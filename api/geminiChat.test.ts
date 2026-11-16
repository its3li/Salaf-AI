// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './chat';
import { signNativeFile, nativeOwner } from './_lib/nativeFiles';
import { clearMemoryStoreForTests, getMediaAllowance } from './_lib/limits';
import { runResearchTool } from './_lib/research';
import { cachedAudioFallback, transcribeNativeMedia } from './_lib/audioFallback';
import { signTranscript } from './_lib/media';
import { readAnswerRecord } from './_lib/answerRecords';
vi.mock('./_lib/audioFallback.js', () => ({ cachedAudioFallback: vi.fn(), transcribeNativeMedia: vi.fn(), NoSpeechError: class extends Error {} }));

vi.mock('./_lib/research.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./_lib/research')>();
  return { ...actual, runResearchTool: vi.fn(async () => ({ type: 'tool_result', tool_use_id: 'call-1', content: 'Verified source text, https://dorar.net/h/abc' })) };
});
const request = (messages: unknown[]) => ({ method: 'POST', headers: { 'x-client-id': 'test-gemini-client' }, body: { messages, language: 'ar' } }) as unknown as VercelRequest;
const response = () => {
  const res = { statusCode: 200, headers: {} as Record<string, unknown>, body: undefined as unknown, chunks: [] as string[],
    writableFinished: false, close: () => {},
    status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; },
    setHeader(key: string, value: unknown) { this.headers[key] = value; return this; },
    write(chunk: string) { this.chunks.push(chunk); return true; }, end() { this.writableFinished = true; },
    on(event: string, cb: () => void) { if (event === 'close') this.close = cb; return this; }, flushHeaders() {} };
  return res;
};
const result = (parts = [{ text: 'الجواب المختصر.' }], finishReason = 'STOP') => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
  usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 100, thoughtsTokenCount: 50 },
}), { headers: { 'Content-Type': 'application/json' } });
const events = (res: ReturnType<typeof response>) => res.chunks.filter(c => c.startsWith('data:')).map(c => JSON.parse(c.slice(5)));
const body = (mock: ReturnType<typeof vi.fn>, index = 0) => JSON.parse(String(mock.mock.calls[index][1].body));

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key'; process.env.GEMINI_BASE_URL = 'https://gemini.example/v1beta';
  vi.mocked(cachedAudioFallback).mockReset().mockResolvedValue(null);
  vi.mocked(transcribeNativeMedia).mockReset().mockRejectedValue(new Error('No test transcriber configured'));
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.clearAllMocks(); clearMemoryStoreForTests();
  for (const key of ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'MEDIA_SIGNING_SECRET', 'DAILY_CREDIT_LIMIT']) delete process.env[key];
});

