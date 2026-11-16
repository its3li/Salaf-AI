// One short public YouTube audio preparation check; no model generation is requested.
const started = Date.now();
const url = process.argv.find(argument => argument.startsWith('--url='))?.slice('--url='.length) || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const response = await fetch('http://127.0.0.1:3000/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'youtube-audio-check-2026' },
  body: JSON.stringify({ action: 'start', url }), signal: AbortSignal.timeout(190000) });
const data = await response.json();
const ok = response.ok && data.result?.kind === 'youtube' && data.result?.mimeType?.startsWith('audio/') && data.result?.durationSec <= 1200;
console.log(JSON.stringify({ ok, status: response.status, mimeType: data.result?.mimeType, durationSec: data.result?.durationSec, error: data.error?.code, elapsedMs: Date.now() - started }));
if (!ok) process.exitCode = 1;
