import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'pwa_install_dismissed';

function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);

  useEffect(() => {
    // Don't show if already installed or user dismissed before
    if (isInStandaloneMode()) return;
    if (!isMobile()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    if (isIos()) {
      setIsIosDevice(true);
      setShow(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function triggerPrompt() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      setDeferredPrompt(null);
      setShow(false);
    });
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setShow(false);
  }

  return { show, isIosDevice, triggerPrompt, dismiss };
}
