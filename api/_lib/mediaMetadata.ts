import { parseBuffer } from 'music-metadata';

export class MediaMetadataError extends Error {}
/** Reads media headers/frames locally, not speech-to-text. Never trust a client-supplied duration. */
export async function verifiedMediaSeconds(bytes: Uint8Array, mimeType: string, audioOnly = false): Promise<number> {
    try {
        const metadata = await parseBuffer(bytes, { mimeType, size: bytes.length }, { duration: true, skipCovers: true });
        if (audioOnly && metadata.format.hasVideo) throw new MediaMetadataError('Expected audio without video frames');
        const durations = [metadata.format.duration, metadata.format.containerDuration,
            ...metadata.format.trackInfo.map(track => track.duration)].filter((value): value is number => Number.isFinite(value) && (value || 0) > 0);
        if (!durations.length) throw new MediaMetadataError('Could not determine media duration');
        return Math.ceil(Math.max(...durations));
    } catch { throw new MediaMetadataError('Could not verify media duration; use MP3, WAV or a standard MP4'); }
}
