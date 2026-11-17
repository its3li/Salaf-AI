import type { Language } from '../i18n/languages';
import { getClientId } from './chatService';

export const BLOG_LANGUAGES: Language[] = ['ar', 'en', 'ur', 'fa'];

export interface BlogSummary {
  slug: string;
  category: string;
  createdAt: number;
  q: string;
  excerpt: string;
}

export interface BlogPostView {
  /** The post's fixed id (used by the admin). */
  id: string;
  /** This version's address, in its own language. */
  slug: string;
  lang: Language;
  category: string;
  createdAt: number;
  updatedAt: number;
  q: string;
  a: string;
  editedAt?: number;
  /** An editor reviewed and approved this language version. */
  reviewed?: boolean;
  languages: Language[];
  slugs: Partial<Record<Language, string>>;
  /** Other questions to read next, in this language. */
  related?: Array<{ slug: string; q: string; category: string }>;
}

/** /blog and /blog/<slug> are Arabic; /en|ur|fa/blog[/<slug>] the other languages. Slugs are in each language's own words. */
export const blogPath = (lang: Language, slug?: string) => `${lang === 'ar' ? '' : `/${lang}`}/blog${slug ? `/${encodeURIComponent(slug)}` : ''}`;

/** A topic's page: /blog/topic/fiqh, /ur/blog/topic/fiqh. */
export const BLOG_TOPICS = ['aqidah', 'fiqh', 'hadith', 'tafsir', 'adab', 'seerah'] as const;
export type BlogTopic = (typeof BLOG_TOPICS)[number];
export const topicPath = (lang: Language, topic: BlogTopic) => `${blogPath(lang)}/topic/${topic}`;

export const parseBlogPath = (pathname: string): { lang: Language; slug: string | null; topic?: BlogTopic } | null => {
  const topicMatch = /^(?:\/(en|ur|fa))?\/blog\/topic\/([a-z]+)\/?$/.exec(pathname);
  if (topicMatch && (BLOG_TOPICS as readonly string[]).includes(topicMatch[2])) {
    return { lang: (topicMatch[1] as Language) ?? 'ar', slug: null, topic: topicMatch[2] as BlogTopic };
  }
  const match = /^(?:\/(en|ur|fa))?\/blog(?:\/([^/]{1,600}))?\/?$/.exec(pathname);
  if (!match) return null;
  let slug = match[2] ?? null;
  try {
    if (slug) slug = decodeURIComponent(slug).normalize('NFKC');
  } catch {
    return null;
  }
  return { lang: (match[1] as Language) ?? 'ar', slug };
};

export const fetchPosts = async (lang: Language, offset = 0, topic?: BlogTopic) => {
  const response = await fetch(`/api/blog?lang=${lang}&offset=${offset}${topic ? `&topic=${topic}` : ''}`);
  if (!response.ok) throw new Error(`Blog list failed (${response.status})`);
  return (await response.json()) as { posts: BlogSummary[]; next: number | null };
};

export const fetchPost = async (slug: string, lang: Language): Promise<BlogPostView | null> => {
  const response = await fetch(`/api/blog?slug=${encodeURIComponent(slug)}&lang=${lang}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blog post failed (${response.status})`);
  return (await response.json()) as BlogPostView;
};

/** Counts a blog read, an "Ask more" press or an opened share for the daily report. Never fails. */
export const trackBlog = (event: 'view' | 'askMore' | 'shareOpen') => {
  const clientId = getClientId();
  void fetch('/api/blog', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...(clientId ? { 'X-Client-Id': clientId } : {}) },
    body: JSON.stringify({ event }),
  }).catch(() => undefined);
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const ADMIN_KEY = 'salaf-ai-admin-secret';

export const loadAdminSecret = () => {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? '';
  } catch {
    return '';
  }
};

export const saveAdminSecret = (secret: string) => {
  try {
    if (secret) localStorage.setItem(ADMIN_KEY, secret);
    else localStorage.removeItem(ADMIN_KEY);
  } catch {
    // The secret is simply asked for again next time.
  }
};

export class AdminError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code);
  }
}

export const adminCall = async <T>(secret: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch('/api/blogadmin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    throw new AdminError(response.status, error?.code ?? `HTTP_${response.status}`, error?.message);
  }
  return payload as T;
};
