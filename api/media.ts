import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { del, head } from '@vercel/blob';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import {
    allowBurst,
    chargeMedia,
    getMediaAllowance,
    getMediaMaxSeconds,
    getStore,
    mediaCreditCost,
    refundMedia,
    settleMedia,
    type MediaAllowance,
    type MediaCharge,
} from './_lib/limits.js';
import {
    getSigningSecret,
    linesFromSegments,
    linesFromWords,
    parseClock,
    parseYoutubeId,
    signTranscript,
    type MediaKind,
    type MediaTranscript,
} from './_lib/media.js';

// ---------------------------------------------------------------------------
// /api/media turns a YouTube link or an uploaded audio/video file into a timestamped transcript.
//
// The browser drives it with short requests: `inspect` (free: title, length, cost), `start` (charges
// credits and kicks off the work), then `status` every few seconds until the transcript is ready.
// AssemblyAI transcribes from a link, so the audio never passes through this server; when it fails,
// Microsoft's MAI Transcribe 2 (through Pollinations) takes over. Each paid step is guarded by a lock
// in Redis so replaying a request can never start the same transcription twice.
// ---------------------------------------------------------------------------

type MediaErrorCode =
    | 'METHOD_NOT_ALLOWED'
    | 'VALIDATION_ERROR'
    | 'RATE_LIMITED'
    | 'MEDIA_UNAVAILABLE'
    | 'YOUTUBE_UNAVAILABLE'
    | 'MEDIA_TOO_LONG'
    | 'MEDIA_DAILY_LIMIT'
    | 'NOT_ENOUGH_CREDITS'
    | 'MEDIA_SITE_LIMIT'
    | 'UPLOAD_REJECTED'
    | 'TRANSCRIPTION_FAILED'
    | 'JOB_NOT_FOUND';

type Stage = 'audio' | 'transcribing' | 'fallback' | 'done' | 'failed';

interface Job {
    id: string;
    kind: MediaKind;
    title: string;
    channel?: string;
    videoId?: string;
    /** Length known before transcription (YouTube page or the browser); null when it couldn't be read. */
    knownSeconds: number | null;
    charge: MediaCharge;
    stage: Stage;
    createdAt: number;
    paxTaskUrl?: string;
    paxStartedAt?: number;
    audioUrl?: string;
    /** File name for the backup provider, which needs one with the right extension. */
    audioName?: string;
    blobUrl?: string;
    aaiId?: string;
    aaiSubmittedAt?: number;
    result?: MediaTranscript;
    error?: MediaErrorCode;
}

interface YoutubeMeta {
    videoId: string;
    title: string;
    channel: string;
    thumbnailUrl: string;
    durationSec: number | null;
    live: boolean;
}

/** What a transcript cache entry keeps; it is signed again when served, so the secret can rotate. */
interface CachedTranscript {
    title: string;
    channel?: string;
    durationSec: number;
    transcript: string;
}

const JOB_TTL_SECONDS = 2 * 3600;
const META_TTL_SECONDS = 3600;
const TRANSCRIPT_CACHE_TTL_SECONDS = 30 * 86400;
const PAXSENIX_TIMEOUT_MS = 3 * 60_000;
const ASSEMBLYAI_TIMEOUT_MS = 8 * 60_000;
// Leaves room under the 300s maxDuration in vercel.json for the backup provider's single long request.
const FALLBACK_BUDGET_MS = 270_000;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Reserved when a YouTube video's length couldn't be read; settled to the real length afterwards. */
const UNKNOWN_LENGTH_SECONDS = 600;
const ASSEMBLYAI = 'https://api.assemblyai.com/v2';
const PAXSENIX = 'https://api.paxsenix.org';
const POLLINATIONS_TRANSCRIBE = 'https://gen.pollinations.ai/v1/audio/transcriptions';
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
};

