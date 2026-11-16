import type { Language } from '../i18n/languages';

export const BLOG_LANGUAGES: Language[] = ['ar', 'en', 'ur', 'fa'];

export interface BlogSummary {
  slug: string;
  category: string;
  createdAt: number;
  q: string;
  excerpt: string;
}

export interface BlogPostView {
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
}

/** /blog and /blog/<slug> are Arabic; /en|ur|fa/blog[/<slug>] the other languages. */
export const blogPath = (lang: Language, slug?: string) => `${lang === 'ar' ? '' : `/${lang}`}/blog${slug ? `/${slug}` : ''}`;

export const parseBlogPath = (pathname: string): { lang: Language; slug: string | null } | null => {
  const match = /^(?:\/(en|ur|fa))?\/blog(?:\/([a-z0-9-]{1,90}))?\/?$/.exec(pathname);
  return match ? { lang: (match[1] as Language) ?? 'ar', slug: match[2] ?? null } : null;
};

export const fetchPosts = async (lang: Language, offset = 0) => {
  const response = await fetch(`/api/blog?lang=${lang}&offset=${offset}`);
  if (!response.ok) throw new Error(`Blog list failed (${response.status})`);
  return (await response.json()) as { posts: BlogSummary[]; next: number | null };
};

export const fetchPost = async (slug: string, lang: Language): Promise<BlogPostView | null> => {
  const response = await fetch(`/api/blog?slug=${encodeURIComponent(slug)}&lang=${lang}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blog post failed (${response.status})`);
  return (await response.json()) as BlogPostView;
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
