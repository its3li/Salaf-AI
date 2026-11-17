import { createHash, randomBytes } from 'node:crypto';
import { generateGemini, getGeminiConfig, type GeminiContent, type GeminiPart } from './gemini.js';
import { getStore, runRedisCommands } from './limits.js';
import { RESEARCH_TOOLS, getResearchConfig, runResearchTool, type ReplyLanguage } from './research.js';
import { SYSTEM_INSTRUCTION, RESEARCH_INSTRUCTION, LANGUAGE_NAMES, languageInstruction } from './prompts.js';

/*
 * The blog: one question a day, chosen, answered, checked and published by Salaf AI on its own,
 * plus questions the owner adds by hand. Each post is answered in Arabic with the same prompt and
 * hadith checks as the chat, reviewed by a second strict pass against what the checks returned,
 * then translated into English, Urdu and Persian. Nothing is published that the review rejects.
 */

export const BLOG_LANGUAGES: ReplyLanguage[] = ['ar', 'en', 'ur', 'fa'];
export const CATEGORIES = ['aqidah', 'fiqh', 'hadith', 'tafsir', 'adab', 'seerah'] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_BRIEF: Record<Category, string> = {
    aqidah: 'creed (Aqidah): Tawhid, the names and attributes of Allah, faith, the unseen, innovations to avoid',
    fiqh: 'jurisprudence (Fiqh): purification, prayer, fasting, zakat, hajj, family, food, trade and everyday rulings',
    hadith: 'the authenticity of a well-known hadith or saying that people circulate (whether it is authentic, weak or fabricated)',
    tafsir: 'the meaning of a well-known verse or short surah of the Quran',
    adab: 'manners, character, supplications and daily remembrance (adhkar)',
    seerah: "the Prophet's life (peace be upon him) and the lives of the Companions",
};

export interface PostVersion {
    q: string;
    a: string;
    /** Set when an editor corrected this version; shown on the page. */
    editedAt?: number;
    editedBy?: string;
    /** Salaf AI's own text from before the first correction, so it can be restored. */
    original?: { q: string; a: string };
    /** A reviewer's verdict on this language version. */
    review?: { status: 'approved' | 'changes'; by: string; at: number; note?: string };
    /** Hidden from the public until shown again; the rest of the post stays up. */
    hidden?: boolean;
    /** This version's address, in its own language's words (/ur/blog/<slug>). Never changes once set. */
    slug?: string;
}

/** Languages of a post the public can see, Arabic first. */
export const visibleLanguages = (post: BlogPost) => BLOG_LANGUAGES.filter((language) => post.langs[language] && !post.langs[language]!.hidden);

// ---------------------------------------------------------------------------
// Editors: the owner (ADMIN_SECRET) and reviewers the owner adds, each with their own key.
// ---------------------------------------------------------------------------

export interface Editor {
    name: string;
    role: 'owner' | 'reviewer';
    /** Languages this editor may review and correct. */
    langs: ReplyLanguage[];
}

export interface Reviewer {
    id: string;
    name: string;
    langs: ReplyLanguage[];
    createdAt: number;
}

const REVIEWERS_KEY = 'salaf:blog:reviewers';
const memoryReviewers = new Map<string, string>();

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Creates a reviewer and returns their key; only its hash is kept, so it is shown once. */
export const addReviewer = async (name: string, langs: ReplyLanguage[]) => {
    const key = `rv_${randomBytes(24).toString('base64url')}`;
    const reviewer: Reviewer = { id: randomBytes(6).toString('hex'), name, langs, createdAt: Date.now() };
    const replies = await redis([['HSET', REVIEWERS_KEY, hashKey(key), JSON.stringify(reviewer)]]);
    if (!replies) memoryReviewers.set(hashKey(key), JSON.stringify(reviewer));
    return { reviewer, key };
};

