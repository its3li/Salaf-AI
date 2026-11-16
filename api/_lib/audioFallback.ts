import { createHash } from 'node:crypto';
import { getStore, runRedisCommands } from './limits.js';
import { getNativeBytes, type NativeFile } from './nativeFiles.js';
import { getSigningSecret, signTranscript, linesFromWords, linesFromSegments, MAX_TRANSCRIPT_CHARS, type MediaTranscript } from './media.js';
import { parseBuffer } from 'music-metadata';

interface State {
    provider?: 'assemblyai' | 'mai';
    jobId?: string;
    text?: string;
    approximateTimes?: boolean;
    failed?: boolean;
    noSpeech?: boolean;
}
export interface TranscriptionFallback { media: MediaTranscript; provider: 'assemblyai' | 'mai'; cached: boolean }
export class NoSpeechError extends Error {}
class TranscriptionServiceError extends Error { constructor(readonly status: number) { super(`Transcription service returned HTTP ${status}`); } }
const AAI = 'https://api.assemblyai.com/v2';
const TTL = 86400;
const keyFor = (file: NativeFile) => `salaf:audio-fallback:${createHash('sha256').update(file.signature).digest('hex')}`;
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
});
async function json<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new TranscriptionServiceError(response.status); }
    return await response.json() as T;
}
const result = (file: NativeFile, state: State, cached: boolean): TranscriptionFallback => ({
    provider: state.provider!, cached,
    media: signTranscript({ kind: file.kind as 'audio' | 'video' | 'youtube', title: file.title, durationSec: file.durationSec,
        ...(file.videoId && { videoId: file.videoId }), transcript: state.text!,
        ...(state.approximateTimes && { approximateTimes: true }) }, getSigningSecret()!),
});
export async function cachedAudioFallback(file: NativeFile): Promise<TranscriptionFallback | null> {
    if (!['audio', 'video', 'youtube'].includes(file.kind)) return null;
    const raw = await getStore({ strict: !!process.env.VERCEL }).getText(keyFor(file));
    const state: State | null = raw ? JSON.parse(raw) : null;
    return state?.text && state.provider ? result(file, state, true) : null;
}

/** Called only for server-verified, already-charged media. Does not charge credits/minutes again. */
export async function transcribeNativeMedia(file: NativeFile, signal: AbortSignal): Promise<TranscriptionFallback> {
    if (!['audio', 'video', 'youtube'].includes(file.kind)) throw new Error('Only audio/video can be transcribed');
    const cached = await cachedAudioFallback(file); if (cached) return cached;
    if (!process.env.ASSEMBLYAI_API_KEY && !process.env.POLLINATIONS_API_KEY) throw new Error('No fallback transcription credential configured');
    const store = getStore({ strict: !!process.env.VERCEL });
    if (process.env.VERCEL && !store.shared) throw new Error('Shared storage is required for paid transcription');
    const key = keyFor(file); const lockKey = `${key}:lock`; const owner = crypto.randomUUID();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
    while (!(await store.setTextIfAbsent(lockKey, owner, 240))) {
        await wait(500, deadline);
        const ready = await cachedAudioFallback(file); if (ready) return ready;
    }
    let state: State = JSON.parse(await store.getText(key) || '{}');
    try {
        if (state.text) return result(file, state, true);
        if (state.failed) {
            if (state.noSpeech) throw new NoSpeechError('No recognizable speech was found');
            throw new Error('Transcription failed for this attachment; attach it again');
        }
        const bytes = Buffer.from(await getNativeBytes(file, deadline), 'base64');
        if (file.kind === 'video') {
            const metadata = await parseBuffer(bytes, { mimeType: file.mimeType, size: bytes.length }, { skipCovers: true });
            if (metadata.format.hasAudio === false) throw new NoSpeechError('This video has no audio track for the speech fallback');
        }
        if (!state.jobId && process.env.ASSEMBLYAI_API_KEY) {
          try {
            const headers = { authorization: process.env.ASSEMBLYAI_API_KEY };
            const uploaded = await json<{ upload_url: string }>(`${AAI}/upload`, { method: 'POST', headers, body: bytes }, deadline);
            const job = await json<{ id: string }>(`${AAI}/transcript`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_url: uploaded.upload_url, speech_models: ['universal-3-5-pro', 'universal-2'], language_detection: true,
                    audio_end_at: Math.ceil(file.durationSec * 1000) }) }, deadline);
            if (!job.id) throw new Error('Transcription did not return a job id');
            state = { provider: 'assemblyai', jobId: job.id };
            await store.setText(key, JSON.stringify(state), TTL);
          } catch (error) {
            if (!deadline.aborted && process.env.POLLINATIONS_API_KEY && error instanceof TranscriptionServiceError && [401, 402, 403, 429].includes(error.status)) state = { provider: 'mai' };
            else throw error;
          }
        }
        if (state.jobId && state.provider === 'assemblyai') {
            for (;;) {
                const job = await json<{ status: string; words?: Array<{ text: string; start: number; end: number }>; text?: string }>(
                    `${AAI}/transcript/${encodeURIComponent(state.jobId)}`, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY! } }, deadline);
                if (job.status === 'error') {
                    if (process.env.POLLINATIONS_API_KEY) { state = { provider: 'mai' }; break; }
                    throw new Error('Transcription job failed');
                }
                if (job.status === 'completed') {
                    state.text = (job.words?.length ? linesFromWords(job.words) : job.text ? `[0:00] ${job.text}` : '').slice(0, MAX_TRANSCRIPT_CHARS);
                    if (!state.text.trim()) throw new NoSpeechError('No recognizable speech was found');
                    break;
                }
                await wait(2000, deadline);
            }
        }
        if (!state.text && state.provider !== 'assemblyai' && process.env.POLLINATIONS_API_KEY) {
            // Used when AssemblyAI is not configured. No second paid submission after an uncertain failure.
            state = { provider: 'mai' }; await store.setText(key, JSON.stringify({ ...state, failed: true }), TTL);
            const form = new FormData(); form.append('file', new Blob([bytes], { type: file.mimeType }), file.title);
            form.append('model', 'microsoft/mai-transcribe-2'); form.append('response_format', 'verbose_json');
            const response = await fetch('https://gen.pollinations.ai/v1/audio/transcriptions', { method: 'POST',
                headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` }, body: form, signal: deadline });
            if (!response.ok) { await response.body?.cancel(); throw new Error('Backup transcription failed'); }
            const transcript = await response.json() as { text?: string; segments?: Array<{ start: number; end: number; text: string }> };
            state.text = (transcript.segments?.length ? linesFromSegments(transcript.segments) : transcript.text ? `[0:00] ${transcript.text}` : '').slice(0, MAX_TRANSCRIPT_CHARS);
            state.approximateTimes = true;
            if (!state.text.trim()) throw new NoSpeechError('No recognizable speech was found');
        }
        if (!state.text) throw new Error('Transcription did not produce text');
        await store.setText(key, JSON.stringify(state), TTL);
        return result(file, state, false);
    } catch (error) {
        // Keep an accepted AssemblyAI job id so a later retry resumes polling instead of paying twice.
        if (!state.jobId || error instanceof NoSpeechError) await store.setText(key, JSON.stringify({ ...state, failed: true, noSpeech: error instanceof NoSpeechError }), TTL).catch(() => {});
        throw error;
    } finally {
        if (store.shared) {
            await runRedisCommands([['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, lockKey, owner]]).catch(() => {});
        } else if (await store.getText(lockKey) === owner) {
            await store.setText(lockKey, '', 1);
        }
    }
}
