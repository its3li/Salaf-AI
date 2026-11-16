// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './media';
import { verifyNativeFile } from './_lib/nativeFiles';
import { clearMemoryStoreForTests } from './_lib/limits';
import { downloadYoutubeAudio } from './_lib/downloadAudio';
vi.mock('./_lib/downloadAudio.js', () => ({ downloadYoutubeAudio: vi.fn(), AudioDownloadError: class extends Error {} }));

const wav = (seconds: number, sampleRate = 8000) => {
  const samples = seconds * sampleRate;
  const bytes = Buffer.alloc(44 + samples);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate, 28); bytes.writeUInt16LE(1, 32); bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples, 40);
  return bytes.toString('base64');
};

const call = async (body: Record<string, unknown>) => {
  const req = { method: 'POST', headers: { 'x-client-id': 'native-media-test' }, body } as unknown as VercelRequest;
  const res = { statusCode: 200, body: {} as Record<string, unknown>, status(code: number) { this.statusCode = code; return this; },
    setHeader() {}, json(body: Record<string, unknown>) { this.body = body; return this; } };
  await handler(req, res as unknown as VercelResponse); return { req, res };
};
beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; process.env.MEDIA_SIGNING_SECRET = 'test-secret'; });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); clearMemoryStoreForTests(); delete process.env.GEMINI_API_KEY; delete process.env.MEDIA_SIGNING_SECRET; delete process.env.PAXSENIX_API_KEY; });
describe('native media preparation', () => {
  it('advertises native mode and its upload limit', async () => {
    const { res } = await call({ action: 'allowance' }); expect(res.body).toMatchObject({ mode: 'native', maxFileBytes: 12582912 });
  });
  it('signs audio instantly without contacting transcription services', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const bytes = wav(30);
    const { req, res } = await call({ action: 'start', dataUrl: `data:audio/wav;base64,${bytes}`, durationSec: 1, name: 'lecture.wav' });
    expect(res.body).toMatchObject({ stage: 'done', mode: 'native', credits: 1, result: { kind: 'audio', durationSec: 30, data: bytes } });
    expect(verifyNativeFile(res.body.result, req)).toBe(true); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a 20-minute-plus recording even when the browser claims it is only one second', async () => {
    const { res } = await call({ action: 'start', dataUrl: `data:audio/wav;base64,${wav(1201, 1000)}`, durationSec: 1, name: 'long.wav' });
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatchObject({ code: 'MEDIA_DAILY_LIMIT' });
    expect((await call({ action: 'allowance' })).res.body.mediaRemainingSeconds).toBe(1200);
  });
  it('keeps scanned PDF bytes without requiring extractable text or charging minutes', async () => {
    const { req, res } = await call({ action: 'start', dataUrl: 'data:application/pdf;base64,YWJj', name: 'scan.pdf' });
    expect(res.body).toMatchObject({ credits: 0, result: { kind: 'pdf', mimeType: 'application/pdf', durationSec: 0 } });
    expect(verifyNativeFile(res.body.result, req)).toBe(true);
  });
  it('rejects executable content', async () => {
    const { res } = await call({ action: 'start', dataUrl: 'data:application/octet-stream;base64,YWJj', name: 'test.exe' });
    expect(res.statusCode).toBe(413);
  });
  it('cannot be used without the signing secret', async () => {
    delete process.env.MEDIA_SIGNING_SECRET;
    expect((await call({ action: 'allowance' })).res.statusCode).toBe(503);
  });
  it('extracts YouTube audio and returns signed audio bytes, without a transcription or video input', async () => {
    process.env.PAXSENIX_API_KEY = 'test-pax-key';
    vi.mocked(downloadYoutubeAudio).mockResolvedValue({ bytes: Buffer.from(wav(30), 'base64'), mimeType: 'audio/wav' });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      const body = href.includes('/oembed') ? { title: 'Short lesson', author_name: 'Tests' } :
        href.includes('/youtubei/') ? { videoDetails: { lengthSeconds: '30' } } :
        href.includes('/yt/ytaudio') ? { ok: true, directLink: 'https://audio.example/test.mp3' } : undefined;
      if (!body) throw new Error(`Unexpected request: ${href}`);
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { req, res } = await call({ action: 'start', url: 'https://youtu.be/Hp5duraTH_U' });
    expect(res.body).toMatchObject({ stage: 'done', result: { kind: 'youtube', mimeType: 'audio/wav', durationSec: 30 } });
    expect(verifyNativeFile(res.body.result, req)).toBe(true);
    expect(fetchMock.mock.calls.every(call => !String(call[0]).includes('assemblyai') && !String(call[0]).includes('pollinations'))).toBe(true);
  });
});
