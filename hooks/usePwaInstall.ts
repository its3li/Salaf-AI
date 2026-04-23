import { useState, useEffect } from 'react';

export const usePwaInstall = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      alert("لتثبيت التطبيق:\n\n1. اضغط على زر المشاركة (Share) في المتصفح.\n2. اختر 'إضافة إلى الشاشة الرئيسية' (Add to Home Screen).");
    }
  };

  return { handleInstallClick };
};
