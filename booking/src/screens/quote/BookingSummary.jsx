import { useEffect, useState } from 'react';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatMoney(value, currency = 'EUR') {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  const symbol = { EUR: '€', GBP: '£', USD: '$' }[currency.toUpperCase()] || currency.toUpperCase() + ' ';
  return `${symbol}${n.toFixed(2)}`;
}

function HoldCountdown({ lockedUntil, onExpire }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!lockedUntil) return null;
  const remainingMs = new Date(lockedUntil).getTime() - now;
  if (remainingMs <= 0) {
    onExpire?.();
    return <p className="q-summary-expired">Your hold has expired. Please retry.</p>;
  }
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  return (
    <p className="q-summary-countdown">
      Hold expires in {mins}:{secs.toString().padStart(2, '0')}
    </p>
  );
}

export default function BookingSummary({ state, marina, intentData, onHoldExpired }) {
  const nights =
    state.checkIn && state.checkOut
      ? Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000)
      : 0;
  const currency = marina?.currency || 'EUR';

  return (
    <aside className="q-summary">
      <div className="q-summary-header">
        <div className="q-summary-marina-name">{marina?.name || 'Your Marina'}</div>
        {marina?.address && <div className="q-summary-marina-address">{marina.address}</div>}
      </div>

      <div className="q-summary-section">
        <div className="q-summary-row">
          <span>Check-in</span><span>{formatDate(state.checkIn)}</span>
        </div>
        <div className="q-summary-row">
          <span>Check-out</span><span>{formatDate(state.checkOut)}</span>
        </div>
        <div className="q-summary-row">
          <span>Nights</span><span>{nights}</span>
        </div>
      </div>

      <div className="q-summary-section">
        {state.boats.map((boat, idx) => (
          <div key={idx} className="q-summary-boat">
            <div className="q-summary-boat-name">
              {boat.vesselName || `Boat ${idx + 1}`}
            </div>
            <div className="q-summary-boat-dims">
              {boat.loa ? `${boat.loa}m LOA` : ''}
              {boat.beam ? ` · ${boat.beam}m beam` : ''}
              {boat.draft ? ` · ${boat.draft}m draft` : ''}
            </div>
            {intentData?.items?.[idx] && (
              <div className="q-summary-boat-price">
                <span>{intentData.items[idx].berth_code || 'Berth TBD'}</span>
                <span>{formatMoney(intentData.items[idx].item_price, currency)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {intentData?.total != null && (
        <div className="q-summary-total">
          <span>Total</span>
          <span>{formatMoney(intentData.total, currency)}</span>
        </div>
      )}

      {intentData?.lockedUntil && (
        <HoldCountdown lockedUntil={intentData.lockedUntil} onExpire={onHoldExpired} />
      )}

      {marina?.booking_terms_pdf_url && (
        <p className="q-summary-tos">
          <a href={marina.booking_terms_pdf_url} target="_blank" rel="noreferrer">
            Booking terms and cancellation policy
          </a>
        </p>
      )}
    </aside>
  );
}
