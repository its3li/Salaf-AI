import { createContext, useContext } from 'react';
import { MESSAGES, type Messages } from './messages';
import { DEFAULT_LANGUAGE, type Language } from './languages';

export interface I18nValue {
  language: Language;
  /** The interface text in the current language. */
  t: Messages;
  setLanguage: (language: Language) => void;
}

// Components rendered without the provider (unit tests) get Arabic.
export const I18nContext = createContext<I18nValue>({
  language: DEFAULT_LANGUAGE,
  t: MESSAGES[DEFAULT_LANGUAGE],
  setLanguage: () => {},
});

export const useI18n = () => useContext(I18nContext);
