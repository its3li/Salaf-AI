import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, MessageSquarePlus, PencilLine, ShieldCheck } from 'lucide-react';
import { MESSAGES } from '../i18n/messages';
import { I18nContext, useI18n } from '../i18n/context';
import { LANGUAGES, textDirection, type Language } from '../i18n/languages';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../types';
import { blogPath, fetchPost, fetchPosts, type BlogPostView, type BlogSummary } from '../services/blogService';
import { createClientUuid } from '../services/ids';

interface BlogViewProps {
  lang: Language;
  slug: string | null;
  /** Moves within the blog (list ↔ post, another language) without reloading the page. */
  onNavigate: (path: string) => void;
  onAskOwn: () => void;
  onContinue: (title: string, messages: Message[]) => void;
}

const formatDate = (ms: number, lang: Language) => new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(new Date(ms));

/** The blog in one language: the list of questions, or one question and its answer. */
export const BlogView: React.FC<BlogViewProps> = ({ lang, slug, onNavigate, onAskOwn, onContinue }) => {
  // The blog speaks the language of its address, whatever the interface language is.
  const t = MESSAGES[lang];
  const dir = textDirection(lang);
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div className="page-glow min-h-dvh bg-bg text-text" dir={dir} lang={lang}>
      <nav className="frosted sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
          <button type="button" onClick={onAskOwn} className="flex items-center gap-2">
            <img src="/logo.png" alt="" width="28" height="28" className="h-7 w-7" />
            <span className="text-[1.05rem] font-bold">{t.appName}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <a
              href={blogPath(lang)}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(blogPath(lang));
              }}
              className="h-9 rounded-full px-3 text-[0.9rem] leading-9 text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              {t.blog.nav}
            </a>
            <button
              type="button"
              onClick={onAskOwn}
              className="h-9 rounded-full bg-text px-4 text-[0.9rem] font-semibold text-bg transition-transform hover:scale-[1.03] active:scale-95"
            >
              {t.blog.askOwn}
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6" data-testid="blog-view">
        {slug ? (
          <PostPage key={`${lang}/${slug}`} lang={lang} slug={slug} back={Back} onNavigate={onNavigate} onAskOwn={onAskOwn} onContinue={onContinue} />
        ) : (
          <IndexPage key={lang} lang={lang} onNavigate={onNavigate} />
        )}
      </main>
    </div>
  );
};

const LanguageLinks: React.FC<{ current: Language; languages: Language[]; slugs?: Partial<Record<Language, string>>; onNavigate: (path: string) => void }> = ({
  current,
  languages,
  slugs,
  onNavigate,
}) => (
  <div className="flex flex-wrap items-center gap-1.5" data-testid="blog-languages">
    {languages.map((language) => {
      const path = blogPath(language, slugs?.[language]);
      const label = LANGUAGES.find((entry) => entry.code === language)?.name ?? language;
      return (
        <a
          key={language}
          href={path}
          lang={language}
          hrefLang={language}
          aria-current={language === current ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(path);
          }}
          className={`rounded-full px-3 py-1 text-[0.85rem] transition-colors ${
            language === current ? 'bg-gold-soft font-semibold text-gold-text' : 'text-muted hover:bg-surface-2 hover:text-text'
          }`}
        >
          {label}
        </a>
      );
    })}
  </div>
);

const IndexPage: React.FC<{ lang: Language; onNavigate: (path: string) => void }> = ({ lang, onNavigate }) => {
  const t = MESSAGES[lang];
  const [posts, setPosts] = useState<BlogSummary[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = `${t.blog.title} | ${t.appName}`;
    fetchPosts(lang)
      .then((page) => {
        setPosts(page.posts);
        setNext(page.next);
      })
      .catch(() => setFailed(true));
  }, [lang, t]);

  const loadMore = () => {
    if (next === null) return;
    void fetchPosts(lang, next).then((page) => {
      setPosts((current) => [...(current ?? []), ...page.posts]);
      setNext(page.next);
    });
  };

  return (
    <>
      <header className="mb-8">
        <h1 className="mb-2 text-[2rem] font-bold">{t.blog.title}</h1>
        <p className="mb-4 text-[1.02rem] leading-relaxed text-muted">{t.blog.subtitle}</p>
        <LanguageLinks current={lang} languages={['ar', 'en', 'ur', 'fa']} onNavigate={onNavigate} />
      </header>

      {!posts && !failed && <p className="py-16 text-center text-muted">{t.blog.loading}</p>}
      {failed && <p className="py-16 text-center text-muted">{t.errors.unavailable}</p>}
      {posts && posts.length === 0 && <p className="py-16 text-center text-muted">{t.blog.empty}</p>}

      <ul className="space-y-3">
        {posts?.map((post) => (
          <li key={post.slug}>
            <a
              href={blogPath(lang, post.slug)}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(blogPath(lang, post.slug));
              }}
              data-testid="blog-post-link"
              className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-gold/40 md:p-5"
            >
              <span className="mb-1.5 flex items-center gap-2 text-[0.8rem] text-faint">
                <span className="rounded-full bg-gold-soft px-2 py-0.5 font-medium text-gold-text">
                  {t.blog.categories[post.category] ?? post.category}
                </span>
                {formatDate(post.createdAt, lang)}
              </span>
              <span className="block text-[1.1rem] font-semibold leading-snug">{post.q}</span>
              <span className="mt-1.5 line-clamp-2 block text-[0.92rem] leading-relaxed text-muted">{post.excerpt}</span>
            </a>
          </li>
        ))}
      </ul>

      {next !== null && (
        <div className="mt-6 text-center">
          <button type="button" onClick={loadMore} className="h-10 rounded-full border border-line px-6 text-muted hover:bg-surface-2 hover:text-text">
            {t.blog.loadMore}
          </button>
        </div>
      )}
    </>
  );
};

