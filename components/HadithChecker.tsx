import React, { useState } from 'react';
import { Check, ExternalLink, Info, X } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { localizeDigits } from '../services/format';
import { gradeTone, type GradeTone } from '../services/hadithGrades';

interface DorarEntry {
  text: string;
  muhaddith?: string;
  source?: string;
  number?: string;
  grade?: string;
  /** The narration's own page on Dorar, when the server could find it. */
  link?: string;
}

type Status = 'idle' | 'loading' | 'empty' | 'error';

// Gold only for a grade that plainly says sound; one that is neither clearly sound nor weak («أورده
// مسلم في مقدمة صحيحه», «سكت عنه») stays grey for the reader to judge.
const GRADE_STYLES: Record<GradeTone, { className: string; Icon: typeof Check }> = {
  sound: { className: 'bg-gold-soft text-gold-text', Icon: Check },
  weak: { className: 'bg-danger-soft text-danger', Icon: X },
  unclear: { className: 'bg-surface-3 text-muted', Icon: Info },
};
const dorarSearchUrl = (query: string) => `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`;

// Dorar.net's results for the witr hadith (checked October 2026), shown before the first search.
const EXAMPLE = {
  query: 'اجعلوا آخر صلاتكم بالليل وترا',
  results: [
    { text: 'اجعَلوا آخِرَ صَلاتِكُم باللَّيلِ وِترًا', muhaddith: 'البخاري', source: 'صحيح البخاري', number: '998', grade: 'صحيح', link: 'https://dorar.net/h/eUqTOTvr' },
    { text: 'اجعَلوا آخِرَ صَلاتِكُم باللَّيلِ وِترًا', muhaddith: 'مسلم', source: 'صحيح مسلم', number: '751', grade: 'صحيح', link: 'https://dorar.net/h/fevZCKUN' },
  ] as DorarEntry[],
};

/** Type part of a hadith and see how Dorar.net's scholars graded it. Without script it opens Dorar's search. */
export const HadithChecker: React.FC = () => {
  const { t, language } = useI18n();
  const [query, setQuery] = useState(EXAMPLE.query);
  const [searched, setSearched] = useState(EXAMPLE.query);
  const [results, setResults] = useState<DorarEntry[]>(EXAMPLE.results);
  const [status, setStatus] = useState<Status>('idle');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 3) return;

    setStatus('loading');
    setSearched(text);
    try {
      const response = await fetch(`/api/hadith?q=${encodeURIComponent(text)}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { results: DorarEntry[] };
      setResults(payload.results);
      setStatus(payload.results.length === 0 ? 'empty' : 'idle');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="rounded-3xl border border-line bg-surface p-4 shadow-[var(--shadow-float)] md:p-5">
      <form
        action="https://dorar.net/hadith/search"
        method="get"
        target="_blank"
        onSubmit={handleSubmit}
        className="flex items-center gap-2 rounded-2xl bg-surface-2 p-1.5 focus-within:ring-2 focus-within:ring-gold/30"
      >
        <label htmlFor="hadith-query" className="sr-only">
          {t.hadithChecker.label}
        </label>
        <input
          id="hadith-query"
          lang="ar"
          dir={query ? 'auto' : undefined}
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.hadithChecker.placeholder}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[1rem] placeholder:text-faint focus:outline-none"
          minLength={3}
          maxLength={120}
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="h-10 shrink-0 rounded-xl bg-gold px-5 text-[0.95rem] font-semibold text-[#17160f] transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60"
        >
          {status === 'loading' ? t.hadithChecker.searching : t.hadithChecker.check}
        </button>
      </form>

      <div aria-live="polite" className="mt-3">
        {status === 'error' && (
          <p className="px-1 text-[0.95rem] text-muted">
            {t.hadithChecker.unreachable}{' '}
            <a href={dorarSearchUrl(searched)} target="_blank" rel="noopener noreferrer" className="text-gold-text underline underline-offset-4">
              {t.hadithChecker.openOnDorar}
            </a>
          </p>
        )}
        {status === 'empty' && (
          <p className="px-1 text-[0.95rem] text-muted">{t.hadithChecker.empty}</p>
        )}
        {(status === 'idle' || status === 'loading') && (
          <ul className={`space-y-2 transition-opacity ${status === 'loading' ? 'opacity-50' : ''}`}>
            {results.map((entry, index) => {
              // Dorar brackets words anywhere in a grade ("[فيه] أبو العاتكة لا يعرف…"); drop them all.
              const grade = entry.grade?.replace(/[[\]]/g, '').trim();
              const tone = grade ? gradeTone(entry.grade ?? '') : 'unclear';
              const { className: gradeClassName, Icon } = GRADE_STYLES[tone];
              return (
                <li key={`${entry.source}-${entry.number}-${index}`} className="rounded-2xl bg-surface-2 px-4 py-3">
                  <p lang="ar" dir="rtl" className="text-[1.02rem] leading-[1.9] font-medium">{entry.text}</p>
                  {/* The whole grade, never cut short: its last words can turn it ("…وليس لهذا الحديث أصل"). */}
                  {grade && (
                    <div lang="ar" dir="rtl" className="mt-2">
                      <p
                        data-grade-tone={tone}
                        className={`inline-flex max-w-full items-start gap-1.5 rounded-xl px-2.5 py-1 text-[0.85rem] leading-relaxed font-semibold ${gradeClassName}`}
                      >
                        <Icon size={14} strokeWidth={2.6} aria-hidden="true" className="mt-[0.3em] shrink-0" />
                        <span>{grade}</span>
                      </p>
                    </div>
                  )}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-[0.85rem] text-muted">
                    {entry.muhaddith && <>{t.hadithChecker.muhaddith} {entry.muhaddith} · </>}
                    {entry.link ? (
                      <a
                        href={entry.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t.hadithChecker.openNarration}
                        className="inline-flex items-center gap-1 text-gold-text underline decoration-gold/40 underline-offset-4 hover:decoration-gold"
                      >
                        {entry.source}
                        {entry.number && <> ({localizeDigits(entry.number, language)})</>}
                        <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                      </a>
                    ) : (
                      <>
                        {entry.source}
                        {entry.number && <> ({localizeDigits(entry.number, language)})</>}
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <a
          href={dorarSearchUrl(searched)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block px-1 text-[0.85rem] text-faint underline underline-offset-4 hover:text-text"
        >
          {t.hadithChecker.allResults}
        </a>
      </div>
    </div>
  );
};
