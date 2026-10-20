import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';

import { Attachment } from '../types';
import { AttachmentError, MAX_IMAGE_FILE_MB, MAX_PDF_FILE_MB, prepareAttachment } from '../services/attachments';
import { ChatQuota, formatResetTime } from '../services/chatService';
import { formatNumber } from '../services/format';
import { useI18n } from '../i18n/context';
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
}

const MIN_TEXTAREA_HEIGHT = 44;
const MAX_TEXTAREA_HEIGHT = 160;
// Only mention the daily limit once it is close, so it never feels like a paywall.
const QUOTA_HINT_THRESHOLD = 10;

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

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  canStop,
  isLoading,
  isDisabled = false,
  input,
  setInput,
  quota,
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

  const isQuotaExhausted = quota?.remaining === 0;
  const isInputLocked = isLoading || isDisabled || isProcessingAttachment || isQuotaExhausted;
  const canSend = (input.trim().length > 0 || Boolean(attachment)) && !isInputLocked;

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

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSend) return;

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

  return (
    <div
      className="w-full"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`composer rounded-[1.75rem] p-2 ${isDragging ? 'ring-4 ring-gold/25' : ''}`}>
        {attachment && (
          <div className="mx-1 mt-1 mb-2 flex w-fit max-w-full items-center gap-3 rounded-2xl bg-surface-2 py-2 ps-2 pe-3 fade-up">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3">
              {attachment.mimeType.startsWith('image/') ? (
                <img src={attachment.data} alt={t.input.attachmentPreview} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[0.7rem] font-bold text-danger">PDF</span>
              )}
            </div>
            <div className="flex min-w-0 max-w-[260px] flex-col">
              <span className="truncate text-[0.9rem] font-medium">{attachment.name}</span>
              <span className="text-[0.8rem] text-faint">
                {attachment.mimeType === 'application/pdf'
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
                : attachment
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
            disabled={isInputLocked}
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
            accept="image/*,application/pdf"
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
              {isProcessingAttachment ? (
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
