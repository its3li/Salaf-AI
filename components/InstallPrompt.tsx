
import React, { useState, useEffect } from 'react';

interface InstallPromptProps {
  onInstall: () => void;
}

export const InstallPrompt: React.FC<InstallPromptProps> = ({ onInstall }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 1. Check if user has already seen this prompt
    const hasSeenPrompt = localStorage.getItem('salaf_ai_pwa_prompt_seen');
    if (hasSeenPrompt) return;

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
    <div className="fixed top-4 left-0 right-0 z-[100] flex justify-center px-4 animate-in fade-in slide-in-from-top-4 duration-700">
      <div className="bg-[#1E1E1E]/95 backdrop-blur-md border border-[#D4AF37] rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.2)] p-4 max-w-md w-full flex items-center justify-between gap-4">
        
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#D4AF37]/10 rounded-lg flex items-center justify-center border border-[#D4AF37]/30 shrink-0">
            <img 
              src="/logo.png" 
              alt="شعار Salaf AI" 
              className="w-8 h-8 object-contain"
            />
          </div>
          <div>
            <h4 className="text-[#D4AF37] font-bold text-sm">تطبيق باحث السلف</h4>
            <p className="text-gray-300 text-xs mt-0.5">ثبّت التطبيق لتجربة أسرع وأفضل</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              onInstall();
              setIsVisible(false);
            }}
            className="px-3 py-1.5 bg-[#D4AF37] text-[#121212] text-xs font-bold rounded-lg hover:bg-[#C5A028] transition-colors whitespace-nowrap"
            aria-label="تثبيت التطبيق"
          >
            تثبيت
          </button>
          <button 
            onClick={() => setIsVisible(false)}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
            aria-label="إغلاق تنبيه التثبيت"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

      </div>
    </div>
  );
};
