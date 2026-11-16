// Real upload/preparation check using only synthetic silence. No model generation is requested.
import { upload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
const duration = 20, rate = 48000, samples = duration * rate * 4;
const bytes = Buffer.alloc(44 + samples);
bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples, 40);
const client = 'storage-verification-2026'; let url;
try {
  const blob = await upload(`media/native/${crypto.randomUUID()}/test-silence.wav`, new File([bytes], 'test-silence.wav', { type: 'audio/wav' }), {
    access: 'public', handleUploadUrl: 'http://127.0.0.1:3000/api/media', contentType: 'audio/wav', headers: { 'X-Client-Id': client },
  }); url = blob.url;
  const response = await fetch('http://127.0.0.1:3000/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': client },
    body: JSON.stringify({ action: 'start', blobUrl: url, name: 'test-silence.wav', durationSec: 1 }) });
  const result = await response.json();
  const ok = response.ok && result.result?.durationSec === duration && result.result?.byteLength === bytes.length;
  console.log(JSON.stringify({ ok, status: response.status, uploadedBytes: bytes.length, verifiedDuration: result.result?.durationSec }));
  if (!ok) process.exitCode = 1;
} catch (error) { console.log(JSON.stringify({ ok: false, errorType: error.name })); process.exitCode = 1; }
finally { if (url) await del(url, { token: env.BLOB_READ_WRITE_TOKEN }).catch(() => {}); }
