import { registerSW } from 'virtual:pwa-register';

// The site works offline from a saved copy, so after each deploy the new version installs in the
// background while the page keeps running the old one. This moves people onto it without ever
// interrupting them: right away if it arrives just after opening and nothing has been started,
// otherwise the next time the app goes to the background with nothing in progress.

const SWITCH_RIGHT_AWAY_MS = 30_000;

/** True when reloading loses nothing: no typed question, no answer streaming, no clip being processed. */
const isIdle = () => {
  const question = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-textarea"]');
  const busy = document.querySelector('[data-testid="stop-generation"], [data-testid="media-pending"], [data-testid="app-dialog"]');
  return !question?.value.trim() && !busy;
};

export const watchForAppUpdates = () => {
  const openedAt = Date.now();
  let switchWhenHidden = false;

  registerSW({
    immediate: true,
    onNeedReload() {
      if (Date.now() - openedAt < SWITCH_RIGHT_AWAY_MS && isIdle()) window.location.reload();
      else switchWhenHidden = true;
    },
    onRegisteredSW(_url, registration) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (switchWhenHidden && isIdle()) window.location.reload();
          return;
        }
        // Installed apps can stay open for days; look for a new version whenever one comes back.
        void registration?.update();
      });
    },
  });
};
