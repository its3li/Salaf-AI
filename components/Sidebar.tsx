import React from 'react';
import { ChatSession } from '../types';

interface SidebarProps {
  isOpen: boolean;
  isFocusMode?: boolean;
  onClose: () => void;
  onNewChat: () => void;
  chats: ChatSession[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onDeleteChat: (e: React.MouseEvent, id: string) => void;
  onRenameChat: (e: React.MouseEvent, id: string) => void;
  onClearAllChats: () => void;
  onExportChats: () => void;
  onImportChats: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleFocus?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  isFocusMode,
  onClose,
  onNewChat,
  chats,
  activeChatId,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onClearAllChats,
  onExportChats,
  onImportChats,
  onToggleFocus,
}) => {
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300 ${
          isOpen && !isFocusMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <aside
        className={`
          fixed md:relative top-0 right-0 h-full z-50
          border-l border-[#D4AF37]/10 bg-[#0A0A0A]/95
          flex flex-col shadow-sm overflow-hidden
          transition-[width,min-width,opacity,transform] duration-300 ease-out
          ${
            isFocusMode
              ? 'w-0 min-w-0 opacity-0 border-l-transparent pointer-events-none'
              : `w-[280px] md:w-[320px] opacity-100 ${
                  isOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
                }`
          }
        `}
      >
        <div className="flex flex-col h-full w-[280px] md:w-[320px] p-4 md:p-5 transition-opacity duration-300">
          <div className="flex justify-between items-center mb-5 pb-4 border-b border-white/10">
            <span className="text-[#D4AF37] font-semibold text-lg">المحادثات</span>
            <div className="flex gap-1.5 items-center">
              {onToggleFocus && (
                <button
                  onClick={onToggleFocus}
                  className="hidden md:flex text-gray-500 hover:text-[#D4AF37] transition-all p-1.5 rounded-lg border border-transparent hover:border-[#D4AF37]/20 hover:bg-[#D4AF37]/10"
                  aria-label="وضع التركيز للقراءة"
                  title="إخفاء القائمة الجانبية (وضع التركيز)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                  </svg>
                </button>
              )}
              <button
                onClick={onClose}
                className="md:hidden text-[#D4AF37]/60 hover:text-[#D4AF37] transition-colors p-1.5 rounded-lg hover:bg-[#D4AF37]/10 border border-transparent"
                aria-label="إغلاق القائمة"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <button
            onClick={onNewChat}
            className="w-full py-2.5 px-4 mb-5 rounded-lg border border-[#D4AF37]/30 text-[#D4AF37] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 hover:border-[#D4AF37]/50 transition-colors duration-200 flex items-center justify-center gap-2 font-medium"
            aria-label="محادثة جديدة"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>محادثة جديدة</span>
          </button>

          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-xs text-[#D4AF37]/60">السجل</p>
            <p className="text-xs text-[#D4AF37]/40">{chats.length} محادثة</p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {chats.length === 0 ? (
              <div className="text-center text-[#D4AF37]/60 text-sm py-8 border border-dashed border-[#D4AF37]/20 rounded-2xl">
                لا توجد محادثات بعد
              </div>
            ) : (
              chats.map((chat) => {
                const isActive = activeChatId === chat.id;
                return (
                  <div
                    key={chat.id}
                    onClick={() => onSelectChat(chat.id)}
                    className={`group relative cursor-pointer rounded-lg px-3 py-2.5 border transition-all duration-200 flex items-center gap-2
                      ${
                        isActive
                          ? 'border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#D4AF37] shadow-[0_0_20px_rgba(212,175,55,0.1)]'
                          : 'border-transparent text-gray-400 hover:bg-[#D4AF37]/5 hover:text-gray-200'
                      }
                    `}
                  >
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
                      className={`shrink-0 ${isActive ? 'text-[#D4AF37]' : 'opacity-80'}`}
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span className="truncate flex-1 text-sm font-medium">{chat.title}</span>

                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRenameChat(e, chat.id);
                        }}
                        className={`p-1.5 rounded-md transition-all duration-200 ${
                          isActive
                            ? 'text-[#D4AF37] hover:bg-[#D4AF37]/20'
                            : 'text-gray-400 hover:text-[#D4AF37] hover:bg-[#D4AF37]/10'
                        }`}
                        title="إعادة تسمية المحادثة"
                        aria-label="Rename chat"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onDeleteChat(e, chat.id);
                        }}
                        className={`p-1.5 rounded-md transition-all duration-200 ${
                          isActive
                            ? 'text-red-300 hover:bg-red-500/30 hover:text-red-200'
                            : 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                        }`}
                        title="حذف المحادثة"
                        aria-label="Delete chat"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-[#D4AF37]/15 flex flex-col gap-2 relative">
            <div className="flex justify-center gap-3 text-xs text-[#D4AF37]/50">
              <button
                onClick={() => {
                  if (chats.length > 0) onClearAllChats();
                }}
                className="hover:text-red-400 transition-colors"
                title="مسح كل المحادثات"
              >
                مسح الكل
              </button>
              <span>•</span>
              <button
                onClick={onExportChats}
                className="hover:text-[#D4AF37] transition-colors"
                title="تصدير المحادثات لملف احتياطي"
              >
                تصدير
              </button>
              <span>•</span>
              <label
                className="cursor-pointer hover:text-[#D4AF37] transition-colors"
                title="استيراد المحادثات من ملف"
              >
                استيراد
                <input type="file" accept=".json" className="hidden" onChange={onImportChats} />
              </label>
            </div>
            <p className="text-[#D4AF37]/30 text-[11px] text-center mt-2.5">{`© ${new Date().getFullYear()} Salaf AI`}</p>
          </div>
        </div>
      </aside>
    </>
  );
};
