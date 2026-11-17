import React, { useEffect, useMemo, useState } from 'react';
import { trackBlog } from '../services/blogService';
import { MessageSquarePlus, Paperclip, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { LanguageMenu } from './LanguageMenu';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../types';
import { fetchShare, sharedToMessages, type SharedConversation } from '../services/shareService';
import { createClientUuid as generateId } from '../services/ids';

interface ShareViewProps {
  shareId: string;
  onAskOwn: () => void;
  onContinue: (title: string, messages: Message[]) => void;
}

type Status = 'loading' | 'ready' | 'missing' | 'error';

/** A conversation someone shared: read-only, with ways to continue it or ask something new. */
export const ShareView: React.FC<ShareViewProps> = ({ shareId, onAskOwn, onContinue }) => {
  const { t, language } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [share, setShare] = useState<SharedConversation | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchShare(shareId)
      .then((result) => {
        if (cancelled) return;
        setShare(result);
        setStatus(result ? 'ready' : 'missing');
        if (result) trackBlog('shareOpen');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  useEffect(() => {
    const question = share?.turns[0]?.q;
    if (question) document.title = `${question.slice(0, 80)} | ${t.appName}`;
  }, [share, t.appName]);

  // Ids are only for rendering here; continuing makes fresh ones.
  const messages = useMemo(() => (share ? sharedToMessages(share, generateId) : []), [share]);
  const sharedOn = share
    ? new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(new Date(share.createdAt))
    : '';

  const continueConversation = () => {
    if (!share) return;
    onContinue(share.turns[0].q.slice(0, 60) || t.chats.newChat, sharedToMessages(share, generateId));
  };

  return (
    <div className="page-glow min-h-dvh bg-bg text-text">
      <nav className="frosted sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
          <button type="button" onClick={onAskOwn} className="flex items-center gap-2">
            <img src="/logo.png" alt="" width="28" height="28" className="h-7 w-7" />
            <span className="text-[1.05rem] font-bold">{t.appName}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <LanguageMenu />
            <button
              type="button"
              onClick={onAskOwn}
              className="h-9 rounded-full bg-text px-4 text-[0.9rem] font-semibold text-bg transition-transform hover:scale-[1.03] active:scale-95"
            >
              {t.share.askOwn}
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6" data-testid="share-view">
        {status === 'loading' && <p className="py-20 text-center text-muted">{t.share.loading}</p>}
        {(status === 'missing' || status === 'error') && (
          <div className="py-20 text-center">
            <p className="mb-6 text-[1.05rem] text-muted">{status === 'missing' ? t.share.notFound : t.errors.unavailable}</p>
            <button
              type="button"
              onClick={onAskOwn}
              className="h-11 rounded-full bg-gold px-6 font-semibold text-[#17160f] transition-opacity hover:opacity-85"
            >
              {t.share.askOwn}
            </button>
          </div>
        )}

        {status === 'ready' && share && (
          <>
            <header className="mb-6">
              <p className="mb-2 text-[0.85rem] font-medium text-faint">
                {t.share.pageLabel} · {t.share.sharedOn(sharedOn)}
              </p>
              <p
                className="flex items-start gap-2 rounded-xl bg-gold-soft px-3 py-2.5 text-[0.88rem] leading-relaxed text-gold-text"
                data-testid="share-verified"
              >
                <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
                {t.share.verified}
              </p>
              {share.partial && (
                <p className="mt-2 text-[0.85rem] text-faint" data-testid="share-partial">
                  {t.share.partial}
                </p>
              )}
            </header>

            <div className="pb-4">
              {messages.map((message, index) => {
                const turn = share.turns[Math.floor(index / 2)];
                const attachmentNote =
                  message.role === 'user' && turn.att
                    ? turn.att.kind === 'images'
                      ? t.share.attachedImages(turn.att.count)
                      : t.share.attachedFile(turn.att.title)
                    : null;
                return (
                  <div key={message.id}>
                    {attachmentNote && (
                      <p className="mb-1 flex items-center justify-end gap-1.5 text-[0.82rem] text-faint">
                        <Paperclip size={13} strokeWidth={2} aria-hidden="true" />
                        {attachmentNote}
                      </p>
                    )}
                    <MessageBubble message={message} />
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-8">
              <button
                type="button"
                onClick={continueConversation}
                data-testid="share-continue"
                className="flex h-11 items-center gap-2 rounded-full bg-gold px-6 font-semibold text-[#17160f] transition-opacity hover:opacity-85"
              >
                <MessageSquarePlus size={18} strokeWidth={2} aria-hidden="true" />
                {t.share.continue}
              </button>
              <button
                type="button"
                onClick={onAskOwn}
                className="h-11 rounded-full border border-line px-6 text-[0.98rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {t.share.askOwn}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
