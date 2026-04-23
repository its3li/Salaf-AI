import React, { useEffect, useRef } from 'react';
import { DialogOptions } from '../hooks/useAppDialog';

interface CustomDialogProps {
  isOpen: boolean;
  options: DialogOptions | null;
  inputValue: string;
  setInputValue: (val: string) => void;
  onConfirm: (val?: string) => void;
  onCancel: () => void;
}

export const CustomDialog: React.FC<CustomDialogProps> = ({
  isOpen,
  options,
  inputValue,
  setInputValue,
  onConfirm,
  onCancel
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && options?.type === 'rename') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, options]);

  if (!isOpen || !options) return null;

  const isRename = options.type === 'rename';
  const isDestructive = options.type === 'confirm' || options.type === 'clearAll';

  const handleConfirm = () => {
    if (isRename) {
      if (!inputValue.trim()) return;
      onConfirm(inputValue.trim());
    } else {
      onConfirm();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onCancel();
  };

  return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onCancel}
          />
          
          <div 
            role="dialog"
            className="relative w-full max-w-md bg-[#111111] border border-white/10 rounded-xl shadow-lg p-6 md:p-8 transform transition-all animate-in zoom-in-95"
          >
            <h3 className="text-xl font-semibold text-[#EAEAEA] mb-3">{options.title}</h3>
            
            {options.message && (
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                {options.message}
              </p>
            )}

            {isRename && (
              <div className="mb-6">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="اسم المحادثة..."
                  className="w-full bg-[#0A0A0A] border border-white/10 text-[#EAEAEA] rounded-lg px-4 py-3 focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
                />
              </div>
            )}

            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={onCancel}
                className="px-5 py-2.5 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium transition-colors"
              >
                {options.cancelText || 'إلغاء'}
              </button>
              <button
                onClick={handleConfirm}
                disabled={isRename && !inputValue.trim()}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm ${
                  isDestructive 
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-[#D4AF37] text-black hover:bg-[#E5C048] disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {options.confirmText || 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
  );
};