const reviewerEntries = async (): Promise<Array<[string, Reviewer]>> => {
    const replies = await redis([['HGETALL', REVIEWERS_KEY]]);
    if (!replies) return [...memoryReviewers.entries()].map(([hash, raw]) => [hash, JSON.parse(raw) as Reviewer]);
    const flat = (replies[0] as string[]) ?? [];
    const entries: Array<[string, Reviewer]> = [];
    for (let i = 0; i + 1 < flat.length; i += 2) entries.push([flat[i], JSON.parse(flat[i + 1]) as Reviewer]);
    return entries;
};

export const listReviewers = async () => (await reviewerEntries()).map(([, reviewer]) => reviewer).sort((a, b) => a.createdAt - b.createdAt);

export const removeReviewer = async (id: string) => {
    for (const [hash, reviewer] of await reviewerEntries()) {
        if (reviewer.id !== id) continue;
        const replies = await redis([['HDEL', REVIEWERS_KEY, hash]]);
        if (!replies) memoryReviewers.delete(hash);
    }
};

/** Who a key belongs to, or null. */
export const findReviewer = async (key: string): Promise<Reviewer | null> => {
    if (!/^rv_[A-Za-z0-9_-]{32}$/.test(key)) return null;
    const replies = await redis([['HGET', REVIEWERS_KEY, hashKey(key)]]);
    const raw = replies ? replies[0] : memoryReviewers.get(hashKey(key));
    return typeof raw === 'string' ? (JSON.parse(raw) as Reviewer) : null;
};

export interface BlogPost {
    v: 1;
    slug: string;
    category: Category;
    source: 'auto' | 'manual';
    status: 'published' | 'hidden';
    createdAt: number;
    updatedAt: number;
    langs: Partial<Record<ReplyLanguage, PostVersion>>;
}

export class BlogError extends Error {
    constructor(public status: number, public code: string, message = code) {
        super(message);
    }
}

// ---------------------------------------------------------------------------
// Storage: Redis when configured, otherwise this instance's memory (local development).
// ---------------------------------------------------------------------------

const POST_KEY = (slug: string) => `salaf:blog:post:${slug}`;
const INDEX_KEY = 'salaf:blog:index';
const QUEUE_KEY = 'salaf:blog:queue';
const FOREVER = 20 * 365 * 24 * 3600;

const SLUGS_KEY = 'salaf:blog:slugs';

const memory = { posts: new Map<string, string>(), index: new Map<string, number>(), queue: [] as string[], slugs: new Map<string, string>() };

const ID_PATTERN = /^[a-z0-9-]{1,90}$/;
const slugField = (lang: ReplyLanguage, slug: string) => `${lang}/${slug}`;

/** A version's address: its own slug, or the post's id for posts made before addresses were translated. */
export const slugFor = (post: BlogPost, lang: ReplyLanguage) => post.langs[lang]?.slug ?? post.slug;

/**
 * The question's first four words as an address: "ما حكم صلاة الوتر؟" → "ما-حكم-صلاة-الوتر".
 * Kept short because copied links spell each Arabic-script letter as %XX%XX.
 */
export const SLUG_WORDS = 4;

export const localSlug = (text: string) =>
    text
        .normalize('NFKC')
        .toLowerCase()
        // Arabic-script vowel marks and the stretching tatweel only make addresses harder to type.
        .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .split('-')
        .slice(0, SLUG_WORDS)
        .join('-')
        .slice(0, 60)
        .replace(/-+$/g, '');

const slugOwner = async (lang: ReplyLanguage, slug: string) => {
    const replies = await redis([['HGET', SLUGS_KEY, slugField(lang, slug)]]);
    const owner = replies ? replies[0] : memory.slugs.get(slugField(lang, slug));
    return typeof owner === 'string' ? owner : null;
};

/** Gives every version without an address one in its own language. English keeps the post's id. */
const assignSlugs = async (post: BlogPost) => {
    for (const lang of BLOG_LANGUAGES) {
        const version = post.langs[lang];
        if (!version || version.slug) continue;
        const base = lang === 'en' ? post.slug : localSlug(version.q) || post.slug;
        for (let n = 1; ; n++) {
            const slug = n === 1 ? base : `${base}-${n}`;
            const owner = await slugOwner(lang, slug);
            if (!owner || owner === post.slug || n > 50) {
                version.slug = n > 50 ? `${base}-${post.slug}` : slug;
                break;
            }
        }
    }
};

