// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './media';
import { clearMemoryStoreForTests } from './_lib/limits';
import { verifyTranscript } from './_lib/media';

interface MockResponse extends Partial<VercelResponse> {
  statusCode: number;
  jsonBody: any;
}

const createMockResponse = (): MockResponse => {
  const response: MockResponse = { statusCode: 200, jsonBody: undefined };
  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response as VercelResponse;
  }) as VercelResponse['status'];
  response.json = vi.fn((body: unknown) => {
    response.jsonBody = body;
    return response as VercelResponse;
  }) as VercelResponse['json'];
  return response;
};

const call = async (body: Record<string, unknown>, device = 'device-aaaa-1111') => {
  const res = createMockResponse();
  await handler(
    { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10', 'x-client-id': device }, body } as unknown as VercelRequest,
    res as VercelResponse
  );
  return res;
};

const VIDEO = 'https://www.youtube.com/watch?v=Hp5duraTH_U';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface FakeServices {
  paxPolls: number;
  aaiSubmits: number;
  aaiChecks: number;
  maiCalls: number;
  aaiStatus: 'completed' | 'error';
  maiFails: boolean;
}

/** Fakes YouTube, PaxSenix, AssemblyAI and Pollinations at the fetch level. */
const fakeServices = (overrides: Partial<FakeServices> = {}) => {
  const state: FakeServices = { paxPolls: 0, aaiSubmits: 0, aaiChecks: 0, maiCalls: 0, aaiStatus: 'completed', maiFails: false, ...overrides };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://www.youtube.com/oembed')) {
        return json({ title: 'شرح الأصول الثلاثة', author_name: 'قناة الدروس', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' });
      }
      if (url.startsWith('https://www.youtube.com/watch')) return new Response('<script>{"lengthSeconds":"600"}</script>');
      if (url.includes('/dl/ytmp3')) return json({ ok: true, task_url: 'https://api.paxsenix.org/task/abc' });
      if (url.endsWith('/task/abc')) {
        state.paxPolls += 1;
        return json(state.paxPolls < 2 ? { status: 'processing' } : { status: 'done', url: 'https://audio.example/a.mp3' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        state.aaiSubmits += 1;
        return json({ id: 'aai-1', status: 'queued' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript/aai-1') {
        state.aaiChecks += 1;
        return json(
          state.aaiStatus === 'error'
            ? { status: 'error', error: 'account balance is negative' }
            : {
                status: 'completed',
                audio_duration: 590,
                words: [
                  { text: 'بسم', start: 0, end: 400 },
                  { text: 'الله', start: 450, end: 900 },
                ],
              }
        );
      }
      if (url === 'https://audio.example/a.mp3') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
      if (url.startsWith('https://gen.pollinations.ai/')) {
        state.maiCalls += 1;
        if (state.maiFails) return json({ error: 'down' }, 500);
        return json({ duration: 595, segments: [{ start: 0, end: 4, text: 'بسم الله الرحمن الرحيم' }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
  return state;
};

/** Polls status until the job finishes, like the browser does. */
const runToEnd = async (jobId: string) => {
  for (let i = 0; i < 10; i += 1) {
    const res = await call({ action: 'status', jobId });
    if (res.jsonBody.stage === 'done' || res.jsonBody.stage === 'failed') return res;
  }
  throw new Error('job never finished');
};

beforeEach(() => {
  process.env.MEDIA_SIGNING_SECRET = 'test-secret';
  process.env.ASSEMBLYAI_API_KEY = 'aai-key';
  process.env.POLLINATIONS_API_KEY = 'pollinations-key';
  process.env.PAXSENIX_API_KEY = 'pax-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearMemoryStoreForTests();
  for (const name of ['MEDIA_SIGNING_SECRET', 'ASSEMBLYAI_API_KEY', 'POLLINATIONS_API_KEY', 'PAXSENIX_API_KEY', 'MEDIA_DAILY_SECONDS']) {
    delete process.env[name];
  }
});

describe('/api/media', () => {
  it('inspects a video without charging anything', async () => {
    fakeServices();
    const res = await call({ action: 'inspect', url: VIDEO });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({
      video: { videoId: 'Hp5duraTH_U', title: 'شرح الأصول الثلاثة', channel: 'قناة الدروس', durationSec: 600 },
      credits: 2,
      quota: { limit: 50, remaining: 50 },
      mediaRemainingSeconds: 3600,
    });
  });

  it('turns a YouTube link into a signed transcript and settles the charge to the real length', async () => {
    const services = fakeServices();
    const start = await call({ action: 'start', url: VIDEO });
    expect(start.jsonBody).toMatchObject({ stage: 'audio', credits: 2, quota: { remaining: 48 } });

    const done = await runToEnd(start.jsonBody.jobId);
    expect(done.jsonBody.stage).toBe('done');
    const result = done.jsonBody.result;
    expect(result).toMatchObject({ kind: 'youtube', videoId: 'Hp5duraTH_U', durationSec: 590, transcript: '[0:00] بسم الله' });
    expect(result.approximateTimes).toBeUndefined();
    expect(verifyTranscript(result, 'test-secret')).toBe(true);
    expect(services.aaiSubmits).toBe(1);

    // Asking again returns the same result without calling anyone.
    const checks = services.aaiChecks;
    expect((await call({ action: 'status', jobId: start.jsonBody.jobId })).jsonBody.result).toEqual(result);
    expect(services.aaiChecks).toBe(checks);

    const allowance = await call({ action: 'allowance' });
    expect(allowance.jsonBody).toMatchObject({ quota: { remaining: 48 }, mediaRemainingSeconds: 3600 - 590 });
  });

  it('never submits the same job twice, even when status requests overlap', async () => {
    const services = fakeServices({ paxPolls: 1 });
    const start = await call({ action: 'start', url: VIDEO });
    await Promise.all([1, 2, 3].map(() => call({ action: 'status', jobId: start.jsonBody.jobId })));
    expect(services.aaiSubmits).toBe(1);
  });

  it('switches to the backup when AssemblyAI fails', async () => {
    const services = fakeServices({ aaiStatus: 'error' });
    const start = await call({ action: 'start', url: VIDEO });
    const done = await runToEnd(start.jsonBody.jobId);
    expect(done.jsonBody.result).toMatchObject({ durationSec: 595, approximateTimes: true, transcript: '[0:00] بسم الله الرحمن الرحيم' });
    expect(verifyTranscript(done.jsonBody.result, 'test-secret')).toBe(true);
    expect(services.maiCalls).toBe(1);
  });

  it('refunds everything when both providers fail', async () => {
    fakeServices({ aaiStatus: 'error', maiFails: true });
    const start = await call({ action: 'start', url: VIDEO });
    const done = await runToEnd(start.jsonBody.jobId);
    expect(done.jsonBody).toMatchObject({ stage: 'failed', error: { code: 'TRANSCRIPTION_FAILED' } });
    const allowance = await call({ action: 'allowance' });
    expect(allowance.jsonBody).toMatchObject({ quota: { remaining: 50 }, mediaRemainingSeconds: 3600 });
  });

  it('serves a video transcribed before from the cache, still charging the user', async () => {
    const services = fakeServices();
    await runToEnd((await call({ action: 'start', url: VIDEO })).jsonBody.jobId);
    const submitted = services.aaiSubmits;

    const again = await call({ action: 'start', url: VIDEO }, 'device-bbbb-2222');
    expect(again.jsonBody).toMatchObject({ stage: 'done', credits: 2, quota: { remaining: 48 } });
    expect(again.jsonBody.result.transcript).toBe('[0:00] بسم الله');
    expect(services.aaiSubmits).toBe(submitted);
  });

  it('refuses once the daily hour is used up', async () => {
    fakeServices();
    process.env.MEDIA_DAILY_SECONDS = '600';
    expect((await call({ action: 'start', url: VIDEO })).statusCode).toBe(200);
    const refused = await call({ action: 'start', url: VIDEO });
    expect(refused.statusCode).toBe(429);
    expect(refused.jsonBody.error).toMatchObject({ code: 'MEDIA_DAILY_LIMIT', resetAt: expect.any(Number) });
  });

  it('stays off until it is configured', async () => {
    delete process.env.MEDIA_SIGNING_SECRET;
    const res = await call({ action: 'inspect', url: VIDEO });
    expect(res.statusCode).toBe(503);
    expect(res.jsonBody.error.code).toBe('MEDIA_UNAVAILABLE');
  });

  it('rejects links that are not YouTube videos', async () => {
    fakeServices();
    const res = await call({ action: 'inspect', url: 'https://example.com/video' });
    expect(res.statusCode).toBe(400);
  });
});
