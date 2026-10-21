import { createHmac, timingSafeEqual } from 'node:crypto';

// Shared by /api/media (which produces transcripts) and /api/chat (which only accepts transcripts this
// server signed, so nobody can pass off arbitrary text as a "transcript" to get around the limits).

export type MediaKind = 'youtube' | 'audio' | 'video';

/** A finished transcript as the browser stores it and sends it back with chat messages. */
export interface MediaTranscript {
    kind: MediaKind;
    title: string;
    channel?: string;
    videoId?: string;
    durationSec: number;
    /** Lines like "[12:34] text"; times are approximate when `approximateTimes` is set. */
    transcript: string;
    approximateTimes?: boolean;
    signature: string;
}

export const MAX_TRANSCRIPT_CHARS = 150_000;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const getSigningSecret = () => process.env.MEDIA_SIGNING_SECRET?.trim() || null;

/** Video id from any common YouTube link (watch, youtu.be, shorts, live, embed, music), or null. */
export const parseYoutubeId = (raw: string): string | null => {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') {
        id = url.pathname.split('/')[1] ?? null;
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        else {
            const [, section, value] = url.pathname.split('/');
            if (['shorts', 'live', 'embed', 'v'].includes(section)) id = value ?? null;
        }
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
};

/** "1:23:54" / "50:52" / "0:07" for a number of seconds. */
export const formatTimestamp = (totalSeconds: number) => {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
};

/** Parses "1:23:54" or "50:52" into seconds, or null. */
export const parseClock = (value: string): number | null => {
    const parts = value.trim().split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
};

interface TimedWord {
    text: string;
    /** Milliseconds. */
    start: number;
    end: number;
}

/**
 * Groups word timings into lines of roughly 6-15 seconds, breaking at natural pauses, so the model
 * can point to a moment ("at 50:52 the sheikh says…") without paying for a timestamp on every word.
 */
export const linesFromWords = (words: TimedWord[]) => {
    const lines: string[] = [];
    let current: TimedWord[] = [];
    words.forEach((word, index) => {
        current.push(word);
        const next = words[index + 1];
        const span = word.end - current[0].start;
        const pause = next ? next.start - word.end : Infinity;
        if ((pause > 700 && span > 6000) || span > 15000 || !next) {
            lines.push(`[${formatTimestamp(current[0].start / 1000)}] ${current.map((w) => w.text).join(' ')}`);
            current = [];
        }
    });
    return lines.join('\n');
};

interface TimedSegment {
    /** Seconds. */
    start: number;
    end: number;
    text: string;
}

const WORDS_PER_LINE = 35;

/**
 * Lines from coarse segments (the backup provider returns a few per ten minutes). Long segments are
 * split into ~35-word lines whose times are spread evenly across the segment, so they are estimates.
 */
export const linesFromSegments = (segments: TimedSegment[]) => {
    const lines: string[] = [];
    for (const segment of segments) {
        const words = segment.text.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) continue;
        const duration = Math.max(0, segment.end - segment.start);
        for (let i = 0; i < words.length; i += WORDS_PER_LINE) {
            const at = segment.start + (duration * i) / words.length;
            lines.push(`[${formatTimestamp(at)}] ${words.slice(i, i + WORDS_PER_LINE).join(' ')}`);
        }
    }
    return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

type SignedFields = Omit<MediaTranscript, 'signature'>;

const canonical = (media: SignedFields) =>
    JSON.stringify([
        1,
        media.kind,
        media.title,
        media.channel ?? '',
        media.videoId ?? '',
        media.durationSec,
        media.approximateTimes ? 1 : 0,
        media.transcript,
    ]);

export const signTranscript = (media: SignedFields, secret: string): MediaTranscript => ({
    ...media,
    signature: createHmac('sha256', secret).update(canonical(media)).digest('base64url'),
});

const MEDIA_KINDS: MediaKind[] = ['youtube', 'audio', 'video'];

/** Checks the shape of a transcript sent back by the browser and that this server signed it. */
export const verifyTranscript = (value: unknown, secret: string | null): value is MediaTranscript => {
    if (!secret || !value || typeof value !== 'object') return false;
    const media = value as Partial<MediaTranscript>;
    if (
        !MEDIA_KINDS.includes(media.kind as MediaKind) ||
        typeof media.title !== 'string' ||
        media.title.length > 300 ||
        (media.channel !== undefined && typeof media.channel !== 'string') ||
        (media.videoId !== undefined && (typeof media.videoId !== 'string' || !YOUTUBE_ID.test(media.videoId))) ||
        typeof media.durationSec !== 'number' ||
        !Number.isFinite(media.durationSec) ||
        typeof media.transcript !== 'string' ||
        media.transcript.length > MAX_TRANSCRIPT_CHARS ||
        typeof media.signature !== 'string'
    ) {
        return false;
    }
    const expected = createHmac('sha256', secret).update(canonical(media as SignedFields)).digest();
    const given = Buffer.from(media.signature, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
};
