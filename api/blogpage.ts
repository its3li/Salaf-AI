import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { BLOG_LANGUAGES, findPost, listPublishedSlugs, readPosts, slugFor, visibleLanguages, type BlogPost } from './_lib/blog.js';
import type { ReplyLanguage } from './_lib/research.js';
import { SITE, SITE_NAME, DIR, applyPageMeta, clip, escapeHtml, injectRoot, loadTemplate, paragraphs, plainAnswer } from './_lib/pageTemplate.js';
import { postSummary, shownLanguage } from './blog.js';
import { handleSitemap } from './_lib/sitemap.js';

/*
 * The blog's pages for link previews and search engines (see vercel.json): /blog and /blog/<slug>
 * in Arabic, /en|ur|fa/blog and /en|ur|fa/blog/<slug> in the other languages. Each is the app's
 * page with its own title, description and hreflang links, and the post as plain text inside.
 */

/** Slugs are in each language's own letters, so they are percent-encoded in addresses. */
export const blogPath = (lang: string, slug?: string) => `${lang === 'ar' ? '' : `/${lang}`}/blog${slug ? `/${encodeURIComponent(slug)}` : ''}`;

const TEXT: Record<ReplyLanguage, { blog: string; blogDescription: string; answer: string; edited: string }> = {
    ar: {
        blog: 'مدونة باحث السلف: سؤال وجواب بالدليل',
        blogDescription: 'كل يوم سؤال شرعي وجوابه بأدلته من القرآن والسنة الصحيحة بفهم السلف، مع التحقق من الأحاديث.',
        answer: 'الجواب',
        edited: 'راجع المحرر هذا الجواب وصحّحه.',
    },
    en: {
        blog: 'Salaf AI blog: questions answered with evidence',
        blogDescription: 'A question every day, answered with evidence from the Quran and authentic Sunnah as the Salaf understood them, with hadith checked.',
        answer: 'Answer',
        edited: 'This answer was reviewed and corrected by the editor.',
    },
    ur: {
        blog: 'باحث السلف بلاگ: دلیل کے ساتھ سوال و جواب',
        blogDescription: 'روزانہ ایک شرعی سوال اور اس کا جواب، قرآن اور صحیح سنت کے دلائل کے ساتھ سلف کے فہم کے مطابق، احادیث کی تحقیق کے ساتھ۔',
        answer: 'جواب',
        edited: 'اس جواب کا مدیر نے جائزہ لیا اور اصلاح کی۔',
    },
    fa: {
        blog: 'وبلاگ باحث السلف: پرسش و پاسخ با دلیل',
        blogDescription: 'هر روز یک پرسش شرعی و پاسخ آن با دلایل قرآن و سنت صحیح به فهم سلف، همراه با بررسی احادیث.',
        answer: 'پاسخ',
        edited: 'این پاسخ را ویراستار بررسی و اصلاح کرده است.',
    },
};

export const renderPostPage = (template: string, post: BlogPost, lang: ReplyLanguage) => {
    const version = post.langs[lang]!;
    const text = TEXT[lang];
    const html = applyPageMeta(template, {
        lang,
        title: `${clip(version.q, 90)} | ${SITE_NAME[lang]}`,
        description: clip(plainAnswer(version.a), 200),
        url: `${SITE}${blogPath(lang, slugFor(post, lang))}`,
        type: 'article',
        alternates: [
            ...visibleLanguages(post).map((language) => ({
                lang: language,
                url: `${SITE}${blogPath(language, slugFor(post, language))}`,
            })),
            { lang: 'x-default', url: `${SITE}${blogPath(visibleLanguages(post)[0] ?? 'ar', slugFor(post, visibleLanguages(post)[0] ?? 'ar'))}` },
        ],
    });
    const structured = {
        '@context': 'https://schema.org',
        '@type': 'QAPage',
        mainEntity: {
            '@type': 'Question',
            name: version.q,
            dateCreated: new Date(post.createdAt).toISOString(),
            answerCount: 1,
            acceptedAnswer: { '@type': 'Answer', text: clip(plainAnswer(version.a), 5000), dateCreated: new Date(post.createdAt).toISOString() },
        },
    };
    const article = [
        `<article dir="${DIR[lang]}" lang="${lang}">`,
        `<h1>${escapeHtml(version.q)}</h1>`,
        version.editedAt ? `<p>${escapeHtml(text.edited)}</p>` : '',
        `<h2>${escapeHtml(text.answer)}</h2>`,
        paragraphs(plainAnswer(version.a)),
        '</article>',
        // "<" is escaped so nothing in a post can close this script tag.
        `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script>`,
    ].join('');
    return injectRoot(html, article);
};

