import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { I18nProvider } from './i18n/I18nProvider';
import { resolveInitialLanguage } from './i18n/languages';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Lets CSS hide entrance-animated content only when script is running to reveal it again.
document.documentElement.classList.add('js');

const root = ReactDOM.createRoot(rootElement);

// Waits for the language only on a first visit (a quick country lookup), so the page never flips language.
void resolveInitialLanguage().then((language) => {
  root.render(
    <React.StrictMode>
      <I18nProvider initialLanguage={language}>
        <App />
      </I18nProvider>
    </React.StrictMode>
  );
});
