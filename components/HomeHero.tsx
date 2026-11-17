import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { blogPath, fetchPosts, type BlogSummary } from '../services/blogService';

interface HomeHeroProps {
  onPickQuestion: (question: string) => void;
  /** Opens a blog address inside the app. */
  onOpenBlogPath?: (path: string) => void;
  /** The composer, placed in the middle of the screen while the conversation is empty. */
  children: React.ReactNode;
}

// Each part arrives a moment after the one above it.
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as React.CSSProperties;

/** The empty conversation: what this is, the input front and centre, and a few ways to start. */
export const HomeHero: React.FC<HomeHeroProps> = ({ onPickQuestion, onOpenBlogPath, children }) => {
  const { t, language } = useI18n();
  // The newest blog post in the interface language, shown under the suggestions.
  const [latest, setLatest] = useState<{ language: string; post: BlogSummary } | null>(null);

  const showLatest = Boolean(onOpenBlogPath);
  useEffect(() => {
    if (!showLatest) return;
    let cancelled = false;
    fetchPosts(language)
      .then((page) => {
        if (!cancelled && page.posts[0]) setLatest({ language, post: page.posts[0] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [language, showLatest]);

  const post = latest?.language === language ? latest.post : null;

  return (
    <div className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col justify-center py-8">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="logo-halo rise mb-6" data-intro-target>
          <img src="/logo.png" alt="" width="76" height="76" className="h-[76px] w-[76px]" />
        </div>
        <h1 className="rise text-[1.85rem] font-bold leading-tight md:text-[2.25rem]" style={delay(80)}>
          {t.home.title}
        </h1>
        <p className="rise mt-3 max-w-[34rem] text-[1rem] leading-relaxed text-muted" style={delay(160)}>
          {t.home.subtitle}
        </p>
      </div>

      <div className="rise" style={delay(240)}>
        {children}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {t.home.suggestions.map((item, index) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onPickQuestion(item.question)}
            style={delay(320 + index * 60)}
            className="rise group flex items-center gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3 text-start transition-all hover:-translate-y-0.5 hover:border-gold/40 hover:bg-surface hover:shadow-[0_10px_30px_-18px_rgba(212,175,55,0.55)]"
          >
            <span className="shrink-0 rounded-full bg-gold-soft px-2.5 py-0.5 text-[0.75rem] font-semibold text-gold-text">
              {item.topic}
            </span>
            <span className="text-[0.95rem] text-muted transition-colors group-hover:text-text">{item.question}</span>
          </button>
        ))}
      </div>

      {post && onOpenBlogPath && (
        <a
          href={blogPath(language, post.slug)}
          onClick={(event) => {
            event.preventDefault();
            onOpenBlogPath(blogPath(language, post.slug));
          }}
          data-testid="home-latest-post"
          style={delay(560)}
          className="rise mt-4 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold-soft/40 px-4 py-3 text-start transition-all hover:-translate-y-0.5 hover:border-gold/60"
        >
          <BookOpen size={20} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-gold-text" />
          <span className="min-w-0">
            <span className="block text-[0.75rem] font-semibold text-gold-text">{t.blog.latest}</span>
            <span className="block truncate text-[0.95rem]">{post.q}</span>
          </span>
        </a>
      )}

      <p className="rise mt-8 text-center text-[0.8rem] leading-relaxed text-faint" style={delay(600)}>
        {t.home.disclaimer}
      </p>
    </div>
  );
};
