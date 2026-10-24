import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { I18nContext } from './context';
import { MESSAGES } from './messages';
import { storeLanguage, textDirection, type Language } from './languages';
import { runViewTransition } from '../services/viewTransition';

export const I18nProvider: React.FC<{ initialLanguage: Language; children: React.ReactNode }> = ({
  initialLanguage,
  children,
}) => {
  const [language, setLanguageState] = useState(initialLanguage);

  // Before the first paint, so an English page never shows a frame laid out right to left. Screen
  // readers and fonts also pick the right shaping and voice from `lang`.
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = textDirection(language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    storeLanguage(next);
    runViewTransition('language', () => setLanguageState(next));
  }, []);

  const value = useMemo(() => ({ language, t: MESSAGES[language], setLanguage }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};
