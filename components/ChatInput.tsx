import React, { useLayoutEffect, useRef, useState } from 'react';

import { Attachment } from '../types';

interface ChatInputProps {
  onSend: (text: string, attachment?: Attachment) => void;
  onStop: () => void;
  canStop: boolean;
  isLoading: boolean;
  input: string;
  setInput: (text: string) => void;
}

const MIN_TEXTAREA_HEIGHT = 44;
const MAX_TEXTAREA_HEIGHT = 72;

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onStop, canStop, isLoading, input, setInput }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachment, setAttachment] = useState<Attachment | undefined>(undefined);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && !attachment) || isLoading) return;

    onSend(input, attachment);
    setInput('');
    setAttachment(undefined);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachment({
        name: file.name,
        mimeType: file.type,
        data: reader.result as string,
      });
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = () => {
    setAttachment(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full bg-transparent px-4 pb-6 pt-2 md:px-6 md:pb-8 shrink-0 z-20">
      <div className="max-w-3xl mx-auto flex flex-col gap-2">
        {attachment && (
          <div className="flex items-center gap-3 bg-[#1E1E1E] border border-[#333] rounded-xl p-2 pl-4 w-fit animate-in fade-in slide-in-from-bottom-2 shadow-lg mx-1 mb-1">
            <div className="relative w-10 h-10 bg-black/30 rounded-lg overflow-hidden flex items-center justify-center border border-[#333]">
              {attachment.mimeType.startsWith('image/') ? (
                <img src={attachment.data} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              )}
            </div>
            <div className="flex flex-col max-w-[120px]">
              <span className="text-xs text-[#E0E0E0] truncate font-medium">{attachment.name}</span>
              <span className="text-[10px] text-gray-500 uppercase">{attachment.mimeType.split('/')[1]}</span>
            </div>
            <button
              onClick={removeAttachment}
              className="p-1 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg transition-colors ml-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        )}

        <div className="relative flex items-end gap-2 bg-[#0F131B]/90 border border-white/10 shadow-[0_12px_30px_rgba(0,0,0,0.35)] rounded-[22px] p-2 transition-all duration-300 focus-within:border-[#D4AF37]/60 focus-within:shadow-[0_0_20px_rgba(212,175,55,0.18)]">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 text-white/60 hover:text-[#D4AF37] hover:bg-white/10 shrink-0 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="إرفاق ملف"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*,application/pdf"
          />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={attachment ? 'أضف تعليقاً...' : 'اسأل هنا وفق منهج السلف...'}
            className="w-full bg-transparent text-[#F1F2F4] px-2 py-2 resize-none focus:outline-none placeholder:text-white/40 text-base leading-6 overflow-y-auto [&::-webkit-scrollbar]:hidden"
            style={{ minHeight: `${MIN_TEXTAREA_HEIGHT}px`, maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
            rows={1}
            disabled={isLoading}
          />

          {canStop ? (
            <button
              onClick={onStop}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30"
              title="إيقاف الرد"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
              </svg>
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              disabled={(!input.trim() && !attachment) || isLoading}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ${
                (!input.trim() && !attachment) || isLoading
                  ? 'bg-white/10 cursor-not-allowed text-gray-500'
                  : 'bg-gradient-to-b from-[#D4AF37] to-[#C89D2F] hover:brightness-105 text-[#121212] shadow-lg shadow-[#D4AF37]/30'
              }`}
              title="إرسال"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-[#121212] border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
