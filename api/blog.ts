import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { BLOG_LANGUAGES, CATEGORIES, findPost, listPublishedSlugs, readPosts, slugFor, visibleLanguages, type BlogPost } from './_lib/blog.js';
import type { ReplyLanguage } from './_lib/research.js';
import { clip, plainAnswer } from './_lib/pageTemplate.js';
import { allowBurst } from './_lib/limits.js';
import { recordBlogEvent, BLOG_EVENTS, type BlogEvent } from './_lib/stats.js';

// Public blog data for the app: GET ?slug=…&lang=… for one post, GET ?lang=…&offset=…[&topic=…] for the list.

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

/** Up to three other questions for the end of a post: the same topic first, then the newest. */
export const relatedPosts = async (post: BlogPost, lang: ReplyLanguage, count = 3) => {
    const others = (await readPosts(await listPublishedSlugs(0, 200))).filter(
        (other) => other.slug !== post.slug && other.status === 'published' && shownLanguage(other, lang) === lang
    );
    const sameTopic = others.filter((other) => other.category === post.category);
    const rest = others.filter((other) => other.category !== post.category);
    return [...sameTopic, ...rest].slice(0, count).map((other) => ({ slug: slugFor(other, lang), q: other.langs[lang]!.q, category: other.category }));
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // POST { event }: the app counts blog reads, "Ask more" presses and opened shares for the daily report.
    if (req.method === 'POST') {
        res.setHeader('Cache-Control', 'no-store');
        const event = req.body?.event as BlogEvent;
        if (!BLOG_EVENTS.includes(event)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
        if (await allowBurst(req, 'blog-event', 30)) await recordBlogEvent(req, event);
        return res.status(204).end();
    }
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET, POST');
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
            const related = await relatedPosts(post, found.lang).catch(() => []);
            return res.status(200).json({ ...postView(post, found.lang), related });
        }
        const offset = Math.max(0, Math.min(10_000, Number(req.query.offset) || 0));
        const topic = (CATEGORIES as readonly string[]).includes(String(req.query.topic)) ? String(req.query.topic) : null;
        const shown = (post: BlogPost) => post.status === 'published' && shownLanguage(post, lang) && (!topic || post.category === topic);
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
        if (topic) {
            // A topic's posts are picked from the newest 500; plenty for a daily blog for a long while.
            const matching = (await readPosts(await listPublishedSlugs(0, 500))).filter(shown);
            return res.status(200).json({
                posts: matching.slice(offset, offset + PAGE_SIZE).map((post) => postSummary(post, lang)),
                next: matching.length > offset + PAGE_SIZE ? offset + PAGE_SIZE : null,
            });
        }
        const slugs = await listPublishedSlugs(offset, PAGE_SIZE + 1);
        const posts = await readPosts(slugs.slice(0, PAGE_SIZE));
        return res.status(200).json({
            posts: posts.filter(shown).map((post) => postSummary(post, lang)),
            next: slugs.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
        });
    } catch (error) {
        console.warn('[api/blog] failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(503).json({ error: { code: 'UNAVAILABLE' } });
    }
}
