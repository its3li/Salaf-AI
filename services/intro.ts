const INTRO_KEY = 'salaf-ai-intro-played';

/** Whether this visit opens with the intro: once per browser session, never for reduced motion or automation. */
export const shouldPlayIntro = () => {
  try {
    if (navigator.webdriver) return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    return sessionStorage.getItem(INTRO_KEY) !== '1';
  } catch {
    return false;
  }
};

export const markIntroPlayed = () => {
  try {
    sessionStorage.setItem(INTRO_KEY, '1');
  } catch {
    // It simply plays again next time.
  }
};
