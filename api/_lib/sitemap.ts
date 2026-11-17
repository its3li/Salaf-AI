import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { BLOG_LANGUAGES, CATEGORIES, listPublishedSlugs, readPosts, slugFor, visibleLanguages } from './blog.js';
import { SITE } from './pageTemplate.js';

const blogPath = (lang: string, slug?: string) => `${lang === 'ar' ? '' : `/${lang}`}/blog${slug ? `/${encodeURIComponent(slug)}` : ''}`;

// /sitemap.xml, served by api/blogpage.ts (see vercel.json): the fixed pages, then every blog post in each of its languages.

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function handleSitemap(_req: VercelRequest, res: VercelResponse) {
    const urls: Array<{ loc: string; lastmod?: string; priority: string; alternates?: Array<{ lang: string; loc: string }> }> = [
        { loc: `${SITE}/`, priority: '1.0' },
        { loc: `${SITE}/about`, priority: '0.8' },
        ...BLOG_LANGUAGES.map((lang) => ({ loc: `${SITE}${blogPath(lang)}`, priority: '0.8' })),
    ];
    try {
        const posts = await readPosts(await listPublishedSlugs(0, 5000));
        for (const topic of CATEGORIES) {
            const inTopic = posts.filter((post) => post.category === topic);
            if (inTopic.length === 0) continue;
            const lastmod = day(Math.max(...inTopic.map((post) => post.updatedAt)));
            const alternates = BLOG_LANGUAGES.map((lang) => ({ lang, loc: `${SITE}${blogPath(lang)}/topic/${topic}` }));
            for (const lang of BLOG_LANGUAGES) urls.push({ loc: `${SITE}${blogPath(lang)}/topic/${topic}`, lastmod, priority: '0.6', alternates });
        }
        for (const post of posts) {
            const languages = visibleLanguages(post);
            const alternates = languages.map((lang) => ({ lang, loc: `${SITE}${blogPath(lang, slugFor(post, lang))}` }));
            for (const lang of languages) {
                urls.push({ loc: `${SITE}${blogPath(lang, slugFor(post, lang))}`, lastmod: day(post.updatedAt), priority: '0.7', alternates });
            }
        }
    } catch (error) {
        console.warn('[api/sitemap] posts unavailable', { error: error instanceof Error ? error.message : String(error) });
    }
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...urls.map((url) =>
            [
                '  <url>',
                `    <loc>${url.loc}</loc>`,
                url.lastmod ? `    <lastmod>${url.lastmod}</lastmod>` : '',
                ...(url.alternates ?? []).map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${alt.loc}"/>`),
                `    <priority>${url.priority}</priority>`,
                '  </url>',
            ]
                .filter(Boolean)
                .join('\n')
        ),
        '</urlset>',
    ].join('\n');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(200).send(xml);
}
