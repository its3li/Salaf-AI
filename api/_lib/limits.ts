import type { VercelRequest } from '@vercel/node';

// ---------------------------------------------------------------------------
// Usage limits shared by /api/chat and /api/media.
//
// Everyone gets a daily budget of credits: a message costs 1, audio/video costs 1 credit per started
// 6 minutes (10 an hour). Audio/video also has its own daily allowance in seconds, a per-network
// ceiling and a site-wide cap, because transcription is paid per second of audio.
//
// Counters live in Redis (Upstash / Vercel KV REST API) when it is configured, so limits hold across
// every serverless instance. Without Redis they fall back to per-instance memory, which still blunts
// bursts but resets whenever an instance is recycled; paid features refuse to run on it in production.
// ---------------------------------------------------------------------------

export const DEFAULT_DAILY_CREDITS = 50;
const DEFAULT_IP_DAILY_CREDITS = 500;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 10;
export const DEFAULT_MEDIA_DAILY_SECONDS = 3600;
const DEFAULT_MEDIA_IP_DAILY_SECONDS = 3 * 3600;
const DEFAULT_MEDIA_SITE_DAILY_SECONDS = 10 * 3600;
export const DEFAULT_MEDIA_MAX_SECONDS = 3 * 3600;
export const MEDIA_SECONDS_PER_CREDIT = 360;

const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export const getNumberEnv = (name: string, fallback: number, min = 1) => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

/** The first of several environment variables that holds a valid number (for renamed settings). */
const getNumberEnvAny = (names: string[], fallback: number, min = 1) => {
    for (const name of names) {
        const value = getNumberEnv(name, Number.NaN, min);
        if (!Number.isNaN(value)) return value;
    }
    return fallback;
};

export const getHeader = (req: VercelRequest, name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
};

export const getClientIp = (req: VercelRequest) =>
    getHeader(req, 'x-forwarded-for')?.split(',')[0]?.trim() || getHeader(req, 'x-real-ip') || 'unknown';

export const getClientDeviceId = (req: VercelRequest) => {
    const raw = getHeader(req, 'x-client-id');
    return raw && CLIENT_ID_PATTERN.test(raw) ? raw : null;
};

/** Credits charged for a piece of audio or video: one per started 6 minutes, at least one. */
export const mediaCreditCost = (seconds: number) => Math.max(1, Math.ceil(seconds / MEDIA_SECONDS_PER_CREDIT));

export const getDailyCreditLimit = () => getNumberEnvAny(['DAILY_CREDIT_LIMIT', 'DAILY_MESSAGE_LIMIT'], DEFAULT_DAILY_CREDITS, 0);

const getMediaLimits = () => ({
    userSeconds: getNumberEnv('MEDIA_DAILY_SECONDS', DEFAULT_MEDIA_DAILY_SECONDS),
    ipSeconds: getNumberEnv('MEDIA_IP_DAILY_SECONDS', DEFAULT_MEDIA_IP_DAILY_SECONDS),
    siteSeconds: getNumberEnv('MEDIA_SITE_DAILY_SECONDS', DEFAULT_MEDIA_SITE_DAILY_SECONDS),
    maxSeconds: getNumberEnv('MEDIA_MAX_SECONDS', DEFAULT_MEDIA_MAX_SECONDS),
});

