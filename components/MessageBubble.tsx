import React, { useMemo, useState } from 'react';
import { AudioLines, BookOpen, Check, ChevronDown, Clapperboard, Copy, RotateCw, ThumbsDown, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Attachment, Message } from '../types';
import { hasFeedbackForMessage } from '../services/feedbackStorage';
import { linkTimestamps, parseMessageSources } from '../services/messageParsing';
import { formatClock, formatTime, localizeDigits } from '../services/format';
import { useI18n } from '../i18n/context';
import type { Language } from '../i18n/languages';

interface MessageBubbleProps {
  message: Message;
  canRetry?: boolean;
  /** Plays the arrival animation; set for the answer that just arrived. */
  isNew?: boolean;
  onRetry?: (messageId: string) => void;
  onFeedback?: (messageId: string) => Promise<boolean>;
  /** The YouTube video this answer is about; its "[12:34]" times become links to that moment. */
  videoId?: string;
}

interface MarkdownProps {
  children?: React.ReactNode;
  className?: string;
  href?: string;
}

const URL_PATTERN = /(https?:\/\/[^\s)،]+)/g;
// A verdict ends its phrase, which keeps book titles such as «صحيح البخاري» from being read as one.
const VERDICT_PATTERN =
  /(باطل لا أصل له|لا يصح|لا أصل له|موضوع|باطل|منكر|ضعيف جدًا|ضعيف جدا|ضعيف|حسن صحيح|صحيح لغيره|حسن لغيره|صحيح|حسن)(?=\s*(?:$|[).،,:؛۔\]\-–]))/;
const UNSOUND_VERDICT = /لا يصح|لا أصل|موضوع|باطل|منكر|ضعيف/;
// Urdu and Persian answers spell the same grades with their own yeh and kaf (صحیح, منکر).
const toArabicLetters = (text: string) => text.replace(/ی/g, 'ي').replace(/ک/g, 'ك');

/** The grade at the end of a hadith's source line, as written there. */
const findVerdict = (sourceText: string) => {
  const match = VERDICT_PATTERN.exec(toArabicLetters(sourceText));
  return match ? sourceText.slice(match.index, match.index + match[1].length) : undefined;
};

