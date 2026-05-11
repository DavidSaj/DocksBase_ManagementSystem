// portal/src/components/portal/checklist/WaiverItem.jsx
import { useState, useEffect } from 'react';
import api from '../../../api';

function PdfLink({ url }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        marginBottom: 18, textDecoration: 'none',
        fontSize: 13, fontWeight: 600, color: 'var(--navy)',
      }}
    >
      <svg
        style={{ width: 14, height: 14, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 }}
        viewBox="0 0 24 24"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      Read Waiver (PDF)
    </a>
  );
}

function ClickWrapUI({ waiverUrl, bookingId, onUpdate }) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/portal/checkin/bookings/${bookingId}/waiver/`);
      onUpdate();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 16, lineHeight: 1.6 }}>
        The marina requires you to read and accept the waiver before arrival.
      </p>
      <PdfLink url={waiverUrl} />
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 18 }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0, width: 16, height: 16 }}
        />
        <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', lineHeight: 1.5 }}>
          I have read and agree to the marina waiver
        </span>
      </label>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <button
        className="p-btn p-btn--primary"
        disabled={!agreed || submitting}
        onClick={handleConfirm}
      >
        {submitting ? 'Confirming…' : 'Confirm Agreement'}
      </button>
    </div>
  );
}

function EsignUI({ waiverUrl, signUrl, onUpdate }) {
  const [opened, setOpened] = useState(false);

  function handleSign() {
    window.open(signUrl, '_blank', 'noopener,noreferrer');
    setOpened(true);
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 16, lineHeight: 1.6 }}>
        The marina requires a signed waiver before arrival. Review the document then sign electronically.
      </p>
      <PdfLink url={waiverUrl} />
      <button className="p-btn p-btn--primary" onClick={handleSign} style={{ marginBottom: 12 }}>
        <svg style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        Sign Waiver
      </button>
      {opened && (
        <button
          style={{ display: 'block', width: '100%', marginTop: 4, height: 44, background: 'transparent', border: 'none', fontSize: 14, color: 'rgba(0,0,0,0.4)', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}
          onClick={onUpdate}
        >
          I've signed — refresh
        </button>
      )}
    </div>
  );
}

export default function WaiverItem({ booking, onUpdate }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/portal/checkin/bookings/${booking.id}/waiver/`)
      .then(res => setState(res.data))
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [booking.id]);

  if (loading) {
    return <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>Loading waiver…</p>;
  }

  if (!state) {
    return <p style={{ fontSize: 13, color: 'var(--red)' }}>Waiver not available. Contact the marina.</p>;
  }

  if (state.mode === 'esign') {
    return <EsignUI waiverUrl={state.waiver_url} signUrl={state.sign_url} onUpdate={onUpdate} />;
  }

  return <ClickWrapUI waiverUrl={state.waiver_url} bookingId={booking.id} onUpdate={onUpdate} />;
}
