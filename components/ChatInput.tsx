import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, AudioLines, Clapperboard, Paperclip, Square, X } from 'lucide-react';

import { Attachment, MediaKind, MediaTranscript } from '../types';
import { AttachmentError, MAX_IMAGE_FILE_MB, MAX_PDF_FILE_MB, prepareAttachment } from '../services/attachments';
import { ChatQuota, formatResetTime } from '../services/chatService';
import {
  MAX_MEDIA_FILE_MB,
  MediaServiceError,
  findYoutubeLink,
  getMediaAllowance,
  inspectYoutube,
  mediaCreditCost,
  readMediaDuration,
  startUpload,
  startYoutube,
  uploadMediaFile,
  parseYoutubeId,
  waitForTranscript,
  type MediaAllowance,
  type MediaStage,
} from '../services/media';
import { formatClock, formatNumber, localizeDigits } from '../services/format';
import type { DialogOptions } from '../hooks/useAppDialog';
import { useI18n } from '../i18n/context';
import type { Language } from '../i18n/languages';
import type { Messages } from '../i18n/messages/ar';

interface ChatInputProps {
  onSend: (text: string, attachment?: Attachment) => void;
  onStop: () => void;
  canStop: boolean;
  isLoading: boolean;
  isDisabled?: boolean;
  input: string;
  setInput: (text: string) => void;
  quota: ChatQuota | null;
  /** Called with the credits left after audio/video was charged. */
  onQuota?: (quota: ChatQuota) => void;
  showDialog?: (options: DialogOptions) => Promise<boolean | string | null>;
}

type MediaStatus = 'checking' | 'uploading' | 'preparing' | 'transcribing';

/** Audio/video being looked up, uploaded or transcribed; it becomes the attachment once its text is ready. */
interface PendingMedia {
  kind: MediaKind;
  title: string;
  thumbnailUrl?: string;
  durationSec: number | null;
  status: MediaStatus;
  progress?: number;
  startedAt: number;
}

const MIN_TEXTAREA_HEIGHT = 44;
const MAX_TEXTAREA_HEIGHT = 160;
// Only mention the daily limit once it is close, so it never feels like a paywall.
const QUOTA_HINT_THRESHOLD = 10;
const MB = 1024 * 1024;
// Give the user a moment to finish pasting or typing before a link is looked up.
const LINK_LOOKUP_DELAY_MS = 600;
const MEDIA_EXTENSIONS = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|weba|mp4|m4v|mov|mkv|3gp|amr)$/i;

const describeAttachmentError = (error: AttachmentError, t: Messages, format: (value: number) => string) => {
  switch (error.reason) {
    case 'pdfTooLarge':
      return t.attachments.pdfTooLarge(format(MAX_PDF_FILE_MB));
    case 'imageTooLarge':
      return t.attachments.imageTooLarge(format(MAX_IMAGE_FILE_MB));
    default:
      return t.attachments[error.reason];
  }
};

const describeMediaError = (error: unknown, t: Messages, language: Language) => {
  const code = error instanceof MediaServiceError ? error.code : '';
  const resetAt = error instanceof MediaServiceError ? (error.details.resetAt ?? error.details.quota?.resetAt) : undefined;
  const time = resetAt ? formatResetTime(resetAt, language) : formatResetTime(nextUtcMidnight(), language);
  switch (code) {
    case 'MEDIA_DAILY_LIMIT':
      return t.media.errors.dailyLimit(time);
    case 'NOT_ENOUGH_CREDITS':
      return t.media.errors.credits(time);
    case 'MEDIA_SITE_LIMIT':
      return t.media.errors.siteLimit;
    case 'MEDIA_TOO_LONG':
      return t.media.errors.tooLong;
    case 'YOUTUBE_UNAVAILABLE':
      return t.media.errors.youtube;
    case 'MEDIA_UNAVAILABLE':
      return t.media.errors.unavailable;
    case 'UPLOAD_FAILED':
      return t.media.errors.upload;
    case 'RATE_LIMITED':
      return t.errors.burst;
    case 'NETWORK_ERROR':
      return t.errors.offline;
    default:
      return t.media.errors.failed;
  }
};

const nextUtcMidnight = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
};

