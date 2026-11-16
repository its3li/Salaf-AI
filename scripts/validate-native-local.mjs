// Real-provider local app checks. Sequential; charges are calculated ONLY at the user's rates.
import fs from 'node:fs/promises';
const dir = 'test-results/native-validation';
await fs.mkdir(dir, { recursive: true });
const client = 'local-native-check-2026';
const results = JSON.parse(await fs.readFile(`${dir}/results.json`, 'utf8').catch(() => '[]'));
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
const endpoint = process.argv.find(a => a.startsWith('--endpoint='))?.slice('--endpoint='.length) || 'http://127.0.0.1:3000';
async function chat(id, text, attachment = {}, language = 'en') {
  const start = Date.now();
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': client },
    body: JSON.stringify({ messages: [{ role: 'user', text, ...attachment }], language }), signal: AbortSignal.timeout(660000) };
  let response = await fetch(`${endpoint}/api/chat`, init);
  if (response.status === 429 && response.headers.get('retry-after')) {
    const details = await response.clone().json().catch(() => null);
    if (details?.error?.code === 'RATE_LIMITED') {
      const seconds = Math.min(65, Number(response.headers.get('retry-after')) + 1);
      console.log(`Respecting the configured burst limit: next attempt in ${seconds} seconds (no model call was made).`);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      response = await fetch(`${endpoint}/api/chat`, init);
    }
  }
  const raw = await response.text();
  const events = raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
  const usage = events.find(e => e.type === 'done')?.usage;
  const answer = events.filter(e => e.type === 'text').map(e => e.text).join('');
  const error = events.find(e => e.type === 'error');
  const row = { id, endpoint, ok: !!usage && !error, elapsedMs: Date.now() - start, usage, error: error?.code,
    costUsdAtUserRates: usage ? (usage.inputTokens * .067 + usage.outputTokens * .34) / 1e6 : null,
    recognizedCode: answer.toUpperCase().includes('CEDAR') && answer.includes('742'), answer };
  if (id === 'images3') row.ok &&= row.recognizedCode && answer.toUpperCase().includes('OLIVE') && answer.includes('913') && answer.toUpperCase().includes('PALM') && answer.includes('285');
  if (id === 'image' || id === 'pdf') row.ok &&= row.recognizedCode;
  if (id === 'pdf-text') row.ok &&= row.recognizedCode;
  if (id === 'video-audio') row.ok &&= /study|learning|routine/i.test(answer) && !/bearded man|light-colored thobe/i.test(answer);
  if (id === 'silent-video') row.ok = error?.code === 'UNSUPPORTED_ATTACHMENT' || (!!usage && /red/i.test(answer) && /green/i.test(answer) && /rainbow|gradient/i.test(answer) && /timestamp|timecode/i.test(answer));
  results.push(row); await fs.writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ...row, answer: undefined }));
}
async function prepare(path, mimeType, seconds) {
  const bytes = await fs.readFile(path);
  const response = await fetch(`${endpoint}/api/media`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': client },
    body: JSON.stringify({ action: 'start', dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, durationSec: seconds, name: path.split('/').at(-1) }) });
  const result = await response.json(); if (!response.ok || !result.result) throw new Error(`File preparation failed: ${response.status}`);
  return result.result;
}
if (!only || only.includes('research')) await chat('research', 'ما صحة حديث «اختلاف أمتي رحمة»؟ يجب استخدام أداة البحث للتحقق من الحديث قبل الإجابة. اذكر المصدر الذي رجعت إليه.', {}, 'ar');
if (!only || only.includes('images3')) await chat('images3', 'Read the document code in each of the three images. Reply with all three codes only.', { images: await Promise.all(['note.jpg', 'second.jpg', 'third.jpg'].map(async file => `data:image/jpeg;base64,${(await fs.readFile(`${dir}/${file}`)).toString('base64')}`)) });
if (!only || only.includes('image')) await chat('image', 'Read the document code in this image. Reply with the code only.', { image: `data:image/jpeg;base64,${(await fs.readFile(`${dir}/note.jpg`)).toString('base64')}` });
if (!only || only.includes('pdf')) await chat('pdf', 'Read the document code on the scanned PDF page. Reply with the code only.', { native: await prepare(`${dir}/scanned-note.pdf`, 'application/pdf', 0) });
if (!only || only.includes('pdf-text')) await chat('pdf-text', 'Read the document code. Reply with the code only.', { native: await prepare(`${dir}/text-note.pdf`, 'application/pdf', 0), pdfText: 'Document code: CEDAR-742' });
if (!only || only.includes('audio')) await chat('audio', 'Summarize the main advice spoken in this recording in three points.', { native: await prepare('test-results/cost-benchmark/media/learning.mp3', 'audio/mpeg', 30) });
if (!only || only.includes('silent-video')) await chat('silent-video', 'Describe the colors and shapes visible in this silent video. Do not invent speech.', { native: await prepare('test-results/cost-benchmark/media/learning-silent.mp4', 'video/mp4', 30) });
if (!only || only.includes('video-audio')) await chat('video-audio', 'Summarize the spoken advice and briefly describe what is visible.', { native: await prepare('test-results/cost-benchmark/media/learning-spoken.mp4', 'video/mp4', 30) });
