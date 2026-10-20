import React, { useEffect, useRef } from 'react';
import { DialogOptions } from '../hooks/useAppDialog';
import { useI18n } from '../i18n/context';

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
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (options?.type === 'rename') inputRef.current?.focus();
        if (options?.type === 'feedback') textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen, options]);

  if (!isOpen || !options) return null;

  const isRename = options.type === 'rename';
  const isFeedback = options.type === 'feedback';
  const requiresInput = isRename || isFeedback;
  const isDestructive = options.type === 'confirm' || options.type === 'clearAll';

  const handleConfirm = () => {
    if (requiresInput) {
      if (!inputValue.trim()) return;
      onConfirm(inputValue.trim());
    } else {
      onConfirm();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
  };

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleConfirm();
  };

  return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div 
            className="absolute inset-0 bg-black/75"
            onClick={onCancel}
          />
          
          <div 
            role={isDestructive ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            data-testid="app-dialog"
            className="relative w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-float)] md:p-7 fade-up"
          >
            <h3 id="app-dialog-title" className="mb-2 text-[1.25rem] font-bold">
              {options.title}
            </h3>
            
            {options.message && (
              <p className="mb-6 whitespace-pre-line text-[0.98rem] leading-relaxed text-muted">
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
                  placeholder={t.dialogs.chatNamePlaceholder}
                  className="w-full rounded-xl bg-surface-2 px-4 py-3 text-[1rem] placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-gold/35"
                />
              </div>
            )}

            {isFeedback && (
              <div className="mb-6">
                <textarea
                  ref={textareaRef}
                  data-testid="dialog-feedback-input"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleFeedbackKeyDown}
                  placeholder={t.dialogs.feedbackPlaceholder}
                  className="min-h-32 w-full resize-y rounded-xl bg-surface-2 px-4 py-3 text-[1rem] placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-gold/35"
                />
              </div>
            )}

            <div className="flex gap-3 justify-end mt-4">
              {(options.type !== 'alert' || options.cancelText) && (
              <button
                type="button"
                onClick={onCancel}
                className="h-10 rounded-full px-5 text-[0.95rem] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {options.cancelText || t.dialogs.cancel}
              </button>
              )}
              <button
                type="button"
                autoFocus={!requiresInput}
                onClick={handleConfirm}
                data-testid="dialog-confirm"
                disabled={requiresInput && !inputValue.trim()}
                className={`h-10 rounded-full px-5 text-base font-semibold transition-opacity hover:opacity-85 ${
                  isDestructive
                    ? 'bg-danger text-white'
                    : 'bg-gold text-[#17160f] disabled:cursor-not-allowed disabled:opacity-40'
                }`}
              >
                {options.confirmText || t.dialogs.confirm}
              </button>
            </div>
          </div>
        </div>
  );
};
