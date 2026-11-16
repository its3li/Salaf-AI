import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nContext, useI18n } from '../i18n/context';
import { MESSAGES } from '../i18n/messages';
import { textDirection, type Language } from '../i18n/languages';
import { MessageBubble } from './MessageBubble';
import { adminCall, AdminError, blogPath, BLOG_LANGUAGES, loadAdminSecret, saveAdminSecret } from '../services/blogService';

/*
 * The blog's private page at /admin. The owner (ADMIN_SECRET) sees everything: questions, the
 * queue, every post and the reviewers. A reviewer signs in with the key the owner made for them
 * and can review, correct and hide only their languages. The server checks every call.
 */

interface Review {
  status: 'approved' | 'changes';
  by: string;
  at: number;
  note?: string;
}

interface PostVersion {
  q: string;
  a: string;
  editedAt?: number;
  editedBy?: string;
  original?: { q: string; a: string };
  review?: Review;
  hidden?: boolean;
}

interface AdminPost {
  slug: string;
  category: string;
  source: 'auto' | 'manual';
  status: 'published' | 'hidden';
  createdAt: number;
  updatedAt: number;
  langs: Partial<Record<Language, PostVersion>>;
}

interface Editor {
  name: string;
  role: 'owner' | 'reviewer';
  langs: Language[];
}

interface Reviewer {
  id: string;
  name: string;
  langs: Language[];
  createdAt: number;
}

type PipelineResult = { ok: true; post: AdminPost } | { ok: false; question?: string; reason: string; issues?: string[] };
type Filter = 'all' | 'review' | 'hidden';

const LANGUAGE_NAMES: Record<Language, string> = { ar: 'Arabic', en: 'English', ur: 'Urdu', fa: 'Persian' };

const button = 'h-9 rounded-full px-4 text-[0.88rem] font-medium transition-colors disabled:opacity-40';
const primary = `${button} bg-gold text-[#17160f] hover:opacity-85`;
const plain = `${button} border border-line text-muted hover:bg-surface-2 hover:text-text`;
const danger = `${button} text-danger hover:bg-danger-soft`;
const field = 'w-full rounded-xl bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/35';

const when = (ms: number) => new Date(ms).toLocaleString();

const describeResult = (result: PipelineResult) =>
  result.ok
    ? `Published: ${result.post.langs.ar?.q}`
    : result.reason === 'already-ran'
      ? "Today's post was already made."
      : `Not published (${result.reason})${result.issues?.length ? `:\n- ${result.issues.join('\n- ')}` : ''}`;

/** A language still waiting for this editor's attention: not approved yet. */
const needsReview = (version: PostVersion | undefined) => !!version && version.review?.status !== 'approved';

const StatusChip: React.FC<{ lang: Language; version?: PostVersion }> = ({ lang, version }) => {
  if (!version) return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-faint line-through">{lang}</span>;
  const parts = [
    version.review?.status === 'approved' ? '✓ approved' : version.review?.status === 'changes' ? '! needs changes' : 'not reviewed',
    version.editedAt ? 'edited' : '',
    version.hidden ? 'hidden' : '',
  ].filter(Boolean);
  const tone =
    version.hidden ? 'bg-surface-2 text-faint' : version.review?.status === 'approved' ? 'bg-gold-soft text-gold-text' : version.review?.status === 'changes' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted';
  return (
    <span className={`rounded-full px-2 py-0.5 ${tone}`} title={parts.join(', ')}>
      {lang} · {parts.join(' · ')}
    </span>
  );
};

/** How the answer will look on the blog, in that language. */
const Preview: React.FC<{ lang: Language; text: string }> = ({ lang, text }) => {
  const { setLanguage } = useI18n();
  return (
    <I18nContext.Provider value={{ language: lang, t: MESSAGES[lang], setLanguage }}>
      <div dir={textDirection(lang)} lang={lang} className="rounded-2xl bg-bg p-3">
        <MessageBubble message={{ id: `preview-${lang}`, role: 'model', text, timestamp: new Date() }} />
      </div>
    </I18nContext.Provider>
  );
};

/** First language of a post this editor works on, else its first language. */
const firstLanguage = (post: AdminPost, editor: Editor) => {
  const available = BLOG_LANGUAGES.filter((lang) => post.langs[lang]);
  return available.find((lang) => editor.langs.includes(lang)) ?? available[0];
};

