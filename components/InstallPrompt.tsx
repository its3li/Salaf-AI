
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { isRunningAsInstalledApp } from '../hooks/usePwaInstall';
import { useI18n } from '../i18n/context';

interface InstallPromptProps {
  onInstall: () => void;
}

export const InstallPrompt: React.FC<InstallPromptProps> = ({ onInstall }) => {
  const { t } = useI18n();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 1. Check if user has already seen this prompt
    const hasSeenPrompt = localStorage.getItem('salaf_ai_pwa_prompt_seen');
    if (hasSeenPrompt || isRunningAsInstalledApp()) return;

    // 2. Set timer for 15 seconds
    const timer = setTimeout(() => {
      setIsVisible(true);
      // Mark as seen immediately so it doesn't show on reload even if they don't click
      localStorage.setItem('salaf_ai_pwa_prompt_seen', 'true');
    }, 15000);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-0 right-0 z-[100] flex justify-center px-4 fade-up">
      <div className="frosted flex w-full max-w-md items-center justify-between gap-4 rounded-2xl border border-line p-4 shadow-[var(--shadow-float)]">
        
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center">
            <img 
              src="/logo.png" 
              alt={t.install.logoAlt} 
              className="w-8 h-8 object-contain"
            />
          </div>
          <div>
            <h4 className="text-[1rem] font-bold">{t.install.title}</h4>
            <p className="text-[0.88rem] text-muted">{t.install.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              onInstall();
              setIsVisible(false);
            }}
            className="h-9 whitespace-nowrap rounded-full bg-gold px-4 text-[0.9rem] font-semibold text-[#17160f] transition-transform hover:scale-[1.03]"
            aria-label={t.install.installLabel}
          >
            {t.install.install}
          </button>
          <button 
            onClick={() => setIsVisible(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text"
            aria-label={t.install.dismiss}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

      </div>
    </div>
  );
};
