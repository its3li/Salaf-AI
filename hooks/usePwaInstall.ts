import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallPlatform = 'ios' | 'android' | 'windows' | 'mac' | 'linux';

export const INSTALL_PLATFORMS: InstallPlatform[] = ['ios', 'android', 'windows', 'mac', 'linux'];

export const isRunningAsInstalledApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** The device the visitor is on, to open the install guide at the right steps. */
export const detectInstallPlatform = (): InstallPlatform => {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return 'android';
};

/**
 * Chrome and Edge (Android, Windows, macOS, Linux, ChromeOS) offer a one-click install through
 * `beforeinstallprompt`; Safari and Firefox need the steps in the install guide instead.
 */
export const usePwaInstall = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isRunningAsInstalledApp);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setIsGuideOpen(false);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    // The browser allows prompt() only once per event; a new one arrives if the user can install again.
    setDeferredPrompt(null);
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsGuideOpen(false);
  };

  return {
    isInstalled,
    canPromptInstall: deferredPrompt !== null,
    promptInstall,
    isGuideOpen,
    openInstallGuide: () => setIsGuideOpen(true),
    closeInstallGuide: () => setIsGuideOpen(false),
  };
};
