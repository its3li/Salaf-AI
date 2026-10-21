import type { Language } from '../i18n/languages';

// Each language's own digits. Plain 'ar' now formats with Latin digits in current browsers, so the
// numbering system is requested explicitly; Urdu and Persian use the extended Arabic-Indic digits.
const LOCALES: Record<Language, string> = {
  ar: 'ar-u-nu-arab',
  ur: 'ur-PK-u-nu-arabext',
  fa: 'fa-IR-u-nu-arabext',
};

const DIGITS: Record<Language, string> = {
  ar: '٠١٢٣٤٥٦٧٨٩',
  ur: '۰۱۲۳۴۵۶۷۸۹',
  fa: '۰۱۲۳۴۵۶۷۸۹',
};

export const formatNumber = (value: number, language: Language) =>
  value.toLocaleString(LOCALES[language], { useGrouping: false });

export const formatTime = (date: Date, language: Language) =>
  date.toLocaleTimeString(LOCALES[language], { hour: 'numeric', minute: '2-digit' });

/** Rewrites Latin digits inside text (hadith numbers, page references) in the language's digits. */
export const localizeDigits = (text: string, language: Language) =>
  text.replace(/[0-9]/g, (digit) => DIGITS[language][Number(digit)]);

/** "1:23:54" or "4:05" for a length in seconds, in Latin digits (pair with localizeDigits to show it). */
export const formatClock = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
