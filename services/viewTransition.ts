import { flushSync } from 'react-dom';

export type TransitionKind = 'theme' | 'language' | 'page';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Applies a visual change inside a view transition, so the page animates between the old and new
 * look instead of jumping. `origin` (viewport coordinates) is where the new theme spreads from.
 * Browsers without view transitions, and visitors who ask for less motion, get the change at once.
 */
export const runViewTransition = (kind: TransitionKind, update: () => void, origin?: { x: number; y: number }) => {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }

  const root = document.documentElement;
  root.dataset.transition = kind;
  // React must have painted the new state before the browser takes its "after" picture.
  const transition = doc.startViewTransition(() => flushSync(update));

  if (kind === 'theme' && origin) {
    void transition.ready.then(() => {
      const radius = Math.hypot(
        Math.max(origin.x, window.innerWidth - origin.x),
        Math.max(origin.y, window.innerHeight - origin.y)
      );
      root.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    });
  }

  void transition.finished.finally(() => {
    if (root.dataset.transition === kind) delete root.dataset.transition;
  });
};

/** The centre of the element that was clicked, keyboard presses included (they report 0,0). */
export const originOf = (event?: { currentTarget: EventTarget | null }) => {
  const target = event?.currentTarget;
  if (!(target instanceof Element)) return undefined;
  const rect = target.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
