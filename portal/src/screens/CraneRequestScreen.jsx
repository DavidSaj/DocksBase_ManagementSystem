// portal/src/screens/CraneRequestScreen.jsx
import { useState } from 'react';
import api from '@docksbase/portal-ui/api';

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function LaunchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function HaulOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function BothIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
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

const SERVICE_OPTIONS = [
  { value: 'launch',   label: 'Launch',   Icon: LaunchIcon,  desc: 'Put your vessel in the water' },
  { value: 'haul_out', label: 'Haul-Out', Icon: HaulOutIcon, desc: 'Lift your vessel out of the water' },
  { value: 'both',     label: 'Both',     Icon: BothIcon,    desc: 'Haul-out and re-launch' },
];

function todayPlusOne() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function CraneRequestScreen({ onBack }) {
  const [serviceType, setServiceType] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const minDate = todayPlusOne();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceType || !requestedDate) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      await api.post('/portal/member/crane-requests/', {
        service_type: serviceType,
        requested_date: requestedDate,
        notes: notes.trim() || undefined,
      });
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
          <div className="p-subscreen__title">Crane / Lift Request</div>
          <div className="p-subscreen__subtitle">Request a hoist service from the harbour team</div>
        </div>
      </div>

      <div className="p-subscreen__body">
        {status === 'success' ? (
          <div className="p-svc-card p-success-card">
            <div className="p-success-card__icon"><CheckCircleIcon /></div>
            <div className="p-success-card__title">Request submitted</div>
            <div className="p-success-card__body">
              The harbour team will contact you to confirm the time.
            </div>
            <button
              className="p-btn p-btn--outline"
              style={{ marginTop: 20 }}
              onClick={onBack}
            >
              Back to Services
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <fieldset className="p-svc-card" style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="p-form-label">Service type</legend>
              {SERVICE_OPTIONS.map(({ value, label, Icon, desc }) => {
                const selected = serviceType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`p-service-option${selected ? ' p-service-option--selected' : ''}`}
                    onClick={() => setServiceType(value)}
                  >
                    <div className="p-service-option__icon"><Icon /></div>
                    <div>
                      <div className="p-service-option__label">{label}</div>
                      <div className="p-service-option__desc">{desc}</div>
                    </div>
                    {selected && <div className="p-service-option__check"><CheckIcon /></div>}
                  </button>
                );
              })}
            </fieldset>

            <div className="p-svc-card">
              <label className="p-form-label" htmlFor="crane-date">Preferred date</label>
              <input
                id="crane-date"
                type="date"
                className="p-input"
                value={requestedDate}
                min={minDate}
                onChange={e => setRequestedDate(e.target.value)}
                required
              />
            </div>

            <div className="p-svc-card">
              <label className="p-form-label" htmlFor="crane-notes">Notes (optional)</label>
              <textarea
                id="crane-notes"
                className="p-input"
                style={{ minHeight: 80, resize: 'vertical' }}
                placeholder="e.g. hull inspection needed, preferred time of day…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {status === 'error' && errorMsg && (
              <div className="p-banner p-banner--error">{errorMsg}</div>
            )}

            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={!serviceType || !requestedDate || status === 'submitting'}
            >
              {status === 'submitting' ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              type="button"
              className="p-btn p-btn--outline"
              style={{ marginTop: 8 }}
              onClick={onBack}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