/**
 * The post at an address, and the language whose address it is. Old addresses (the post's id)
 * still work. An address in one language opens that language's version.
 */
export const findPost = async (raw: string, lang: ReplyLanguage): Promise<{ post: BlogPost; lang: ReplyLanguage } | null> => {
    let slug = raw;
    try {
        if (slug.includes('%')) slug = decodeURIComponent(slug);
    } catch {
        return null;
    }
    slug = slug.normalize('NFKC');
    if (!slug || slug.length > 200) return null;
    const order = [lang, ...BLOG_LANGUAGES.filter((other) => other !== lang)];
    const replies = await redis([['HMGET', SLUGS_KEY, ...order.map((other) => slugField(other, slug))]]);
    const owners = replies ? ((replies[0] as Array<string | null>) ?? []) : order.map((other) => memory.slugs.get(slugField(other, slug)) ?? null);
    const owned = async (i: number) => {
        const owner = owners[i];
        const post = typeof owner === 'string' ? await readPost(owner) : null;
        // A former address of the post still finds it; the page then moves to the current one.
        return post && post.langs[order[i]] ? { post, lang: order[i] } : null;
    };
    // The asked language's own address, then an old address (the post's id, which English shares),
    // then another language's address.
    const own = await owned(0);
    if (own) return own;
    const byId = ID_PATTERN.test(slug) ? await readPost(slug) : null;
    if (byId) return { post: byId, lang };
    for (let i = 1; i < order.length; i++) {
        const other = await owned(i);
        if (other) return other;
    }
    return null;
};

export const clearBlogMemoryForTests = () => {
    memory.posts.clear();
    memory.index.clear();
    memory.queue.length = 0;
    memory.slugs.clear();
    memoryReviewers.clear();
};

const redis = async (commands: Array<Array<string | number>>) => {
    const replies = await runRedisCommands(commands);
    return replies ? replies.map((reply) => reply.result) : null;
};

export const savePost = async (post: BlogPost) => {
    await assignSlugs(post);
    const value = JSON.stringify(post);
    const fields = BLOG_LANGUAGES.filter((lang) => post.langs[lang]).flatMap((lang) => [slugField(lang, slugFor(post, lang)), post.slug]);
    const replies = await redis([
        ['SET', POST_KEY(post.slug), value, 'EX', FOREVER],
        post.status === 'published' ? ['ZADD', INDEX_KEY, post.createdAt, post.slug] : ['ZREM', INDEX_KEY, post.slug],
        ['HSET', SLUGS_KEY, ...fields],
    ]);
    if (replies) return;
    for (let i = 0; i < fields.length; i += 2) memory.slugs.set(fields[i], fields[i + 1]);
    memory.posts.set(post.slug, value);
    if (post.status === 'published') memory.index.set(post.slug, post.createdAt);
    else memory.index.delete(post.slug);
};

export const readPost = async (slug: string): Promise<BlogPost | null> => {
    if (!ID_PATTERN.test(slug)) return null;
    const replies = await redis([['GET', POST_KEY(slug)]]);
    const raw = replies ? replies[0] : memory.posts.get(slug);
    return typeof raw === 'string' ? (JSON.parse(raw) as BlogPost) : null;
};

export const deletePost = async (slug: string) => {
    const post = await readPost(slug);
    const fields = post ? BLOG_LANGUAGES.filter((lang) => post.langs[lang]).map((lang) => slugField(lang, slugFor(post, lang))) : [];
    const replies = await redis([['DEL', POST_KEY(slug)], ['ZREM', INDEX_KEY, slug], ...(fields.length ? [['HDEL', SLUGS_KEY, ...fields]] : [])]);
    if (replies) return;
    for (const field of fields) memory.slugs.delete(field);
    memory.posts.delete(slug);
    memory.index.delete(slug);
};

