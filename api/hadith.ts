import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { fetchDorarResults } from './_lib/research.js';

// Public hadith lookup for the landing page: a visitor types a fragment and sees how Dorar.net's
// scholars graded it. It never calls the model, so it does not use the daily question allowance.

const MAX_RESULTS = 5;
const MIN_QUERY_CHARS = 3;
const MAX_QUERY_CHARS = 120;
const LIMIT_PER_MINUTE = 15;

const lookups = new Map<string, { count: number; resetAt: number }>();

const isRateLimited = (req: VercelRequest) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    for (const [key, value] of lookups) {
        if (value.resetAt <= now) lookups.delete(key);
    }
    const entry = lookups.get(ip) ?? { count: 0, resetAt: now + 60_000 };
    entry.count += 1;
    lookups.set(ip, entry);
    return entry.count > LIMIT_PER_MINUTE;
};

export const clearHadithRateLimitForTests = () => lookups.clear();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    }

    const query = String(req.query.q ?? '').trim();
    if (query.length < MIN_QUERY_CHARS || query.length > MAX_QUERY_CHARS) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    }

    if (isRateLimited(req)) {
        return res.status(429).json({ error: { code: 'RATE_LIMITED' } });
    }

    try {
        // Dorar lists narrations in no particular order; put al-Bukhari's and Muslim's first so the
        // strongest chain is seen before weaker ones. Every result keeps its own grading.
        const rank = (source = '') => (/صحيح البخاري|صحيح مسلم/.test(source) ? 0 : 1);
        const results = (await fetchDorarResults(query, AbortSignal.timeout(28_000)))
            .map((entry, index) => ({ entry, index }))
            .sort((a, b) => rank(a.entry.source) - rank(b.entry.source) || a.index - b.index)
            .slice(0, MAX_RESULTS)
            .map(({ entry }) => entry);
        // Gradings do not change; let Vercel's CDN answer repeated lookups for a day.
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json({
            query,
            source: `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`,
            results,
        });
    } catch (error) {
        console.warn('[api/hadith] Dorar lookup failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(502).json({ error: { code: 'UPSTREAM_ERROR' } });
    }
}
