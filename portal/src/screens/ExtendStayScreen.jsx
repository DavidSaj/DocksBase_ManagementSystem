// portal/src/screens/ExtendStayScreen.jsx
import { useState, useEffect } from 'react';
import api from '../api';

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function ExtendStayScreen({ onBack }) {
  const [booking, setBooking] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [newCheckOut, setNewCheckOut] = useState('');
  // 'idle' | 'checking' | 'available' | 'unavailable' | 'submitting' | 'success' | 'error'
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    api.get('/portal/member/booking/')
      .then(r => {
        setBooking(r.data);
        setNewCheckOut(addDays(r.data.check_out, 1));
      })
      .catch(() => setLoadError('Could not load your current booking. Please try again.'));
  }, []);

  async function handleCheck(e) {
    e.preventDefault();
    if (!newCheckOut) return;
    setStatus('checking');
    setErrorMsg('');
    try {
      const res = await api.get('/portal/member/extend-stay/', {
        params: { new_check_out: newCheckOut },
      });
      setStatus(res.data.available ? 'available' : 'unavailable');
    } catch {
      setStatus('unavailable');
    }
  }

  async function handleConfirm() {
    setStatus('submitting');
    try {
      await api.post('/portal/member/extend-stay/', { new_check_out: newCheckOut });
      setStatus('success');
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="p-subscreen">
      <div className="p-subscreen__header">
        <button className="p-subscreen__back" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <div>
          <div className="p-subscreen__title">Extend Stay</div>
          <div className="p-subscreen__subtitle">Request additional nights at your berth</div>
        </div>
      </div>

      <div className="p-subscreen__body">
        {loadError && <div className="p-banner p-banner--error">{loadError}</div>}

        {!booking && !loadError && (
          <div className="p-feed__empty">Loading booking…</div>
        )}

        {booking && status === 'success' && (
          <div className="p-form-card p-success-card">
            <div className="p-success-card__icon"><CheckCircleIcon /></div>
            <div className="p-success-card__title">Extension requested</div>
            <div className="p-success-card__body">
              The marina will confirm your extended stay by email.
            </div>
            <button
              className="p-btn p-btn--outline"
              style={{ marginTop: 20 }}
              onClick={onBack}
            >
              Back to Services
            </button>
          </div>
        )}

        {booking && status !== 'success' && (
          <div className="p-form-card">
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', marginBottom: 14 }}>
              Current check-out:{' '}
              <span style={{ fontWeight: 400 }}>{booking.check_out}</span>
            </p>

            <form onSubmit={handleCheck}>
              <label className="p-form-label" htmlFor="extend-date">
                New check-out date
              </label>
              <input
                id="extend-date"
                type="date"
                className="p-input"
                style={{ marginBottom: 14 }}
                value={newCheckOut}
                min={addDays(booking.check_out, 1)}
                onChange={e => { setNewCheckOut(e.target.value); setStatus('idle'); }}
                required
              />

              {(status === 'idle' || status === 'error') && (
                <button type="submit" className="p-btn p-btn--primary" disabled={!newCheckOut}>
                  Check availability
                </button>
              )}

              {status === 'checking' && (
                <div className="p-feed__empty">Checking availability…</div>
              )}
            </form>

            {status === 'available' && (
              <>
                <div className="p-banner p-banner--success" style={{ marginTop: 14 }}>
                  Your berth is free — you can extend your stay.
                </div>
                <button
                  className="p-btn p-btn--primary"
                  style={{ background: 'var(--green)' }}
                  onClick={handleConfirm}
                >
                  Confirm extension
                </button>
                <button
                  className="p-btn p-btn--outline"
                  style={{ marginTop: 8 }}
                  onClick={() => setStatus('idle')}
                >
                  Change dates
                </button>
              </>
            )}

            {status === 'unavailable' && (
              <>
                <div className="p-banner p-banner--error" style={{ marginTop: 14 }}>
                  Sorry, your berth isn't available for those dates. Please contact the marina.
                </div>
                <button
                  className="p-btn p-btn--outline"
                  onClick={() => setStatus('idle')}
                >
                  Try different dates
                </button>
              </>
            )}

            {status === 'submitting' && (
              <div className="p-feed__empty">Submitting request…</div>
            )}

            {status === 'error' && errorMsg && (
              <div className="p-banner p-banner--error" style={{ marginTop: 8 }}>
                {errorMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
