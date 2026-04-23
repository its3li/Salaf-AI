import React from 'react';

interface HeaderProps {
  onToggleSidebar: () => void;
  onHomeClick: () => void;
  isFocusMode?: boolean;
  onToggleFocus?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onHomeClick, isFocusMode, onToggleFocus }) => {
  return (
    <header className="w-full sticky top-0 z-30 shrink-0 border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-md">
      <div className="w-full px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={isFocusMode ? onToggleFocus : onToggleSidebar}
            className={`${isFocusMode ? 'flex' : 'flex md:hidden'} text-[#E6E7EB] hover:text-[#D4AF37] transition-all p-2 rounded-xl hover:bg-[#D4AF37]/10 border border-transparent hover:border-[#D4AF37]/20`}
            aria-label="Toggle Menu"
            title="إظهار القائمة الجانبية"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isFocusMode ? (
                 <>
                   <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                   <line x1="9" y1="3" x2="9" y2="21"></line>
                 </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </>
              )}
            </svg>
          </button>

          <button
            className="flex items-center gap-3 select-none group rounded-2xl px-1.5 py-1 hover:bg-white/5 transition-all"
            onClick={onHomeClick}
            title="العودة للرئيسية"
            aria-label="العودة للرئيسية"
          >
            <div className="relative">
              <img
                src="https://i.postimg.cc/RhRmHpj2/1000000424.png"
                alt="Salaf AI Logo"
                width="40"
                height="40"
                className="relative h-10 w-10 object-contain"
              />
            </div>
            <h1 className="text-lg md:text-xl font-bold text-[#D4AF37] tracking-wide flex items-center gap-2">
              <span className="font-bold text-lg tracking-wide text-[#E8D499] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]">
                Salaf AI
              </span>
              <span className="hidden sm:inline text-white/30 text-sm font-normal">|</span>
              <span className="hidden sm:inline text-gray-400 text-base">باحث السلف</span>
            </h1>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/its3li/Salaf-AI"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-gray-300 transition-all"
            title="ادعم المشروع"
          >
            <span>ادعم المشروع</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
};
