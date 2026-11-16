// One real STT check on a synthetic recording, no Gemini generation and no extra credit/minute charges.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
for (const [name, value] of Object.entries(env)) process.env[name] ??= value;
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', mode: 'test' });
try {
  const { transcribeNativeMedia } = await server.ssrLoadModule('/api/_lib/audioFallback.ts');
  const bytes = await fs.readFile('test-results/cost-benchmark/media/learning.mp3');
  const started = Date.now();
  const result = await transcribeNativeMedia({ kind: 'audio', title: 'Synthetic learning.mp3', mimeType: 'audio/mpeg', durationSec: 31,
    byteLength: bytes.length, data: bytes.toString('base64'), owner: 'synthetic-test', signature: 'live-fallback-synthetic-test', expiresAt: Date.now() + 60000 }, AbortSignal.timeout(180000));
  const recognized = /study|routine/i.test(result.media.transcript) && /twenty|20/i.test(result.media.transcript);
  await fs.writeFile('test-results/native-validation/stt-fallback.json', JSON.stringify({ ok: recognized, provider: result.provider, elapsedMs: Date.now() - started, transcript: result.media.transcript }, null, 2));
  console.log(JSON.stringify({ ok: recognized, provider: result.provider, elapsedMs: Date.now() - started, cached: result.cached }));
  if (!recognized) process.exitCode = 1;
} finally { await server.close(); }
