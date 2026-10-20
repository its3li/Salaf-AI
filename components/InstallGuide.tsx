import React, { useEffect, useState } from 'react';
import { Apple, Check, Download, Monitor, Smartphone, Terminal, X } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { formatNumber } from '../services/format';
import { INSTALL_PLATFORMS, detectInstallPlatform, type InstallPlatform } from '../hooks/usePwaInstall';

interface InstallGuideProps {
  isOpen: boolean;
  isInstalled: boolean;
  canPromptInstall: boolean;
  onPromptInstall: () => void;
  onClose: () => void;
}

const PLATFORM_ICONS: Record<InstallPlatform, typeof Smartphone> = {
  ios: Apple,
  android: Smartphone,
  windows: Monitor,
  mac: Apple,
  linux: Terminal,
};

/** How to install the app on each kind of device, opened at the visitor's own. */
export const InstallGuide: React.FC<InstallGuideProps> = ({
  isOpen,
  isInstalled,
  canPromptInstall,
  onPromptInstall,
  onClose,
}) => {
  const { t, language } = useI18n();
  const guide = t.installGuide;
  const [platform, setPlatform] = useState<InstallPlatform>(detectInstallPlatform);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const steps = guide.platforms[platform];

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm fade-up" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
        className="relative w-full max-w-lg rounded-t-[2rem] border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] sm:rounded-[2rem] sm:p-6 rise"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={guide.close}
          className="absolute top-4 end-4 flex h-9 w-9 items-center justify-center rounded-full text-faint transition-all hover:bg-surface-2 hover:text-text active:scale-90"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="mb-5 flex items-center gap-3 pe-10">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2">
            <img src="/logo.png" alt="" width="34" height="34" className="h-[34px] w-[34px]" />
          </div>
          <div>
            <h2 id="install-guide-title" className="text-[1.2rem] font-bold">
              {guide.title}
            </h2>
            <p className="text-[0.9rem] leading-relaxed text-muted">{guide.intro}</p>
          </div>
        </div>

        {isInstalled ? (
          <p className="flex items-center gap-2 rounded-2xl bg-gold-soft px-4 py-3 text-[0.95rem] text-gold-text">
            <Check size={18} strokeWidth={2.4} aria-hidden="true" />
            {guide.installed}
          </p>
        ) : (
          <>
            {canPromptInstall && (
              <button
                type="button"
                onClick={onPromptInstall}
                data-testid="install-now"
                className="mb-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-[1rem] font-semibold text-[#17160f] shadow-[0_10px_30px_-12px_rgba(212,175,55,0.8)] transition-transform hover:scale-[1.01] active:scale-[0.98]"
              >
                <Download size={18} strokeWidth={2.2} aria-hidden="true" />
                {guide.installNow}
              </button>
            )}

            <div role="tablist" aria-label={guide.title} className="mb-4 grid grid-cols-5 gap-1 rounded-2xl bg-surface-2 p-1">
              {INSTALL_PLATFORMS.map((item) => {
                const Icon = PLATFORM_ICONS[item];
                const isActive = item === platform;
                return (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setPlatform(item)}
                    className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[0.72rem] font-medium leading-tight transition-all ${
                      isActive ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                    }`}
                  >
                    <Icon size={17} strokeWidth={2} aria-hidden="true" />
                    {guide.platforms[item].name}
                  </button>
                );
              })}
            </div>

            <ol key={platform} role="tabpanel" className="space-y-2.5">
              {steps.steps.map((step, index) => (
                <li
                  key={step}
                  className="rise flex items-start gap-3 text-[0.95rem] leading-relaxed"
                  style={{ '--d': `${index * 70}ms` } as React.CSSProperties}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-soft text-[0.78rem] font-bold text-gold-text">
                    {formatNumber(index + 1, language)}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-[0.82rem] leading-relaxed text-faint">{guide.offlineNote}</p>
          </>
        )}
      </section>
    </div>
  );
};
