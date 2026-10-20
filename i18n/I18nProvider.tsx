import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nContext } from './context';
import { MESSAGES } from './messages';
import { storeLanguage, type Language } from './languages';
import { runViewTransition } from '../services/viewTransition';

export const I18nProvider: React.FC<{ initialLanguage: Language; children: React.ReactNode }> = ({
  initialLanguage,
  children,
}) => {
  const [language, setLanguageState] = useState(initialLanguage);

  useEffect(() => {
    // Screen readers and fonts pick the right shaping and voice from it; all three languages are right to left.
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    storeLanguage(next);
    runViewTransition('language', () => setLanguageState(next));
  }, []);

  const value = useMemo(() => ({ language, t: MESSAGES[language], setLanguage }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};
