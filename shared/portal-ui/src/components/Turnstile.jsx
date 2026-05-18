import { useEffect, useRef } from 'react';

const SITE_KEY = import.meta.env.VITE_CAPTCHA_SITE_KEY || '';

export default function Turnstile({ onToken }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!SITE_KEY) {
      onToken('bypass');
      return;
    }
    if (!window.turnstile) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      document.body.appendChild(s);
    }
    const id = setInterval(() => {
      if (window.turnstile && ref.current && !ref.current.dataset.rendered) {
        window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          callback: onToken,
        });
        ref.current.dataset.rendered = '1';
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  }, [onToken]);

  return <div ref={ref} />;
}