const keys = {
    job: (id: string) => `salaf:media:job:${id}`,
    lock: (id: string, step: string) => `salaf:media:job:${id}:lock:${step}`,
    meta: (videoId: string) => `salaf:media:yt:${videoId}`,
    transcript: (videoId: string) => `salaf:media:transcript:${videoId}`,
};

const sendError = (
    res: VercelResponse,
    status: number,
    code: MediaErrorCode,
    message: string,
    extra: Record<string, unknown> = {}
) => res.status(status).json({ error: { code, message, ...extra } });

const describeError = (error: unknown) => (error instanceof Error ? error.message.slice(0, 300) : String(error));

const fetchJson = async <T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).host} responded with ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
};

// ---------------------------------------------------------------------------
// YouTube details
// ---------------------------------------------------------------------------

const readYoutubeLength = async (videoId: string): Promise<{ seconds: number | null; live: boolean }> => {
    try {
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(10_000),
        });
        const html = await response.text();
        const length = /"lengthSeconds":"(\d+)"/.exec(html);
        const live = /"isLiveContent":true/.test(html) && /"isLive":true/.test(html);
        if (length && Number(length[1]) > 0) return { seconds: Number(length[1]), live };
        if (live) return { seconds: null, live: true };
    } catch (error) {
        console.warn('[api/media] YouTube page lookup failed', { videoId, error: describeError(error) });
    }

    const paxKey = process.env.PAXSENIX_API_KEY;
    if (!paxKey) return { seconds: null, live: false };
    try {
        const payload = await fetchJson<{ results?: Array<{ videoId?: string; duration?: string }> }>(
            `${PAXSENIX}/yt/search?q=${encodeURIComponent(videoId)}`,
            { headers: { Authorization: `Bearer ${paxKey}` } },
            20_000
        );
        const match = payload.results?.find((result) => result.videoId === videoId);
        return { seconds: match?.duration ? parseClock(match.duration) : null, live: false };
    } catch (error) {
        console.warn('[api/media] PaxSenix length lookup failed', { videoId, error: describeError(error) });
        return { seconds: null, live: false };
    }
};

