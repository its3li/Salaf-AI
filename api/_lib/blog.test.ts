// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateGemini } from './gemini';
import { runResearchTool } from './research';
import { clearMemoryStoreForTests } from './limits';
import { clearBlogMemoryForTests, publishQuestion, queueQuestion, readPost, runDaily, savePost, type BlogPost } from './blog';
import blogHandler from '../blog';
import adminHandler from '../blogadmin';
import sitemapHandler from '../sitemap';
import { renderPostPage } from '../blogpage';

vi.mock('./gemini.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gemini')>()),
  generateGemini: vi.fn(),
}));
vi.mock('./research.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./research')>()),
  runResearchTool: vi.fn(async () => ({ type: 'tool_result', tool_use_id: 'x', content: 'صحيح مسلم (751) [صحيح]' })),
}));

const reply = (text: string) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
const toolCall = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'search_hadith', args: { query: 'اجعلوا آخر صلاتكم' } } }] }, finishReason: 'STOP' }] };

/** Answers each kind of model call by what its system prompt is for. */
const scriptModel = ({ approve = true } = {}) => {
  vi.mocked(generateGemini).mockImplementation(async (body) => {
    const system = String((body as { systemInstruction: { parts: Array<{ text: string }> } }).systemInstruction.parts[0].text);
    const contents = (body as { contents: unknown[] }).contents;
    if (system.includes('strict reviewer')) return reply(JSON.stringify(approve ? { approved: true, issues: [] } : { approved: false, issues: ['Wrong grading'] })) as never;
    if (system.includes('You translate')) return reply(JSON.stringify({ question: 'Translated question', answer: 'Translated answer' })) as never;
    if (system.includes('URL slug')) return reply(JSON.stringify({ slug: 'witr-ruling', category: 'fiqh' })) as never;
    if (system.includes('You choose questions')) return reply(JSON.stringify({ question: 'ما حكم صلاة الضحى؟', slug: 'duha-prayer-ruling' })) as never;
    // Salaf AI itself: check a hadith first, then answer.
    return (contents.length === 1 ? toolCall : reply('الوتر سنة مؤكدة (١).')) as never;
  });
};

const response = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
    send(value: unknown) { this.body = value; return this; },
    end() { return this; },
    setHeader(key: string, value: unknown) { this.headers[key.toLowerCase()] = value; return this; },
    redirect(code: number, url: string) { this.statusCode = code; this.headers.location = url; return this; },
  };
  return res;
};
const admin = (body: Record<string, unknown>, secret = 'admin-secret') =>
  ({ method: 'POST', headers: { authorization: `Bearer ${secret}` }, query: {}, body }) as unknown as VercelRequest;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test';
  process.env.ADMIN_SECRET = 'admin-secret';
  process.env.CRON_SECRET = 'cron-secret';
});
afterEach(() => {
  vi.clearAllMocks();
  clearBlogMemoryForTests();
  clearMemoryStoreForTests();
  for (const key of ['GEMINI_API_KEY', 'ADMIN_SECRET', 'CRON_SECRET']) delete process.env[key];
});

