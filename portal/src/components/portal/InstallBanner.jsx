import { useInstallPrompt } from '../../hooks/useInstallPrompt';

const banner = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  background: '#1a3c5e',
  color: '#fff',
  padding: '16px 20px',
  zIndex: 1000,
  boxShadow: '0 -2px 12px rgba(0,0,0,0.15)',
};

const row = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  maxWidth: 480,
  margin: '0 auto',
};

const installBtn = {
  background: '#fff',
  color: '#1a3c5e',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const dismissBtn = {
  background: 'transparent',
  border: 'none',
  color: 'rgba(255,255,255,0.6)',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1,
  padding: '0 4px',
  flexShrink: 0,
};

export default function InstallBanner() {
  const { show, isIosDevice, triggerPrompt, dismiss } = useInstallPrompt();

  if (!show) return null;

  return (
    <div style={banner}>
      <div style={row}>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
          {isIosDevice ? (
            <>
              <strong>Add to Home Screen</strong>
              <br />
              Tap the share icon below, then <strong>"Add to Home Screen"</strong> for quick access.
            </>
          ) : (
            <>
              <strong>Install the app</strong>
              <br />
              Get quick access to your booking from your home screen.
            </>
          )}
        </div>
        {!isIosDevice && (
          <button style={installBtn} onClick={triggerPrompt}>
            Install
          </button>
        )}
        <button style={dismissBtn} onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
