// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { transcribeNativeMedia } from './audioFallback';
import { clearMemoryStoreForTests, getMediaAllowance } from './limits';
import type { NativeFile } from './nativeFiles';
import type { VercelRequest } from '@vercel/node';

beforeEach(() => { process.env.ASSEMBLYAI_API_KEY = 'test-assembly-key'; process.env.MEDIA_SIGNING_SECRET = 'test-signing-key'; });
afterEach(() => { delete process.env.ASSEMBLYAI_API_KEY; delete process.env.MEDIA_SIGNING_SECRET; vi.unstubAllGlobals(); clearMemoryStoreForTests(); });
it('caches a transcript and does not charge credits/minutes or transcribe the same file twice', async () => {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const data = url.endsWith('/upload') ? { upload_url: 'https://audio.example/upload' } :
      url.endsWith('/transcript') && init?.method === 'POST' ? { id: 'job-1' } :
      { status: 'completed', words: [{ text: 'actual', start: 0, end: 500 }, { text: 'speech', start: 600, end: 1000 }] };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }); vi.stubGlobal('fetch', fetchMock);
  const file: NativeFile = { kind: 'audio', title: 'test.wav', mimeType: 'audio/wav', durationSec: 30, byteLength: 3,
    data: 'YWJj', owner: 'owner', expiresAt: Date.now() + 60000, signature: 'unique-file-signature' };
  const first = await transcribeNativeMedia(file, new AbortController().signal);
  const second = await transcribeNativeMedia(file, new AbortController().signal);
  expect(first.media.transcript).toBe('[0:00] actual speech'); expect(second.cached).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect((await getMediaAllowance({ headers: { 'x-client-id': 'test-credits-user' } } as unknown as VercelRequest)).credits.remaining).toBe(50);
});
