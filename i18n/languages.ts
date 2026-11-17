export type Language = 'ar' | 'en' | 'ur' | 'fa';

export const DEFAULT_LANGUAGE: Language = 'ar';

/** Listed in the language menu under their own names. */
export const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'ar', name: 'العربية' },
  { code: 'en', name: 'English' },
  { code: 'ur', name: 'اردو' },
  { code: 'fa', name: 'فارسی' },
];

/** English reads left to right; Arabic, Urdu and Persian right to left. */
export const textDirection = (language: Language) => (language === 'en' ? 'ltr' : 'rtl');

// Where most visitors read Urdu or Persian, and the Arab countries, so that an English browser there
// still starts in Arabic. Elsewhere the browser's language decides, then Arabic.
const ARAB_COUNTRIES = [
  'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'YE', 'IQ', 'SY', 'JO', 'LB', 'PS', 'EG', 'SD', 'LY', 'TN', 'DZ', 'MA', 'MR', 'SO', 'DJ', 'KM',
];
const COUNTRY_LANGUAGE: Record<string, Language> = {
  ...Object.fromEntries(ARAB_COUNTRIES.map((country) => [country, 'ar'])),
  PK: 'ur',
  IR: 'fa',
  AF: 'fa',
};

const LANGUAGE_KEY = 'salaf-ai-language';
const BLOG_LANGUAGE_KEY = 'salaf-ai-blog-language';
const COUNTRY_KEY = 'salaf-ai-country';
const GEO_TIMEOUT_MS = 1500;

export const isLanguage = (value: unknown): value is Language =>
  value === 'ar' || value === 'en' || value === 'ur' || value === 'fa';

export const readStoredLanguage = (): Language | null => {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const storeLanguage = (language: Language) => {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // The choice simply won't persist.
  }
};

const languageFromBrowser = (): Language | null => {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return null;
};

const fetchCountry = async (): Promise<string | null> => {
  try {
    const cached = sessionStorage.getItem(COUNTRY_KEY);
    if (cached !== null) return cached || null;
  } catch {
    // Asked again below.
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const response = await fetch('/api/geo', { signal: controller.signal });
    if (!response.ok) return null;
    const { country } = (await response.json()) as { country?: unknown };
    const found = typeof country === 'string' ? country : null;
    try {
      sessionStorage.setItem(COUNTRY_KEY, found ?? '');
    } catch {
      // Asked again next time.
    }
    return found;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
};

/**
 * The visitor's own choice; on a first visit, the language of their country, then their browser's.
 * A language found from the country is remembered so later visits start at once.
 */
export const resolveInitialLanguage = async (): Promise<Language> => {
  const stored = readStoredLanguage();
  if (stored) return stored;

  const country = await fetchCountry();
  if (country) {
    const language = COUNTRY_LANGUAGE[country] ?? languageFromBrowser() ?? DEFAULT_LANGUAGE;
    storeLanguage(language);
    return language;
  }
  return languageFromBrowser() ?? DEFAULT_LANGUAGE;
};

/** Remembers the language a reader picked from the blog's language menu. */
export const storeBlogLanguage = (language: Language) => {
  try {
    localStorage.setItem(BLOG_LANGUAGE_KEY, language);
  } catch {
    // The choice simply won't persist.
  }
};

/**
 * The blog's language when it is opened from the app: the reader's own pick on the blog, then the
 * language of their country (English outside the Arab countries, Pakistan, Iran and Afghanistan),
 * then the app's saved language, then English.
 */
export const resolveBlogLanguage = async (): Promise<Language> => {
  try {
    const picked = localStorage.getItem(BLOG_LANGUAGE_KEY);
    if (isLanguage(picked)) return picked;
  } catch {
    // Fall through to the country.
  }
  const country = await fetchCountry();
  if (country) return COUNTRY_LANGUAGE[country] ?? 'en';
  return readStoredLanguage() ?? 'en';
};
