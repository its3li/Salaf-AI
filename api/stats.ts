import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { readStats, statsDay, type DayStats } from './_lib/stats.js';

// ---------------------------------------------------------------------------
// /api/stats posts yesterday's usage to the Discord channel every morning, just after the daily
// reset (Vercel Cron, see vercel.json). Vercel signs cron requests with `Authorization: Bearer
// $CRON_SECRET`; anything else is turned away. `?day=YYYY-MM-DD` picks another day and `?dryRun=1`
// returns the numbers without posting, for checking by hand with the same header.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const GOLD = 13938487;
const LANGUAGE_NAMES: Record<string, string> = { ar: 'العربية', ur: 'الأردية', fa: 'الفارسية' };

const formatNumber = (value: number) => new Intl.NumberFormat('ar-u-nu-arab').format(value);

const describeMedia = (stats: DayStats) => {
    if (stats.mediaItems === 0) return 'لا شيء';
    const parts = [`${formatNumber(stats.mediaItems)} · ${formatNumber(Math.round(stats.mediaSeconds / 60))} دقيقة`];
    if (stats.mediaCached > 0) parts.push(`${formatNumber(stats.mediaCached)} من الذاكرة دون تكلفة`);
    // Worth knowing: AssemblyAI failing (or out of balance) shows up here first.
    if (stats.mediaBackup > 0) parts.push(`⚠️ ${formatNumber(stats.mediaBackup)} بالخدمة الاحتياطية`);
    return parts.join('\n');
};

export const buildReport = (stats: DayStats, weekUsers: number) => {
    const languages = Object.entries(stats.languages)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([language, count]) => `${LANGUAGE_NAMES[language] ?? language} ${formatNumber(count)}`)
        .join(' · ');
    return {
        embeds: [
            {
                title: `إحصاء يوم ${stats.day}`,
                color: GOLD,
                fields: [
                    { name: 'المستخدمون', value: formatNumber(stats.users), inline: true },
                    { name: 'الرسائل', value: formatNumber(stats.messages), inline: true },
                    {
                        name: 'لكل مستخدم',
                        value: stats.users > 0 ? formatNumber(Math.round((stats.messages / stats.users) * 10) / 10) : '—',
                        inline: true,
                    },
                    { name: 'اللغات', value: languages || '—' },
                    { name: 'المقاطع', value: describeMedia(stats) },
                    { name: 'مستخدمون مختلفون في آخر ٧ أيام', value: formatNumber(weekUsers) },
                ],
                footer: { text: 'اليوم من منتصف الليل إلى منتصف الليل بتوقيت UTC (٣ فجرًا بتوقيت السعودية)' },
            },
        ],
    };
};

const isAuthorized = (req: VercelRequest) => {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

    const requested = typeof req.query?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : null;
    const day = requested ?? statsDay(Date.now() - DAY_MS);
    const noon = Date.parse(`${day}T12:00:00Z`);
    const week = Array.from({ length: 7 }, (_, i) => statsDay(noon - i * DAY_MS));

    const result = await readStats(day, week);
    if (!result) return res.status(503).json({ error: 'Redis is not configured' });

    const webhook = process.env.STATS_WEBHOOK_URL || process.env.FEEDBACK_WEBHOOK_URL;
    let sent = false;
    if (webhook && req.query?.dryRun !== '1') {
        try {
            const response = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildReport(result.stats, result.weekUsers)),
                signal: AbortSignal.timeout(10_000),
            });
            sent = response.ok;
            if (!response.ok) console.error('[api/stats] Discord refused the report', { status: response.status });
        } catch (error) {
            console.error('[api/stats] could not post the report', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    console.info('[api/stats] report', { ...result.stats, weekUsers: result.weekUsers, sent });
    return res.status(200).json({ ...result, sent });
}
