import { getNumberEnv, getStore, runRedisCommands } from './limits.js';

export const getChatProvider = () => process.env.CHAT_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini';

export const getGeminiConfig = () => {
    // The benchmark aliases are local-only: deployment must explicitly configure the app's key.
    const local = !process.env.VERCEL;
    const apiKey = process.env.GEMINI_API_KEY || (local ? process.env.BENCHMARK_API_KEY : undefined);
    const raw = process.env.GEMINI_BASE_URL || (local ? process.env.BENCHMARK_BASE_URL : undefined) ||
        'https://generativelanguage.googleapis.com/v1beta';
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
        throw new Error('Invalid Gemini endpoint configuration');
    }
    // 8sToken documents its native Gemini endpoint under /v1beta, not the generic /models route.
    if (['8stoken.com', 'api.8stoken.com', 'cdn.8stoken.com'].includes(url.hostname) && url.pathname === '/') url.pathname = '/v1beta';
    const effort = process.env.CHAT_EFFORT?.toUpperCase();
    return {
        apiKey,
        baseURL: url.toString().replace(/\/+$/, ''),
        model: process.env.GEMINI_MODEL || (local ? process.env.BENCHMARK_MODEL : undefined) || 'gemini-4-hydrogen',
        thinkingLevel: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'].includes(effort || '') ? effort : 'LOW',
        timeoutMs: Math.min(getNumberEnv('GEMINI_TIMEOUT_MS', local ? 600_000 : 250_000), local ? 900_000 : 270_000),
    };
};

export interface GeminiPart {
    text?: string;
    thought?: boolean;
    thoughtSignature?: string;
    inlineData?: { mimeType: string; data: string };
    fileData?: { mimeType: string; fileUri: string };
    functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
    functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}
export interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }
export interface GeminiResponse {
    candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number;
        billing_usage?: { source?: string; openai_usage?: { prompt_tokens_details?: { image_tokens?: number; audio_tokens?: number } } } };
}

export class GeminiError extends Error {
    constructor(readonly status: number, message: string, readonly reason: 'provider' | 'queue' | 'unsupported_audio' | 'unsupported_attachment' = 'provider', readonly diagnostic?: string) { super(message); }
}

// One upstream request per instance, and per site when Redis is configured. Never resend a timed-out
// generation automatically: the provider may have billed it even if its response was lost.
const localStateKey = Symbol.for('salaf.gemini.local-slot');
const globalSlots = globalThis as unknown as Record<symbol, { owner: string | null; expiresAt: number }>;
const localSlot = globalSlots[localStateKey] ??= { owner: null, expiresAt: 0 };
const SLOT_KEY = 'salaf:gemini:slot:v1';
export async function generateGemini(body: Record<string, unknown>, signal: AbortSignal): Promise<GeminiResponse> {
    const config = getGeminiConfig();
    if (!config.apiKey) throw new GeminiError(401, 'Missing Gemini credentials');
    const owner = crypto.randomUUID();
    let shared = false;
    const waitingAt = Date.now();
    for (;;) {
        signal.throwIfAborted();
        if (Date.now() - waitingAt > 45_000) throw new GeminiError(429, 'Another answer is being prepared', 'queue');
        if (getStore().shared) {
            const result = await runRedisCommands([['SET', SLOT_KEY, owner, 'NX', 'PX', config.timeoutMs + 5000]]);
            if (result?.[0]?.result === 'OK') { shared = true; break; }
        } else {
            // Persist across module reloads, but recover if a terminated request left a stale slot.
            if (localSlot.expiresAt <= Date.now()) localSlot.owner = null;
            if (!localSlot.owner) { localSlot.owner = owner; localSlot.expiresAt = Date.now() + config.timeoutMs + 5000; break; }
        }
        await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 300);
            signal.addEventListener('abort', abort, { once: true });
        });
    }
    try {
        const response = await fetch(`${config.baseURL}/models/${encodeURIComponent(config.model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
        });
        if (!response.ok) {
            // Read only a bounded error prefix for classification. Never log the body or echo it to clients.
            let errorText = '';
            if (response.body && [400, 415, 422].includes(response.status)) {
                const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
                try {
                    while (size < 4096) {
                        const chunk = await reader.read(); if (chunk.done) break;
                        const part = chunk.value.subarray(0, 4096 - size); size += part.length; chunks.push(part);
                    }
                    errorText = Buffer.concat(chunks).toString('utf8');
                } finally { await reader.cancel().catch(() => {}); }
            } else await response.body?.cancel();
            const audioUnsupported = response.status === 415 ||
                (/audio/i.test(errorText) && /unsupported|not.supported|not.accepted|cannot.*(?:process|accept)|invalid.*(?:mime|format)/i.test(errorText));
            const attachmentUnsupported = /pdf|video|attachment|file|mime|media/i.test(errorText) &&
                /unsupported|not.supported|not.accepted|cannot.*(?:process|accept)|invalid.*(?:mime|format)/i.test(errorText);
            let diagnostic: string | undefined;
            try { const parsed = JSON.parse(errorText); diagnostic = String(parsed.error?.message || '').replaceAll(config.apiKey, '[redacted]').slice(0, 700); } catch { /* Some providers return non-JSON errors; keep them private. */ }
            throw new GeminiError(response.status, `Gemini provider returned HTTP ${response.status}`,
                response.status === 415 ? 'unsupported_attachment' : audioUnsupported ? 'unsupported_audio' : attachmentUnsupported ? 'unsupported_attachment' : 'provider', diagnostic);
        }
        return await response.json() as GeminiResponse;
    } finally {
        if (shared) {
            await runRedisCommands([['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, SLOT_KEY, owner]]).catch(() => {});
        } else if (localSlot.owner === owner) { localSlot.owner = null; localSlot.expiresAt = 0; }
    }
}