describe('Gemini chat route', () => {
  it('saves each answer for sharing and links a follow-up to the answer before it', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => result()); vi.stubGlobal('fetch', fetchMock);
    const first = response(); await handler(request([{ role: 'user', text: 'سؤال' }]), first as unknown as VercelResponse);
    const receipt = events(first).find(e => e.type === 'done').receipt;
    expect(receipt).toMatchObject({ id: expect.any(String), key: expect.any(String) });
    const second = response();
    await handler(request([{ role: 'user', text: 'سؤال' }, { role: 'assistant', text: 'الجواب المختصر.', receipt }, { role: 'user', text: 'وماذا بعد؟' }]), second as unknown as VercelResponse);
    const followUp = events(second).find(e => e.type === 'done').receipt;
    const record = await readAnswerRecord(followUp);
    expect(record).toMatchObject({ q: 'وماذا بعد؟', a: 'الجواب المختصر.', prev: receipt.id, ctx: 2, ok: true });
    expect(first.chunks.join('')).not.toContain('"q"');
  });
  it('uses the private Gemini endpoint, returns text, and counts thinking at the supplied rates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(request([{ role: 'user', text: 'سؤال' }]), res as unknown as VercelResponse);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gemini.example/v1beta/models/gemini-4-hydrogen:generateContent');
    expect(body(fetchMock).systemInstruction.parts[0].text).toContain('Salaf AI');
    expect(body(fetchMock).generationConfig.thinkingConfig.thinkingLevel).toBe('LOW');
    expect(events(res)).toMatchObject([{ type: 'text' }, { type: 'done', usage: { inputTokens: 3000, outputTokens: 150, thinkingTokens: 50 } }]);
    expect(res.chunks.join('')).not.toContain('test-gemini-key');
  });
  it('preserves signed thinking parts across a research round, runs the tool, and sums every round', async () => {
    const parts = [{ functionCall: { name: 'search_hadith', args: { query: 'اختلاف أمتي رحمة' } }, thoughtSignature: 'encrypted-signature' }];
    const fetchMock = vi.fn().mockResolvedValueOnce(result([...parts, { text: '' }] as never)).mockResolvedValueOnce(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(request([{ role: 'user', text: 'تحقق من هذا الحديث' }]), res as unknown as VercelResponse);
    expect(runResearchTool).toHaveBeenCalledTimes(1);
    expect(body(fetchMock, 1).contents[1].parts).toEqual(parts);
    expect(body(fetchMock, 1).contents[2].parts[0].functionResponse.response.result).toContain('Verified source');
    expect(events(res)).toMatchObject([{ type: 'status' }, { type: 'text' }, { type: 'done', usage: { rounds: 2, toolCalls: 1, inputTokens: 6000, outputTokens: 300 } }]);
    expect(res.chunks.join('')).not.toContain('encrypted-signature');
  });
  it('sends an image as native inline data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(request([{ role: 'user', text: 'اقرأ الصورة', image: 'data:image/jpeg;base64,YWJj' }]), res as unknown as VercelResponse);
    expect(body(fetchMock).contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } });
  });
  it('sends all three images and reserves seven credits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(request([{ role: 'user', text: 'compare', images: Array(3).fill('data:image/jpeg;base64,YWJj') }]), res as unknown as VercelResponse);
    expect(body(fetchMock).contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData)).toHaveLength(3);
    expect(res.headers['X-RateLimit-Remaining']).toBe('43');
  });
  it('rejects four images and images hidden in history before making a provider request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const messages of [
      [{ role: 'user', text: 'compare', images: Array(4).fill('data:image/jpeg;base64,YWJj') }],
      [{ role: 'user', text: 'old', image: 'data:image/jpeg;base64,YWJj' }, { role: 'user', text: 'current' }],
    ]) {
      const res = response(); await handler(request(messages), res as unknown as VercelResponse); expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses image credits without locking text-only questions when some balance remains', async () => {
    process.env.DAILY_CREDIT_LIMIT = '2';
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(request([{ role: 'user', text: 'read', image: 'data:image/jpeg;base64,YWJj' }]), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(429); expect(res.body).toMatchObject({ error: { code: 'INSUFFICIENT_CREDITS' } });
    expect(res.headers['X-RateLimit-Remaining']).toBe('2'); expect(fetchMock).not.toHaveBeenCalled();
  });
  for (const [kind, mimeType] of [['audio', 'audio/wav'], ['video', 'video/mp4'], ['pdf', 'application/pdf']] as const) {
    it(`sends signed ${kind} bytes directly, without calling a transcriber`, async () => {
      process.env.MEDIA_SIGNING_SECRET = 'test-secret';
      const req = request([]);
      const native = signNativeFile({ kind, mimeType, title: 'test', durationSec: kind === 'pdf' ? 0 : 30,
        data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() + 60000 });
      req.body.messages = [{ role: 'user', text: '', native }];
      const fetchMock = vi.fn().mockResolvedValue(result()); vi.stubGlobal('fetch', fetchMock);
      const res = response(); await handler(req, res as unknown as VercelResponse);
      expect(body(fetchMock).contents[0].parts[0].inlineData).toEqual({ mimeType, data: 'YWJj' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }
  it('rejects forged or expired native assets before any provider call', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret';
    const req = request([]);
    const native = signNativeFile({ kind: 'pdf', mimeType: 'application/pdf', title: 'test', durationSec: 0,
      data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() - 1 });
    req.body.messages = [{ role: 'user', text: 'read', native }];
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends only audio bytes for a prepared YouTube attachment', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret';
    const req = request([]);
    req.body.messages = [{ role: 'user', text: 'Summarize the speech', native: signNativeFile({
      kind: 'youtube', mimeType: 'audio/mpeg', title: 'Lecture', videoId: 'Hp5duraTH_U', durationSec: 30,
      data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() + 60000,
    }) }];
    const fetchMock = vi.fn().mockResolvedValue(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(body(fetchMock).contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'audio/mpeg', data: 'YWJj' } });
    expect(JSON.stringify(body(fetchMock))).not.toContain('fileUri');
  });
  it('refunds a failed answer and never leaks the provider error body', async () => {
    const req = request([{ role: 'user', text: 'سؤال' }]);
    const fetchMock = vi.fn().mockResolvedValue(new Response('secret test-gemini-key', { status: 502 })); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(events(res)[0]).toMatchObject({ type: 'error', code: 'UPSTREAM_ERROR' });
    expect((await getMediaAllowance(req)).credits.remaining).toBe(50);
    expect(res.chunks.join('')).not.toContain('test-gemini-key'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('treats a missing stop reason as incomplete rather than delivering it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result([{ text: 'partial' }], '')));
    const res = response(); await handler(request([{ role: 'user', text: 'سؤال' }]), res as unknown as VercelResponse);
    expect(events(res)).toMatchObject([{ type: 'error', code: 'UPSTREAM_ERROR' }]);
  });
  it('does not deliver guessed PDF/video answers from the known attachment-dropping gateway adapter', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret';
    const req = request([]);
    req.body.messages = [{ role: 'user', text: 'Read this PDF', native: signNativeFile({ kind: 'pdf', mimeType: 'application/pdf',
      title: 'scan.pdf', durationSec: 0, data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() + 60000 }) }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Invented file content' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, billing_usage: { source: 'oai_chat' } },
    }))));
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(events(res)).toMatchObject([{ type: 'error', code: 'UNSUPPORTED_ATTACHMENT' }]);
    expect(res.chunks.join('')).not.toContain('Invented file content');
  });
  it('tries native audio first and transcribes only after explicit audio rejection', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret'; const req = request([]);
    req.body.messages = [{ role: 'user', text: 'Summarize', native: signNativeFile({ kind: 'audio', mimeType: 'audio/wav',
      title: 'recording.wav', durationSec: 30, data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() + 60000 }) }];
    const media = signTranscript({ kind: 'audio', title: 'recording.wav', durationSec: 30, transcript: '[0:00] Actual spoken content' }, 'test-secret');
    vi.mocked(transcribeNativeMedia).mockResolvedValue({ media, provider: 'assemblyai', cached: false });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unsupported audio format' } }), { status: 400 }))
      .mockResolvedValueOnce(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(body(fetchMock).contents[0].parts[0].inlineData.mimeType).toBe('audio/wav');
    expect(JSON.stringify(body(fetchMock, 1))).toContain('Actual spoken content');
    expect(body(fetchMock, 1).contents[0].parts.some((part: { inlineData?: unknown }) => part.inlineData)).toBe(false);
    expect(transcribeNativeMedia).toHaveBeenCalledTimes(1);
    expect(events(res).at(-1)).toMatchObject({ type: 'done', mediaFallback: media, usage: { transcriptionFallbacks: 1 } });
  });
  it('does not start transcription for a busy provider', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret'; const req = request([]);
    req.body.messages = [{ role: 'user', text: 'Summarize', native: signNativeFile({ kind: 'audio', mimeType: 'audio/wav',
      title: 'recording.wav', durationSec: 30, data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() + 60000 }) }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(transcribeNativeMedia).not.toHaveBeenCalled(); expect(events(res)[0].code).toBe('UPSTREAM_BUSY');
  });
  it('falls back to extracted PDF text without making up scanned page contents', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret'; const req = request([]);
    req.body.messages = [{ role: 'user', text: 'Read this PDF', pdfText: 'Actual extracted PDF content', native: signNativeFile({ kind: 'pdf', mimeType: 'application/pdf',
      title: 'text.pdf', durationSec: 0, data: 'YWJj', byteLength: 3, owner: nativeOwner(req), expiresAt: Date.now() + 60000 }) }];
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'No PDF received' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, billing_usage: { source: 'oai_chat' } } })))
      .mockResolvedValueOnce(result()); vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler(req, res as unknown as VercelResponse);
    expect(JSON.stringify(body(fetchMock, 1))).toContain('Actual extracted PDF content');
    expect(body(fetchMock, 1).contents[0].parts.some((part: { inlineData?: unknown }) => part.inlineData)).toBe(false);
    expect(events(res).at(-1)).toMatchObject({ type: 'done', pdfTextFallback: true });
    expect(transcribeNativeMedia).not.toHaveBeenCalled();
  });
});