const LIST_NUMBERING: Record<Language, string> = { ar: 'arabic-indic', ur: 'urdu', fa: 'persian' };

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const VerdictPill: React.FC<{ verdict: string }> = ({ verdict }) => {
  const unsound = UNSOUND_VERDICT.test(toArabicLetters(verdict));
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold ${
        unsound ? 'bg-danger-soft text-danger' : 'bg-gold-soft text-gold-text'
      }`}
    >
      {unsound ? (
        <X size={12} strokeWidth={2.6} aria-hidden="true" />
      ) : (
        <Check size={12} strokeWidth={2.8} aria-hidden="true" />
      )}
      {verdict}
    </span>
  );
};

const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: React.ReactNode }
> = ({ label, children, ...props }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className="flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-all hover:bg-surface-2 hover:text-text active:scale-90"
    {...props}
  >
    {children}
  </button>
);

/** A shared YouTube video or audio/video file, with the transcript the assistant read. */
const MediaCard: React.FC<{ attachment: Attachment }> = ({ attachment }) => {
  const { t, language } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const media = attachment.media;
  if (!media) return null;

  const detail = [t.media.kinds[media.kind], localizeDigits(formatClock(media.durationSec), language), media.channel]
    .filter(Boolean)
    .join(' · ');
  const title = <span className="line-clamp-2 text-[0.95rem] font-medium leading-snug" dir="auto">{media.title}</span>;

  return (
    <div data-testid="media-card" className="mb-2 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 p-2.5">
        {attachment.thumbnailUrl ? (
          <img src={attachment.thumbnailUrl} alt="" className="h-14 w-24 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-gold-text">
            {media.kind === 'audio' ? (
              <AudioLines size={20} strokeWidth={1.9} aria-hidden="true" />
            ) : (
              <Clapperboard size={20} strokeWidth={1.9} aria-hidden="true" />
            )}
          </span>
        )}
        <span className="min-w-0">
          {media.videoId ? (
            <a
              href={`https://www.youtube.com/watch?v=${media.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {title}
            </a>
          ) : (
            title
          )}
          <span className="mt-0.5 block truncate text-[0.8rem] text-faint">{detail}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-[0.85rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        {isOpen ? t.media.hideTranscript : t.media.showTranscript}
        <ChevronDown size={15} strokeWidth={2} aria-hidden="true" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="max-h-72 overflow-y-auto border-t border-line px-3.5 py-3">
          {media.approximateTimes && <p className="mb-2 text-[0.8rem] text-faint">{t.media.approximateTimes}</p>}
          <p dir="auto" className="whitespace-pre-wrap text-[0.88rem] leading-relaxed text-muted">
            {localizeDigits(media.transcript, language)}
          </p>
        </div>
      )}
    </div>
  );
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  canRetry = false,
  isNew = false,
  onRetry,
  onFeedback,
  videoId,
}) => {
  const { t, language } = useI18n();
  const localDigits = (text: string) => localizeDigits(text, language);
  const isUser = message.role === 'user';
  const [isCopied, setIsCopied] = useState(false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(() =>
    hasFeedbackForMessage(message.id)
  );

  const { displayContent, sourcesList } = useMemo(
    () => parseMessageSources(message.text || ''),
    [message.text]
  );

  const handleCopy = () => {
    // Strip the custom tags injected by the prompt and leave out the hidden sources block.
    const cleanText = displayContent
      .replace(/<p class="(quran|hadith)">/g, '')
      .replace(/<span class="source">/g, '')
      .replace(/<\/p>/g, '')
      .replace(/<\/span>/g, '')
      .replace(/<br\s*\/?>/gi, '\n');

    void navigator.clipboard.writeText(cleanText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const handleFeedbackClick = () => {
    if (!onFeedback) return;
    void onFeedback(message.id).then((wasSubmitted) => {
      if (wasSubmitted) setHasSubmittedFeedback(true);
    });
  };

  // Recursively write digits in rendered text nodes in the interface language's numerals.
  const processContent = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') return localDigits(node);
    if (Array.isArray(node)) {
      return node.map((n, i) => <React.Fragment key={i}>{processContent(n)}</React.Fragment>);
    }
    if (React.isValidElement(node)) {
      const props = node.props as { children?: React.ReactNode };
      if (props.children) {
        return React.cloneElement(node as React.ReactElement<{ children?: React.ReactNode }>, {
          children: processContent(props.children),
        });
      }
    }
    return node;
  };

  // Turn the prompt's HTML tags into fenced blocks the `pre` renderer below can style.
  const processedText = useMemo(
    () =>
      (videoId ? linkTimestamps(displayContent, videoId) : displayContent)
        .replace(/<p class="quran">([\s\S]*?)<\/p>/g, '\n```quran\n$1\n```\n')
        .replace(/<p class="hadith">([\s\S]*?)<\/p>/g, (_, content) => `\n\`\`\`hadith\n${content}\n\`\`\`\n`)
        // A tag left open (an interrupted answer) styles the rest as that block instead of raw HTML.
        .replace(/<p class="(quran|hadith)">([\s\S]*)$/, '\n```$1\n$2\n```\n'),
    [displayContent, videoId]
  );

  const components = {
    p: ({ children }: MarkdownProps) => (
      <p className="mb-4 last:mb-0 whitespace-pre-wrap break-words">{processContent(children)}</p>
    ),
    h1: ({ children }: MarkdownProps) => (
      <h3 className="mt-7 mb-3 text-[1.25rem] font-bold first:mt-0">{processContent(children)}</h3>
    ),
    h2: ({ children }: MarkdownProps) => (
      <h3 className="mt-7 mb-3 text-[1.2rem] font-bold first:mt-0">{processContent(children)}</h3>
    ),
    h3: ({ children }: MarkdownProps) => (
      <h4 className="mt-6 mb-2 text-[1.08rem] font-bold first:mt-0">{processContent(children)}</h4>
    ),
    strong: ({ children }: MarkdownProps) => <strong className="font-semibold">{processContent(children)}</strong>,
    em: ({ children }: MarkdownProps) => <em className="not-italic font-medium">{processContent(children)}</em>,
    ul: ({ children }: MarkdownProps) => (
      <ul className="mb-4 list-disc space-y-1.5 ps-6 marker:text-faint">{children}</ul>
    ),
    ol: ({ children }: MarkdownProps) => (
      <ol className="mb-4 space-y-1.5 ps-7 marker:text-faint" style={{ listStyleType: LIST_NUMBERING[language] }}>
        {children}
      </ol>
    ),
    li: ({ children }: MarkdownProps) => <li className="ps-1">{processContent(children)}</li>,
    blockquote: ({ children }: MarkdownProps) => (
      <blockquote className="my-4 border-s-2 border-gold/60 ps-4 text-muted">{processContent(children)}</blockquote>
    ),
    a: ({ href, children }: MarkdownProps) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gold-text underline decoration-gold/40 underline-offset-4 hover:decoration-gold"
      >
        {processContent(children)}
      </a>
    ),
    hr: () => <hr className="my-6 border-line" />,
    // react-markdown wraps every fenced block in <pre><code>, so blocks are rendered here and the
    // `code` renderer below only ever sees inline code.
    pre: ({ children }: MarkdownProps) => {
      const codeElement = React.isValidElement<MarkdownProps>(children) ? children : null;
      const classMatch = /language-(\w+)/.exec(codeElement?.props.className || '');
      const lang = classMatch ? classMatch[1] : '';
      const content = String(codeElement?.props.children ?? '').replace(/\n$/, '');

      if (lang === 'quran') {
        const verse = content.trim().replace(/^﴿\s*|\s*﴾$/g, '');
        return (
          <div className="quran whitespace-pre-wrap break-words">
            <span className="verse-mark">﴿</span> {localDigits(verse)} <span className="verse-mark">﴾</span>
          </div>
        );
      }

      if (lang === 'hadith') {
        const sourceMatch = content.match(/<span class="source">([\s\S]*?)<\/span>/);
        const sourceText = sourceMatch ? localDigits(sourceMatch[1].trim()) : '';
        const verdict = findVerdict(sourceText);
        const mainText = (sourceMatch ? content.replace(sourceMatch[0], '') : content)
          .replace(/<br\s*\/?>/gi, '')
          .trim();
        return (
          <figure className="hadith my-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[0.85rem] font-medium text-faint">
                <BookOpen size={15} strokeWidth={1.8} aria-hidden="true" />
                {t.message.hadith}
              </span>
              {verdict && <VerdictPill verdict={verdict} />}
            </div>
            <blockquote className="text-[1.12rem] leading-[2] font-medium">{localDigits(mainText)}</blockquote>
            {sourceText && <figcaption className="source mt-2 text-[0.9rem] leading-relaxed text-muted">{sourceText}</figcaption>}
          </figure>
        );
      }

      return (
        <div className="my-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <pre dir="auto" className="p-4 font-mono text-sm whitespace-pre-wrap break-words">
            {content}
          </pre>
        </div>
      );
    },
    code: ({ children }: MarkdownProps) => (
      <code className="mx-0.5 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    table: ({ children }: MarkdownProps) => (
      <div className="my-4 overflow-x-auto rounded-xl border border-line">
        <table className="min-w-full border-collapse text-right text-[0.95rem]">{children}</table>
      </div>
    ),
    thead: ({ children }: MarkdownProps) => <thead className="bg-surface-2">{children}</thead>,
    tbody: ({ children }: MarkdownProps) => <tbody className="divide-y divide-line">{children}</tbody>,
    th: ({ children }: MarkdownProps) => (
      <th className="px-4 py-2.5 text-right font-semibold align-top">{processContent(children)}</th>
    ),
    td: ({ children }: MarkdownProps) => <td className="px-4 py-2.5 align-top break-words">{processContent(children)}</td>,
  };

  if (isUser) {
    return (
      <article aria-label="User message" className="mb-8 flex justify-start slide-in">
        <div className="max-w-[85%] md:max-w-[75%]">
          {message.attachment?.media ? (
            <MediaCard attachment={message.attachment} />
          ) : message.attachment && (
            <div className="mb-2 overflow-hidden rounded-2xl border border-line">
              {message.attachment.mimeType.startsWith('image/') ? (
                <img src={message.attachment.data} alt={t.message.attachedImage} className="max-h-72 w-full object-cover" />
              ) : (
                <div className="flex items-center gap-3 bg-surface px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-soft text-[0.7rem] font-bold text-danger">PDF</span>
                  <span className="truncate text-[0.95rem]">{message.attachment.name}</span>
                </div>
              )}
            </div>
          )}
          {message.text && (
            <p className="rounded-3xl rounded-tr-lg bg-surface-2 px-5 py-3 text-[1.05rem] leading-[1.8] whitespace-pre-wrap break-words">
              {message.text}
            </p>
          )}
        </div>
      </article>
    );
  }

  const avatar = (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line">
      <img src="/logo.png" alt="" width="22" height="22" className="h-[22px] w-[22px]" />
    </div>
  );

  if (message.isError) {
    return (
      <article aria-label="Salaf AI response" className={`mb-10 flex gap-3 ${isNew ? 'answer-reveal' : ''}`}>
        {avatar}
        <div className="min-w-0 flex-1 rounded-2xl bg-danger-soft px-4 py-3">
          <p className="text-[1rem] leading-[1.85] whitespace-pre-wrap">{localDigits(message.text)}</p>
          {canRetry && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              data-testid="retry-message"
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-surface px-4 text-[0.9rem] font-semibold shadow-sm transition-colors hover:bg-surface-3"
              aria-label={t.message.retry}
            >
              <RotateCw size={15} strokeWidth={2.2} aria-hidden="true" />
              {t.message.retry}
            </button>
          )}
        </div>
      </article>
    );
  }

  const feedbackLabel = hasSubmittedFeedback ? t.message.feedbackAgain : t.message.feedback;

  return (
    <article aria-label="Salaf AI response" className={`mb-10 flex gap-3 ${isNew ? 'answer-reveal' : ''}`}>
      {avatar}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[1.05rem] leading-[1.95]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {processedText}
          </ReactMarkdown>
        </div>

        {sourcesList.length > 0 && (
          <section className="mt-5" aria-label={t.message.sources}>
            <h4 className="mb-2 text-[0.85rem] font-semibold text-faint">{t.message.sources}</h4>
            <ol className="grid gap-2 sm:grid-cols-2">
              {sourcesList.map((source, index) => {
                const text = source.replace(/^\d+\.\s*/, '');
                const url = text.match(URL_PATTERN)?.[0];
                const label = localDigits(text.replace(URL_PATTERN, '').replace(/[\s،,:|\-–—]+$/, '').trim());
                const content = (
                  <>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-soft text-[0.75rem] font-bold text-gold-text">
                      {localDigits(String(index + 1))}
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-[0.9rem] leading-snug">{label}</span>
                      {url && <span dir="ltr" className="mt-0.5 block truncate text-right text-[0.78rem] text-faint">{getHostname(url)}</span>}
                    </span>
                  </>
                );
                return (
                  <li key={index}>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex h-full items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:bg-surface-3 hover:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.5)]"
                      >
                        {content}
                      </a>
                    ) : (
                      <div className="flex h-full items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">{content}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <div className="mt-3 flex items-center gap-0.5">
          <IconButton label={isCopied ? t.message.copied : t.message.copy} onClick={handleCopy}>
            {isCopied ? (
              <Check size={16} strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={1.9} aria-hidden="true" />
            )}
          </IconButton>
          {onFeedback && (
            <IconButton label={feedbackLabel} onClick={handleFeedbackClick} data-testid="feedback-message">
              <ThumbsDown size={16} strokeWidth={1.9} fill={hasSubmittedFeedback ? 'currentColor' : 'none'} aria-hidden="true" />
            </IconButton>
          )}
          <span className="ms-2 text-[0.8rem] text-faint">{formatTime(message.timestamp, language)}</span>
        </div>
      </div>
    </article>
  );
};
