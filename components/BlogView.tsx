import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Languages, MessageSquarePlus, PencilLine, ShieldCheck } from 'lucide-react';
import { MESSAGES } from '../i18n/messages';
import { I18nContext, useI18n } from '../i18n/context';
import { LANGUAGES, storeBlogLanguage, textDirection, type Language } from '../i18n/languages';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../types';
import { BLOG_TOPICS, blogPath, fetchPost, fetchPosts, topicPath, type BlogPostView, type BlogSummary, type BlogTopic } from '../services/blogService';
import { createClientUuid } from '../services/ids';

interface BlogViewProps {
  lang: Language;
  slug: string | null;
  /** Set on a topic page (/blog/topic/fiqh). */
  topic?: BlogTopic;
  /** Moves within the blog (list ↔ post, another language) without reloading the page. */
  onNavigate: (path: string) => void;
  onAskOwn: () => void;
  onContinue: (title: string, messages: Message[]) => void;
}

const formatDate = (ms: number, lang: Language) => new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(new Date(ms));

/** The blog in one language: the list of questions, or one question and its answer. */
export const BlogView: React.FC<BlogViewProps> = ({ lang, slug, topic, onNavigate, onAskOwn, onContinue }) => {
  // The blog speaks the language of its address, whatever the interface language is.
  const t = MESSAGES[lang];
  const dir = textDirection(lang);
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  // Where each language's version of this page lives. A post reports its own once it has loaded.
  const [postPaths, setPostPaths] = useState<{ key: string; paths: Partial<Record<Language, string>> } | null>(null);
  const pageKey = `${lang}/${slug ?? ''}`;
  const reportPostLanguages = useCallback((paths: Partial<Record<Language, string>>) => setPostPaths({ key: pageKey, paths }), [pageKey]);
  const languagePaths: Partial<Record<Language, string>> | null = slug
    ? postPaths?.key === pageKey
      ? postPaths.paths
      : null
    : Object.fromEntries(LANGUAGES.map(({ code }) => [code, topic ? topicPath(code, topic) : blogPath(code)]));

  return (
    <div className="page-glow min-h-dvh bg-bg text-text" dir={dir} lang={lang}>
      <nav className="frosted sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
          <button type="button" onClick={onAskOwn} className="flex items-center gap-2">
            <img src="/logo.png" alt="" width="28" height="28" className="h-7 w-7" />
            <span className="whitespace-nowrap text-[1.05rem] font-bold">{t.appName}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <LanguageMenu current={lang} paths={languagePaths} onNavigate={onNavigate} />
            <a
              href={blogPath(lang)}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(blogPath(lang));
              }}
              className="hidden h-9 whitespace-nowrap rounded-full px-3 text-[0.9rem] leading-9 text-muted transition-colors hover:bg-surface-2 hover:text-text sm:block"
            >
              {t.blog.nav}
            </a>
            <button
              type="button"
              onClick={onAskOwn}
              className="h-9 whitespace-nowrap rounded-full bg-text px-3.5 text-[0.9rem] font-semibold text-bg transition-transform hover:scale-[1.03] active:scale-95 sm:px-4"
            >
              {t.blog.askOwn}
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6" data-testid="blog-view">
        {slug ? (
          <PostPage
            key={pageKey}
            lang={lang}
            slug={slug}
            back={Back}
            onNavigate={onNavigate}
            onAskOwn={onAskOwn}
            onContinue={onContinue}
            onLanguages={reportPostLanguages}
          />
        ) : (
          <IndexPage key={`${lang}/${topic ?? ''}`} lang={lang} topic={topic} onNavigate={onNavigate} />
        )}
      </main>
    </div>
  );
};