const isMediaFile = (file: File) =>
  file.type.startsWith('audio/') || file.type.startsWith('video/') || MEDIA_EXTENSIONS.test(file.name);

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  canStop,
  isLoading,
  isDisabled = false,
  input,
  setInput,
  quota,
  onQuota,
  showDialog,
}) => {
  const { t, language } = useI18n();
  const format = (value: number) => formatNumber(value, language);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachment, setAttachment] = useState<Attachment | undefined>(undefined);
  const [isProcessingAttachment, setIsProcessingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  // The question to send as soon as the transcript is ready; null when nothing is waiting.
  const [queuedText, setQueuedText] = useState<string | null>(null);
  // The same, for the async code that finishes a transcript after renders it can't see.
  const queuedTextRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mediaAbortRef = useRef<AbortController | null>(null);
  // Videos already offered in this session, so the same link is never offered twice.
  const offeredVideosRef = useRef(new Set<string>());
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const isQuotaExhausted = quota?.remaining === 0;
  const isQueued = queuedText !== null;
  const isInputLocked = isLoading || isDisabled || isProcessingAttachment || isQuotaExhausted || isQueued;
  const canSend = (input.trim().length > 0 || Boolean(attachment) || Boolean(pendingMedia)) && !isInputLocked;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT),
      MAX_TEXTAREA_HEIGHT
    );
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  // Ticks the elapsed time shown while audio/video is being processed.
  useEffect(() => {
    if (!pendingMedia || pendingMedia.status === 'checking') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pendingMedia]);

  useEffect(() => () => mediaAbortRef.current?.abort(), []);

  const queue = (text: string | null) => {
    queuedTextRef.current = text;
    setQueuedText(text);
  };

  const clearMedia = () => {
    mediaAbortRef.current?.abort();
    mediaAbortRef.current = null;
    setPendingMedia(null);
    queue(null);
  };

  const updateMediaStatus = (status: MediaStatus, extra: Partial<PendingMedia> = {}) =>
    setPendingMedia((current) => (current ? { ...current, status, ...extra } : current));

  const failMedia = (error: unknown) => {
    if (isAbort(error)) return;
    console.error('Audio/video failed:', error);
    if (error instanceof MediaServiceError && error.details.quota) onQuota?.(error.details.quota);
    setAttachmentError(describeMediaError(error, t, language));
    setPendingMedia(null);
    queue(null);
  };

  /** Checks what a clip would cost and asks before charging; false when it can't or shouldn't go ahead. */
  const confirmMedia = async (
    kind: MediaKind,
    allowance: MediaAllowance,
    durationSec: number | null,
    credits: number,
    preview: { title: string; detail?: string; imageUrl?: string }
  ) => {
    onQuota?.(allowance.quota);
    if (allowance.mediaRemainingSeconds <= 0) {
      throw new MediaServiceError('MEDIA_DAILY_LIMIT', { resetAt: allowance.quota.resetAt });
    }
    if (durationSec && durationSec > allowance.maxSeconds) throw new MediaServiceError('MEDIA_TOO_LONG');
    if (allowance.quota.remaining < credits + 1) {
      throw new MediaServiceError('NOT_ENOUGH_CREDITS', { resetAt: allowance.quota.resetAt });
    }
    if (!showDialog) return true;

    const { quota } = allowance;
    const creditsAfter = Math.max(0, quota.remaining - credits);
    const totalMinutes = Math.round(allowance.mediaLimitSeconds / 60);
    const minutesLeft = Math.floor(allowance.mediaRemainingSeconds / 60);
    const minutes = durationSec ? Math.max(1, Math.ceil(durationSec / 60)) : null;
    const minutesAfter = minutes === null ? minutesLeft : Math.max(0, minutesLeft - minutes);
    const notes = [
      t.media.rule,
      minutes === null && t.media.unknownLength,
      durationSec && durationSec > allowance.mediaRemainingSeconds && t.media.overAllowance,
    ].filter(Boolean);

    const confirmed = await showDialog({
      type: 'proceed',
      title: kind === 'youtube' ? t.media.titleYoutube : t.media.titleFile,
      preview,
      warning: t.media.warning,
      meters: [
        {
          label: t.media.creditsMeter,
          uses: t.media.usesCredits(credits, format(credits)),
          detail: t.media.creditsLeft(format(creditsAfter), format(quota.limit)),
          total: quota.limit,
          before: quota.remaining,
          after: creditsAfter,
        },
        {
          label: t.media.minutesMeter,
          uses: minutes === null ? t.media.unknown : t.media.usesMinutes(minutes, format(minutes)),
          detail: t.media.minutesLeft(format(minutesAfter), format(totalMinutes)),
          total: totalMinutes,
          before: minutesLeft,
          after: minutesAfter,
        },
      ],
      footnote: notes.join('\n'),
      confirmText: t.media.continue,
      cancelText: t.dialogs.cancel,
    });
    return confirmed === true;
  };

  const finishMedia = (media: MediaTranscript, mimeType: string, thumbnailUrl?: string) => {
    const ready: Attachment = { name: media.title, mimeType, data: '', media, ...(thumbnailUrl && { thumbnailUrl }) };
    setPendingMedia(null);
    mediaAbortRef.current = null;
    // A question sent while the transcript was being made goes out now.
    const queued = queuedTextRef.current;
    if (queued === null) {
      setAttachment(ready);
      return;
    }
    queue(null);
    onSend(queued, ready);
  };

  const onStage = (stage: MediaStage) => updateMediaStatus(stage === 'audio' ? 'preparing' : 'transcribing');

  const offerYoutube = async (link: string) => {
    setAttachmentError(null);
    setPendingMedia({ kind: 'youtube', title: link, durationSec: null, status: 'checking', startedAt: Date.now() });
    try {
      const { video, credits, ...allowance } = await inspectYoutube(link);
      setPendingMedia((current) => current && { ...current, title: video.title, thumbnailUrl: video.thumbnailUrl, durationSec: video.durationSec });
      const detail = [video.channel, video.durationSec ? localizeDigits(formatClock(video.durationSec), language) : '']
        .filter(Boolean)
        .join(' · ');
      // The server's price, which also covers videos whose length it couldn't read.
      const confirmed = await confirmMedia('youtube', allowance, video.durationSec, credits, {
        title: video.title,
        detail,
        imageUrl: video.thumbnailUrl,
      });
      if (!confirmed) {
        setPendingMedia(null);
        return;
      }

      // The card stands for the link from here on, so it leaves the question.
      setInput(inputRef.current.replace(link, '').replace(/\s{2,}/g, ' ').trim());
      const controller = new AbortController();
      mediaAbortRef.current = controller;
      updateMediaStatus('preparing', { startedAt: Date.now() });
      setNow(Date.now());
      const job = await startYoutube(link);
      if (job.quota) onQuota?.(job.quota);
      const media = await waitForTranscript(job, { onStage, signal: controller.signal });
      finishMedia(media, 'video/youtube', video.thumbnailUrl);
    } catch (error) {
      // A site without audio/video configured just treats the link as text.
      if (error instanceof MediaServiceError && (error.code === 'MEDIA_UNAVAILABLE' || error.code === 'VALIDATION_ERROR')) {
        setPendingMedia(null);
        return;
      }
      failMedia(error);
    }
  };

  const offerFile = async (file: File) => {
    setAttachmentError(null);
    if (file.size > MAX_MEDIA_FILE_MB * MB) {
      setAttachmentError(t.media.errors.fileTooLarge(format(MAX_MEDIA_FILE_MB)));
      return;
    }
    const kind: MediaKind = file.type.startsWith('video/') ? 'video' : 'audio';
    setAttachment(undefined);
    setPendingMedia({ kind, title: file.name, durationSec: null, status: 'checking', startedAt: Date.now() });
    try {
      const [durationSec, allowance] = await Promise.all([readMediaDuration(file), getMediaAllowance()]);
      const seconds = durationSec ? Math.ceil(durationSec) : null;
      setPendingMedia((current) => current && { ...current, durationSec: seconds });
      const detail = [t.media.kinds[kind], seconds ? localizeDigits(formatClock(seconds), language) : '']
        .filter(Boolean)
        .join(' · ');
      // Same estimate as the server when the browser can't read the length: 128 kbit/s audio.
      const credits = mediaCreditCost(seconds ?? Math.ceil(file.size / 16_000));
      const confirmed = await confirmMedia(kind, allowance, seconds, credits, { title: file.name, detail });
      if (!confirmed) {
        setPendingMedia(null);
        return;
      }

      const controller = new AbortController();
      mediaAbortRef.current = controller;
      updateMediaStatus('uploading', { progress: 0, startedAt: Date.now() });
      setNow(Date.now());
      const blobUrl = await uploadMediaFile(file, {
        signal: controller.signal,
        onProgress: (progress) => updateMediaStatus('uploading', { progress }),
      });
      updateMediaStatus('transcribing');
      const job = await startUpload(blobUrl, seconds, file.name);
      if (job.quota) onQuota?.(job.quota);
      const media = await waitForTranscript(job, { onStage, signal: controller.signal });
      finishMedia(media, file.type || 'audio/mpeg');
    } catch (error) {
      failMedia(error);
    }
  };

  // Offers a YouTube link typed or pasted into the question, once per video.
  useEffect(() => {
    if (!showDialog || pendingMedia || attachment || isLoading || isDisabled) return;
    const link = findYoutubeLink(input);
    const videoId = link ? parseYoutubeId(link) : null;
    if (!link || !videoId || offeredVideosRef.current.has(videoId)) return;
    const timer = window.setTimeout(() => {
      offeredVideosRef.current.add(videoId);
      void offerYoutube(link);
    }, LINK_LOOKUP_DELAY_MS);
    return () => window.clearTimeout(timer);
    // offerYoutube only reads refs and setters; re-running it on every render would offer the link again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pendingMedia, attachment, isLoading, isDisabled, showDialog]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSend) return;

    if (pendingMedia) {
      // Waits for the transcript; finishMedia sends it.
      queue(input);
      return;
    }

    onSend(input, attachment);
    setAttachment(undefined);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (!isMobile && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const processFile = async (file: File) => {
    setAttachmentError(null);
    if (isMediaFile(file)) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!pendingMedia) void offerFile(file);
      return;
    }
    setIsProcessingAttachment(true);

    try {
      setAttachment(await prepareAttachment(file));
    } catch (error) {
      console.error('Failed to read attachment:', error);
      setAttachmentError(
        error instanceof AttachmentError ? describeAttachmentError(error, t, format) : t.input.readFailed
      );
    } finally {
      setIsProcessingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void processFile(file);
        return;
      }
    }
  };

  const removeAttachment = () => {
    setAttachment(undefined);
    setAttachmentError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const mediaStatusText = (media: PendingMedia) => {
    switch (media.status) {
      case 'checking':
        return t.media.checking;
      case 'uploading':
        return t.media.uploading(format(Math.round(media.progress ?? 0)));
      case 'preparing':
        return t.media.preparing;
      default:
        return t.media.transcribing;
    }
  };

  const mediaIcon = (kind: MediaKind) =>
    kind === 'audio' ? (
      <AudioLines size={20} strokeWidth={1.9} aria-hidden="true" />
    ) : (
      <Clapperboard size={20} strokeWidth={1.9} aria-hidden="true" />
    );

  const attachmentMedia = attachment?.media;

  return (
    <div
      className="w-full"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`composer rounded-[1.75rem] p-2 ${isDragging ? 'ring-4 ring-gold/25' : ''}`}>
        {pendingMedia && (
          <div
            data-testid="media-pending"
            aria-live="polite"
            className="mx-1 mt-1 mb-2 flex w-fit max-w-full items-center gap-3 rounded-2xl bg-surface-2 py-2 ps-2 pe-3 fade-up"
          >
            <div className="relative flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3 text-gold-text">
              {pendingMedia.thumbnailUrl ? (
                <img src={pendingMedia.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-70" referrerPolicy="no-referrer" />
              ) : (
                mediaIcon(pendingMedia.kind)
              )}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              </span>
            </div>
            <div className="flex min-w-0 max-w-[260px] flex-col">
              <span className="truncate text-[0.9rem] font-medium" dir="auto">{pendingMedia.title}</span>
              <span className="text-[0.8rem] text-faint">
                {mediaStatusText(pendingMedia)}
                {pendingMedia.status !== 'checking' && (
                  <span className="ms-1.5 tabular-nums">{localizeDigits(formatClock((now - pendingMedia.startedAt) / 1000), language)}</span>
                )}
              </span>
              {isQueued && <span className="text-[0.8rem] leading-snug text-gold-text">{t.media.queued}</span>}
            </div>
            {pendingMedia.status !== 'checking' && (
              <button
                type="button"
                onClick={clearMedia}
                className="flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-text"
                aria-label={t.media.remove}
              >
                <X size={14} strokeWidth={2.4} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {attachment && (
          <div className="mx-1 mt-1 mb-2 flex w-fit max-w-full items-center gap-3 rounded-2xl bg-surface-2 py-2 ps-2 pe-3 fade-up">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3 text-gold-text">
              {attachment.thumbnailUrl ? (
                <img src={attachment.thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : attachmentMedia ? (
                mediaIcon(attachmentMedia.kind)
              ) : attachment.mimeType.startsWith('image/') ? (
                <img src={attachment.data} alt={t.input.attachmentPreview} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[0.7rem] font-bold text-danger">PDF</span>
              )}
            </div>
            <div className="flex min-w-0 max-w-[260px] flex-col">
              <span className="truncate text-[0.9rem] font-medium" dir="auto">{attachment.name}</span>
              <span className="text-[0.8rem] text-faint">
                {attachmentMedia
                  ? `${t.media.kinds[attachmentMedia.kind]} · ${localizeDigits(formatClock(attachmentMedia.durationSec), language)} · ${t.media.ready}`
                  : attachment.mimeType === 'application/pdf'
                    ? attachment.pageCount
                      ? t.input.pages(format(attachment.pageCount))
                      : t.input.pdf
                    : t.input.image}
              </span>
              {attachment.mimeType === 'application/pdf' && attachment.extractionError && (
                <span className="text-[0.8rem] leading-snug text-danger">{t.attachments[attachment.extractionError]}</span>
              )}
              {attachment.mimeType === 'application/pdf' && attachment.textTruncated && (
                <span className="text-[0.8rem] leading-snug text-faint">{t.input.truncated}</span>
              )}
            </div>
            <button
              type="button"
              onClick={removeAttachment}
              className="flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-text"
              aria-label={t.input.removeAttachment}
            >
              <X size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          data-testid="chat-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isDisabled
              ? t.input.placeholderOffline
              : isQuotaExhausted && quota
                ? t.input.placeholderLimit(formatResetTime(quota.resetAt, language))
                : attachment || pendingMedia
                  ? t.input.placeholderAttachment
                  : t.input.placeholder
          }
          className="block w-full resize-none overflow-y-auto bg-transparent px-3 pt-2.5 pb-1 text-[1.05rem] leading-7 placeholder:text-faint focus:outline-none disabled:cursor-not-allowed [&::-webkit-scrollbar]:hidden"
          style={{ minHeight: `${MIN_TEXTAREA_HEIGHT}px`, maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
          rows={1}
          aria-label={t.input.label}
          disabled={isInputLocked}
        />

        <div className="flex items-center justify-between px-1 pt-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            data-testid="attach-file"
            disabled={isInputLocked || Boolean(pendingMedia)}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[0.9rem] text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            title={t.input.attachTitle}
            aria-label={t.input.attachLabel}
          >
            <Paperclip size={17} strokeWidth={1.9} aria-hidden="true" />
            <span className="hidden sm:inline">{t.input.attach}</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*,application/pdf,audio/*,video/*"
          />

          {canStop ? (
            <button
              type="button"
              onClick={onStop}
              data-testid="stop-generation"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-text text-bg transition-transform hover:scale-105 active:scale-95"
              title={t.input.stop}
              aria-label={t.input.stopLabel}
            >
              <Square size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit()}
              data-testid="send-message"
              disabled={!canSend}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-[#17160f] shadow-[0_6px_20px_-6px_rgba(212,175,55,0.7)] transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:bg-surface-3 disabled:text-faint disabled:shadow-none"
              title={t.input.send}
              aria-label={t.input.send}
            >
              {isProcessingAttachment || isQueued ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>

      {attachmentError && (
        <p role="alert" className="mt-2 px-3 text-[0.9rem] text-danger">
          {attachmentError}
        </p>
      )}
      {quota && quota.remaining <= QUOTA_HINT_THRESHOLD && (
        <p data-testid="quota-hint" className="mt-2 text-center text-[0.85rem] text-faint">
          {isQuotaExhausted
            ? t.input.limitReached(formatResetTime(quota.resetAt, language))
            : t.input.remaining(quota.remaining, format(quota.remaining))}
        </p>
      )}
    </div>
  );
};