/** Newest first. */
export const listPublishedSlugs = async (offset = 0, count = 20): Promise<string[]> => {
    const replies = await redis([['ZREVRANGE', INDEX_KEY, offset, offset + count - 1]]);
    if (replies) return (replies[0] as string[]) ?? [];
    return [...memory.index.entries()].sort((a, b) => b[1] - a[1]).slice(offset, offset + count).map(([slug]) => slug);
};

export const readPosts = async (slugs: string[]): Promise<BlogPost[]> => {
    if (slugs.length === 0) return [];
    const replies = await redis([['MGET', ...slugs.map(POST_KEY)]]);
    const raws = replies ? ((replies[0] as Array<string | null>) ?? []) : slugs.map((slug) => memory.posts.get(slug) ?? null);
    return raws.filter((raw): raw is string => typeof raw === 'string').map((raw) => JSON.parse(raw) as BlogPost);
};

/** Every post, published or hidden, for the admin page and for avoiding repeats. */
export const listAllPosts = async (): Promise<BlogPost[]> => {
    const replies = await redis([['KEYS', POST_KEY('*')]]);
    const keys = replies ? ((replies[0] as string[]) ?? []) : [...memory.posts.keys()].map(POST_KEY);
    const slugs = keys.map((key) => key.slice(POST_KEY('').length));
    const posts = await readPosts(slugs);
    // Posts saved before each language had its own address get theirs here (the admin page and the daily run).
    for (const post of posts) {
        // Addresses longer than four words (from before they were shortened) are made again; the old ones redirect.
        let changed = false;
        for (const lang of BLOG_LANGUAGES) {
            const version = post.langs[lang];
            if (!version) continue;
            if (version.slug && lang !== 'en' && version.slug.split('-').length > SLUG_WORDS + 1) delete version.slug;
            if (!version.slug) changed = true;
        }
        if (changed) await savePost(post);
    }
    return posts.sort((a, b) => b.createdAt - a.createdAt);
};

export const queueQuestion = async (question: string) => {
    const replies = await redis([['RPUSH', QUEUE_KEY, question]]);
    if (!replies) memory.queue.push(question);
};

export const readQueue = async (): Promise<string[]> => {
    const replies = await redis([['LRANGE', QUEUE_KEY, 0, -1]]);
    return replies ? ((replies[0] as string[]) ?? []) : [...memory.queue];
};

const takeQueuedQuestion = async (): Promise<string | null> => {
    const replies = await redis([['LPOP', QUEUE_KEY]]);
    if (replies) return typeof replies[0] === 'string' ? replies[0] : null;
    return memory.queue.shift() ?? null;
};

export const removeQueuedQuestion = async (question: string) => {
    const replies = await redis([['LREM', QUEUE_KEY, 1, question]]);
    if (!replies) {
        const index = memory.queue.indexOf(question);
        if (index >= 0) memory.queue.splice(index, 1);
    }
};

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

/** Text of a single model turn with no tools. */
const ask = async (system: string, prompt: string, signal: AbortSignal, json = false) => {
    const response = await generateGemini(
        {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 16000,
                thinkingConfig: { thinkingLevel: 'LOW' },
                ...(json ? { responseMimeType: 'application/json' } : {}),
            },
        },
        signal
    );
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return parts.filter((part) => part.text && !part.thought).map((part) => part.text).join('').trim();
};

const parseJson = <T>(text: string): T => {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('The model did not return JSON');
    return JSON.parse(text.slice(start, end + 1)) as T;
};

/**
 * The same answer the chat would give, research tools included, without streaming. Returns the
 * answer and everything the tools returned, which the review checks the answer against.
 */
