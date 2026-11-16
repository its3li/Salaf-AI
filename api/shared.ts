import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { readShare, SHARE_ID_PATTERN, type SharedConversation } from './_lib/shares.js';
import {
    SITE,
    SITE_NAME,
    DIR,
    applyPageMeta,
    clip,
    escapeHtml,
    injectRoot,
    loadTemplate,
    paragraphs,
    plainAnswer,
} from './_lib/pageTemplate.js';

export { plainAnswer };

/*
 * /s/<id> lands here (see vercel.json). It serves the app's own page with the shared question as
 * its title and preview, and the conversation as plain text inside it (see _lib/pageTemplate).
 */

const LABELS: Record<string, { question: string; answer: string; note: string }> = {
    ar: { question: 'السؤال', answer: 'جواب باحث السلف', note: 'محادثة محفوظة كما أجاب عنها باحث السلف، ولا يمكن تعديلها.' },
    en: { question: 'Question', answer: "Salaf AI's answer", note: 'Saved exactly as Salaf AI answered it; it cannot be edited.' },
    ur: { question: 'سوال', answer: 'باحث السلف کا جواب', note: 'یہ گفتگو بالکل ویسی محفوظ ہے جیسے باحث السلف نے جواب دیا؛ اس میں ترمیم نہیں ہو سکتی۔' },
    fa: { question: 'پرسش', answer: 'پاسخ باحث السلف', note: 'این گفتگو دقیقاً همان‌گونه که باحث السلف پاسخ داد ذخیره شده و قابل ویرایش نیست.' },
};

export const renderSharePage = (template: string, share: SharedConversation | null, id: string) => {
    if (!share) return template.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex">');
    const lang = share.lang in LABELS ? share.lang : 'ar';
    const labels = LABELS[lang];
    const first = share.turns[0];
    const html = applyPageMeta(template, {
        lang,
        title: `${clip(first.q || labels.question, 90)} | ${SITE_NAME[lang]}`,
        description: clip(plainAnswer(share.turns[share.turns.length - 1].a), 200),
        url: `${SITE}/s/${id}`,
        type: 'article',
    });
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
    return injectRoot(html, article);
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
