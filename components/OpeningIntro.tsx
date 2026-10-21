import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import { markIntroPlayed } from '../services/intro';

/*
 * The opening: the logo's own network assembles itself. Its points light up outward from the
 * book's spine, the lines between them draw in, the logo settles exactly over that drawing, the
 * name is written right to left, and the logo then travels to its place on the page while the
 * interface rises around it. Points and lines were measured from public/logo.png (512x512).
 */

const NODES: Array<[number, number]> = [
  [113.3, 102], [397.6, 101.9], [66.9, 153.9], [444, 154], [255.7, 182.8], [181, 186.1], [330.4, 186],
  [397.9, 213.5], [112.7, 213.9], [183.4, 234.6], [327.6, 234.6], [164.3, 256.5], [346.9, 256.4],
  [200.1, 276.1], [310.6, 276.1], [255.5, 285.5], [113.9, 316.6], [396.9, 316.8], [89.5, 338.6],
  [420.9, 338.5], [67.4, 361.9], [443.5, 361.9], [255.5, 389.5],
];

const EDGES: Array<[number, number]> = [
  [0, 5], [0, 8], [0, 9], [1, 6], [1, 7], [1, 10], [2, 20], [3, 21], [4, 5], [4, 6], [4, 9], [4, 10],
  [4, 15], [5, 8], [5, 15], [6, 7], [6, 15], [7, 12], [7, 17], [8, 11], [8, 16], [9, 11], [9, 13],
  [9, 15], [10, 12], [10, 14], [10, 15], [11, 13], [11, 16], [12, 14], [12, 17], [13, 16], [13, 22],
  [14, 17], [14, 22], [15, 22],
];

const SPINE = 22;
const START_MS = 220;
const STEP_MS = 150;
const EXIT_AT_MS = 2450;

/** How many steps each point is from the spine; the outer page edges, not linked to it, come last. */
const depths = (() => {
  const result = new Array<number>(NODES.length).fill(-1);
  result[SPINE] = 0;
  const queue = [SPINE];
  while (queue.length) {
    const node = queue.shift() as number;
    for (const [a, b] of EDGES) {
      const next = a === node ? b : b === node ? a : -1;
      if (next >= 0 && result[next] < 0) {
        result[next] = result[node] + 1;
        queue.push(next);
      }
    }
  }
  const deepest = Math.max(...result);
  return result.map((depth) => (depth < 0 ? deepest : depth));
})();

const nodeDelay = (index: number) => START_MS + depths[index] * STEP_MS;

const ms = (value: number) => ({ '--d': `${value}ms` }) as React.CSSProperties;

export const OpeningIntro: React.FC = () => {
  const { t } = useI18n();
  const [isVisible, setIsVisible] = useState(true);
  const [isSkipped, setIsSkipped] = useState(false);
  const bgRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const exitingRef = useRef(false);

  const finish = useCallback(() => {
    markIntroPlayed();
    setIsVisible(false);
  }, []);

  const exit = useCallback(
    (fast: boolean) => {
      if (exitingRef.current) return;
      exitingRef.current = true;
      if (fast) setIsSkipped(true);

      const duration = fast ? 360 : 760;
      const logo = logoRef.current;
      const target = document.querySelector<HTMLElement>('[data-intro-target]');

      // The page's own entrances play while the logo travels, so it lands in a living page.
      document.documentElement.classList.remove('intro-playing');
      textRef.current?.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(12px)' }], {
        duration: 260,
        easing: 'ease-in',
        fill: 'forwards',
      });
      bgRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: duration * 0.75,
        delay: duration * 0.2,
        easing: 'ease-out',
        fill: 'forwards',
      });

      if (!logo) return finish();
      const from = logo.getBoundingClientRect();
      if (target && target.offsetParent !== null) {
        const to = target.getBoundingClientRect();
        // The page's logo waits, hidden, for this one to land on it.
        target.style.animation = 'none';
        target.style.opacity = '0';
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const scale = to.width / from.width;
        logo
          .animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }], {
            duration,
            easing: 'cubic-bezier(0.76, 0, 0.24, 1)',
            fill: 'forwards',
          })
          .finished.then(() => {
            target.style.opacity = '';
            finish();
          }, finish);
      } else {
        logo
          .animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.85)' }], {
            duration: duration * 0.6,
            easing: 'ease-in',
            fill: 'forwards',
          })
          .finished.then(finish, finish);
      }
    },
    [finish]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => exit(false), EXIT_AT_MS);
    const skip = () => exit(true);
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [exit]);

  if (!isVisible) return null;

  return (
    <div className={`fixed inset-0 z-[300] flex items-center justify-center ${isSkipped ? 'intro-skip' : ''}`} aria-hidden="true">
      <div ref={bgRef} className="absolute inset-0 bg-bg" />

      <div className="relative flex flex-col items-center">
        <div ref={logoRef} className="intro-logo relative" style={{ width: 'clamp(150px, 34vmin, 230px)', aspectRatio: '1' }}>
          <svg viewBox="0 0 512 512" className="intro-network absolute inset-0 h-full w-full">
            <g stroke="#dcb54a" strokeWidth="5.5" strokeLinecap="round">
              {EDGES.map(([a, b]) => {
                // Each line grows away from the point nearer the spine.
                const [from, to] = depths[a] <= depths[b] ? [a, b] : [b, a];
                return (
                  <line
                    key={`${a}-${b}`}
                    className="intro-line"
                    x1={NODES[from][0]}
                    y1={NODES[from][1]}
                    x2={NODES[to][0]}
                    y2={NODES[to][1]}
                    pathLength={1}
                    style={ms(nodeDelay(from) + 90)}
                  />
                );
              })}
            </g>
            <g fill="#dcb54a">
              {NODES.map(([x, y], index) => (
                <circle key={index} className="intro-node" cx={x} cy={y} r={index === SPINE ? 13 : 10} style={ms(nodeDelay(index))} />
              ))}
            </g>
          </svg>
          <img src="/logo.png" alt="" className="intro-logo-img absolute inset-0 h-full w-full" />
          <div className="intro-sheen absolute inset-0" />
        </div>

        <div ref={textRef} className="mt-6 flex flex-col items-center text-center">
          <p className="intro-name text-[clamp(2.1rem,7vmin,3.4rem)] font-bold leading-tight">{t.appName}</p>
          <p className="intro-tagline mt-2 text-[clamp(1rem,2.6vmin,1.25rem)] text-muted">
            {t.about.titleStart}
            <span className="text-gold-text">{t.about.titleHighlight}</span>
            {t.about.titleEnd}
          </p>
        </div>
      </div>
    </div>
  );
};
