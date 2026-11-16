import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { del } from '@vercel/blob';
import { getClientDeviceId, getClientIp, getStore, runRedisCommands } from './limits.js';
import { getSigningSecret } from './media.js';

export interface NativeFile {
    kind: 'audio' | 'video' | 'youtube' | 'pdf';
    title: string;
    mimeType: string;
    durationSec: number;
    byteLength: number;
    data?: string;
    blobUrl?: string;
    videoId?: string;
    owner: string;
    expiresAt: number;
    signature: string;
}
export const NATIVE_INLINE_BYTES = 2 * 1024 * 1024;
// Inline Gemini requests must stay under its ~20 MB request limit after base64 encoding.
export const NATIVE_MAX_BYTES = 12 * 1024 * 1024;
export const NATIVE_TTL_SECONDS = 24 * 3600;
const CLEANUP_KEY = 'salaf:native:cleanup:v1';
export const NATIVE_MIME_TYPES = ['application/pdf', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/webm', 'video/mp4', 'video/webm', 'video/quicktime'];
export const nativeOwner = (req: VercelRequest) => createHmac('sha256', getSigningSecret() || 'local-owner')
    .update(getClientDeviceId(req) || getClientIp(req)).digest('base64url');
const canonical = (file: Omit<NativeFile, 'signature'>) => JSON.stringify([
    1, file.kind, file.title, file.mimeType, file.durationSec, file.byteLength,
    file.data || '', file.blobUrl || '', file.videoId || '', file.owner, file.expiresAt,
]);
export const signNativeFile = (file: Omit<NativeFile, 'signature'>): NativeFile => {
    const secret = getSigningSecret();
    if (!secret) throw new Error('Missing media signing secret');
    return { ...file, signature: createHmac('sha256', secret).update(canonical(file)).digest('base64url') };
};
export const isBlobUrl = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com') &&
            !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
};
export const verifyNativeFile = (value: unknown, req: VercelRequest): value is NativeFile => {
    const secret = getSigningSecret();
    if (!secret || !value || typeof value !== 'object') return false;
    const f = value as NativeFile;
    if (!['audio', 'video', 'youtube', 'pdf'].includes(f.kind) || typeof f.title !== 'string' || f.title.length > 300 ||
        typeof f.signature !== 'string' || f.owner !== nativeOwner(req) || !Number.isFinite(f.expiresAt) || f.expiresAt <= Date.now() ||
        !Number.isFinite(f.durationSec) || f.durationSec < 0 || !Number.isSafeInteger(f.byteLength) || f.byteLength < 0 || f.byteLength > NATIVE_MAX_BYTES ||
        !NATIVE_MIME_TYPES.includes(f.mimeType)) return false;
    if (f.kind === 'youtube') {
        if (!/^[A-Za-z0-9_-]{11}$/.test(f.videoId || '') || !f.mimeType.startsWith('audio/')) return false;
    }
    if (typeof f.data === 'string') {
        if (f.blobUrl || f.data.length > Math.ceil(NATIVE_INLINE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+=*$/.test(f.data) ||
            Buffer.from(f.data, 'base64').length !== f.byteLength) return false;
    } else if (!isBlobUrl(f.blobUrl)) return false;
    const expected = createHmac('sha256', secret).update(canonical(f)).digest();
    const actual = Buffer.from(f.signature, 'base64url');
    return actual.length === expected.length && timingSafeEqual(expected, actual);
};

export async function getNativeBytes(file: Pick<NativeFile, 'data' | 'blobUrl' | 'byteLength'>, signal: AbortSignal): Promise<string> {
    if (file.data) return file.data;
    if (!isBlobUrl(file.blobUrl)) throw new Error('Invalid file reference');
    const response = await fetch(file.blobUrl, { signal, redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('Attached file is unavailable; attach it again');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > NATIVE_MAX_BYTES || size > file.byteLength) { await reader.cancel(); throw new Error('Attached file is too large'); }
        chunks.push(chunk.value);
    }
    if (size !== file.byteLength) throw new Error('Attached file changed');
    return Buffer.concat(chunks).toString('base64');
}

export async function retainNativeBlob(url: string) {
    if (getStore().shared) await runRedisCommands([['ZADD', CLEANUP_KEY, Date.now() + NATIVE_TTL_SECONDS * 1000, url]]);
}
/** Called by the existing authenticated daily stats cron, also in bounded batches on media requests. */
export async function cleanupNativeBlobs() {
    if (!getStore().shared) return;
    const result = await runRedisCommands([['ZRANGEBYSCORE', CLEANUP_KEY, 0, Date.now(), 'LIMIT', 0, 25]]);
    for (const url of (result?.[0]?.result as string[] || [])) {
        if (!isBlobUrl(url)) continue;
        try { await del(url); await runRedisCommands([['ZREM', CLEANUP_KEY, url]]); }
        catch { console.warn('[media] expired upload cleanup failed'); }
    }
}
