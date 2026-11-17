import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, timingSafeEqual } from 'node:crypto';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import {
    BLOG_LANGUAGES,
    BlogError,
    addReviewer,
    deletePost,
    findReviewer,
    listAllPosts,
    listReviewers,
    publishQuestion,
    queueQuestion,
    readPost,
    readQueue,
    removeQueuedQuestion,
    removeReviewer,
    runDaily,
    savePost,
    type BlogPost,
    type Editor,
} from './_lib/blog.js';
import type { ReplyLanguage } from './_lib/research.js';

/*
 * The blog's private side. The daily schedule calls GET ?task=daily with CRON_SECRET. The admin
 * page calls POST with a key: the owner's ADMIN_SECRET can do everything; a reviewer's key (made
 * by the owner on the admin page) can review, correct and hide only the languages it was given.
 */

const MAX_QUESTION_CHARS = 500;
const MAX_NOTE_CHARS = 2000;

const sameSecret = (given: string | undefined, secret: string | undefined) => {
    if (!secret || !given) return false;
    // Hashing first makes the comparison constant-time whatever the lengths.
    const a = createHash('sha256').update(given).digest();
    const b = createHash('sha256').update(secret).digest();
    return timingSafeEqual(a, b);
};

const bearer = (req: VercelRequest) => {
    const header = req.headers.authorization;
    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
};

const identify = async (req: VercelRequest): Promise<Editor | null> => {
    const key = bearer(req);
    if (sameSecret(key, process.env.ADMIN_SECRET)) return { name: 'Owner', role: 'owner', langs: [...BLOG_LANGUAGES] };
    const reviewer = key ? await findReviewer(key) : null;
    return reviewer ? { name: reviewer.name, role: 'reviewer', langs: reviewer.langs } : null;
};

const cleanQuestion = (value: unknown) => {
    const question = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (question.length < 5 || question.length > MAX_QUESTION_CHARS) throw new BlogError(400, 'VALIDATION_ERROR');
    return question;
};

const requirePost = async (slug: unknown) => {
    const post = typeof slug === 'string' ? await readPost(slug) : null;
    if (!post) throw new BlogError(404, 'POST_NOT_FOUND');
    return post;
};

const requireOwner = (editor: Editor) => {
    if (editor.role !== 'owner') throw new BlogError(403, 'OWNER_ONLY');
};

/** A language version this editor may work on. */
const requireVersion = (editor: Editor, post: BlogPost, lang: unknown) => {
    const language = lang as ReplyLanguage;
    if (!BLOG_LANGUAGES.includes(language)) throw new BlogError(400, 'VALIDATION_ERROR');
    if (!editor.langs.includes(language)) throw new BlogError(403, 'LANGUAGE_NOT_ALLOWED');
    const version = post.langs[language];
    if (!version) throw new BlogError(404, 'LANGUAGE_NOT_FOUND');
    return { language, version };
};

