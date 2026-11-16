// Paired real-file Gemini benchmark, plus AssemblyAI STT. Uses only synthetic test content.
import fs from 'node:fs/promises';
import { getBenchmarkProvider, redactBenchmarkError } from './benchmark-provider.mjs';
import { parseEnv } from 'node:util';
import { performance } from 'node:perf_hooks';
const args = new Set(process.argv.slice(2));
const fixtureDir = 'test-results/cost-benchmark';
const runName = [...args].find(a => a.startsWith('--run='))?.slice('--run='.length);
if (runName && !/^[a-zA-Z0-9_-]+$/.test(runName)) throw new Error('Invalid run name');
const dir = `${fixtureDir}${runName ? `/${runName}` : ''}`;
await fs.mkdir(dir, { recursive: true });
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
const model = [...args].find(a => a.startsWith('--model='))?.slice('--model='.length) || process.env.BENCHMARK_MODEL || 'gemini-4-hydrogen';
if (!['gemini-4-hydrogen', 'gemini-3.8-flash'].includes(model)) throw new Error('Unsupported benchmark model');
const prefix = model === 'gemini-4-hydrogen' ? 'native-media' : `native-media-${model}`;
const provider = getBenchmarkProvider('google', process.env);
const rows = [];
const priorRows = JSON.parse(await fs.readFile(`${fixtureDir}/native-media-results.json`, 'utf8').catch(() => '[]'));
async function generate(id, kind, text) {
  const start = performance.now();
  const row = { id, kind, durationSec: kind === 'text' ? 0 : 30, ok: false };
  try {
    const parts = [{ text: 'Briefly summarize the spoken or written content in up to five points. If there is no speech or writing, describe only what is visible.' }];
    if (kind === 'text') parts.push({ text });
    else {
      const suffix = kind === 'audio' ? '.mp3' : kind === 'video-silent' ? '-silent.mp4' : '-spoken.mp4';
      const bytes = await fs.readFile(`${fixtureDir}/media/${id}${suffix}`);
      row.bytes = bytes.length;
      parts.push({ inlineData: { mimeType: kind === 'audio' ? 'audio/mpeg' : 'video/mp4', data: bytes.toString('base64') } });
    }
    const response = await fetch(`${provider.settings.baseURL}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.settings.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'MEDIUM' } } }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data.error).slice(0,300)}`);
    const u = data.usageMetadata || {};
    row.usageMetadata = u;
    row.inputTokens = u.promptTokenCount || 0;
    row.visibleOutputTokens = u.candidatesTokenCount || 0;
    row.reasoningTokens = u.thoughtsTokenCount || 0;
    row.outputTokens = row.visibleOutputTokens + row.reasoningTokens;
    row.costUsdAtUserRates = (row.inputTokens * .067 + row.outputTokens * .34) / 1e6;
    row.answer = data.candidates?.[0]?.content?.parts?.filter(p => p.text && !p.thought).map(p => p.text).join('');
    row.ok = data.candidates?.[0]?.finishReason === 'STOP' && !!row.answer;
  } catch (e) { row.error = redactBenchmarkError(e.message, provider); }
  row.elapsedMs = Math.round(performance.now() - start);
  rows.push(row);
  await fs.writeFile(`${dir}/${prefix}-results.json`, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ ...row, answer: undefined, usageMetadata: undefined }));
}

async function transcribe(id) {
  const previous = priorRows.find(r => r.id === id && r.kind === 'assemblyai-transcription' && r.ok);
  if (args.has('--reuse-stt') && previous) {
    rows.push(previous);
    return;
  }
  const start = performance.now();
  const row = { id, kind: 'assemblyai-transcription', durationSec: 30, ok: false };
  const headers = { authorization: env.ASSEMBLYAI_API_KEY };
  try {
    const uploadStart = performance.now();
    const upload = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST', headers, body: await fs.readFile(`${fixtureDir}/media/${id}.mp3`), signal: AbortSignal.timeout(30000),
    });
    if (!upload.ok) throw new Error(`Upload HTTP ${upload.status}`);
    const uploaded = await upload.json();
    row.uploadMs = Math.round(performance.now() - uploadStart);
    const submitted = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: uploaded.upload_url, speech_models: ['universal-3-5-pro', 'universal-2'], language_detection: true }), signal: AbortSignal.timeout(30000),
    });
    const job = await submitted.json();
    if (!submitted.ok || !job.id) throw new Error(`Submission HTTP ${submitted.status}: ${job.error || 'no id'}`);
    const jobStarted = performance.now();
    while (performance.now() - jobStarted < 180000) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const status = await fetch(`https://api.assemblyai.com/v2/transcript/${job.id}`, { headers, signal: AbortSignal.timeout(20000) });
      if (!status.ok) throw new Error(`Status HTTP ${status.status}`);
      const result = await status.json();
      if (result.status === 'error') throw new Error(result.error);
      if (result.status !== 'completed') continue;
      row.ok = true;
      row.durationSec = result.audio_duration;
      row.speechModel = result.speech_model_used || result.speech_model;
      row.text = result.text;
      row.wordCount = result.words?.length;
      row.listPriceUsd = result.audio_duration / 3600 * .21;
      break;
    }
    if (!row.ok) row.error = 'Transcription deadline exceeded';
  } catch (e) { row.error = e.message; }
  row.elapsedMs = Math.round(performance.now() - start);
  rows.push(row);
  await fs.writeFile(`${dir}/${prefix}-results.json`, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ ...row, text: undefined }));
}

// Sequential calls avoid distorting latency through local concurrency.
for (const id of ['learning', 'science', 'budget']) {
  const metadata = JSON.parse((await fs.readFile(`${fixtureDir}/media/${id}.json`, 'utf8')).replace(/^\uFEFF/, ''));
  for (const kind of ['text', 'audio', 'video-silent', 'video-spoken']) await generate(id, kind, metadata.text);
  await transcribe(id);
}
const groups = {};
for (const kind of ['text', 'audio', 'video-silent', 'video-spoken', 'assemblyai-transcription']) {
  const selected = rows.filter(r => r.kind === kind && r.ok);
  const avg = key => selected.reduce((sum,r) => sum+(r[key] || 0), 0)/selected.length;
  groups[kind] = { n: selected.length, meanSeconds: avg('elapsedMs')/1000, meanInputTokens: avg('inputTokens'), meanOutputTokens: avg('outputTokens'), meanCostUsd: avg('costUsdAtUserRates'), meanSttListPriceUsd: avg('listPriceUsd') };
}
await fs.writeFile(`${dir}/${prefix}-results.json`, JSON.stringify(rows, null, 2));
await fs.writeFile(`${dir}/${prefix}-summary.json`, JSON.stringify({ model, notes: ['30-second synthetic English recordings; 3 topics, 2 desktop voices.', 'Native media is a separate alternative to the current transcript-only app.', 'Simple common instruction; no app system prompt or research tools.', 'Video visuals are a synthetic moving test pattern, not real-world scenes.', 'AssemblyAI price is list-price estimation, not invoice verification.'], groups }, null, 2));
console.log(JSON.stringify(groups, null, 2));
