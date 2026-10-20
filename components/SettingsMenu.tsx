import React, { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Download, FileDown, FileUp, Heart, Info, Languages, Moon, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { LANGUAGES } from '../i18n/languages';
import { formatNumber } from '../services/format';
import type { Theme } from '../hooks/useTheme';

interface SettingsMenuProps {
  remaining: number;
  limit: number;
  theme: Theme;
  onToggleTheme: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenAbout: () => void;
  onInstall?: () => void;
  onExportChats: () => void;
  onImportChats: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearAllChats: () => void;
}

const RING_RADIUS = 15;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Today's remaining questions as a ring that empties as they are used. */
const QuotaRing: React.FC<{ remaining: number; limit: number; label: string }> = ({ remaining, limit, label }) => {
  const share = Math.max(0, Math.min(1, remaining / limit));
  const isLow = remaining <= 3;
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={RING_RADIUS} fill="none" strokeWidth="3" className="stroke-surface-3" />
        <circle
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - share)}
          className={`transition-[stroke-dashoffset] duration-700 ${isLow ? 'stroke-danger' : 'stroke-gold'}`}
        />
      </svg>
      <span className="text-[0.78rem] font-bold tabular-nums">{label}</span>
    </span>
  );
};

const itemClass =
  'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[0.9rem] text-text transition-colors hover:bg-surface-2';

/**
 * The sidebar's footer: today's questions at a glance, and a menu with everything else
 * (appearance, language, install, about, backups, support).
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  remaining,
  limit,
  theme,
  onToggleTheme,
  onOpenAbout,
  onInstall,
  onExportChats,
  onImportChats,
  onClearAllChats,
}) => {
  const { t, language, setLanguage } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Outside the menu so a backup can be picked (and tested) without opening it.
  const importInputRef = useRef<HTMLInputElement>(null);
  const format = (value: number) => formatNumber(value, language);

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

  const runAndClose = (action: () => void) => () => {
    setIsOpen(false);
    action();
  };

  const openImportPicker = () => {
    setIsOpen(false);
    importInputRef.current?.click();
  };

  return (
    <div ref={rootRef} className="relative shrink-0 border-t border-line p-2">
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={onImportChats}
        data-testid="import-chats"
      />

      {isOpen && (
        <div
          role="menu"
          aria-label={t.sidebar.settings}
          className="menu-up absolute inset-x-2 bottom-full z-50 mb-2 rounded-2xl border border-line bg-surface p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)]"
        >
          <button type="button" role="menuitemcheckbox" aria-checked={theme === 'dark'} onClick={onToggleTheme} className={itemClass}>
            <Moon size={17} strokeWidth={1.9} className="text-muted" aria-hidden="true" />
            <span className="flex-1 text-start">{t.header.darkMode}</span>
            <span
              className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${theme === 'dark' ? 'bg-gold' : 'bg-surface-3'}`}
              aria-hidden="true"
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-300 ${
                  theme === 'dark' ? 'start-[1.125rem]' : 'start-0.5'
                }`}
              />
            </span>
          </button>

          <div className="px-3 pt-2 pb-1">
            <p className="mb-2 flex items-center gap-3 text-[0.9rem]">
              <Languages size={17} strokeWidth={1.9} className="text-muted" aria-hidden="true" />
              {t.sidebar.language}
            </p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
              {LANGUAGES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.code === language}
                  lang={item.code}
                  onClick={() => setLanguage(item.code)}
                  className={`h-8 rounded-lg text-[0.85rem] font-medium transition-all ${
                    item.code === language ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="my-1.5 h-px bg-line" />

          {onInstall && (
            <button type="button" role="menuitem" onClick={runAndClose(onInstall)} data-testid="open-install-guide" className={itemClass}>
              <Download size={17} strokeWidth={1.9} className="text-muted" aria-hidden="true" />
              {t.sidebar.install}
            </button>
          )}
          <button type="button" role="menuitem" onClick={runAndClose(onOpenAbout)} className={itemClass}>
            <Info size={17} strokeWidth={1.9} className="text-muted" aria-hidden="true" />
            {t.sidebar.about}
          </button>
          <button type="button" role="menuitem" onClick={runAndClose(onExportChats)} data-testid="export-chats" className={itemClass}>
            <FileDown size={17} strokeWidth={1.9} className="text-muted" aria-hidden="true" />
            {t.sidebar.export}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={openImportPicker}
            className={itemClass}
          >
            <FileUp size={17} strokeWidth={1.9} className="text-muted" aria-hidden="true" />
            {t.sidebar.import}
          </button>

          <div className="my-1.5 h-px bg-line" />

          <a
            href="https://ko-fi.com/its3li"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className={`${itemClass} group`}
          >
            <Heart size={17} strokeWidth={0} fill="currentColor" className="heartbeat" aria-hidden="true" />
            <span className="flex-1">{t.sidebar.support}</span>
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={runAndClose(onClearAllChats)}
            className={`${itemClass} text-danger hover:bg-danger-soft`}
          >
            <Trash2 size={17} strokeWidth={1.9} aria-hidden="true" />
            {t.sidebar.clearAll}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid="settings-menu"
        className={`flex w-full items-center gap-3 rounded-xl p-2 text-start transition-colors hover:bg-surface-2 ${
          isOpen ? 'bg-surface-2' : ''
        }`}
      >
        <QuotaRing remaining={remaining} limit={limit} label={format(remaining)} />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9rem] font-semibold">{t.sidebar.questionsToday}</span>
          <span className="block truncate text-[0.78rem] text-faint">{t.sidebar.remaining(format(remaining), format(limit))}</span>
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.9} className="shrink-0 text-faint" aria-hidden="true" />
      </button>
    </div>
  );
};
