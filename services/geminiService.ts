import { Message, Attachment } from "../types";

type ChatContent =
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

interface ApiMessage {
    role: 'user' | 'assistant';
    content: ChatContent;
}

interface StreamContentPart {
    text?: string;
}

interface StreamPayload {
    choices?: Array<{
        delta?: { content?: string | StreamContentPart[] };
        message?: { content?: string };
    }>;
}

interface ApiErrorResponse {
    error?: {
        code?: string;
        message?: string;
        requestId?: string;
    } | string;
}

export class ChatServiceError extends Error {
    status?: number;
    code?: string;
    requestId?: string;

    constructor(message: string, options: { status?: number; code?: string; requestId?: string } = {}) {
        super(message);
        this.name = 'ChatServiceError';
        this.status = options.status;
        this.code = options.code;
        this.requestId = options.requestId;
    }
}

const compressImage = (base64Str: string, maxWidth = 1024, quality = 0.7): Promise<string> => {
    return new Promise((resolve) => {
        try {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(base64Str);
                    return;
                }
                
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => {
                resolve(base64Str);
            };
        } catch (error) {
            console.error("Failed to compress image:", error);
            resolve(base64Str);
        }
    });
};

const extractStreamText = (payload: StreamPayload): string => {
    const choice = payload?.choices?.[0];

    if (!choice) return "";

    if (typeof choice?.delta?.content === 'string') {
        return choice.delta.content;
    }

    if (typeof choice?.message?.content === 'string') {
        return choice.message.content;
    }

    if (Array.isArray(choice?.delta?.content)) {
        return choice.delta.content
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('');
    }

    return "";
};

const parseApiError = (rawText: string): ApiErrorResponse | null => {
    try {
        return JSON.parse(rawText) as ApiErrorResponse;
    } catch {
        return null;
    }
};

const callBackendApi = async (messages: ApiMessage[], signal?: AbortSignal) => {
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: messages
            }),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            const parsedError = parseApiError(errorText);
            const errorPayload = parsedError?.error;
            const message =
                typeof errorPayload === 'object' && errorPayload?.message
                    ? errorPayload.message
                    : `API Error ${response.status}`;

            throw new ChatServiceError(message, {
                status: response.status,
                code: typeof errorPayload === 'object' ? errorPayload.code : undefined,
                requestId: typeof errorPayload === 'object' ? errorPayload.requestId : undefined,
            });
        }

        if (!response.body) {
            throw new Error('Streaming response body is missing');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let finalText = '';
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith('data:')) continue;

                const dataPart = line.slice(5).trim();
                if (!dataPart || dataPart === '[DONE]') continue;

                try {
                    const payload = JSON.parse(dataPart) as StreamPayload;
                    finalText += extractStreamText(payload);
                } catch {
                    // Ignore malformed chunks and continue parsing the stream.
                }
            }
        }

        if (buffer.trim().startsWith('data:')) {
            const dataPart = buffer.trim().slice(5).trim();
            if (dataPart && dataPart !== '[DONE]') {
                try {
                    const payload = JSON.parse(dataPart) as StreamPayload;
                    finalText += extractStreamText(payload);
                } catch {
                    // Ignore trailing malformed chunk.
                }
            }
        }

        if (!finalText.trim()) {
            throw new ChatServiceError('Empty response from service', {
                code: 'EMPTY_RESPONSE',
            });
        }

        return finalText;
    } catch (error) {
        console.error("Backend API Error:", error);
        throw error;
    }
};

export const sendMessageToGemini = async (
    history: Message[],
    text: string,
    attachment?: Attachment,
    signal?: AbortSignal
): Promise<string> => {
    const apiMessages: ApiMessage[] = [];

    const recentHistory = history.slice(-10);
    
    // The last message in history is the current message we are building.
    // We exclude it from the history loop so we don't push it twice.
    const historyWithoutCurrent = recentHistory.slice(0, -1);

    for (const msg of historyWithoutCurrent) {
        if (!msg.isError) {
            apiMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.text
            });
        }
    }

    let userContent: ChatContent = text;
    if (attachment) {
        try {
            const compressedData = await compressImage(attachment.data);
            const contentArray: Exclude<ChatContent, string> = [];
            if (text.trim()) {
                contentArray.push({ type: "text", text: text });
            }
            contentArray.push({ type: "image_url", image_url: { url: compressedData } });
            
            userContent = contentArray;
        } catch (e) {
            console.error("Failed to compress attachment", e);
        }
    }

    apiMessages.push({ role: 'user', content: userContent });

    return await callBackendApi(apiMessages, signal);
};
