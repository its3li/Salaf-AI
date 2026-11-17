import type { VercelRequest } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { getClientDeviceId, getClientIp, runRedisCommands } from './limits.js';

// ---------------------------------------------------------------------------
// Daily usage statistics, kept in Redis for 90 days and summarised every morning by /api/stats.
//
// Users are counted with a HyperLogLog, which keeps only a fuzzy fingerprint of each id: it can
// tell how many different users there were (within about 1%) but not who they were. Everything
// here is best-effort: a Redis hiccup must never cost anyone an answer.
// ---------------------------------------------------------------------------

const KEEP_SECONDS = 90 * 86400;

export const statsKeys = {
    day: (day: string) => `salaf:stats:day:${day}`,
    users: (day: string) => `salaf:stats:users:${day}`,
    readers: (day: string) => `salaf:stats:readers:${day}`,
};

/** The UTC day a moment falls on, as the limits count it (they reset at 00:00 UTC). */
export const statsDay = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

const record = async (commands: Array<Array<string | number>>, day: string) => {
    try {
        await runRedisCommands([
            ...commands,
            ['EXPIRE', statsKeys.day(day), KEEP_SECONDS],
            ['EXPIRE', statsKeys.users(day), KEEP_SECONDS],
        ]);
    } catch (error) {
        console.warn('[stats] could not record', { error: error instanceof Error ? error.message : String(error) });
    }
};

/** Counts an answered message and the user who sent it. */
export const recordMessage = (req: VercelRequest, language: string) => {
    const day = statsDay();
    const deviceId = getClientDeviceId(req);
    const user = deviceId ? `device:${deviceId}` : `ip:${getClientIp(req)}`;
    return record(
        [
            ['PFADD', statsKeys.users(day), user],
            ['HINCRBY', statsKeys.day(day), 'messages', 1],
            ['HINCRBY', statsKeys.day(day), `lang_${language}`, 1],
        ],
        day
    );
};

export const BLOG_EVENTS = ['view', 'askMore', 'shareOpen'] as const;
export type BlogEvent = (typeof BLOG_EVENTS)[number];

const BLOG_FIELD: Record<BlogEvent, string> = { view: 'blog_views', askMore: 'blog_ask_more', shareOpen: 'share_opens' };

/** Counts a blog read (and its reader), an "Ask more" press, or an opened shared conversation. */
export const recordBlogEvent = (req: VercelRequest, event: BlogEvent) => {
    const day = statsDay();
    const deviceId = getClientDeviceId(req);
    const reader = deviceId ? `device:${deviceId}` : `ip:${getClientIp(req)}`;
    return record(
        [
            ['HINCRBY', statsKeys.day(day), BLOG_FIELD[event], 1],
            ...(event === 'view' ? [['PFADD', statsKeys.readers(day), reader], ['EXPIRE', statsKeys.readers(day), KEEP_SECONDS]] : []),
        ],
        day
    );
};

/** Counts a transcribed clip: its length, and whether the backup or the cache supplied it. */
export const recordMedia = (seconds: number, provider: 'assemblyai' | 'mai' | 'cache' | 'native') => {
    const day = statsDay();
    return record(
        [
            ['HINCRBY', statsKeys.day(day), 'media_items', 1],
            ['HINCRBY', statsKeys.day(day), 'media_seconds', Math.round(seconds)],
            ...(provider === 'assemblyai' ? [] : [['HINCRBY', statsKeys.day(day), `media_${provider}`, 1]]),
        ],
        day
    );
};

export interface DayStats {
    day: string;
    users: number;
    messages: number;
    languages: Record<string, number>;
    mediaItems: number;
    mediaSeconds: number;
    mediaBackup: number;
    mediaCached: number;
    blogViews: number;
    blogReaders: number;
    blogAskMore: number;
    shareOpens: number;
}

/** One day's numbers, plus how many different users there were over the days given. */
export const readStats = async (day: string, weekDays: string[]): Promise<{ stats: DayStats; weekUsers: number } | null> => {
    const replies = await runRedisCommands([
        ['HGETALL', statsKeys.day(day)],
        ['PFCOUNT', statsKeys.users(day)],
        ['PFCOUNT', ...weekDays.map(statsKeys.users)],
        ['PFCOUNT', statsKeys.readers(day)],
    ]);
    if (!replies) return null;

    // Upstash returns HGETALL as a flat [field, value, field, value…] list.
    const flat = (replies[0]?.result as string[] | null) ?? [];
    const fields: Record<string, number> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) fields[flat[i]] = Number(flat[i + 1]) || 0;
    const languages = Object.fromEntries(
        Object.entries(fields)
            .filter(([field]) => field.startsWith('lang_'))
            .map(([field, count]) => [field.slice(5), count])
    );

    return {
        stats: {
            day,
            users: Number(replies[1]?.result) || 0,
            messages: fields.messages ?? 0,
            languages,
            mediaItems: fields.media_items ?? 0,
            mediaSeconds: fields.media_seconds ?? 0,
            mediaBackup: fields.media_mai ?? 0,
            mediaCached: fields.media_cache ?? 0,
            blogViews: fields.blog_views ?? 0,
            blogReaders: Number(replies[3]?.result) || 0,
            blogAskMore: fields.blog_ask_more ?? 0,
            shareOpens: fields.share_opens ?? 0,
        },
        weekUsers: Number(replies[2]?.result) || 0,
    };
};
