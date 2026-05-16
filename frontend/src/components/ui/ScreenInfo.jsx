import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ScreenInfo({ title, body }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const paragraphs = typeof body === 'string'
    ? body.split(/\n\n+/).map(s => s.trim()).filter(Boolean)
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="About this screen"
        title="About this screen"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, padding: 0, marginLeft: 8,
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.18)',
          background: 'transparent',
          color: 'rgba(0,0,0,0.55)',
          cursor: 'pointer',
          fontSize: 12, fontWeight: 600, lineHeight: 1,
          verticalAlign: 'middle',
        }}
      >?</button>

      {open && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
              zIndex: 1000,
            }}
          />
          <aside
            role="dialog"
            aria-label={`About ${title}`}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(420px, calc(100vw - 16px))',
              background: '#fff',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
              zIndex: 1001,
              display: 'flex', flexDirection: 'column',
              animation: 'screeninfo-slide 180ms ease-out',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid rgba(0,0,0,0.08)',
            }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: 'transparent', border: 0, cursor: 'pointer',
                  fontSize: 20, color: 'rgba(0,0,0,0.5)', padding: 4, lineHeight: 1,
                }}
              >×</button>
            </div>
            <div style={{
              padding: '16px 20px',
              overflowY: 'auto',
              fontSize: 13.5, lineHeight: 1.55, color: 'rgba(0,0,0,0.75)',
            }}>
              {paragraphs
                ? paragraphs.map((p, i) => (
                    <p key={i} style={{ margin: i === 0 ? '0 0 12px' : '12px 0' }}>{p}</p>
                  ))
                : body}
            </div>
          </aside>
          <style>{`@keyframes screeninfo-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        </>,
        document.body
      )}
    </>
  );
}
