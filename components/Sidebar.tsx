import React, { useMemo, useState } from 'react';
import { PanelRight, Pencil, Search, SquarePen, Trash2, X } from 'lucide-react';
import { ChatSession } from '../types';
import { ChatQuota } from '../services/chatService';
import { Theme } from '../hooks/useTheme';
import { useI18n } from '../i18n/context';
import { SettingsMenu } from './SettingsMenu';

interface SidebarProps {
  isOpen: boolean;
  isFocusMode?: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenAbout: () => void;
  /** Opens the install guide; left out once the app runs installed. */
  onInstall?: () => void;
  chats: ChatSession[];
  activeChatId: string | null;
  quota: ChatQuota | null;
  theme: Theme;
  onToggleTheme: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (e: React.MouseEvent, id: string) => void;
  onRenameChat: (e: React.MouseEvent, id: string) => void;
  onClearAllChats: () => void;
  onExportChats: () => void;
  onImportChats: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleFocus?: () => void;
}

const DAY_MS = 86_400_000;

/** Groups conversations with messages by their last activity: today, yesterday, this week, earlier. */
const groupChats = (chats: ChatSession[]) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const groups: Array<{ period: 'today' | 'yesterday' | 'thisWeek' | 'older'; chats: ChatSession[] }> = [
    { period: 'today', chats: [] },
    { period: 'yesterday', chats: [] },
    { period: 'thisWeek', chats: [] },
    { period: 'older', chats: [] },
  ];
  for (const chat of chats) {
    if (chat.messages.length === 0) continue;
    const last = chat.messages.at(-1)?.timestamp.getTime() ?? chat.createdAt;
    const index = last >= today ? 0 : last >= today - DAY_MS ? 1 : last >= today - 6 * DAY_MS ? 2 : 3;
    groups[index].chats.push(chat);
  }
  return groups.filter((group) => group.chats.length > 0);
};

const DAILY_ALLOWANCE = 30;

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  isFocusMode,
  onClose,
  onNewChat,
  onOpenAbout,
  onInstall,
  chats,
  activeChatId,
  quota,
  theme,
  onToggleTheme,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onClearAllChats,
  onExportChats,
  onImportChats,
  onToggleFocus,
}) => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const query = search.trim();
    return groupChats(query ? chats.filter((chat) => chat.title.includes(query)) : chats);
  }, [chats, search]);

  const remaining = quota?.remaining ?? DAILY_ALLOWANCE;
  const limit = quota?.limit ?? DAILY_ALLOWANCE;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          isOpen && !isFocusMode ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed top-0 right-0 z-50 flex h-full flex-col overflow-hidden border-e border-line bg-surface transition-[width,opacity,transform] duration-300 ease-out md:relative ${
          isFocusMode
            ? 'pointer-events-none w-0 border-e-transparent opacity-0'
            : `w-[86vw] max-w-[300px] opacity-100 md:w-[272px] ${isOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`
        }`}
      >
        <div className="flex h-full w-[86vw] max-w-[300px] flex-col md:w-[272px]">
          <div className="flex h-14 shrink-0 items-center justify-between px-3">
            <div className="flex items-center gap-2 ps-1">
              <img src="/logo.png" alt="" width="28" height="28" className="h-7 w-7" />
              <span className="text-[1.05rem] font-bold">{t.appName}</span>
            </div>
            <button
              type="button"
              onClick={onToggleFocus}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-text md:flex"
              aria-label={t.sidebar.hide}
              title={t.sidebar.hide}
            >
              <PanelRight size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-text md:hidden"
              aria-label={t.sidebar.close}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2 px-3 pb-3">
            <button
              type="button"
              onClick={onNewChat}
              className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-[0.95rem] font-medium transition-colors hover:bg-surface-2"
            >
              <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
              {t.sidebar.newChat}
            </button>
            <label className="flex h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-faint focus-within:ring-2 focus-within:ring-gold/30">
              <Search size={16} strokeWidth={2} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t.sidebar.search}
                className="min-w-0 flex-1 bg-transparent text-[0.9rem] text-text placeholder:text-faint focus:outline-none"
                aria-label={t.sidebar.search}
              />
            </label>
          </div>

          <nav className="flex-1 overflow-y-auto px-2" aria-label={t.sidebar.conversations}>
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-[0.9rem] text-faint">
                {search.trim() ? t.sidebar.noMatches : t.sidebar.empty}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.period} className="mb-3">
                  <p className="px-3 pb-1 pt-2 text-[0.78rem] font-semibold text-faint">{t.sidebar[group.period]}</p>
                  <ul className="space-y-0.5">
                    {group.chats.map((chat) => {
                      const isActive = activeChatId === chat.id;
                      return (
                        <li
                          key={chat.id}
                          className={`group relative flex items-center rounded-xl transition-colors ${
                            isActive ? 'bg-surface-3' : 'hover:bg-surface-2'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectChat(chat.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`h-10 min-w-0 flex-1 truncate px-3 text-right text-[0.92rem] ${
                              isActive ? 'font-medium text-text' : 'text-muted group-hover:text-text'
                            }`}
                          >
                            {chat.title}
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5 pe-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onRenameChat(e, chat.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface hover:text-text"
                              title={t.sidebar.rename}
                              aria-label={t.sidebar.rename}
                            >
                              <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onDeleteChat(e, chat.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface hover:text-danger"
                              title={t.sidebar.delete}
                              aria-label={t.sidebar.delete}
                            >
                              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </nav>

          <SettingsMenu
            remaining={remaining}
            limit={limit}
            theme={theme}
            onToggleTheme={onToggleTheme}
            onOpenAbout={onOpenAbout}
            onInstall={onInstall}
            onExportChats={onExportChats}
            onImportChats={onImportChats}
            onClearAllChats={() => {
              if (chats.some((chat) => chat.messages.length > 0)) onClearAllChats();
            }}
          />
        </div>
      </aside>
    </>
  );
};