const PostPage: React.FC<{
  lang: Language;
  slug: string;
  back: typeof ArrowLeft;
  onNavigate: (path: string) => void;
  onAskOwn: () => void;
  onContinue: (title: string, messages: Message[]) => void;
}> = ({ lang, slug, back: Back, onNavigate, onAskOwn, onContinue }) => {
  const t = MESSAGES[lang];
  const { setLanguage } = useI18n();
  const [post, setPost] = useState<BlogPostView | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchPost(slug, lang)
      .then((result) => {
        setPost(result);
        if (!result) return;
        document.title = `${result.q} | ${t.appName}`;
        // Old addresses, or one language's address under another's prefix, show the version's own address.
        const own = blogPath(result.lang, result.slug);
        if (window.location.pathname !== own) window.history.replaceState(window.history.state, '', own + window.location.search);
      })
      .catch(() => setFailed(true));
  }, [slug, lang, t]);

  if (failed) return <p className="py-16 text-center text-muted">{t.errors.unavailable}</p>;
  if (post === undefined) return <p className="py-16 text-center text-muted">{t.blog.loading}</p>;
  if (post === null) return <p className="py-16 text-center text-muted">{t.blog.notFound}</p>;

  const answer: Message = { id: `blog-${post.id}`, role: 'model', text: post.a, timestamp: new Date(post.createdAt) };

  return (
    <article>
      <a
        href={blogPath(lang)}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(blogPath(lang));
        }}
        className="mb-5 inline-flex items-center gap-1.5 text-[0.9rem] text-muted hover:text-text"
      >
        <Back size={16} strokeWidth={2} aria-hidden="true" />
        {t.blog.back}
      </a>

      <p className="mb-2 flex items-center gap-2 text-[0.82rem] text-faint">
        <span className="rounded-full bg-gold-soft px-2 py-0.5 font-medium text-gold-text">{t.blog.categories[post.category] ?? post.category}</span>
        {t.blog.published(formatDate(post.createdAt, lang))}
      </p>
      <h1 className="mb-4 text-[1.7rem] font-bold leading-snug md:text-[2rem]">{post.q}</h1>

      <p className="mb-2 flex items-start gap-2 rounded-xl bg-gold-soft px-3 py-2.5 text-[0.88rem] leading-relaxed text-gold-text">
        {post.editedAt ? (
          <PencilLine size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
        ) : (
          <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
        )}
        <span data-testid="blog-note">{post.editedAt ? t.blog.edited : post.reviewed ? t.blog.reviewed : t.blog.autoNote}</span>
      </p>

      {post.languages.length > 1 && (
        <div className="mb-6 mt-3 flex flex-wrap items-center gap-2 text-[0.85rem] text-faint">
          {t.blog.otherLanguages}:
          <LanguageLinks current={post.lang} languages={post.languages} slugs={post.slugs} onNavigate={onNavigate} />
        </div>
      )}

      {/* The answer's labels ("Hadith", sources) and numerals follow the post, not the interface. */}
      <I18nContext.Provider value={{ language: post.lang, t: MESSAGES[post.lang], setLanguage }}>
        <div dir={textDirection(post.lang)} lang={post.lang}>
          <MessageBubble message={answer} />
        </div>
      </I18nContext.Provider>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-8">
        <button
          type="button"
          data-testid="blog-ask-more"
          onClick={() =>
            onContinue(post.q.slice(0, 60), [
              { id: createClientUuid(), role: 'user', text: post.q, timestamp: new Date(post.createdAt) },
              { id: createClientUuid(), role: 'model', text: post.a, timestamp: new Date(post.createdAt) },
            ])
          }
          className="flex h-11 items-center gap-2 rounded-full bg-gold px-6 font-semibold text-[#17160f] transition-opacity hover:opacity-85"
        >
          <MessageSquarePlus size={18} strokeWidth={2} aria-hidden="true" />
          {t.blog.askMore}
        </button>
        <button
          type="button"
          onClick={onAskOwn}
          className="h-11 rounded-full border border-line px-6 text-[0.98rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          {t.blog.askOwn}
        </button>
      </div>
    </article>
  );
};