export const getMediaMaxSeconds = () => getMediaLimits().maxSeconds;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface Store {
    /** True when counters are shared by every instance (Redis), not kept in this instance's memory. */
    shared: boolean;
    incrementBy(key: string, amount: number, expiresAtMs: number): Promise<number>;
    decrementBy(key: string, amount: number): Promise<void>;
    get(key: string): Promise<number>;
    getText(key: string): Promise<string | null>;
    setText(key: string, value: string, ttlSeconds: number): Promise<void>;
    /** Sets the value only when the key does not exist yet; true when this call set it (a lock). */
    setTextIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

const memoryCounters = new Map<string, { count: number; expiresAt: number }>();
const memoryTexts = new Map<string, { value: string; expiresAt: number }>();

const pruneMemory = () => {
    const now = Date.now();
    for (const [key, value] of memoryCounters) {
        if (value.expiresAt <= now) memoryCounters.delete(key);
    }
    for (const [key, value] of memoryTexts) {
        if (value.expiresAt <= now) memoryTexts.delete(key);
    }
};

const memoryStore: Store = {
    shared: false,
    async incrementBy(key, amount, expiresAtMs) {
        pruneMemory();
        const entry = memoryCounters.get(key) ?? { count: 0, expiresAt: expiresAtMs };
        entry.count += amount;
        memoryCounters.set(key, entry);
        return entry.count;
    },
    async decrementBy(key, amount) {
        const entry = memoryCounters.get(key);
        if (entry) entry.count = Math.max(0, entry.count - amount);
    },
    async get(key) {
        pruneMemory();
        return memoryCounters.get(key)?.count ?? 0;
    },
    async getText(key) {
        pruneMemory();
        return memoryTexts.get(key)?.value ?? null;
    },
    async setText(key, value, ttlSeconds) {
        memoryTexts.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async setTextIfAbsent(key, value, ttlSeconds) {
        pruneMemory();
        if (memoryTexts.has(key)) return false;
        memoryTexts.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return true;
    },
};

export const clearMemoryStoreForTests = () => {
    memoryCounters.clear();
    memoryTexts.clear();
};

const getRedisConfig = () => {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
};

const runRedisPipeline = async (
    config: { url: string; token: string },
    commands: Array<Array<string | number>>
) => {
    const response = await fetch(`${config.url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Redis responded with ${response.status}`);
    const replies = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const failed = replies.find((reply) => reply.error);
    if (failed) throw new Error(failed.error);
    return replies;
};

/** Runs raw Redis commands in one round trip; null when Redis isn't configured (local development). */
export const runRedisCommands = (commands: Array<Array<string | number>>) => {
    const config = getRedisConfig();
    return config ? runRedisPipeline(config, commands) : Promise.resolve(null);
};

/**
 * `strict` stores throw when Redis is unreachable; the default falls back to memory so chat keeps
 * working through a Redis outage. Paid features use strict mode so an outage can't lift their limits.
 */
export const getStore = ({ strict = false } = {}): Store => {
    const config = getRedisConfig();
    if (!config) return memoryStore;

    const withFallback = async <T>(run: () => Promise<T>, fallback: () => Promise<T>) => {
        try {
            return await run();
        } catch (error) {
            if (strict) throw error;
            console.error('[limits] Redis unavailable, using memory counters', {
                error: error instanceof Error ? error.message : String(error),
            });
            return fallback();
        }
    };

    return {
        shared: true,
        incrementBy: (key, amount, expiresAtMs) =>
            withFallback(
                async () => {
                    const [incr] = await runRedisPipeline(config, [
                        ['INCRBY', key, amount],
                        ['EXPIREAT', key, Math.ceil(expiresAtMs / 1000)],
                    ]);
                    if (typeof incr?.result !== 'number') throw new Error('Unexpected Redis reply');
                    return incr.result;
                },
                () => memoryStore.incrementBy(key, amount, expiresAtMs)
            ),
        decrementBy: (key, amount) =>
            withFallback(
                async () => {
                    await runRedisPipeline(config, [['DECRBY', key, amount]]);
                },
                () => memoryStore.decrementBy(key, amount)
            ),
        get: (key) =>
            withFallback(
                async () => {
                    const [reply] = await runRedisPipeline(config, [['GET', key]]);
                    return Number(reply?.result ?? 0) || 0;
                },
                () => memoryStore.get(key)
            ),
        getText: (key) =>
            withFallback(
                async () => {
                    const [reply] = await runRedisPipeline(config, [['GET', key]]);
                    return typeof reply?.result === 'string' ? reply.result : null;
                },
                () => memoryStore.getText(key)
            ),
        setText: (key, value, ttlSeconds) =>
            withFallback(
                async () => {
                    await runRedisPipeline(config, [['SET', key, value, 'EX', ttlSeconds]]);
                },
                () => memoryStore.setText(key, value, ttlSeconds)
            ),
        setTextIfAbsent: (key, value, ttlSeconds) =>
            withFallback(
                async () => {
                    const [reply] = await runRedisPipeline(config, [['SET', key, value, 'NX', 'EX', ttlSeconds]]);
                    return reply?.result === 'OK';
                },
                () => memoryStore.setTextIfAbsent(key, value, ttlSeconds)
            ),
    };
};

// ---------------------------------------------------------------------------
// Identity and day keys
// ---------------------------------------------------------------------------

const getNextUtcMidnight = (now: number) => {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};

interface Identity {
    day: string;
    resetAt: number;
    /** Per device (anonymous id from the browser), or per IP for clients that send none. */
    user: string;
    ip: string;
}

const getIdentity = (req: VercelRequest, now = Date.now()): Identity => {
    const deviceId = getClientDeviceId(req);
    const ip = getClientIp(req);
    return {
        day: new Date(now).toISOString().slice(0, 10),
        resetAt: getNextUtcMidnight(now),
        user: deviceId ? `device:${deviceId}` : `ip:${ip}`,
        ip,
    };
};

const creditKeys = (identity: Pick<Identity, 'day' | 'user' | 'ip'>) => ({
    user: `salaf:credits:${identity.user}:${identity.day}`,
    ip: `salaf:credits:ipceiling:${identity.ip}:${identity.day}`,
});

const mediaKeys = (identity: Pick<Identity, 'day' | 'user' | 'ip'>) => ({
    user: `salaf:media:${identity.user}:${identity.day}`,
    ip: `salaf:media:ipceiling:${identity.ip}:${identity.day}`,
    site: `salaf:media:site:${identity.day}`,
});

const getIpCreditLimit = (dailyLimit: number) =>
    Math.max(dailyLimit, getNumberEnvAny(['IP_DAILY_CREDIT_LIMIT', 'IP_DAILY_MESSAGE_LIMIT'], DEFAULT_IP_DAILY_CREDITS));

/** Counts a request against a per-IP, per-minute limit for one kind of request; true when it may go on. */
export const allowBurst = async (req: VercelRequest, name: string, max: number) => {
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const count = await getStore().incrementBy(`salaf:burst:${name}:${getClientIp(req)}:${windowStart}`, 1, windowStart + 60_000);
    return count <= max;
};

// ---------------------------------------------------------------------------
// Credits for chat messages
// ---------------------------------------------------------------------------

export interface QuotaStatus {
    limit: number;
    remaining: number;
    resetAt: number;
}

export interface QuotaReservation {
    allowed: boolean;
    reason?: 'burst' | 'daily';
    retryAfterSeconds: number;
    quota: QuotaStatus | null;
    release: () => Promise<void>;
}

/**
 * Charges one credit for a chat message, after the per-minute burst limit. The daily budget is
 * tracked per device with a higher per-IP ceiling so clearing browser storage cannot be used to
 * bypass it. `release` refunds the credit when the answer never reached the user.
 */
export const reserveMessageCredit = async (req: VercelRequest): Promise<QuotaReservation> => {
    const store = getStore();
    const now = Date.now();
    const identity = getIdentity(req, now);

    const burstWindowMs = getNumberEnv('CHAT_RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS, 1000);
    const burstMax = getNumberEnv('CHAT_RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX);
    const burstWindowStart = Math.floor(now / burstWindowMs) * burstWindowMs;
    const burstCount = await store.incrementBy(
        `salaf:burst:${identity.ip}:${burstWindowStart}`,
        1,
        burstWindowStart + burstWindowMs
    );
    if (burstCount > burstMax) {
        return {
            allowed: false,
            reason: 'burst',
            retryAfterSeconds: Math.max(1, Math.ceil((burstWindowStart + burstWindowMs - now) / 1000)),
            quota: null,
            release: async () => {},
        };
    }

    const dailyLimit = getDailyCreditLimit();
    if (dailyLimit === 0) {
        return { allowed: true, retryAfterSeconds: 0, quota: null, release: async () => {} };
    }

    const keys = creditKeys(identity);
    const [userCount, ipCount] = await Promise.all([
        store.incrementBy(keys.user, 1, identity.resetAt),
        store.incrementBy(keys.ip, 1, identity.resetAt),
    ]);
    const release = async () => {
        await Promise.all([store.decrementBy(keys.user, 1), store.decrementBy(keys.ip, 1)]);
    };

    const quota: QuotaStatus = {
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - userCount),
        resetAt: identity.resetAt,
    };

    if (userCount > dailyLimit || ipCount > getIpCreditLimit(dailyLimit)) {
        await release();
        return {
            allowed: false,
            reason: 'daily',
            retryAfterSeconds: Math.max(1, Math.ceil((identity.resetAt - now) / 1000)),
            quota: { ...quota, remaining: 0 },
            release: async () => {},
        };
    }

    return { allowed: true, retryAfterSeconds: 0, quota, release };
};

// ---------------------------------------------------------------------------
// Audio and video
// ---------------------------------------------------------------------------

export interface MediaAllowance {
    credits: QuotaStatus;
    /** Seconds of audio/video still available today (0 once the daily allowance is used up). */
    mediaRemainingSeconds: number;
    mediaLimitSeconds: number;
    maxSeconds: number;
}

/** Reads what a user has left today without charging anything. */
export const getMediaAllowance = async (req: VercelRequest): Promise<MediaAllowance> => {
    const store = getStore({ strict: true });
    const identity = getIdentity(req);
    const limits = getMediaLimits();
    const dailyLimit = getDailyCreditLimit();
    const [creditsUsed, mediaUsed] = await Promise.all([
        store.get(creditKeys(identity).user),
        store.get(mediaKeys(identity).user),
    ]);
    return {
        credits: { limit: dailyLimit, remaining: Math.max(0, dailyLimit - creditsUsed), resetAt: identity.resetAt },
        mediaRemainingSeconds: Math.max(0, limits.userSeconds - mediaUsed),
        mediaLimitSeconds: limits.userSeconds,
        maxSeconds: limits.maxSeconds,
    };
};

/** What was charged for one piece of audio/video; carried in the signed job token until it settles. */
export interface MediaCharge {
    day: string;
    user: string;
    ip: string;
    resetAt: number;
    seconds: number;
    credits: number;
}

export type MediaRefusal = 'MEDIA_TOO_LONG' | 'MEDIA_DAILY_LIMIT' | 'NOT_ENOUGH_CREDITS' | 'MEDIA_SITE_LIMIT';

export type MediaChargeResult =
    | { allowed: true; charge: MediaCharge; quota: QuotaStatus }
    | { allowed: false; reason: MediaRefusal; quota: QuotaStatus | null; resetAt: number };

/**
 * Charges credits and seconds for a piece of audio/video before it is transcribed. It may start as
 * long as some of today's allowance is left, and then counts in full ("let it pass fully"). The user
 * must also have enough credits for it plus the question that goes with it.
 */
export const chargeMedia = async (req: VercelRequest, seconds: number): Promise<MediaChargeResult> => {
    const store = getStore({ strict: true });
    const identity = getIdentity(req);
    const limits = getMediaLimits();
    const dailyCredits = getDailyCreditLimit();
    const credits = mediaCreditCost(seconds);
    const refuse = (reason: MediaRefusal, quota: QuotaStatus | null = null): MediaChargeResult => ({
        allowed: false,
        reason,
        quota,
        resetAt: identity.resetAt,
    });

    if (seconds > limits.maxSeconds) return refuse('MEDIA_TOO_LONG');

    const cKeys = creditKeys(identity);
    const mKeys = mediaKeys(identity);
    const [userCredits, ipCredits, userSeconds, ipSeconds, siteSeconds] = await Promise.all([
        store.incrementBy(cKeys.user, credits, identity.resetAt),
        store.incrementBy(cKeys.ip, credits, identity.resetAt),
        store.incrementBy(mKeys.user, seconds, identity.resetAt),
        store.incrementBy(mKeys.ip, seconds, identity.resetAt),
        store.incrementBy(mKeys.site, seconds, identity.resetAt),
    ]);
    const charge: MediaCharge = { ...identity, seconds, credits };
    const quota: QuotaStatus = {
        limit: dailyCredits,
        remaining: Math.max(0, dailyCredits - userCredits),
        resetAt: identity.resetAt,
    };

    // Every check looks at the total *before* this item, so the item that crosses a line still passes.
    let reason: MediaRefusal | null = null;
    if (userSeconds - seconds >= limits.userSeconds) reason = 'MEDIA_DAILY_LIMIT';
    else if (ipSeconds - seconds >= limits.ipSeconds) reason = 'MEDIA_DAILY_LIMIT';
    else if (siteSeconds - seconds >= limits.siteSeconds) reason = 'MEDIA_SITE_LIMIT';
    // Credits are the exception: the question that goes with the media needs one more.
    else if (dailyCredits > 0 && (userCredits + 1 > dailyCredits || ipCredits > getIpCreditLimit(dailyCredits))) {
        reason = 'NOT_ENOUGH_CREDITS';
    }

    if (reason) {
        await refundMedia(charge);
        return refuse(reason, { ...quota, remaining: Math.max(0, dailyCredits - (userCredits - credits)) });
    }
    return { allowed: true, charge, quota };
};

/** Gives back part or all of a charge, e.g. when transcription failed or the audio was shorter. */
export const refundMedia = async (charge: MediaCharge, { seconds = charge.seconds, credits = charge.credits } = {}) => {
    if (seconds <= 0 && credits <= 0) return;
    const store = getStore({ strict: true });
    const cKeys = creditKeys(charge);
    const mKeys = mediaKeys(charge);
    await Promise.all([
        credits > 0 && store.decrementBy(cKeys.user, credits),
        credits > 0 && store.decrementBy(cKeys.ip, credits),
        seconds > 0 && store.decrementBy(mKeys.user, seconds),
        seconds > 0 && store.decrementBy(mKeys.ip, seconds),
        seconds > 0 && store.decrementBy(mKeys.site, seconds),
    ]);
};

/**
 * Corrects a charge to the real length once transcription is done: refunds the difference when the
 * audio was shorter than estimated, and charges the rest when it was longer.
 */
export const settleMedia = async (charge: MediaCharge, actualSeconds: number): Promise<MediaCharge> => {
    const seconds = Math.max(1, Math.round(actualSeconds));
    const credits = mediaCreditCost(seconds);
    const settled = { ...charge, seconds, credits };
    if (seconds < charge.seconds || credits < charge.credits) {
        await refundMedia(charge, {
            seconds: Math.max(0, charge.seconds - seconds),
            credits: Math.max(0, charge.credits - credits),
        });
    }
    if (seconds > charge.seconds || credits > charge.credits) {
        const store = getStore({ strict: true });
        const cKeys = creditKeys(charge);
        const mKeys = mediaKeys(charge);
        const extraSeconds = Math.max(0, seconds - charge.seconds);
        const extraCredits = Math.max(0, credits - charge.credits);
        await Promise.all([
            extraCredits > 0 && store.incrementBy(cKeys.user, extraCredits, charge.resetAt),
            extraCredits > 0 && store.incrementBy(cKeys.ip, extraCredits, charge.resetAt),
            extraSeconds > 0 && store.incrementBy(mKeys.user, extraSeconds, charge.resetAt),
            extraSeconds > 0 && store.incrementBy(mKeys.ip, extraSeconds, charge.resetAt),
            extraSeconds > 0 && store.incrementBy(mKeys.site, extraSeconds, charge.resetAt),
        ]);
    }
    return settled;
};