export const answerLikeTheChat = async (question: string, signal: AbortSignal) => {
    const researchConfig = getResearchConfig();
    const tools = RESEARCH_TOOLS.filter((tool) => tool.name === 'search_hadith' || researchConfig.paxsenixKey || researchConfig.aquadevsKey);
    const declarations = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.input_schema }));
    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: question }] }];
    const evidence: string[] = [];
    // Nobody is waiting on a blog post, so it thinks harder than the chat does.
    const thinkingLevel = process.env.BLOG_THINKING || 'HIGH';
    let toolCalls = 0;
    for (let round = 0; round <= 5; round++) {
        const response = await generateGemini(
            {
                systemInstruction: { parts: [{ text: `${SYSTEM_INSTRUCTION}\n${RESEARCH_INSTRUCTION}\n${languageInstruction('ar')}` }] },
                contents,
                generationConfig: { maxOutputTokens: 32000, thinkingConfig: { thinkingLevel } },
                tools: [{ functionDeclarations: declarations }],
                ...(round === 5 || toolCalls >= 8 ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } } : {}),
            },
            signal
        );
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        const calls = parts.filter((part) => part.functionCall).map((part) => part.functionCall!);
        if (calls.length) {
            toolCalls += calls.length;
            contents.push({
                ...candidate!.content!,
                parts: parts.filter((part) => part.thoughtSignature || part.functionCall || part.text),
            });
            const results = await Promise.all(
                calls.map(async (call, i): Promise<GeminiPart> => {
                    const result = await runResearchTool(
                        { type: 'tool_use', caller: { type: 'direct' }, id: call.id || `${round}-${i}`, name: call.name, input: call.args || {} },
                        researchConfig,
                        signal
                    );
                    const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
                    evidence.push(`${call.name}(${JSON.stringify(call.args || {})}):\n${text?.slice(0, 12000)}`);
                    return { functionResponse: { name: call.name, ...(call.id && { id: call.id }), response: { result: text?.slice(0, 12000), isError: result.is_error || false } } };
                })
            );
            contents.push({ role: 'user', parts: results });
            continue;
        }
        const answer = parts.filter((part) => part.text && !part.thought).map((part) => part.text).join('').trim();
        if (!answer || candidate?.finishReason !== 'STOP') throw new Error(`Incomplete answer (${candidate?.finishReason ?? 'none'})`);
        return { answer, evidence };
    }
    throw new Error('Research did not finish');
};

const REVIEW_SYSTEM = `You are a strict reviewer for an Islamic research website that follows the methodology of the Salaf (Ahl al-Sunnah wal-Jama'ah). An AI assistant wrote the answer below. It will be published publicly, without a human reading it first, so reject anything you are not confident is correct.

Reject the answer if ANY of these is true:
- A hadith is quoted with wording, a reference (book/number) or a grading that is wrong, or presented as authentic when it is weak or fabricated. Where tool results are given, they are the record of what Dorar.net returned: gradings and references must agree with them. Well-known hadith in al-Bukhari and Muslim may be quoted from memory if they are clearly correct.
- A Quranic verse is misquoted or given the wrong surah/verse number.
- A statement is attributed to a scholar that you are not confident they said.
- The answer departs from the understanding of the Salaf in creed, promotes innovation, or presents a weak opinion as the only position where trusted scholars differ.
- It does not actually answer the question, or reads as a personal fatwa for one person's situation.
- It contains a link that does not come from the tool results.

Reply with JSON only: {"approved": true or false, "issues": ["short description", ...]}.`;

export const reviewAnswer = async (question: string, answer: string, evidence: string[], signal: AbortSignal) => {
    const prompt = [
        `<question>\n${question}\n</question>`,
        `<answer>\n${answer}\n</answer>`,
        `<tool_results>\n${evidence.join('\n\n') || '(no tools were used)'}\n</tool_results>`,
    ].join('\n\n');
    const verdict = parseJson<{ approved?: boolean; issues?: string[] }>(await ask(REVIEW_SYSTEM, prompt, signal, true));
    return { approved: verdict.approved === true, issues: Array.isArray(verdict.issues) ? verdict.issues.map(String).slice(0, 10) : [] };
};

