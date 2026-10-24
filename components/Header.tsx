import React from 'react';
import { Menu, Moon, SquarePen, Sun } from 'lucide-react';
import { Theme } from '../hooks/useTheme';
import { useI18n } from '../i18n/context';
import { LanguageMenu } from './LanguageMenu';

interface HeaderProps {
  title: string;
  /** Hidden on the home screen, which already is a new question. */
  showNewChat?: boolean;
  theme?: Theme;
  onToggleTheme?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  isFocusMode?: boolean;
  onToggleFocus?: () => void;
}

const iconButton =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-all hover:bg-surface-2 hover:text-text active:scale-90';

/** Frosted top bar: the conversation being read, a new question, the language and the theme. */
export const Header: React.FC<HeaderProps> = ({
  title,
  showNewChat = true,
  theme,
  onToggleTheme,
  onToggleSidebar,
  onNewChat,
  isFocusMode,
  onToggleFocus,
}) => {
  const { t } = useI18n();
  const themeLabel = theme === 'dark' ? t.header.lightMode : t.header.darkMode;

  return (
    <header className="frosted sticky top-0 z-30 w-full shrink-0">
      <div className="flex h-14 items-center gap-1.5 px-2 md:px-4">
        <button
          type="button"
          onClick={isFocusMode ? onToggleFocus : onToggleSidebar}
          data-testid="toggle-sidebar"
          className={`${isFocusMode ? 'flex' : 'flex md:hidden'} ${iconButton}`}
          aria-label={isFocusMode ? t.header.showSidebar : t.header.openMenu}
        >
          <Menu size={20} strokeWidth={1.9} aria-hidden="true" />
        </button>

        <p className="min-w-0 flex-1 truncate px-1 text-[1rem] font-semibold"><span dir="auto">{title}</span></p>

        <LanguageMenu />

        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            className={iconButton}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === 'dark' ? (
              <Sun size={18} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Moon size={18} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        )}

        {showNewChat && (
          <button type="button" onClick={onNewChat} className={iconButton} aria-label={t.header.newQuestion} title={t.header.newQuestion}>
            <SquarePen size={19} strokeWidth={1.9} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
};