const touch = async (post: BlogPost) => {
    post.updatedAt = Date.now();
    await savePost(post);
    return post;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    const signal = AbortSignal.timeout(280_000);
    try {
        if (req.method === 'GET') {
            if (req.query.task !== 'daily' || !sameSecret(bearer(req), process.env.CRON_SECRET)) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
            }
            const result = await runDaily(signal);
            console.info('[api/blogadmin] daily run', { ok: result.ok, slug: result.ok ? result.post.slug : undefined, reason: result.ok ? undefined : result.reason });
            return res.status(200).json(result);
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
        }
        const editor = await identify(req);
        if (!editor) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });

        const body = (req.body ?? {}) as Record<string, unknown>;
        switch (body.action) {
            case 'list':
                return res.status(200).json({
                    editor,
                    posts: await listAllPosts(),
                    ...(editor.role === 'owner' ? { queue: await readQueue(), reviewers: await listReviewers() } : {}),
                });

            // --- Owner only -------------------------------------------------------------
            case 'queue':
                requireOwner(editor);
                await queueQuestion(cleanQuestion(body.question));
                return res.status(200).json({ queue: await readQueue() });
            case 'unqueue':
                requireOwner(editor);
                await removeQueuedQuestion(String(body.question ?? ''));
                return res.status(200).json({ queue: await readQueue() });
            case 'publish':
                requireOwner(editor);
                return res.status(200).json(await publishQuestion(cleanQuestion(body.question), { source: 'manual', signal }));
            case 'run':
                requireOwner(editor);
                return res.status(200).json(await runDaily(signal, { force: true }));
            case 'hide':
            case 'show': {
                requireOwner(editor);
                const post = await requirePost(body.slug);
                post.status = body.action === 'hide' ? 'hidden' : 'published';
                return res.status(200).json(await touch(post));
            }
            case 'delete':
                requireOwner(editor);
                await requirePost(body.slug);
                await deletePost(String(body.slug));
                return res.status(204).end();
            case 'addReviewer': {
                requireOwner(editor);
                const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
                const langs = Array.isArray(body.langs) ? body.langs.filter((lang): lang is ReplyLanguage => BLOG_LANGUAGES.includes(lang)) : [];
                if (!name || langs.length === 0) throw new BlogError(400, 'VALIDATION_ERROR');
                return res.status(200).json(await addReviewer(name, [...new Set(langs)]));
            }
            case 'removeReviewer':
                requireOwner(editor);
                await removeReviewer(String(body.id ?? ''));
                return res.status(200).json({ reviewers: await listReviewers() });

            // --- Owner and reviewers, within their languages -----------------------------
            case 'edit': {
                const post = await requirePost(body.slug);
                const { language, version } = requireVersion(editor, post, body.lang);
                if (typeof body.a !== 'string' || !body.a.trim() || body.a.length > 60_000) throw new BlogError(400, 'VALIDATION_ERROR');
                const q = typeof body.q === 'string' && body.q.trim() ? body.q.trim().slice(0, MAX_QUESTION_CHARS) : version.q;
                post.langs[language] = {
                    ...version,
                    q,
                    a: body.a.trim(),
                    editedAt: Date.now(),
                    editedBy: editor.name,
                    original: version.original ?? { q: version.q, a: version.a },
                };
                return res.status(200).json(await touch(post));
            }
            case 'restore': {
                const post = await requirePost(body.slug);
                const { language, version } = requireVersion(editor, post, body.lang);
                if (!version.original) throw new BlogError(400, 'NOTHING_TO_RESTORE');
                const restored = { ...version, q: version.original.q, a: version.original.a };
                delete restored.editedAt;
                delete restored.editedBy;
                delete restored.original;
                post.langs[language] = restored;
                return res.status(200).json(await touch(post));
            }
            case 'review': {
                const post = await requirePost(body.slug);
                const { language, version } = requireVersion(editor, post, body.lang);
                if (body.status !== 'approved' && body.status !== 'changes' && body.status !== 'none') throw new BlogError(400, 'VALIDATION_ERROR');
                const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_CHARS) : '';
                const reviewed = { ...version };
                if (body.status === 'none') delete reviewed.review;
                else reviewed.review = { status: body.status, by: editor.name, at: Date.now(), ...(note ? { note } : {}) };
                post.langs[language] = reviewed;
                return res.status(200).json(await touch(post));
            }
            case 'hideLang':
            case 'showLang': {
                const post = await requirePost(body.slug);
                const { language, version } = requireVersion(editor, post, body.lang);
                post.langs[language] = { ...version, hidden: body.action === 'hideLang' };
                return res.status(200).json(await touch(post));
            }
            default:
                throw new BlogError(400, 'UNKNOWN_ACTION');
        }
    } catch (error) {
        if (error instanceof BlogError) return res.status(error.status).json({ error: { code: error.code } });
        console.warn('[api/blogadmin] failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(502).json({ error: { code: 'FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
}
