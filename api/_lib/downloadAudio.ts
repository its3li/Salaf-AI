import { lookup } from 'node:dns/promises';
import { NATIVE_MAX_BYTES } from './nativeFiles.js';

export class AudioDownloadError extends Error {}
const privateAddress = (address: string) => /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::|fc|fd|fe80:)/i.test(address);
export async function downloadYoutubeAudio(raw: string, signal: AbortSignal): Promise<{ bytes: Buffer; mimeType: string }> {
    let url = new URL(raw);
    for (let redirect = 0; redirect < 4; redirect++) {
        if (url.protocol !== 'https:' || url.username || url.password) throw new AudioDownloadError('Invalid audio download URL');
        const addresses = await lookup(url.hostname, { all: true });
        if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw new AudioDownloadError('Private audio URL refused');
        const response = await fetch(url, { signal, redirect: 'manual' });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location'); await response.body?.cancel();
            if (!location) throw new AudioDownloadError('Invalid audio redirect');
            url = new URL(location, url); continue;
        }
        if (!response.ok || !response.body) throw new AudioDownloadError('YouTube audio could not be downloaded');
        const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
        for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length;
            if (size > NATIVE_MAX_BYTES) { await reader.cancel(); throw new AudioDownloadError('YouTube audio exceeds the 12 MB limit'); }
            chunks.push(chunk.value);
        }
        const bytes = Buffer.concat(chunks);
        const mimeType = bytes.subarray(4, 8).toString() === 'ftyp' ? 'audio/mp4' :
            bytes.subarray(0, 4).toString() === 'RIFF' ? 'audio/wav' :
            bytes.subarray(0, 4).toString() === 'fLaC' ? 'audio/flac' :
            bytes.subarray(0, 4).toString() === 'OggS' ? 'audio/ogg' : 'audio/mpeg';
        return { bytes, mimeType };
    }
    throw new AudioDownloadError('Too many audio redirects');
}
