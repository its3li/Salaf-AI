import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { readShare, SHARE_ID_PATTERN, type SharedConversation } from './_lib/shares.js';

/*
 * /s/<id> lands here (see vercel.json). It serves the app's own page with the shared question as
 * its title and preview, and the conversation as plain text inside it, so link previews in
 * WhatsApp/Telegram and search engines see the content without running the app. The app then
 * takes over the page and shows the conversation with the full answer styling.
 */

const SITE = 'https://salaf-ai.vercel.app';
const SITE_NAME: Record<string, string> = { ar: 'باحث السلف', en: 'Salaf AI', ur: 'باحث السلف', fa: 'باحث السلف' };
const LOCALE: Record<string, string> = { ar: 'ar_AR', en: 'en_US', ur: 'ur_PK', fa: 'fa_IR' };
const DIR: Record<string, string> = { ar: 'rtl', en: 'ltr', ur: 'rtl', fa: 'rtl' };
const LABELS: Record<string, { question: string; answer: string; note: string }> = {
    ar: { question: 'السؤال', answer: 'جواب باحث السلف', note: 'محادثة محفوظة كما أجاب عنها باحث السلف، ولا يمكن تعديلها.' },
    en: { question: 'Question', answer: "Salaf AI's answer", note: 'Saved exactly as Salaf AI answered it; it cannot be edited.' },
    ur: { question: 'سوال', answer: 'باحث السلف کا جواب', note: 'یہ گفتگو بالکل ویسی محفوظ ہے جیسے باحث السلف نے جواب دیا؛ اس میں ترمیم نہیں ہو سکتی۔' },
    fa: { question: 'پرسش', answer: 'پاسخ باحث السلف', note: 'این گفتگو دقیقاً همان‌گونه که باحث السلف پاسخ داد ذخیره شده و قابل ویرایش نیست.' },
};

const escapeHtml = (text: string) =>
    text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

/** Answer text without the prompt's markup or the hidden sources block, for previews and crawlers. */
export const plainAnswer = (text: string) =>
    text
        .replace(/\[\[SOURCES_START\]\][\s\S]*?(\[\[SOURCES_END\]\]|$)/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/```[a-z]*\n?/g, '')
        .replace(/[*_#>`]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const clip = (text: string, length: number) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > length ? `${flat.slice(0, length - 1).trim()}…` : flat;
};

const paragraphs = (text: string) =>
    text
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');

export const renderSharePage = (template: string, share: SharedConversation | null, id: string) => {
    const setMeta = (html: string, pattern: RegExp, replacement: string) => html.replace(pattern, replacement);
    if (!share) {
        return template.replace(
            /<meta name="robots" content="[^"]*">/,
            '<meta name="robots" content="noindex">'
        );
    }
    const lang = share.lang in LABELS ? share.lang : 'ar';
    const labels = LABELS[lang];
    const first = share.turns[0];
    const title = `${clip(first.q || labels.question, 90)} | ${SITE_NAME[lang]}`;
    const description = clip(plainAnswer(share.turns[share.turns.length - 1].a), 200);
    const url = `${SITE}/s/${id}`;
    const attr = escapeHtml;

    let html = template;
    html = html.replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${lang}" dir="${DIR[lang]}">`);
    html = setMeta(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
    html = setMeta(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(description)}">`);
    html = setMeta(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(clip(first.q, 90))}">`);
    html = setMeta(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(description)}">`);
    html = setMeta(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
    html = setMeta(html, /<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="article">');
    html = setMeta(html, /<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${LOCALE[lang]}">`);
    html = setMeta(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(clip(first.q, 90))}">`);
    html = setMeta(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(description)}">`);
    html = setMeta(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);

    const article = [
        `<article dir="${DIR[lang]}" lang="${lang}">`,
        `<h1>${escapeHtml(clip(first.q, 200))}</h1>`,
        `<p>${escapeHtml(labels.note)}</p>`,
        ...share.turns.map(
            (turn) =>
                `<section><h2>${escapeHtml(labels.question)}</h2>${paragraphs(turn.q)}<h2>${escapeHtml(labels.answer)}</h2>${paragraphs(plainAnswer(turn.a))}</section>`
        ),
        '</article>',
    ].join('');
    // React replaces the contents of #root when the app starts; until then this is the page.
    return html.replace('<div id="root"></div>', `<div id="root">${article}</div>`);
};

let cachedTemplate: { html: string; at: number } | null = null;

const loadTemplate = async (req: VercelRequest) => {
    if (cachedTemplate && Date.now() - cachedTemplate.at < 5 * 60_000) return cachedTemplate.html;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const headers: Record<string, string> = {};
    // Protected preview deployments let their own functions through with Vercel's bypass secret.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
        headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    const response = await fetch(`https://${host}/index.html`, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`index.html responded with ${response.status}`);
    const html = await response.text();
    cachedTemplate = { html, at: Date.now() };
    return html;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).end();
    }
    const id = String(req.query.id ?? '');
    let template: string;
    try {
        template = await loadTemplate(req);
    } catch (error) {
        console.warn('[api/shared] app page unavailable', { error: error instanceof Error ? error.message : String(error) });
        // The app can still render the conversation itself.
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, `/s/${encodeURIComponent(id)}?app=1`);
    }
    const share = SHARE_ID_PATTERN.test(id) ? await readShare(id).catch(() => null) : null;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', share ? 'public, s-maxage=60' : 'no-store');
    return res.status(share ? 200 : 404).send(renderSharePage(template, share, id));
}