describe('publishing a question', () => {
  it('answers with research, passes review, translates into every language and saves', async () => {
    scriptModel();
    const result = await publishQuestion('ما حكم الوتر؟', { source: 'manual', signal: AbortSignal.timeout(5000) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(runResearchTool).toHaveBeenCalledTimes(1);
    expect(result.post.slug).toBe('witr-ruling');
    expect(result.post.category).toBe('fiqh');
    expect(Object.keys(result.post.langs).sort()).toEqual(['ar', 'en', 'fa', 'ur']);
    expect(result.post.langs.ar).toEqual({ q: 'ما حكم الوتر؟', a: 'الوتر سنة مؤكدة (١).' });
    // The review saw what the hadith check returned.
    const reviewCall = vi.mocked(generateGemini).mock.calls.find(([body]) => JSON.stringify(body).includes('strict reviewer'));
    expect(JSON.stringify(reviewCall)).toContain('صحيح مسلم (751)');
    expect((await readPost('witr-ruling'))?.status).toBe('published');
  });

  it('publishes nothing when the review rejects both drafts', async () => {
    scriptModel({ approve: false });
    const result = await publishQuestion('ما حكم الوتر؟', { source: 'manual', signal: AbortSignal.timeout(5000) });
    expect(result).toMatchObject({ ok: false, reason: 'review', issues: ['Wrong grading'] });
    expect(await readPost('witr-ruling')).toBeNull();
  });

  it('gives a repeated slug a number instead of overwriting', async () => {
    scriptModel();
    await publishQuestion('ما حكم الوتر؟', { source: 'manual', signal: AbortSignal.timeout(5000) });
    const second = await publishQuestion('هل الوتر واجب؟', { source: 'manual', signal: AbortSignal.timeout(5000) });
    expect(second.ok && second.post.slug).toBe('witr-ruling-2');
  });
});

describe('the daily post', () => {
  it('uses a queued question first, and runs only once a day', async () => {
    scriptModel();
    await queueQuestion('ما حكم الوتر؟');
    const first = await runDaily(AbortSignal.timeout(5000));
    expect(first.ok && first.post.source).toBe('manual');
    expect(await runDaily(AbortSignal.timeout(5000))).toEqual({ ok: false, reason: 'already-ran' });
  });

  it('chooses a new question itself when the queue is empty', async () => {
    scriptModel();
    const result = await runDaily(AbortSignal.timeout(5000));
    expect(result.ok && result.post.langs.ar?.q).toBe('ما حكم صلاة الضحى؟');
    expect(result.ok && result.post.source).toBe('auto');
  });

  it('only runs from the schedule with the cron secret', async () => {
    const res = response();
    await adminHandler({ method: 'GET', headers: { authorization: 'Bearer wrong' }, query: { task: 'daily' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(401);
  });
});

const samplePost = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  v: 1,
  slug: 'witr-ruling',
  category: 'fiqh',
  source: 'auto',
  status: 'published',
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
  langs: { ar: { q: 'ما حكم الوتر؟', a: 'الوتر سنة مؤكدة </script><script>alert(1)</script>' }, en: { q: 'Is witr obligatory?', a: 'Witr is a confirmed Sunnah.' } },
  ...overrides,
});

describe('admin', () => {
  it('turns away a wrong secret', async () => {
    const res = response();
    await adminHandler(admin({ action: 'list' }, 'nope'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(401);
  });

  it('marks a corrected version as edited, and hides posts from the public', async () => {
    await savePost(samplePost());
    const res = response();
    await adminHandler(admin({ action: 'edit', slug: 'witr-ruling', lang: 'en', a: 'Witr is a strongly confirmed Sunnah.' }), res as unknown as VercelResponse);
    expect((res.body as BlogPost).langs.en).toMatchObject({ q: 'Is witr obligatory?', a: 'Witr is a strongly confirmed Sunnah.', editedAt: expect.any(Number) });

    await adminHandler(admin({ action: 'hide', slug: 'witr-ruling' }), response() as unknown as VercelResponse);
    const publicRes = response();
    await blogHandler({ method: 'GET', headers: {}, query: { slug: 'witr-ruling', lang: 'en' } } as unknown as VercelRequest, publicRes as unknown as VercelResponse);
    expect(publicRes.statusCode).toBe(404);
  });
});

describe('public pages', () => {
  it('serves a post in the asked language, falling back to Arabic', async () => {
    await savePost(samplePost());
    const res = response();
    await blogHandler({ method: 'GET', headers: {}, query: { slug: 'witr-ruling', lang: 'ur' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.body).toMatchObject({ lang: 'ar', q: 'ما حكم الوتر؟', languages: ['ar', 'en'] });
  });

  it('renders a post page with hreflang links and data that cannot break out of its script tag', () => {
    const template =
      '<html lang="ar" dir="rtl"><head><title>x</title><meta name="description" content="d"><link rel="canonical" href="c">' +
      '<meta name="robots" content="index"></head><body><div id="root"></div></body></html>';
    const html = renderPostPage(template, samplePost(), 'en');
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<link rel="canonical" href="https://salaf-ai.vercel.app/en/blog/witr-ruling">');
    expect(html).toContain('hreflang="ar" href="https://salaf-ai.vercel.app/blog/witr-ruling"');
    expect(renderPostPage(template, samplePost(), 'ar')).not.toContain('</script><script>alert(1)');
  });

  it('lists every language of every post in the sitemap', async () => {
    await savePost(samplePost());
    const res = response();
    await sitemapHandler({ method: 'GET', headers: {}, query: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(String(res.body)).toContain('<loc>https://salaf-ai.vercel.app/blog/witr-ruling</loc>');
    expect(String(res.body)).toContain('<loc>https://salaf-ai.vercel.app/en/blog/witr-ruling</loc>');
  });
});

describe('reviewers', () => {
  const call = async (body: Record<string, unknown>, key: string) => {
    const res = response();
    await adminHandler(admin(body, key), res as unknown as VercelResponse);
    return res;
  };
  const publicPost = async (lang: string) => {
    const res = response();
    await blogHandler({ method: 'GET', headers: {}, query: { slug: 'witr-ruling', lang } } as unknown as VercelRequest, res as unknown as VercelResponse);
    return res.body as { lang: string; reviewed?: boolean; editedAt?: number; languages: string[]; a: string };
  };

  it('work only on their own languages, and can be removed', async () => {
    await savePost(samplePost({ langs: { ...samplePost().langs, ur: { q: 'کیا وتر واجب ہے؟', a: 'پرانا ترجمہ' } } }));
    const added = await call({ action: 'addReviewer', name: 'Hamza', langs: ['ur'] }, 'admin-secret');
    const { key, reviewer } = added.body as { key: string; reviewer: { id: string } };

    expect((await call({ action: 'list' }, key)).body).toMatchObject({ editor: { name: 'Hamza', role: 'reviewer', langs: ['ur'] } });
    expect((await call({ action: 'list' }, key)).body).not.toHaveProperty('reviewers');

    const edited = await call({ action: 'edit', slug: 'witr-ruling', lang: 'ur', a: 'بہتر ترجمہ' }, key);
    expect((edited.body as BlogPost).langs.ur).toMatchObject({ a: 'بہتر ترجمہ', editedBy: 'Hamza', original: { a: 'پرانا ترجمہ' } });

    expect((await call({ action: 'edit', slug: 'witr-ruling', lang: 'en', a: 'x' }, key)).statusCode).toBe(403);
    expect((await call({ action: 'delete', slug: 'witr-ruling' }, key)).statusCode).toBe(403);
    expect((await call({ action: 'publish', question: 'ما حكم الوتر؟' }, key)).statusCode).toBe(403);

    await call({ action: 'removeReviewer', id: reviewer.id }, 'admin-secret');
    expect((await call({ action: 'list' }, key)).statusCode).toBe(401);
  });

  it('approve, hide a single language, and restore the original', async () => {
    await savePost(samplePost());
    await call({ action: 'review', slug: 'witr-ruling', lang: 'en', status: 'approved', note: 'Checked the wording' }, 'admin-secret');
    expect(await publicPost('en')).toMatchObject({ lang: 'en', reviewed: true });

    await call({ action: 'hideLang', slug: 'witr-ruling', lang: 'en' }, 'admin-secret');
    expect(await publicPost('en')).toMatchObject({ lang: 'ar', languages: ['ar'] });
    await call({ action: 'showLang', slug: 'witr-ruling', lang: 'en' }, 'admin-secret');
    expect((await publicPost('en')).lang).toBe('en');

    await call({ action: 'edit', slug: 'witr-ruling', lang: 'en', a: 'Corrected.' }, 'admin-secret');
    expect((await publicPost('en')).editedAt).toEqual(expect.any(Number));
    const restored = await call({ action: 'restore', slug: 'witr-ruling', lang: 'en' }, 'admin-secret');
    expect((restored.body as BlogPost).langs.en).toMatchObject({ a: 'Witr is a confirmed Sunnah.' });
    expect((restored.body as BlogPost).langs.en).not.toHaveProperty('editedAt');
  });

  it('keep a whole post hidden until it is published again', async () => {
    await savePost(samplePost());
    await call({ action: 'hide', slug: 'witr-ruling' }, 'admin-secret');
    const hidden = response();
    await blogHandler({ method: 'GET', headers: {}, query: { slug: 'witr-ruling', lang: 'ar' } } as unknown as VercelRequest, hidden as unknown as VercelResponse);
    expect(hidden.statusCode).toBe(404);
    await call({ action: 'show', slug: 'witr-ruling' }, 'admin-secret');
    expect((await publicPost('ar')).lang).toBe('ar');
  });
});
