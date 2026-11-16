import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { head, del, put } from '@vercel/blob';
import { getGeminiConfig } from './gemini.js';
import { chargeMedia, refundMedia, getMediaAllowance, getStore, mediaCreditCost, allowBurst, type MediaCharge } from './limits.js';
import { getSigningSecret, parseYoutubeId } from './media.js';
import { signNativeFile, nativeOwner, isBlobUrl, getNativeBytes, retainNativeBlob, cleanupNativeBlobs,
    NATIVE_INLINE_BYTES, NATIVE_MAX_BYTES, NATIVE_MIME_TYPES, NATIVE_TTL_SECONDS } from './nativeFiles.js';
import { recordMedia } from './stats.js';
import { verifiedMediaSeconds, MediaMetadataError } from './mediaMetadata.js';
import { downloadYoutubeAudio, AudioDownloadError } from './downloadAudio.js';

interface YoutubeMeta { videoId: string; title: string; channel: string; thumbnailUrl: string; durationSec: number | null; live: boolean }
const uploadKey = (path: string) => `salaf:native:upload:${path}`;
export async function handleNativeMedia(req: VercelRequest, res: VercelResponse, getYoutubeMeta: (id: string) => Promise<YoutubeMeta | null>,
    getYoutubeAudio: (id: string, signal?: AbortSignal) => Promise<string>) {
    let pendingCharge: MediaCharge | undefined;
    const controller = new AbortController();
    res.on?.('close', () => { if (!res.writableFinished) controller.abort(); });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]);
    const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => res.status(status).json({ error: { code, message, ...extra } });
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    try {
        if (!getGeminiConfig().apiKey || !getSigningSecret() || (process.env.VERCEL && !getStore().shared)) {
            return error(503, 'MEDIA_UNAVAILABLE', 'Native media requires Gemini credentials, a signing secret, and shared storage in production');
        }
        if (req.body?.type === 'blob.upload-completed') {
            // Blob callbacks are signature-verified by the SDK; owner metadata was written at token generation.
            const result = await handleUpload({ body: req.body as HandleUploadBody, request: req,
                onBeforeGenerateToken: async () => { throw new Error('Invalid callback'); },
                onUploadCompleted: async ({ blob }) => { await retainNativeBlob(blob.url); } });
            return res.status(200).json(result);
        }
        if (!(await allowBurst(req, 'native-media', 20))) return error(429, 'RATE_LIMITED', 'Too many requests');
        const allowance = await getMediaAllowance(req);
        const view = { mode: 'native', quota: allowance.credits, mediaRemainingSeconds: allowance.mediaRemainingSeconds,
            mediaLimitSeconds: allowance.mediaLimitSeconds, maxSeconds: allowance.maxSeconds, maxFileBytes: NATIVE_MAX_BYTES,
            imageRemainingCount: allowance.imageRemainingCount, imageLimitCount: allowance.imageLimitCount };
        if (req.body?.type === 'blob.generate-client-token') {
            if (!process.env.BLOB_READ_WRITE_TOKEN) return error(503, 'MEDIA_UNAVAILABLE', 'Larger file uploads are not configured');
            const result = await handleUpload({ body: req.body as HandleUploadBody, request: req,
                onBeforeGenerateToken: async (pathname) => {
                    if (!/^media\/native\/[0-9a-f-]{36}\/[^/]+$/.test(pathname)) throw new Error('Invalid upload path');
                    if (allowance.credits.remaining < 1) throw new Error('NOT_ENOUGH_CREDITS');
                    await getStore({ strict: !!process.env.VERCEL }).setText(uploadKey(pathname), nativeOwner(req), 3600);
                    return { allowedContentTypes: NATIVE_MIME_TYPES, maximumSizeInBytes: NATIVE_MAX_BYTES,
                        addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60000 };
                } });
            return res.status(200).json(result);
        }
        if (req.body?.action === 'allowance') return res.status(200).json(view);
        if (req.body?.action === 'inspect') {
            const id = typeof req.body.url === 'string' ? parseYoutubeId(req.body.url) : null;
            const video = id ? await getYoutubeMeta(id) : null;
            if (!video || video.live) return error(422, 'YOUTUBE_UNAVAILABLE', 'This video cannot be used');
            return res.status(200).json({ ...view, video, credits: mediaCreditCost(video.durationSec || 600) });
        }
        if (req.body?.action !== 'start') return error(400, 'VALIDATION_ERROR', 'Unknown native media action');
        const body = req.body;
        const owner = nativeOwner(req);
        let data: string | undefined;
        let blobUrl: string | undefined;
        let videoId: string | undefined;
        let title = typeof body.name === 'string' ? body.name.slice(0, 200) : 'Attachment';
        let mimeType: string;
        let byteLength = 0;
        let durationSec = Number(body.durationSec);
        let kind: 'pdf' | 'audio' | 'video' | 'youtube';
        if (typeof body.url === 'string') {
            videoId = parseYoutubeId(body.url) || undefined;
            const video = videoId ? await getYoutubeMeta(videoId) : null;
            if (!video || video.live) return error(422, 'YOUTUBE_UNAVAILABLE', 'This video cannot be used');
            title = video.title;
            if (video.durationSec && video.durationSec > allowance.mediaRemainingSeconds) return error(429, 'MEDIA_DAILY_LIMIT', 'This clip exceeds the remaining daily minutes', { resetAt: allowance.credits.resetAt });
            if (allowance.credits.remaining < mediaCreditCost(video.durationSec || allowance.maxSeconds) + 1) return error(429, 'NOT_ENOUGH_CREDITS', 'Not enough credits', { quota: allowance.credits });
            if (!process.env.PAXSENIX_API_KEY) return error(503, 'YOUTUBE_UNAVAILABLE', 'YouTube audio extraction is not configured');
            if (!(await allowBurst(req, 'youtube-audio', 3))) return error(429, 'RATE_LIMITED', 'Too many YouTube audio requests');
            const audio = await downloadYoutubeAudio(await getYoutubeAudio(videoId!, signal), signal);
            mimeType = audio.mimeType; kind = 'youtube'; byteLength = audio.bytes.length;
            durationSec = await verifiedMediaSeconds(audio.bytes, mimeType, true);
            if (byteLength <= NATIVE_INLINE_BYTES) data = audio.bytes.toString('base64');
            else {
                if (!process.env.BLOB_READ_WRITE_TOKEN) return error(503, 'MEDIA_UNAVAILABLE', 'Larger YouTube audio needs storage');
                const blob = await put(`media/native/${crypto.randomUUID()}/youtube-audio`, audio.bytes, { access: 'public', contentType: mimeType });
                blobUrl = blob.url; await retainNativeBlob(blobUrl);
            }
        } else {
            if (typeof body.dataUrl === 'string') {
                const match = /^data:([^;]+);base64,([A-Za-z0-9+/]+=*)$/.exec(body.dataUrl);
                if (!match || match[2].length > Math.ceil(NATIVE_INLINE_BYTES / 3) * 4) return error(413, 'UPLOAD_REJECTED', 'Use storage upload for larger files');
                mimeType = match[1]; data = match[2]; byteLength = Buffer.from(data, 'base64').length;
            } else if (isBlobUrl(body.blobUrl)) {
                const blob = await head(body.blobUrl);
                if (await getStore().getText(uploadKey(blob.pathname)) !== owner) return error(403, 'UPLOAD_REJECTED', 'Upload does not belong to this client');
                mimeType = blob.contentType; byteLength = blob.size; blobUrl = body.blobUrl;
            } else return error(400, 'VALIDATION_ERROR', 'Missing file');
            if (!NATIVE_MIME_TYPES.includes(mimeType) || !byteLength || byteLength > NATIVE_MAX_BYTES) return error(413, 'UPLOAD_REJECTED', 'Unsupported or oversized file');
            kind = mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('video/') ? 'video' : 'audio';
            if (kind === 'pdf') durationSec = 0;
            else {
                const bytes = data ? Buffer.from(data, 'base64') : Buffer.from(await getNativeBytes({ blobUrl, byteLength }, signal), 'base64');
                durationSec = await verifiedMediaSeconds(bytes, mimeType);
            }
        }
        signal.throwIfAborted();
        if (kind !== 'pdf') {
            const charge = await chargeMedia(req, durationSec);
            if (!charge.allowed) {
                if (blobUrl) await del(blobUrl).catch(() => {});
                return error(charge.reason === 'MEDIA_TOO_LONG' ? 413 : 429, charge.reason, 'Media limit reached', { resetAt: charge.resetAt, quota: charge.quota });
            }
            pendingCharge = charge.charge;
            const result = signNativeFile({ kind, title, mimeType, durationSec, byteLength, data, blobUrl, videoId,
                owner, expiresAt: Date.now() + NATIVE_TTL_SECONDS * 1000 });
            if (blobUrl) await retainNativeBlob(blobUrl);
            await recordMedia(durationSec, 'native');
            pendingCharge = undefined;
            return res.status(200).json({ jobId: crypto.randomUUID(), mode: 'native', stage: 'done', result,
                credits: charge.charge.credits, quota: charge.quota });
        }
        const result = signNativeFile({ kind, title, mimeType, durationSec: 0, byteLength, data, blobUrl,
            owner, expiresAt: Date.now() + NATIVE_TTL_SECONDS * 1000 });
        if (blobUrl) await retainNativeBlob(blobUrl);
        return res.status(200).json({ jobId: crypto.randomUUID(), mode: 'native', stage: 'done', result, credits: 0, quota: allowance.credits });
    } catch (cause) {
        if (pendingCharge) await refundMedia(pendingCharge).catch(() => console.warn('[api/media] native credit refund failed'));
        console.warn('[api/media] native file preparation failed');
        return error(cause instanceof MediaMetadataError ? 422 : 503,
            cause instanceof MediaMetadataError ? 'MEDIA_DURATION_UNKNOWN' : cause instanceof AudioDownloadError || typeof req.body?.url === 'string' ? 'YOUTUBE_UNAVAILABLE' : 'MEDIA_UNAVAILABLE',
            'File preparation failed; try again');
    } finally {
        void cleanupNativeBlobs().catch(() => {});
    }
}
