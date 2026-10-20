import React, { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useI18n } from '../i18n/context';

// Said in Arabic whatever the interface language.
const DHIKR_PHRASES = [
  'سبحان الله وبحمده',
  'الحمد لله',
  'لا إله إلا الله',
  'الله أكبر',
  'لا حول ولا قوة إلا بالله',
  'اللهم صلِّ على محمد ﷺ',
];

/**
 * Shown where the answer will appear while it is being prepared: a dhikr to say while waiting, and
 * each research step as it happens (checking a hadith, reading a source).
 */
export const ResearchCard: React.FC<{ steps: string[] }> = ({ steps }) => {
  const { t } = useI18n();
  const [dhikrIndex, setDhikrIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(
      () => setDhikrIndex((index) => (index + 1) % DHIKR_PHRASES.length),
      3200
    );
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div role="status" aria-live="polite" aria-label={t.research.preparing} className="mb-10 flex gap-3 fade-up">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line">
        <img src="/logo.png" alt="" width="22" height="22" className="h-[22px] w-[22px]" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <p key={dhikrIndex} lang="ar" className="shimmer-text fade-up text-[1.1rem] font-semibold">
          {DHIKR_PHRASES[dhikrIndex]}
        </p>
        <ol className="mt-2 space-y-1.5">
          {(steps.length > 0 ? steps : [t.research.defaultStep]).map((step, index, all) => {
            const isCurrent = index === all.length - 1;
            return (
              <li
                key={`${index}-${step}`}
                className={`flex items-center gap-2 text-[0.92rem] fade-up ${isCurrent ? 'text-muted' : 'text-faint'}`}
              >
                {isCurrent ? (
                  <LoaderCircle size={14} strokeWidth={2.4} className="shrink-0 text-faint motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Check size={14} strokeWidth={2.6} className="text-gold-text" aria-hidden="true" />
                )}
                {step}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};
