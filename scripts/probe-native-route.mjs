// One bounded native-PDF route check. Never logs the key or changes app configuration.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
const base = new URL(env.GEMINI_BASE_URL || env.BENCHMARK_BASE_URL);
base.pathname = '/v1beta';
const key = env.GEMINI_API_KEY || env.BENCHMARK_API_KEY;
const model = env.GEMINI_MODEL || env.BENCHMARK_MODEL || 'gemini-4-hydrogen';
const bytes = await fs.readFile('test-results/native-validation/scanned-note.pdf');
const started = Date.now();
const response = await fetch(`${base.href.replace(/\/$/, '')}/models/${model}:generateContent`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Read the document code from this scanned PDF. Return only the code.' },
    { inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } }] }],
    generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'LOW' } } }),
  signal: AbortSignal.timeout(120000),
});
const data = await response.json().catch(() => null);
const text = data?.candidates?.[0]?.content?.parts?.filter(p => p.text && !p.thought).map(p => p.text).join('');
console.log(JSON.stringify({ route: '/v1beta', status: response.status, elapsedMs: Date.now() - started,
  recognizedCode: !!text?.toUpperCase().includes('CEDAR') && !!text?.includes('742'), text, usage: data?.usageMetadata }));