/** Mounted per post, language and saved version, so its drafts start from what is saved. */
const ReviewPanel: React.FC<{
  post: AdminPost;
  editor: Editor;
  lang: Language;
  busy: boolean;
  onLanguage: (lang: Language) => void;
  onAction: (body: Record<string, unknown>) => Promise<boolean>;
}> = ({ post, editor, lang, busy, onLanguage, onAction }) => {
  const available = BLOG_LANGUAGES.filter((language) => post.langs[language]);
  const version = post.langs[lang]!;
  const canWork = editor.langs.includes(lang);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [draft, setDraft] = useState({ q: version.q, a: version.a });
  const [note, setNote] = useState(version.review?.note ?? '');
  const [showArabic, setShowArabic] = useState(false);

  const switchTo = onLanguage;

  const act = (body: Record<string, unknown>) => onAction({ slug: post.slug, lang, ...body });

  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-4" data-testid="review-panel">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {available.map((language) => (
          <button
            key={language}
            type="button"
            className={language === lang ? primary : plain}
            onClick={() => switchTo(language)}
            title={editor.langs.includes(language) ? '' : 'You can read this language but not change it'}
          >
            {LANGUAGE_NAMES[language]}
            {post.langs[language]?.review?.status === 'approved' ? ' ✓' : ''}
            {post.langs[language]?.hidden ? ' (hidden)' : ''}
          </button>
        ))}
      </div>

      <div className="mb-3 space-y-1 text-[0.85rem] text-muted">
        {version.review ? (
          <p>
            {version.review.status === 'approved' ? '✓ Approved' : '! Needs changes'} by {version.review.by}, {when(version.review.at)}
            {version.review.note ? ` — “${version.review.note}”` : ''}
          </p>
        ) : (
          <p>Not reviewed yet.</p>
        )}
        {version.editedAt && <p>✎ Corrected by {version.editedBy ?? 'an editor'}, {when(version.editedAt)}. The page says it was reviewed and corrected.</p>}
        {version.hidden && <p className="text-danger">This language is hidden from the public.</p>}
        {!canWork && <p>You can read this language, but only its reviewers can change it.</p>}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={mode === 'preview' ? primary : plain} onClick={() => setMode('preview')}>
          Preview
        </button>
        {canWork && (
          <button type="button" className={mode === 'edit' ? primary : plain} onClick={() => setMode('edit')} data-testid="review-edit">
            Edit
          </button>
        )}
        {lang !== 'ar' && post.langs.ar && (
          <button type="button" className={plain} onClick={() => setShowArabic((value) => !value)}>
            {showArabic ? 'Hide the Arabic' : 'Compare with the Arabic'}
          </button>
        )}
      </div>

      <div className={showArabic ? 'grid gap-3 lg:grid-cols-2' : ''}>
        <div>
          {mode === 'preview' ? (
            <>
              <p dir={textDirection(lang)} className="mb-2 text-[1.05rem] font-semibold">
                {version.q}
              </p>
              <Preview lang={lang} text={version.a} />
            </>
          ) : (
            <>
              <p className="mb-2 text-[0.82rem] text-faint">
                Keep the &lt;p class="quran"&gt;, &lt;p class="hadith"&gt; and [[SOURCES_START]] … [[SOURCES_END]] markup as it is. The preview below
                updates as you type.
              </p>
              <input dir="auto" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} className={`${field} mb-2`} aria-label="Question" />
              <textarea
                dir="auto"
                value={draft.a}
                onChange={(event) => setDraft({ ...draft, a: event.target.value })}
                className={`${field} mb-3 min-h-72 font-mono text-[0.85rem]`}
                aria-label="Answer"
                data-testid="review-answer"
              />
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primary}
                  disabled={busy || !draft.a.trim() || (draft.q === version.q && draft.a === version.a)}
                  onClick={() => void act({ action: 'edit', q: draft.q, a: draft.a }).then((ok) => ok && setMode('preview'))}
                  data-testid="review-save"
                >
                  Save correction
                </button>
                <button type="button" className={plain} onClick={() => setDraft({ q: version.q, a: version.a })}>
                  Undo my changes
                </button>
              </div>
              <Preview lang={lang} text={draft.a} />
            </>
          )}
        </div>
        {showArabic && post.langs.ar && (
          <div>
            <p dir="rtl" className="mb-2 text-[1.05rem] font-semibold">
              {post.langs.ar.q}
            </p>
            <Preview lang="ar" text={post.langs.ar.a} />
          </div>
        )}
      </div>

      {canWork && (
        <div className="mt-4 border-t border-line pt-4">
          <label className="mb-1 block text-[0.85rem] text-muted" htmlFor={`note-${post.slug}`}>
            Review note (only editors see it)
          </label>
          <textarea id={`note-${post.slug}`} dir="auto" value={note} onChange={(event) => setNote(event.target.value)} className={`${field} mb-3 min-h-16`} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void act({ action: 'review', status: 'approved', note })} data-testid="review-approve">
              Approve
            </button>
            <button type="button" className={plain} disabled={busy} onClick={() => void act({ action: 'review', status: 'changes', note })}>
              Needs changes
            </button>
            {version.review && (
              <button type="button" className={plain} disabled={busy} onClick={() => void act({ action: 'review', status: 'none' })}>
                Clear review
              </button>
            )}
            <button
              type="button"
              className={version.hidden ? plain : danger}
              disabled={busy}
              onClick={() => void act({ action: version.hidden ? 'showLang' : 'hideLang' })}
              data-testid="review-hide-language"
            >
              {version.hidden ? `Show ${LANGUAGE_NAMES[lang]} again` : `Hide ${LANGUAGE_NAMES[lang]} only`}
            </button>
            {version.original && (
              <button
                type="button"
                className={plain}
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Put back Salaf AI's original text for this language? Your corrections will be lost.")) void act({ action: 'restore' });
                }}
              >
                Restore Salaf AI's original
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ReviewersSection: React.FC<{ reviewers: Reviewer[]; busy: boolean; onCall: <T>(body: Record<string, unknown>) => Promise<T | undefined>; onChanged: () => void }> = ({
  reviewers,
  busy,
  onCall,
  onChanged,
}) => {
  const [name, setName] = useState('');
  const [langs, setLangs] = useState<Language[]>([]);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const add = async () => {
    const result = await onCall<{ reviewer: Reviewer; key: string }>({ action: 'addReviewer', name, langs });
    if (result) {
      setNewKey({ name: result.reviewer.name, key: result.key });
      setName('');
      setLangs([]);
      onChanged();
    }
  };

  return (
    <section className="mb-6 rounded-3xl border border-line bg-surface p-5">
      <h2 className="mb-1 text-[1.1rem] font-semibold">Reviewers</h2>
      <p className="mb-3 text-[0.88rem] text-muted">
        Give someone their own key instead of your secret. They can review, correct and hide only the languages you pick, and can't delete posts,
        publish questions or manage reviewers. Remove them at any time.
      </p>

      {newKey && (
        <div className="mb-4 rounded-2xl bg-gold-soft p-3 text-[0.9rem] text-gold-text" data-testid="reviewer-key">
          <p className="mb-2 font-semibold">Key for {newKey.name}. It is shown only now; send it to them privately.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-bg px-2 py-1 text-text">{newKey.key}</code>
            <button
              type="button"
              className={plain}
              onClick={() => void navigator.clipboard.writeText(newKey.key).then(() => setCopied(true))}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className={plain} onClick={() => setNewKey(null)}>
              Done
            </button>
          </div>
          <p className="mt-2">They open {window.location.origin}/admin and paste it in.</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className={`${field} max-w-48 bg-surface-2`} aria-label="Reviewer name" />
        {BLOG_LANGUAGES.map((lang) => (
          <label key={lang} className="flex items-center gap-1.5 text-[0.9rem]">
            <input
              type="checkbox"
              checked={langs.includes(lang)}
              onChange={(event) => setLangs((current) => (event.target.checked ? [...current, lang] : current.filter((entry) => entry !== lang)))}
            />
            {LANGUAGE_NAMES[lang]}
          </label>
        ))}
        <button type="button" className={primary} disabled={busy || !name.trim() || langs.length === 0} onClick={() => void add()}>
          Add reviewer
        </button>
      </div>

      {reviewers.length > 0 && (
        <ul className="space-y-2">
          {reviewers.map((reviewer) => (
            <li key={reviewer.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
              <span>
                <span className="font-medium">{reviewer.name}</span>
                <span className="text-muted"> · {reviewer.langs.map((lang) => LANGUAGE_NAMES[lang]).join(', ')}</span>
              </span>
              <button
                type="button"
                className={danger}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove ${reviewer.name}? Their key stops working immediately.`)) void onCall({ action: 'removeReviewer', id: reviewer.id }).then(onChanged);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export const AdminView: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const { language } = useI18n();
  const [secret, setSecret] = useState(loadAdminSecret);
  const [secretInput, setSecretInput] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [panelLang, setPanelLang] = useState<Record<string, Language>>({});
  const [filter, setFilter] = useState<Filter>('all');

  const call = useCallback(
    async <T,>(label: string, body: Record<string, unknown>): Promise<T | undefined> => {
      setBusy(label);
      setMessage('');
      try {
        return await adminCall<T>(secret, body);
      } catch (error) {
        if (error instanceof AdminError && error.status === 401) {
          saveAdminSecret('');
          setSecret('');
          setEditor(null);
          setMessage('That key was not accepted.');
        } else if (error instanceof AdminError && error.status === 403) {
          setMessage("You don't have permission for that.");
        } else {
          setMessage(error instanceof Error ? error.message : String(error));
        }
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [secret]
  );

  const refresh = useCallback(async () => {
    const data = await call<{ editor: Editor; posts: AdminPost[]; queue?: string[]; reviewers?: Reviewer[] }>('load', { action: 'list' });
    if (data) {
      setEditor(data.editor);
      setPosts(data.posts);
      setQueue(data.queue ?? []);
      setReviewers(data.reviewers ?? []);
    }
  }, [call]);

  useEffect(() => {
    document.title = 'Blog admin | Salaf AI';
    // Loaded after this render, not during the effect itself.
    if (secret) void Promise.resolve().then(refresh);
  }, [secret, refresh]);

  const shown = useMemo(() => {
    if (!editor) return [];
    if (filter === 'hidden') return posts.filter((post) => post.status === 'hidden' || BLOG_LANGUAGES.some((lang) => post.langs[lang]?.hidden));
    if (filter === 'review') return posts.filter((post) => editor.langs.some((lang) => needsReview(post.langs[lang])));
    return posts;
  }, [posts, filter, editor]);

  if (!secret) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-4 text-text" dir="ltr" lang="en">
        <form
          className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const value = secretInput.trim();
            if (!value) return;
            saveAdminSecret(value);
            setSecret(value);
          }}
        >
          <h1 className="mb-1 text-[1.3rem] font-bold">Blog admin</h1>
          <p className="mb-4 text-[0.9rem] text-muted">Enter your admin secret or reviewer key.</p>
          {message && <p className="mb-3 text-[0.88rem] text-danger">{message}</p>}
          <input
            type="password"
            autoComplete="current-password"
            value={secretInput}
            onChange={(event) => setSecretInput(event.target.value)}
            className="mb-4 w-full rounded-xl bg-surface-2 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-gold/35"
            aria-label="Admin secret"
          />
          <div className="flex justify-between gap-2">
            <button type="button" onClick={onExit} className={plain}>
              Back to the app
            </button>
            <button type="submit" className={primary}>
              Open
            </button>
          </div>
        </form>
      </div>
    );
  }

  const isOwner = editor?.role === 'owner';

  const runPipeline = async (label: 'publish' | 'run') => {
    const result = await call<PipelineResult>(label, label === 'publish' ? { action: 'publish', question } : { action: 'run' });
    if (result) {
      setMessage(describeResult(result));
      if (result.ok && label === 'publish') setQuestion('');
      void refresh();
    }
  };

  const addToQueue = async () => {
    const data = await call<{ queue: string[] }>('queue', { action: 'queue', question });
    if (data) {
      setQueue(data.queue);
      setQuestion('');
    }
  };

  /** Runs an action and reloads; true when it worked. */
  const update = async (body: Record<string, unknown>) => {
    const ok = (await call('update', body)) !== undefined || body.action === 'delete';
    await refresh();
    return ok;
  };

  const isWorking = busy === 'publish' || busy === 'run';
  const toReview = editor ? posts.filter((post) => editor.langs.some((lang) => needsReview(post.langs[lang]))).length : 0;

  return (
    <div className="min-h-dvh bg-bg text-text" dir="ltr" lang="en">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[1.6rem] font-bold">Blog admin</h1>
            {editor && (
              <p className="text-[0.88rem] text-muted" data-testid="admin-editor">
                Signed in as {editor.name}
                {editor.role === 'reviewer' ? ` · reviewer for ${editor.langs.map((lang) => LANGUAGE_NAMES[lang]).join(', ')}` : ' · full access'}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <a href={blogPath(language)} className={`${plain} leading-9`}>
              View blog
            </a>
            <button
              type="button"
              className={plain}
              onClick={() => {
                saveAdminSecret('');
                setSecret('');
                setEditor(null);
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        {message && (
          <p className="mb-4 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-[0.9rem]" role="status" data-testid="admin-message">
            {message}
          </p>
        )}

        {isOwner && (
          <section className="mb-6 rounded-3xl border border-line bg-surface p-5">
            <h2 className="mb-1 text-[1.1rem] font-semibold">Add a question</h2>
            <p className="mb-3 text-[0.88rem] text-muted">
              Write it in Arabic. “Publish now” answers, checks and translates it right away (2–4 minutes). “Add to queue” uses it for the next daily
              post instead of an automatic question.
            </p>
            <textarea
              dir="auto"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className={`${field} mb-3 min-h-24 bg-surface-2`}
              placeholder="مثال: ما حكم صلاة الضحى؟"
              data-testid="admin-question"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={!question.trim() || !!busy} onClick={() => void runPipeline('publish')}>
                {busy === 'publish' ? 'Answering, checking, translating…' : 'Publish now'}
              </button>
              <button type="button" className={plain} disabled={!question.trim() || !!busy} onClick={() => void addToQueue()}>
                Add to queue
              </button>
              <button type="button" className={`${plain} ms-auto`} disabled={!!busy} onClick={() => void runPipeline('run')}>
                {busy === 'run' ? 'Making today’s post…' : 'Make today’s post now'}
              </button>
            </div>
            {isWorking && <p className="mt-3 text-[0.85rem] text-faint">Keep this page open until it finishes.</p>}

            {queue.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-[0.95rem] font-semibold">Queue ({queue.length})</h3>
                <ul className="space-y-2">
                  {queue.map((item) => (
                    <li key={item} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                      <span dir="auto">{item}</span>
                      <button type="button" className={danger} disabled={!!busy} onClick={() => void update({ action: 'unqueue', question: item })}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {isOwner && (
          <ReviewersSection reviewers={reviewers} busy={!!busy} onCall={(body) => call('reviewers', body)} onChanged={() => void refresh()} />
        )}

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="me-2 text-[1.1rem] font-semibold">Posts</h2>
            {(
              [
                ['all', `All (${posts.length})`],
                ['review', `To review (${toReview})`],
                ['hidden', 'Hidden'],
              ] as Array<[Filter, string]>
            ).map(([value, label]) => (
              <button key={value} type="button" className={filter === value ? primary : plain} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          {busy === 'load' && posts.length === 0 && <p className="text-muted">Loading…</p>}
          {editor && shown.length === 0 && busy !== 'load' && <p className="text-muted">Nothing here.</p>}
          <ul className="space-y-3">
            {shown.map((post) => (
              <li key={post.slug} className="rounded-2xl border border-line bg-surface p-4" data-testid="admin-post">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-faint">
                  <span className={post.status === 'published' ? 'text-gold-text' : 'text-danger'}>{post.status === 'published' ? 'published' : 'whole post hidden'}</span>·
                  <span>{post.source === 'auto' ? 'automatic' : 'added by hand'}</span>·<span>{post.category}</span>·<span>{when(post.createdAt)}</span>
                </div>
                <p dir="rtl" className="mb-2 text-[1.05rem] font-semibold">
                  {post.langs.ar?.q}
                </p>
                <div className="mb-3 flex flex-wrap gap-1.5 text-[0.78rem]">
                  {BLOG_LANGUAGES.map((lang) => (
                    <StatusChip key={lang} lang={lang} version={post.langs[lang]} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={openSlug === post.slug ? primary : plain}
                    onClick={() => setOpenSlug(openSlug === post.slug ? null : post.slug)}
                    data-testid="admin-review"
                  >
                    {openSlug === post.slug ? 'Close review' : 'Review'}
                  </button>
                  <a href={blogPath('ar', post.slug)} target="_blank" rel="noreferrer" className={`${plain} leading-9`}>
                    Open on the blog
                  </a>
                  {isOwner && (
                    <>
                      <button
                        type="button"
                        className={plain}
                        disabled={!!busy}
                        onClick={() => void update({ action: post.status === 'published' ? 'hide' : 'show', slug: post.slug })}
                        data-testid="admin-hide-post"
                      >
                        {post.status === 'published' ? 'Hide whole post' : 'Publish again'}
                      </button>
                      <button
                        type="button"
                        className={danger}
                        disabled={!!busy}
                        onClick={() => {
                          if (window.confirm('Delete this post permanently? This cannot be undone. To take it down for now, use “Hide whole post” instead.'))
                            void update({ action: 'delete', slug: post.slug });
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>

                {openSlug === post.slug && editor && (
(() => {
                  const lang = panelLang[post.slug] && post.langs[panelLang[post.slug]] ? panelLang[post.slug] : firstLanguage(post, editor);
                  return (
                    <ReviewPanel
                      key={`${post.slug}-${lang}-${post.updatedAt}`}
                      post={post}
                      editor={editor}
                      lang={lang}
                      busy={!!busy}
                      onLanguage={(next) => setPanelLang((current) => ({ ...current, [post.slug]: next }))}
                      onAction={update}
                    />
                  );
                })()
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};
