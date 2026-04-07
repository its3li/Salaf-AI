import { Message, Attachment } from "../types";

const compressImage = (base64Str: string, maxWidth = 1024, quality = 0.7): Promise<string> => {
    return new Promise((resolve) => {
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
            ctx?.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
    });
};

const uploadImageToDiscord = async (attachment: Attachment, signal?: AbortSignal): Promise<string> => {
    try {
        const compressedData = await compressImage(attachment.data);

        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: compressedData,
                name: attachment.name.replace(/\.[^/.]+$/, ".jpg")
            }),
            signal
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Upload failed: ${error.error || response.statusText}`);
        }

        const data = await response.json();
        return data.url;
    } catch (error) {
        console.error("Error uploading image:", error);
        throw error;
    }
};

const callBackendApi = async (messages: any[], signal?: AbortSignal) => {
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
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
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
    const apiMessages = [];

    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
        if (!msg.isError) {
            apiMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.text
            });
        }
    }

    let userContent: any = text;
    if (attachment) {
        try {
            const imageUrl = await uploadImageToDiscord(attachment, signal);
            userContent = [
                { type: "text", text: text },
                { type: "image_url", image_url: { url: imageUrl } }
            ];
        } catch (e) {
            console.error("Failed to upload attachment", e);
        }
    }

    apiMessages.push({ role: 'user', content: userContent });

    return await callBackendApi(apiMessages, signal);
};