export const renderIndexPage = (template: string, posts: BlogPost[], lang: ReplyLanguage) => {
    const text = TEXT[lang];
    const html = applyPageMeta(template, {
        lang,
        title: text.blog,
        description: text.blogDescription,
        url: `${SITE}${blogPath(lang)}`,
        alternates: [
            ...BLOG_LANGUAGES.map((language) => ({ lang: language, url: `${SITE}${blogPath(language)}` })),
            { lang: 'x-default', url: `${SITE}${blogPath('ar')}` },
        ],
    });
    const items = posts
        .filter((post) => shownLanguage(post, lang))
        .map((post) => postSummary(post, lang))
        .map((item) => `<li><a href="${blogPath(lang, item.slug)}">${escapeHtml(item.q)}</a><p>${escapeHtml(item.excerpt)}</p></li>`)
        .join('');
    return injectRoot(html, `<main dir="${DIR[lang]}" lang="${lang}"><h1>${escapeHtml(text.blog)}</h1><p>${escapeHtml(text.blogDescription)}</p><ul>${items}</ul></main>`);
};

const decodeSlug = (slug: string) => {
    try {
        return (slug.includes('%') ? decodeURIComponent(slug) : slug).normalize('NFKC');
    } catch {
        return slug;
    }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // /sitemap.xml comes here too (vercel.json), keeping within Vercel's function limit.
    if (req.query.sitemap === '1') return handleSitemap(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).end();
    }
    const lang = BLOG_LANGUAGES.includes(req.query.lang as ReplyLanguage) ? (req.query.lang as ReplyLanguage) : 'ar';
    const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
    const fallbackUrl = `${lang === 'ar' ? '' : `/${lang}`}/blog${slug ? `/${encodeURIComponent(slug)}` : ''}?app=1`;
    let template: string;
    try {
        template = await loadTemplate(req);
    } catch (error) {
        console.warn('[api/blogpage] app page unavailable', { error: error instanceof Error ? error.message : String(error) });
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, fallbackUrl);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
        if (slug) {
            const found = await findPost(slug, lang);
            const post = found?.post;
            if (!found || !post || post.status !== 'published' || !shownLanguage(post, found.lang)) {
                res.setHeader('Cache-Control', 'no-store');
                return res.status(404).send(applyPageMeta(template, { lang, title: TEXT[lang].blog, description: TEXT[lang].blogDescription, url: `${SITE}${blogPath(lang)}`, noindex: true }));
            }
            // Each version lives at its own language's address: an Arabic address shows the Arabic version,
            // an old or other-language address moves there, and a hidden translation falls back to another language.
            const shown = shownLanguage(post, found.lang)!;
            const canonical = blogPath(shown, slugFor(post, shown));
            if (shown !== lang || slugFor(post, shown) !== decodeSlug(slug)) {
                res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
                return res.redirect(shown === found.lang ? 301 : 302, canonical);
            }
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
            return res.status(200).send(renderPostPage(template, post, lang));
        }
        const posts = await readPosts(await listPublishedSlugs(0, 50));
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
        return res.status(200).send(renderIndexPage(template, posts, lang));
    } catch (error) {
        console.warn('[api/blogpage] failed', { error: error instanceof Error ? error.message : String(error) });
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, fallbackUrl);
    }
}
