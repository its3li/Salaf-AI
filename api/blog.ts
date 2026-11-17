import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { BLOG_LANGUAGES, findPost, listPublishedSlugs, readPosts, slugFor, visibleLanguages, type BlogPost } from './_lib/blog.js';
import type { ReplyLanguage } from './_lib/research.js';
import { clip, plainAnswer } from './_lib/pageTemplate.js';

// Public blog data for the app: GET ?slug=…&lang=… for one post, GET ?lang=…&offset=… for the list.

const PAGE_SIZE = 20;

const pickLanguage = (value: unknown): ReplyLanguage =>
    BLOG_LANGUAGES.includes(value as ReplyLanguage) ? (value as ReplyLanguage) : 'ar';

/** The language a post is shown in: the asked one when visible, else its first visible one. */
export const shownLanguage = (post: BlogPost, lang: ReplyLanguage) => {
    const visible = visibleLanguages(post);
    return visible.includes(lang) ? lang : (visible[0] ?? null);
};

/** The post in the asked language, or another visible language when that one is missing or hidden. */
export const postView = (post: BlogPost, lang: ReplyLanguage) => {
    const shown = shownLanguage(post, lang)!;
    const version = post.langs[shown]!;
    const languages = visibleLanguages(post);
    return {
        id: post.slug,
        slug: slugFor(post, shown),
        lang: shown,
        category: post.category,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        q: version.q,
        a: version.a,
        ...(version.editedAt ? { editedAt: version.editedAt } : {}),
        // Reviewers' names and notes stay private; the page only says it was reviewed.
        ...(version.review?.status === 'approved' ? { reviewed: true } : {}),
        languages,
        /** Each visible language's own address. */
        slugs: Object.fromEntries(languages.map((language) => [language, slugFor(post, language)])),
    };
};

export const postSummary = (post: BlogPost, lang: ReplyLanguage) => {
    const version = post.langs[shownLanguage(post, lang)!]!;
    return { slug: slugFor(post, shownLanguage(post, lang)!), category: post.category, createdAt: post.createdAt, q: version.q, excerpt: clip(plainAnswer(version.a), 220) };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    }
    const lang = pickLanguage(req.query.lang);
    try {
        if (typeof req.query.slug === 'string') {
            // The address's own language wins: an Urdu address opens the Urdu version.
            const found = await findPost(req.query.slug, lang);
            const post = found?.post;
            if (!found || !post || post.status !== 'published' || !shownLanguage(post, found.lang)) {
                res.setHeader('Cache-Control', 'no-store');
                return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });
            }
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
            return res.status(200).json(postView(post, found.lang));
        }
        const offset = Math.max(0, Math.min(10_000, Number(req.query.offset) || 0));
        const slugs = await listPublishedSlugs(offset, PAGE_SIZE + 1);
        const posts = await readPosts(slugs.slice(0, PAGE_SIZE));
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
        return res.status(200).json({
            posts: posts.filter((post) => post.status === 'published' && shownLanguage(post, lang)).map((post) => postSummary(post, lang)),
            next: slugs.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
        });
    } catch (error) {
        console.warn('[api/blog] failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(503).json({ error: { code: 'UNAVAILABLE' } });
    }
}
