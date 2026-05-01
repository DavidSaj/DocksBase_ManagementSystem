export default function StripeGateModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 10, padding: 28,
          width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0c1f3d', marginBottom: 8 }}>
          Connect your bank account
        </div>
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6, marginBottom: 20 }}>
          To accept online payments, DocksBase needs to know where to send your money.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Stripe Connect coming soon"
            style={{ flex: 1, opacity: 0.5, cursor: 'not-allowed' }}
          >
            Connect via Stripe
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