/** "All" and each topic, as links; the current one is highlighted. */
const TopicLinks: React.FC<{ lang: Language; current?: BlogTopic; onNavigate: (path: string) => void }> = ({ lang, current, onNavigate }) => {
  const t = MESSAGES[lang];
  const items: Array<{ key: string; label: string; path: string; active: boolean }> = [
    { key: 'all', label: t.blog.allTopics, path: blogPath(lang), active: !current },
    ...BLOG_TOPICS.map((topic) => ({ key: topic, label: t.blog.categories[topic], path: topicPath(lang, topic), active: topic === current })),
  ];
  return (
    <nav aria-label={t.blog.topics} className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1" data-testid="blog-topics">
      {items.map((item) => (
        <a
          key={item.key}
          href={item.path}
          aria-current={item.active ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(item.path);
          }}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[0.85rem] transition-colors ${
            item.active ? 'border-gold/50 bg-gold-soft font-semibold text-gold-text' : 'border-line text-muted hover:bg-surface-2 hover:text-text'
          }`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
};

/** The language icon in the top bar: this page in each language it exists in. The pick is remembered. */
const LanguageMenu: React.FC<{ current: Language; paths: Partial<Record<Language, string>> | null; onNavigate: (path: string) => void }> = ({
  current,
  paths,
  onNavigate,
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = MESSAGES[current];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const available = LANGUAGES.filter(({ code }) => paths?.[code]);
  if (available.length < 2) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label={t.blog.language}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="blog-language-menu"
        className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.85rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Languages size={18} strokeWidth={1.9} aria-hidden="true" />
        <span className="hidden sm:inline">{LANGUAGES.find(({ code }) => code === current)?.name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-11 z-30 min-w-40 overflow-hidden rounded-2xl border border-line bg-surface p-1 shadow-xl">
          {available.map(({ code, name }) => (
            <a
              key={code}
              role="menuitem"
              href={paths![code]}
              lang={code}
              hrefLang={code}
              dir={textDirection(code)}
              aria-current={code === current ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                storeBlogLanguage(code);
                if (code !== current) onNavigate(paths![code]!);
              }}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[0.92rem] transition-colors hover:bg-surface-2 ${
                code === current ? 'font-semibold text-gold-text' : 'text-text'
              }`}
            >
              {name}
              {code === current && <Check size={16} strokeWidth={2} aria-hidden="true" />}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

const IndexPage: React.FC<{ lang: Language; topic?: BlogTopic; onNavigate: (path: string) => void }> = ({ lang, topic, onNavigate }) => {
  const t = MESSAGES[lang];
  const [posts, setPosts] = useState<BlogSummary[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = topic ? `${t.blog.categories[topic]} | ${t.blog.title}` : `${t.blog.title} | ${t.appName}`;
    fetchPosts(lang, 0, topic)
      .then((page) => {
        setPosts(page.posts);
        setNext(page.next);
      })
      .catch(() => setFailed(true));
  }, [lang, topic, t]);

  const loadMore = () => {
    if (next === null) return;
    void fetchPosts(lang, next, topic).then((page) => {
      setPosts((current) => [...(current ?? []), ...page.posts]);
      setNext(page.next);
    });
  };

  return (
    <>
      <header className="mb-8">
        <h1 className="mb-2 text-[2rem] font-bold">{topic ? t.blog.categories[topic] : t.blog.title}</h1>
        <p className="mb-4 text-[1.02rem] leading-relaxed text-muted">{topic ? t.blog.topicSubtitle(t.blog.categories[topic]) : t.blog.subtitle}</p>
        <TopicLinks lang={lang} current={topic} onNavigate={onNavigate} />
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
  onLanguages: (paths: Partial<Record<Language, string>>) => void;
}> = ({ lang, slug, back: Back, onNavigate, onAskOwn, onContinue , onLanguages }) => {
  const t = MESSAGES[lang];
  const { setLanguage } = useI18n();
  const [post, setPost] = useState<BlogPostView | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchPost(slug, lang)
      .then((result) => {
        setPost(result);
        if (!result) return;
        onLanguages(Object.fromEntries(result.languages.map((language) => [language, blogPath(language, result.slugs[language])])));
        document.title = `${result.q} | ${t.appName}`;
        // Old addresses, or one language's address under another's prefix, show the version's own address.
        const own = blogPath(result.lang, result.slug);
        if (window.location.pathname !== own) window.history.replaceState(window.history.state, '', own + window.location.search);
      })
      .catch(() => setFailed(true));
  }, [slug, lang, t, onLanguages]);

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
        {(BLOG_TOPICS as readonly string[]).includes(post.category) ? (
          <a
            href={topicPath(post.lang, post.category as BlogTopic)}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(topicPath(post.lang, post.category as BlogTopic));
            }}
            className="rounded-full bg-gold-soft px-2 py-0.5 font-medium text-gold-text hover:underline"
          >
            {t.blog.categories[post.category]}
          </a>
        ) : (
          <span className="rounded-full bg-gold-soft px-2 py-0.5 font-medium text-gold-text">{t.blog.categories[post.category] ?? post.category}</span>
        )}
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
