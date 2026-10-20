import React, { useEffect, useRef, useState } from 'react';
import { Check, Languages } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { LANGUAGES } from '../i18n/languages';

/** Globe-style button that opens the list of interface languages, each written in its own script. */
export const LanguageMenu: React.FC = () => {
  const { language, setLanguage, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t.languageMenu}
        title={t.languageMenu}
        data-testid="language-menu"
        className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-muted transition-all hover:bg-surface-2 hover:text-text active:scale-95"
      >
        <Languages size={18} strokeWidth={1.9} aria-hidden="true" />
        <span className="hidden text-[0.85rem] font-medium sm:inline">{current.name}</span>
      </button>

      {isOpen && (
        <ul
          role="menu"
          aria-label={t.languageMenu}
          className="absolute end-0 top-full z-50 mt-2 min-w-40 rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.45)] pop-in"
        >
          {LANGUAGES.map((item) => (
            <li key={item.code} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={item.code === language}
                lang={item.code}
                onClick={() => {
                  setLanguage(item.code);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-[0.95rem] transition-colors hover:bg-surface-2"
              >
                {item.name}
                {item.code === language && <Check size={16} strokeWidth={2.4} className="text-gold-text" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
