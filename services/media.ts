import { upload } from '@vercel/blob/client';
import type { MediaTranscript } from '../types';
import { getClientId, type ChatQuota } from './chatService';

// Talks to /api/media: looks up YouTube links, uploads audio/video files straight to storage, starts a
// transcription and waits for it. The server charges credits when a transcription starts.

export const MEDIA_SECONDS_PER_CREDIT = 360;
export const MAX_MEDIA_FILE_MB = 200;
const POLL_INTERVAL_MS = 3000;
// Long lectures take about two minutes; the backup provider can take several more.
const POLL_TIMEOUT_MS = 20 * 60_000;

/** Same rule as the server: one credit per started 6 minutes, at least one. */
export const mediaCreditCost = (seconds: number) => Math.max(1, Math.ceil(seconds / MEDIA_SECONDS_PER_CREDIT));

export interface MediaAllowance {
  quota: ChatQuota;
  mediaRemainingSeconds: number;
  mediaLimitSeconds: number;
  maxSeconds: number;
}

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  durationSec: number | null;
}

export type MediaStage = 'audio' | 'transcribing' | 'done' | 'failed';

interface JobResponse {
  jobId: string;
  stage: MediaStage;
  result?: MediaTranscript;
  error?: { code: string };
  credits: number;
  quota?: ChatQuota;
}

export class MediaServiceError extends Error {
  constructor(
    readonly code: string,
    readonly details: { resetAt?: number; quota?: ChatQuota } = {}
  ) {
    super(code);
    this.name = 'MediaServiceError';
  }
}

const YOUTUBE_LINK =
  /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[A-Za-z0-9_-]{11}[^\s]*/i;

/** The first YouTube video link in a piece of text, as written there. */
export const findYoutubeLink = (text: string) => YOUTUBE_LINK.exec(text)?.[0] ?? null;

/** The video id in a YouTube link (for remembering which links the user already declined). */
export const youtubeIdFromLink = (link: string) =>
  /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/.exec(link)?.[1] ?? null;

const callMedia = async <T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
  const clientId = getClientId();
  let response: Response;
  try {
    response = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(clientId && { 'X-Client-Id': clientId }) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MediaServiceError('NETWORK_ERROR');
  }
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; resetAt?: number; quota?: ChatQuota } })
    | null;
  if (!response.ok || !payload) {
    const error = payload?.error;
    throw new MediaServiceError(error?.code || 'MEDIA_UNAVAILABLE', { resetAt: error?.resetAt, quota: error?.quota });
  }
  return payload;
};

export const inspectYoutube = (url: string) =>
  callMedia<MediaAllowance & { video: YoutubeVideo; credits: number }>({ action: 'inspect', url });

export const getMediaAllowance = () => callMedia<MediaAllowance>({ action: 'allowance' });

/** The length of an audio or video file as the browser reads it, or null when it can't. */
export const readMediaDuration = (file: File): Promise<number | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const finish = (value: number | null) => {
      URL.revokeObjectURL(url);
      element.removeAttribute('src');
      resolve(value);
    };
    element.preload = 'metadata';
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
    element.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 10_000);
    element.src = url;
  });

/** Uploads a file straight to storage (not through our functions, which cap request bodies at 4.5 MB). */
export const uploadMediaFile = async (
  file: File,
  { onProgress, signal }: { onProgress?: (percentage: number) => void; signal?: AbortSignal } = {}
) => {
  const clientId = getClientId();
  try {
    const blob = await upload(`media/${file.name || 'audio'}`, file, {
      access: 'public',
      handleUploadUrl: '/api/media',
      multipart: file.size > 8 * 1024 * 1024,
      contentType: file.type || undefined,
      headers: clientId ? { 'X-Client-Id': clientId } : undefined,
      onUploadProgress: ({ percentage }) => onProgress?.(percentage),
      abortSignal: signal,
    });
    return blob.url;
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : '';
    const code = ['MEDIA_DAILY_LIMIT', 'NOT_ENOUGH_CREDITS', 'MEDIA_UNAVAILABLE'].find((known) => message.includes(known));
    throw new MediaServiceError(code ?? 'UPLOAD_FAILED');
  }
};

export const startYoutube = (url: string) => callMedia<JobResponse>({ action: 'start', url });

export const startUpload = (blobUrl: string, durationSec: number | null, name: string) =>
  callMedia<JobResponse>({ action: 'start', blobUrl, durationSec, name });

/** Asks for a job's progress every few seconds until its transcript is ready. */
export const waitForTranscript = async (
  job: JobResponse,
  { onStage, signal }: { onStage?: (stage: MediaStage) => void; signal?: AbortSignal } = {}
): Promise<MediaTranscript> => {
  const startedAt = Date.now();
  let current = job;
  for (;;) {
    if (current.stage === 'done' && current.result) return current.result;
    if (current.stage === 'failed') throw new MediaServiceError(current.error?.code || 'TRANSCRIPTION_FAILED');
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) throw new MediaServiceError('TRANSCRIPTION_FAILED');
    onStage?.(current.stage);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, POLL_INTERVAL_MS);
      signal?.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    });
    // One request at a time: the server runs each paid step once, but there's no need to ask twice.
    current = { ...current, ...(await callMedia<JobResponse>({ action: 'status', jobId: job.jobId }, signal)) };
  }
};