/** Title, channel, thumbnail and length of a public video, or null when YouTube won't share it. */
const getYoutubeMeta = async (videoId: string): Promise<YoutubeMeta | null> => {
    const store = getStore();
    const cached = await store.getText(keys.meta(videoId));
    if (cached) return JSON.parse(cached) as YoutubeMeta;

    let oembed: { title?: string; author_name?: string; thumbnail_url?: string };
    try {
        oembed = await fetchJson(
            `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
            { headers: BROWSER_HEADERS },
            8000
        );
    } catch (error) {
        // Private, removed and embedding-disabled videos all answer 401/403/404 here.
        console.warn('[api/media] oEmbed lookup failed', { videoId, error: describeError(error) });
        return null;
    }

    const length = await readYoutubeLength(videoId);
    const meta: YoutubeMeta = {
        videoId,
        title: (oembed.title || videoId).slice(0, 300),
        channel: (oembed.author_name || '').slice(0, 200),
        thumbnailUrl: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSec: length.seconds,
        live: length.live,
    };
    await store.setText(keys.meta(videoId), JSON.stringify(meta), META_TTL_SECONDS);
    return meta;
};

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Asks PaxSenix to prepare the audio of a video; returns the URL to poll for the result. */
const requestYoutubeAudio = async (videoId: string): Promise<string> => {
    const key = process.env.PAXSENIX_API_KEY;
    if (!key) throw new Error('PAXSENIX_API_KEY is not set');
    const url = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
    const payload = await fetchJson<{ ok?: boolean; task_url?: string; message?: string }>(
        `${PAXSENIX}/dl/ytmp3?url=${url}&format=mp3`,
        { headers: { Authorization: `Bearer ${key}` } },
        20_000
    );
    if (!payload.ok || !payload.task_url) throw new Error(payload.message || 'PaxSenix returned no task');
    return payload.task_url;
};

/** One look at a PaxSenix job: the audio URL when ready, null while working; throws when it failed. */
const checkYoutubeAudio = async (taskUrl: string): Promise<string | null> => {
    const key = process.env.PAXSENIX_API_KEY as string;
    const task = await fetchJson<{ status?: string; url?: string; message?: string }>(
        taskUrl,
        { headers: { Authorization: `Bearer ${key}` } },
        15_000
    );
    if (task.status === 'done' && task.url) return task.url;
    if (/fail|error/i.test(task.status ?? '')) throw new Error(task.message || `PaxSenix task ${task.status}`);
    return null;
};

/** PaxSenix's second YouTube audio source; slower (~30 s) but answers in one request. */
const fetchYoutubeAudioDirect = async (videoId: string): Promise<string> => {
    const key = process.env.PAXSENIX_API_KEY as string;
    const url = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
    const payload = await fetchJson<{ ok?: boolean; directLink?: string; downloads?: string; message?: string }>(
        `${PAXSENIX}/yt/ytaudio?url=${url}`,
        { headers: { Authorization: `Bearer ${key}` } },
        90_000
    );
    const link = payload.directLink || payload.downloads;
    if (!payload.ok || !link) throw new Error(payload.message || 'PaxSenix returned no audio link');
    return link;
};

interface AssemblyTranscript {
    status: 'queued' | 'processing' | 'completed' | 'error';
    error?: string;
    audio_duration?: number;
    words?: Array<{ text: string; start: number; end: number }>;
}

const assemblyHeaders = () => ({
    authorization: process.env.ASSEMBLYAI_API_KEY as string,
    'content-type': 'application/json',
});

const submitAssembly = async (audioUrl: string, endAtSeconds?: number): Promise<string> => {
    if (!process.env.ASSEMBLYAI_API_KEY) throw new Error('ASSEMBLYAI_API_KEY is not set');
    const payload = await fetchJson<{ id?: string; error?: string }>(
        `${ASSEMBLYAI}/transcript`,
        {
            method: 'POST',
            headers: assemblyHeaders(),
            body: JSON.stringify({
                audio_url: audioUrl,
                // Universal-2 picks up languages Universal-3.5 Pro doesn't cover.
                speech_models: ['universal-3-5-pro', 'universal-2'],
                language_detection: true,
                ...(endAtSeconds && { audio_end_at: Math.round(endAtSeconds * 1000) }),
            }),
        },
        20_000
    );
    if (!payload.id) throw new Error(payload.error || 'AssemblyAI returned no transcript id');
    return payload.id;
};

const getAssembly = (id: string) =>
    fetchJson<AssemblyTranscript>(`${ASSEMBLYAI}/transcript/${id}`, { headers: assemblyHeaders() }, 15_000);

interface MaiTranscript {
    duration?: number;
    text?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
}

/** The backup: downloads the audio and sends it to Microsoft's MAI Transcribe 2 through Pollinations. */
const transcribeWithMai = async (audioUrl: string, fileName: string, deadline: number): Promise<MaiTranscript> => {
    const key = process.env.POLLINATIONS_API_KEY;
    if (!key) throw new Error('POLLINATIONS_API_KEY is not set');
    const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!audio.ok) throw new Error(`Audio download responded with ${audio.status}`);
    const bytes = await audio.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`Audio is too large for the backup (${bytes.byteLength} bytes)`);

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: audio.headers.get('content-type') || 'audio/mpeg' }), fileName);
    form.append('model', 'microsoft/mai-transcribe-2');
    form.append('response_format', 'verbose_json');
    return fetchJson<MaiTranscript>(
        POLLINATIONS_TRANSCRIBE,
        { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
        Math.max(1000, deadline - Date.now())
    );
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const saveJob = (job: Job) => getStore({ strict: true }).setText(keys.job(job.id), JSON.stringify(job), JOB_TTL_SECONDS);

const loadJob = async (id: string): Promise<Job | null> => {
    const raw = await getStore({ strict: true }).getText(keys.job(id));
    return raw ? (JSON.parse(raw) as Job) : null;
};

/** Takes a one-time lock for a step of a job; false when another request already took it. */
const lockStep = (id: string, step: string) =>
    getStore({ strict: true }).setTextIfAbsent(keys.lock(id, step), String(Date.now()), JOB_TTL_SECONDS);

const deleteUpload = async (job: Job) => {
    if (!job.blobUrl) return;
    try {
        await del(job.blobUrl);
    } catch (error) {
        console.warn('[api/media] could not delete upload', { jobId: job.id, error: describeError(error) });
    }
};

const finishJob = async (
    job: Job,
    transcript: string,
    actualSeconds: number,
    provider: 'assemblyai' | 'mai' | 'cache'
): Promise<Job> => {
    const secret = getSigningSecret() as string;
    const charge = await settleMedia(job.charge, actualSeconds || job.knownSeconds || job.charge.seconds);
    const result = signTranscript(
        {
            kind: job.kind,
            title: job.title,
            ...(job.channel && { channel: job.channel }),
            ...(job.videoId && { videoId: job.videoId }),
            durationSec: charge.seconds,
            transcript,
            ...(provider === 'mai' && { approximateTimes: true }),
        },
        secret
    );
    // Only AssemblyAI's word-timed transcripts are cached; the backup's times are estimates.
    if (provider === 'assemblyai' && job.videoId) {
        const cached: CachedTranscript = { title: job.title, channel: job.channel, durationSec: charge.seconds, transcript };
        await getStore().setText(keys.transcript(job.videoId), JSON.stringify(cached), TRANSCRIPT_CACHE_TTL_SECONDS);
    }
    await deleteUpload(job);
    const done: Job = { ...job, charge, stage: 'done', result };
    await saveJob(done);
    console.info('[api/media] transcript ready', {
        jobId: job.id,
        kind: job.kind,
        provider,
        seconds: charge.seconds,
        credits: charge.credits,
        chars: transcript.length,
        elapsedMs: Date.now() - job.createdAt,
    });
    return done;
};

const failJob = async (job: Job, error: MediaErrorCode, reason: string): Promise<Job> => {
    await refundMedia(job.charge);
    await deleteUpload(job);
    const failed: Job = { ...job, stage: 'failed', error };
    await saveJob(failed);
    console.error('[api/media] job failed', { jobId: job.id, kind: job.kind, error, reason });
    return failed;
};

/** Sends the audio to AssemblyAI, or straight to the backup if AssemblyAI won't take it. */
const submitTranscription = async (job: Job, audioUrl: string): Promise<Job> => {
    // Only cap the length when it's unknown; a known length passes in full.
    const endAt = job.knownSeconds === null ? getMediaMaxSeconds() : undefined;
    try {
        const aaiId = await submitAssembly(audioUrl, endAt);
        return { ...job, audioUrl, aaiId, aaiSubmittedAt: Date.now(), stage: 'transcribing' };
    } catch (error) {
        console.warn('[api/media] AssemblyAI submit failed, switching to backup', { jobId: job.id, error: describeError(error) });
        return { ...job, audioUrl, stage: 'fallback' };
    }
};

const runFallback = async (job: Job): Promise<Job> => {
    if (!job.audioUrl) return failJob(job, 'TRANSCRIPTION_FAILED', 'no audio URL for the backup');
    try {
        const mai = await transcribeWithMai(job.audioUrl, job.audioName || 'audio.mp3', Date.now() + FALLBACK_BUDGET_MS);
        const transcript = mai.segments?.length
            ? linesFromSegments(mai.segments)
            : mai.text?.trim()
              ? `[0:00] ${mai.text.trim()}`
              : '';
        if (!transcript) return failJob(job, 'TRANSCRIPTION_FAILED', 'backup returned no text');
        return finishJob(job, transcript, mai.duration ?? 0, 'mai');
    } catch (error) {
        return failJob(job, 'TRANSCRIPTION_FAILED', `backup failed: ${describeError(error)}`);
    }
};

/** Moves a job one step forward. Every paid or final step runs under a lock, at most once. */
const advanceJob = async (job: Job): Promise<Job> => {
    if (job.stage === 'audio') {
        let audioUrl: string | null = null;
        try {
            if (job.paxTaskUrl && Date.now() - (job.paxStartedAt ?? job.createdAt) < PAXSENIX_TIMEOUT_MS) {
                audioUrl = await checkYoutubeAudio(job.paxTaskUrl);
                if (!audioUrl) return job;
            } else {
                if (!(await lockStep(job.id, 'audio-direct'))) return job;
                audioUrl = await fetchYoutubeAudioDirect(job.videoId as string);
            }
        } catch (error) {
            if (job.paxTaskUrl) {
                // The first source failed; the next status call tries the second one.
                console.warn('[api/media] PaxSenix task failed', { jobId: job.id, error: describeError(error) });
                const next = { ...job, paxTaskUrl: undefined };
                await saveJob(next);
                return next;
            }
            if (!(await lockStep(job.id, 'finish'))) return job;
            return failJob(job, 'YOUTUBE_UNAVAILABLE', `audio sources failed: ${describeError(error)}`);
        }
        if (!(await lockStep(job.id, 'submit'))) return job;
        const next = await submitTranscription(job, audioUrl);
        await saveJob(next);
        return next;
    }

    if (job.stage === 'transcribing' && job.aaiId) {
        let transcript: AssemblyTranscript;
        try {
            transcript = await getAssembly(job.aaiId);
        } catch (error) {
            console.warn('[api/media] AssemblyAI status check failed', { jobId: job.id, error: describeError(error) });
            return job;
        }
        if (transcript.status === 'completed' && transcript.words?.length) {
            if (!(await lockStep(job.id, 'finish'))) return job;
            return finishJob(job, linesFromWords(transcript.words), transcript.audio_duration ?? 0, 'assemblyai');
        }
        const timedOut = Date.now() - (job.aaiSubmittedAt ?? job.createdAt) > ASSEMBLYAI_TIMEOUT_MS;
        if (transcript.status === 'completed' || transcript.status === 'error' || timedOut) {
            console.warn('[api/media] AssemblyAI failed, switching to backup', {
                jobId: job.id,
                status: transcript.status,
                error: transcript.error,
                timedOut,
            });
            const next: Job = { ...job, stage: 'fallback' };
            await saveJob(next);
            return next;
        }
        return job;
    }

    if (job.stage === 'fallback') {
        if (!(await lockStep(job.id, 'finish'))) return job;
        return runFallback(job);
    }

    return job;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const describeAllowance = (allowance: MediaAllowance) => ({
    quota: allowance.credits,
    mediaRemainingSeconds: allowance.mediaRemainingSeconds,
    mediaLimitSeconds: allowance.mediaLimitSeconds,
    maxSeconds: allowance.maxSeconds,
});

const publicJob = (job: Job) => ({
    jobId: job.id,
    stage: job.stage === 'fallback' ? 'transcribing' : job.stage,
    ...(job.result && { result: job.result }),
    ...(job.error && { error: { code: job.error } }),
    credits: job.charge.credits,
});

const REFUSAL_STATUS: Record<string, number> = {
    MEDIA_TOO_LONG: 413,
    MEDIA_DAILY_LIMIT: 429,
    NOT_ENOUGH_CREDITS: 429,
    MEDIA_SITE_LIMIT: 429,
};

const handleInspect = async (req: VercelRequest, res: VercelResponse) => {
    const videoId = typeof req.body?.url === 'string' ? parseYoutubeId(req.body.url) : null;
    if (!videoId) return sendError(res, 400, 'VALIDATION_ERROR', 'Not a YouTube video link');
    if (!(await allowBurst(req, 'media-inspect', 20))) {
        return sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
    }
    const meta = await getYoutubeMeta(videoId);
    if (!meta || meta.live) return sendError(res, 422, 'YOUTUBE_UNAVAILABLE', 'This video cannot be used');
    const allowance = await getMediaAllowance(req);
    return res.status(200).json({
        video: meta,
        credits: mediaCreditCost(meta.durationSec ?? UNKNOWN_LENGTH_SECONDS),
        ...describeAllowance(allowance),
    });
};

const handleAllowance = async (req: VercelRequest, res: VercelResponse) =>
    res.status(200).json(describeAllowance(await getMediaAllowance(req)));

const isOurBlobUrl = (raw: unknown): raw is string => {
    if (typeof raw !== 'string') return false;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
    } catch {
        return false;
    }
};

const cleanFileName = (raw: unknown) =>
    (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || 'audio';

const handleStart = async (req: VercelRequest, res: VercelResponse) => {
    const body = req.body ?? {};
    const now = Date.now();
    const id = randomUUID();

    if (typeof body.url === 'string') {
        const videoId = parseYoutubeId(body.url);
        if (!videoId) return sendError(res, 400, 'VALIDATION_ERROR', 'Not a YouTube video link');
        const meta = await getYoutubeMeta(videoId);
        if (!meta || meta.live) return sendError(res, 422, 'YOUTUBE_UNAVAILABLE', 'This video cannot be used');

        const charged = await chargeMedia(req, meta.durationSec ?? UNKNOWN_LENGTH_SECONDS);
        if (!charged.allowed) {
            return sendError(res, REFUSAL_STATUS[charged.reason], charged.reason, 'Media limit reached', {
                resetAt: charged.resetAt,
                ...(charged.quota && { quota: charged.quota }),
            });
        }
        let job: Job = {
            id,
            kind: 'youtube',
            title: meta.title,
            channel: meta.channel || undefined,
            videoId,
            knownSeconds: meta.durationSec,
            charge: charged.charge,
            stage: 'audio',
            createdAt: now,
            audioName: `${videoId}.mp3`,
        };

        const cachedRaw = await getStore().getText(keys.transcript(videoId));
        if (cachedRaw && (await lockStep(id, 'finish'))) {
            const cached = JSON.parse(cachedRaw) as CachedTranscript;
            job = await finishJob(job, cached.transcript, cached.durationSec, 'cache');
        } else {
            try {
                job = { ...job, paxTaskUrl: await requestYoutubeAudio(videoId), paxStartedAt: now };
            } catch (error) {
                // The next status call falls back to PaxSenix's second audio source.
                console.warn('[api/media] PaxSenix request failed', { jobId: id, error: describeError(error) });
            }
            await saveJob(job);
        }
        return res.status(200).json({ ...publicJob(job), quota: charged.quota });
    }

    if (isOurBlobUrl(body.blobUrl)) {
        let blob: Awaited<ReturnType<typeof head>>;
        try {
            blob = await head(body.blobUrl);
        } catch {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Uploaded file not found');
        }
        const declared = Number(body.durationSec);
        // A browser that can't read the length gets an estimate from the size (128 kbit/s audio).
        const seconds = Number.isFinite(declared) && declared > 0 ? Math.ceil(declared) : Math.ceil(blob.size / 16_000);
        const charged = await chargeMedia(req, seconds);
        if (!charged.allowed) {
            await del(body.blobUrl).catch(() => {});
            return sendError(res, REFUSAL_STATUS[charged.reason], charged.reason, 'Media limit reached', {
                resetAt: charged.resetAt,
                ...(charged.quota && { quota: charged.quota }),
            });
        }
        const name = cleanFileName(body.name);
        const job: Job = {
            id,
            kind: blob.contentType.startsWith('video/') ? 'video' : 'audio',
            title: name,
            knownSeconds: seconds,
            charge: charged.charge,
            stage: 'transcribing',
            createdAt: now,
            blobUrl: body.blobUrl,
            audioName: name,
        };
        // Transcribe only what was paid for (plus a little slack), whatever length the browser reported.
        let next: Job;
        try {
            const aaiId = await submitAssembly(body.blobUrl, seconds + 30);
            next = { ...job, audioUrl: body.blobUrl, aaiId, aaiSubmittedAt: now };
        } catch (error) {
            console.warn('[api/media] AssemblyAI submit failed, switching to backup', { jobId: id, error: describeError(error) });
            next = { ...job, audioUrl: body.blobUrl, stage: 'fallback' };
        }
        await saveJob(next);
        return res.status(200).json({ ...publicJob(next), quota: charged.quota });
    }

    return sendError(res, 400, 'VALIDATION_ERROR', 'Send a YouTube link or an uploaded file');
};

const handleStatus = async (req: VercelRequest, res: VercelResponse) => {
    const jobId = req.body?.jobId;
    if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/.test(jobId)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Missing job id');
    }
    const job = await loadJob(jobId);
    if (!job) return sendError(res, 404, 'JOB_NOT_FOUND', 'This transcription has expired');
    const next = job.stage === 'done' || job.stage === 'failed' ? job : await advanceJob(job);
    return res.status(200).json(publicJob(next));
};

const handleBlobUpload = async (req: VercelRequest, res: VercelResponse) => {
    try {
        const result = await handleUpload({
            body: req.body as HandleUploadBody,
            request: req,
            onBeforeGenerateToken: async () => {
                // Turn people away before they spend minutes uploading a file they couldn't use today.
                const allowance = await getMediaAllowance(req);
                if (allowance.mediaRemainingSeconds <= 0) throw new Error('MEDIA_DAILY_LIMIT');
                if (allowance.credits.remaining < 2) throw new Error('NOT_ENOUGH_CREDITS');
                return {
                    allowedContentTypes: ['audio/*', 'video/*'],
                    maximumSizeInBytes: MAX_UPLOAD_BYTES,
                    addRandomSuffix: true,
                };
            },
        });
        return res.status(200).json(result);
    } catch (error) {
        const message = describeError(error);
        const code = message === 'MEDIA_DAILY_LIMIT' || message === 'NOT_ENOUGH_CREDITS' ? message : 'UPLOAD_REJECTED';
        console.warn('[api/media] upload refused', { error: message });
        return sendError(res, code === 'UPLOAD_REJECTED' ? 400 : 429, code, message);
    }
};

/** Media costs real money, so it only runs once every piece it depends on is in place. */
const missingConfiguration = () => {
    const missing: string[] = [];
    if (!getSigningSecret()) missing.push('MEDIA_SIGNING_SECRET');
    if (!process.env.ASSEMBLYAI_API_KEY && !process.env.POLLINATIONS_API_KEY) missing.push('a transcription key');
    // Without Redis every instance would count limits on its own, so the daily hour couldn't hold.
    if (process.env.VERCEL && !getStore().shared) missing.push('Redis');
    return missing;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    const missing = missingConfiguration();
    if (missing.length > 0) {
        console.error('[api/media] not configured', { missing });
        return sendError(res, 503, 'MEDIA_UNAVAILABLE', 'Audio and video are not available right now');
    }

    try {
        if (typeof req.body?.type === 'string' && req.body.type.startsWith('blob.')) {
            if (!process.env.BLOB_READ_WRITE_TOKEN) {
                return sendError(res, 503, 'MEDIA_UNAVAILABLE', 'File uploads are not available right now');
            }
            return await handleBlobUpload(req, res);
        }
        switch (req.body?.action) {
            case 'inspect':
                return await handleInspect(req, res);
            case 'allowance':
                return await handleAllowance(req, res);
            case 'start':
                return await handleStart(req, res);
            case 'status':
                return await handleStatus(req, res);
            default:
                return sendError(res, 400, 'VALIDATION_ERROR', 'Unknown action');
        }
    } catch (error) {
        console.error('[api/media] failed', { action: req.body?.action, error: describeError(error) });
        return sendError(res, 503, 'MEDIA_UNAVAILABLE', 'Audio and video are not available right now');
    }
}
