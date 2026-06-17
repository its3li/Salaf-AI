import React from 'react';

interface HeaderProps {
  onToggleSidebar: () => void;
  onHomeClick: () => void;
  isFocusMode?: boolean;
  onToggleFocus?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onHomeClick,
  isFocusMode,
  onToggleFocus,
}) => {
  return (
    <header className="w-full sticky top-0 z-30 shrink-0 border-b border-[#D4AF37]/10 bg-[#0A0A0A]/80 backdrop-blur-md">
      <div className="w-full px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={isFocusMode ? onToggleFocus : onToggleSidebar}
            className={`${isFocusMode ? 'flex' : 'flex md:hidden'} text-[#E6E7EB] hover:text-[#D4AF37] transition-all p-2 rounded-xl hover:bg-[#D4AF37]/10 border border-transparent hover:border-[#D4AF37]/20`}
            aria-label={isFocusMode ? 'إظهار القائمة الجانبية' : 'فتح القائمة الجانبية'}
            title="إظهار القائمة الجانبية"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
                src="/logo.png"
                alt="شعار Salaf AI"
                width="40"
                height="40"
                className="relative h-10 w-10 object-contain"
              />
            </div>
            <h1 className="text-lg md:text-xl font-bold text-[#D4AF37] tracking-wide flex items-center gap-2">
              <span>Salaf AI</span>
              <span className="hidden sm:inline text-white/30 text-sm font-normal">|</span>
              <span className="hidden sm:inline text-gray-400 text-base">باحث السلف</span>
            </h1>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://ko-fi.com/its3li"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#D4AF37]/25 text-[#D4AF37] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 hover:text-[#E5C048] transition-all duration-200 text-sm font-medium"
          >
            <span className="hidden sm:inline">ادعم المشروع</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
};