const translateSystem = (language: ReplyLanguage) => `You translate answers from an Islamic research website from Arabic into ${LANGUAGE_NAMES[language]}, for readers of ${LANGUAGE_NAMES[language]}.
Rules:
- Translate the question and the answer faithfully. Do not add, remove or soften anything.
- Inside <p class="quran">…</p> keep the Arabic verse exactly as it is. Right after the closing tag, give the meaning in ${LANGUAGE_NAMES[language]}, presented as a translation of the meaning.
- Inside <p class="hadith">…</p> keep the Arabic hadith text exactly as it is, and translate only the source line inside <span class="source">…</span>. Right after the closing tag, give the meaning in ${LANGUAGE_NAMES[language]}.
- Keep every tag, the markdown structure, the citation numbers and the [[SOURCES_START]] … [[SOURCES_END]] block. Translate the source details but keep book titles and scholars' names recognizable. Keep links unchanged.
- Write citation numbers in ${language === 'en' ? 'Western digits, e.g. (1)' : 'Eastern Arabic-Indic digits used in that language, e.g. (۱)'}.
- Write Islamic terms the way ${LANGUAGE_NAMES[language]} readers know them${language === 'en' ? ' (Tawhid, Aqidah, Fiqh, Sunnah, Salaf), with a short meaning in brackets the first time a less familiar term appears' : ''}.
Reply with JSON only: {"question": "...", "answer": "..."}.`;

export const translatePost = async (question: string, answer: string, language: ReplyLanguage, signal: AbortSignal): Promise<PostVersion> => {
    const result = parseJson<{ question?: string; answer?: string }>(
        await ask(translateSystem(language), `<question>\n${question}\n</question>\n\n<answer>\n${answer}\n</answer>`, signal, true)
    );
    if (!result.question?.trim() || !result.answer?.trim()) throw new Error(`Empty ${language} translation`);
    return { q: result.question.trim(), a: result.answer.trim() };
};

const normalize = (text: string) =>
    text
        .replace(/[ً-ْـ]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .toLowerCase();

const QUESTION_SYSTEM = `You choose questions for the daily post of an Islamic research website that follows the Salaf. Pick a question that Muslims commonly ask and search for online, phrased in Arabic the way people would type it into a search engine (clear, natural, one question). It must be answerable from the Quran, authentic Sunnah and the statements of trusted scholars: no personal fatwa about one person's situation, no political or sectarian provocation, no new matter (nawazil) that needs a living scholar's ijtihad.
It must be clearly different from every question in the "already published" list: not the same question reworded, and not the same narrow issue.
Reply with JSON only: {"question": "the Arabic question", "slug": "short-english-url-slug-in-lowercase-with-hyphens"}.`;

/** A new question in today's category that hasn't been covered. */
export const chooseQuestion = async (category: Category, published: string[], signal: AbortSignal) => {
    const prompt = `Category: ${CATEGORY_BRIEF[category]}.\n\nAlready published (do not repeat):\n${published.slice(0, 400).map((q) => `- ${q}`).join('\n') || '(none yet)'}`;
    const known = new Set(published.map(normalize));
    for (let attempt = 0; attempt < 3; attempt++) {
        const choice = parseJson<{ question?: string; slug?: string }>(await ask(QUESTION_SYSTEM, prompt, signal, true));
        const question = choice.question?.trim();
        if (question && !known.has(normalize(question))) return { question, slug: choice.slug ?? '' };
    }
    throw new Error('No new question found');
};

const META_SYSTEM = `For this Islamic question, give a short English URL slug (lowercase words joined by hyphens, at most 8 words) and its category, one of: ${CATEGORIES.join(', ')}. Reply with JSON only: {"slug": "...", "category": "..."}`;

const describeQuestion = async (question: string, signal: AbortSignal) => {
    const meta = parseJson<{ slug?: string; category?: string }>(await ask(META_SYSTEM, question, signal, true));
    const category = (CATEGORIES as readonly string[]).includes(meta.category ?? '') ? (meta.category as Category) : 'fiqh';
    return { slug: meta.slug ?? '', category };
};

const cleanSlug = (raw: string) =>
    raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 70)
        .replace(/-+$/g, '');

