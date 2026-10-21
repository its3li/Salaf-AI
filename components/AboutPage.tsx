import React from 'react';
import { BookOpenText, ChevronDown, Heart, MessageCircle, ShieldCheck } from 'lucide-react';
import { HadithChecker } from './HadithChecker';
import { LanguageMenu } from './LanguageMenu';
import { useI18n } from '../i18n/context';

interface AboutPageProps {
  onStartChat: () => void;
  onInstallClick: () => void;
}

// Hero parts arrive one after another.
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as React.CSSProperties;

// One icon per step of "how it works": ask, verify, answer.
const STEP_ICONS = [MessageCircle, ShieldCheck, BookOpenText];

/** A short page about the project, for visitors and search engines; the app itself opens at "/". */
export const AboutPage: React.FC<AboutPageProps> = ({ onStartChat, onInstallClick }) => {
  const { t } = useI18n();
  const { about } = t;

  return (
    <div className="page-glow min-h-dvh">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: about.faq.map((item) => ({
              '@type': 'Question',
              name: item.question,
              acceptedAnswer: { '@type': 'Answer', text: item.answer },
            })),
          }),
        }}
      />

      <nav className="frosted sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
          <button type="button" onClick={onStartChat} className="flex items-center gap-2">
            <img src="/logo.png" alt="" width="28" height="28" className="h-7 w-7" />
            <span className="text-[1.05rem] font-bold">{t.appName}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <LanguageMenu />
            <button
              type="button"
              onClick={onStartChat}
              className="h-9 rounded-full bg-text px-4 text-[0.9rem] font-semibold text-bg transition-transform hover:scale-[1.03] active:scale-95"
            >
              {about.start}
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4">
        <section className="flex flex-col items-center py-16 text-center md:py-24">
          <div className="logo-halo rise mb-8" data-intro-target>
            <img src="/logo.png" alt="" width="104" height="104" className="h-[104px] w-[104px]" />
          </div>
          <h1 className="rise max-w-3xl text-[2.4rem] font-bold leading-[1.25] md:text-[3.6rem]" style={delay(90)}>
            {about.titleStart}
            <span className="text-gold-text">{about.titleHighlight}</span>
            {about.titleEnd}
          </h1>
          <p className="rise mt-5 max-w-2xl text-[1.1rem] leading-relaxed text-muted md:text-[1.2rem]" style={delay(180)}>
            {about.intro}
          </p>
          <div className="rise mt-8 flex flex-wrap items-center justify-center gap-3" style={delay(270)}>
            <button
              type="button"
              onClick={onStartChat}
              className="h-12 rounded-full bg-gold px-7 text-[1rem] font-semibold text-[#17160f] shadow-[0_10px_30px_-10px_rgba(212,175,55,0.8)] transition-transform hover:scale-[1.03] active:scale-95"
            >
              {about.start}
            </button>
            <button
              type="button"
              onClick={onInstallClick}
              className="h-12 rounded-full border border-line bg-surface px-6 text-[1rem] font-medium transition-colors hover:bg-surface-2"
            >
              {about.install}
            </button>
          </div>
          <p className="rise mt-4 text-[0.85rem] text-faint" style={delay(340)}>
            {about.freeLine}
          </p>
        </section>

        <section className="reveal-on-scroll pb-20" aria-labelledby="how-heading">
          <h2 id="how-heading" className="mb-8 text-center text-[1.6rem] font-bold md:text-[2rem]">
            {about.howTitle}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {about.steps.map((step, index) => {
              const Icon = STEP_ICONS[index];
              return (
                <div
                  key={step.title}
                  className="rounded-3xl border border-line bg-surface p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-[0_18px_40px_-24px_rgba(212,175,55,0.6)]"
                >
                  <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gold-soft text-gold-text">
                    <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  <h3 className="text-[1.2rem] font-bold">{step.title}</h3>
                  <p className="mt-2 text-[0.98rem] leading-relaxed text-muted">{step.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="reveal-on-scroll pb-20" aria-labelledby="check-heading">
          <div className="mx-auto max-w-2xl">
            <h2 id="check-heading" className="text-center text-[1.6rem] font-bold md:text-[2rem]">
              {about.checkTitle}
            </h2>
            <p className="mt-3 mb-6 text-center text-[1rem] text-muted">{about.checkIntro}</p>
            <HadithChecker />
          </div>
        </section>

        <section className="reveal-on-scroll pb-20" aria-labelledby="faq-heading">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq-heading" className="mb-8 text-center text-[1.6rem] font-bold md:text-[2rem]">
              {about.faqTitle}
            </h2>
            <div className="space-y-2">
              {about.faq.map((item) => (
                <details
                  key={item.question}
                  className="group rounded-2xl border border-line bg-surface open:bg-surface [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[1.05rem] font-semibold">
                    {item.question}
                    <ChevronDown
                      size={18}
                      strokeWidth={2}
                      className="shrink-0 text-faint transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="px-5 pb-5 text-[0.98rem] leading-relaxed text-muted">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="reveal-on-scroll pb-20">
          <div className="relative overflow-hidden rounded-[2rem] border border-line bg-surface px-6 py-12 text-center md:px-12">
            <div
              className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-[36rem] max-w-full rounded-full bg-gold/20 blur-3xl"
              aria-hidden="true"
            />
            <h2 className="relative text-[1.6rem] font-bold md:text-[2rem]">{about.supportTitle}</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-[1rem] leading-relaxed text-muted">{about.supportText}</p>
            <a
              href="https://ko-fi.com/its3li"
              target="_blank"
              rel="noopener noreferrer"
              className="relative mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-text px-6 text-[0.95rem] font-semibold text-bg transition-transform hover:scale-[1.03] active:scale-95"
            >
              <Heart size={17} strokeWidth={0} fill="#f43f5e" className="heartbeat shrink-0" aria-hidden="true" />
              <span className="leading-none">{about.support}</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 py-8 text-[0.85rem] text-faint md:flex-row">
          <p>
            © {new Date().getFullYear()} {t.appName} · Salaf AI
          </p>
          <div className="flex items-center gap-5">
            <a
              href="https://www.instagram.com/_salafai_?igsh=eHVzcndzaHcxbTg0"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-text"
            >
              {about.instagram}
            </a>
            <a
              href="https://www.facebook.com/share/1FY1sZzk19/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-text"
            >
              {about.facebook}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
