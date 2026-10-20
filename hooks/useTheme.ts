import { useCallback, useState } from 'react';
import { originOf, runViewTransition } from '../services/viewTransition';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'salaf-ai-theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#0b0b0c', light: '#faf9f6' };

const readTheme = (): Theme =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

/** Dark/light switch. index.html applies the saved (or device) theme before first paint. */
export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  /** Pass the click event so the new theme spreads out from the switch that was pressed. */
  const toggleTheme = useCallback((event?: { currentTarget: EventTarget | null }) => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    runViewTransition(
      'theme',
      () => {
        // Swap colours in one frame; otherwise every element with a colour transition fades on its own.
        root.classList.add('theme-switching');
        root.dataset.theme = next;
        setTheme(next);
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
      },
      originOf(event)
    );
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[next]);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice simply won't persist.
    }
  }, []);

  return { theme, toggleTheme };
};