const uniqueSlug = async (raw: string) => {
    const base = cleanSlug(raw) || `question-${Date.now().toString(36)}`;
    for (let n = 1; n < 50; n++) {
        const slug = n === 1 ? base : `${base}-${n}`;
        if (!(await readPost(slug))) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
};

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export type PipelineResult =
    | { ok: true; post: BlogPost }
    | { ok: false; question: string; reason: string; issues?: string[] };

/** Answers, reviews, translates and saves one question. Rejected answers are tried once more. */
export const publishQuestion = async (
    question: string,
    options: { source: 'auto' | 'manual'; category?: Category; slug?: string; signal: AbortSignal }
): Promise<PipelineResult> => {
    const { signal } = options;
    let issues: string[] = [];
    let answer = '';
    for (let attempt = 0; attempt < 2; attempt++) {
        const draft = await answerLikeTheChat(question, signal);
        const review = await reviewAnswer(question, draft.answer, draft.evidence, signal);
        if (review.approved) {
            answer = draft.answer;
            break;
        }
        issues = review.issues;
        console.warn('[blog] review rejected a draft', { question, attempt, issues });
    }
    if (!answer) return { ok: false, question, reason: 'review', issues };

    const translations = await Promise.all(
        (['en', 'ur', 'fa'] as const).map((language) =>
            translatePost(question, answer, language, signal).then(
                (version) => [language, version] as const,
                (error) => {
                    console.warn('[blog] translation failed', { language, error: error instanceof Error ? error.message : String(error) });
                    return null;
                }
            )
        )
    );
    const meta = options.slug && options.category ? { slug: options.slug, category: options.category } : await describeQuestion(question, signal);
    const slug = await uniqueSlug(options.slug || meta.slug);
    const now = Date.now();
    const post: BlogPost = {
        v: 1,
        slug,
        category: options.category ?? meta.category,
        source: options.source,
        status: 'published',
        createdAt: now,
        updatedAt: now,
        langs: {
            ar: { q: question, a: answer },
            ...Object.fromEntries(translations.filter((entry) => entry !== null)),
        },
    };
    await savePost(post);
    return { ok: true, post };
};

const SITE = 'https://salaf-ai.vercel.app';

/** Tells the owner's Discord channel what the daily run did. */
export const notifyOwner = async (result: PipelineResult) => {
    const webhook = process.env.STATS_WEBHOOK_URL || process.env.FEEDBACK_WEBHOOK_URL;
    if (!webhook) return;
    const content = result.ok
        ? `📝 New blog post: ${result.post.langs.ar?.q}\n${SITE}/blog/${encodeURIComponent(slugFor(result.post, 'ar'))}`
        : `⚠️ No blog post published for: ${result.question}\nReason: ${result.reason}${result.issues?.length ? `\n- ${result.issues.join('\n- ')}` : ''}`;
    await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
};

const categoryForDay = (now: number) => CATEGORIES[Math.floor(now / 86_400_000) % CATEGORIES.length];

/**
 * Today's post: a question the owner queued, or a new one Salaf AI chooses. Runs once a day even
 * if the schedule fires twice.
 */
export const runDaily = async (signal: AbortSignal, { force = false } = {}): Promise<PipelineResult | { ok: false; reason: 'already-ran' }> => {
    if (!getGeminiConfig().apiKey) throw new BlogError(503, 'NOT_CONFIGURED');
    const day = new Date().toISOString().slice(0, 10);
    if (!force && !(await getStore({ strict: !!process.env.VERCEL }).setTextIfAbsent(`salaf:blog:ran:${day}`, '1', 2 * 86_400))) {
        return { ok: false, reason: 'already-ran' };
    }
    const queued = await takeQueuedQuestion();
    const category = categoryForDay(Date.now());
    let result: PipelineResult;
    try {
        if (queued) {
            result = await publishQuestion(queued, { source: 'manual', signal });
        } else {
            const published = (await listAllPosts()).map((post) => post.langs.ar?.q ?? '').filter(Boolean);
            const choice = await chooseQuestion(category, published, signal);
            result = await publishQuestion(choice.question, { source: 'auto', category, slug: choice.slug, signal });
        }
    } catch (error) {
        result = { ok: false, question: queued ?? `(${category})`, reason: error instanceof Error ? error.message : String(error) };
    }
    await notifyOwner(result);
    return result;
};
