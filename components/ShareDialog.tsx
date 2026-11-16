import React, { useEffect, useState } from 'react';
import { Check, Copy, Link2, Share2, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/context';
import type { Message } from '../types';
import { createShare, shareUrl, stopSharing, ShareServiceError } from '../services/shareService';

interface ShareDialogProps {
  /** The conversation and the answer being shared. Mounted once per answer (keyed by its id). */
  target: { messages: Message[]; messageId: string };
  onShared: (messageId: string, share: Message['share']) => void;
  onClose: () => void;
}

type Status = 'creating' | 'ready' | 'stopping' | 'stopped' | 'error';

/** Creates (or reuses) the link for an answer, with copy, the system share sheet, and stop sharing. */
export const ShareDialog: React.FC<ShareDialogProps> = ({ target, onShared, onClose }) => {
  const { t } = useI18n();
  const existing = target.messages.find((message) => message.id === target.messageId)?.share;
  const [status, setStatus] = useState<Status>(existing ? 'ready' : 'creating');
  const [share, setShare] = useState<Message['share']>(existing);
  const [errorText, setErrorText] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (existing) return;
    let cancelled = false;
    createShare(target.messages, target.messageId)
      .then((created) => {
        if (cancelled) return;
        setShare(created);
        setStatus('ready');
        onShared(target.messageId, created);
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorText(error instanceof ShareServiceError && error.code === 'ANSWER_NOT_FOUND' ? t.share.errorExpired : t.share.errorGeneric);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // Runs once per mounted dialog; onShared is a fresh closure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [target, onClose]);

  const url = share ? shareUrl(share.id) : '';

  const copy = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const openShareSheet = () => {
    void navigator.share?.({ url }).catch(() => undefined);
  };

  const stop = () => {
    if (!share) return;
    setStatus('stopping');
    stopSharing(share.id, share.deleteToken)
      .then(() => {
        setStatus('stopped');
        onShared(target.messageId, undefined);
      })
      .catch(() => {
        setErrorText(t.share.errorGeneric);
        setStatus('error');
      });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        data-testid="share-dialog"
        className="relative w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-float)] md:p-7 fade-up"
      >
        <h3 id="share-dialog-title" className="mb-2 flex items-center gap-2 text-[1.25rem] font-bold">
          <Link2 size={20} strokeWidth={2} aria-hidden="true" className="text-gold-text" />
          {t.share.title}
        </h3>

        {status === 'error' || status === 'stopped' ? (
          <p className="mb-6 text-[0.98rem] leading-relaxed text-muted" role="status">
            {status === 'stopped' ? t.share.stopped : errorText}
          </p>
        ) : (
          <>
            <p className="mb-4 flex items-start gap-2 rounded-xl bg-gold-soft px-3 py-2.5 text-[0.88rem] leading-relaxed text-gold-text">
              <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
              {t.share.explain}
            </p>
            <div className="mb-4 flex items-center gap-2 rounded-2xl bg-surface-2 p-1.5 ps-3">
              <span dir="ltr" className="min-w-0 flex-1 truncate text-[0.92rem] text-muted" data-testid="share-url">
                {status === 'creating' ? t.share.creating : url}
              </span>
              <button
                type="button"
                onClick={copy}
                disabled={status !== 'ready'}
                data-testid="share-copy"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 text-[0.9rem] font-semibold text-[#17160f] transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                {isCopied ? <Check size={15} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={15} strokeWidth={2} aria-hidden="true" />}
                {isCopied ? t.share.copied : t.share.copy}
              </button>
            </div>
          </>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {status === 'ready' && (
            <button
              type="button"
              onClick={stop}
              data-testid="share-stop"
              className="me-auto h-10 rounded-full px-4 text-[0.9rem] text-danger transition-colors hover:bg-danger-soft"
            >
              {t.share.stop}
            </button>
          )}
          {status === 'ready' && typeof navigator.share === 'function' && (
            <button
              type="button"
              onClick={openShareSheet}
              className="flex h-10 items-center gap-1.5 rounded-full px-4 text-[0.95rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Share2 size={16} strokeWidth={1.9} aria-hidden="true" />
              {t.share.shareVia}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full px-5 text-[0.95rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            {t.share.close}
          </button>
        </div>
      </div>
    </div>
  );
};
