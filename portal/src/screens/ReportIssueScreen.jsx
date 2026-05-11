// portal/src/screens/ReportIssueScreen.jsx
import { useState } from 'react';
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

const CATEGORIES = [
  { value: 'berth',    label: 'Berth / Pontoon' },
  { value: 'facility', label: 'Facility (shower, toilet, electricity)' },
  { value: 'vessel',   label: 'Vessel Issue' },
  { value: 'other',    label: 'Other' },
];

export default function ReportIssueScreen({ onBack }) {
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [ref, setRef] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!category || !description.trim()) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await api.post('/portal/member/issues/', {
        category,
        description: description.trim(),
      });
      setRef(res.data.ref ?? '');
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
          <div className="p-subscreen__title">Report an Issue</div>
          <div className="p-subscreen__subtitle">Let the harbour team know about a problem</div>
        </div>
      </div>

      <div className="p-subscreen__body">
        {status === 'success' ? (
          <div className="p-form-card p-success-card">
            <div className="p-success-card__icon"><CheckCircleIcon /></div>
            <div className="p-success-card__title">Issue reported</div>
            <div className="p-success-card__body">
              The harbour team has been notified and will be in touch.
            </div>
            {ref && <div className="p-success-card__ref">Reference: {ref}</div>}
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
            <div className="p-form-card">
              <label className="p-form-label" htmlFor="issue-category">Category</label>
              <select
                id="issue-category"
                className="p-input"
                value={category}
                onChange={e => setCategory(e.target.value)}
                required
              >
                <option value="">Select a category…</option>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="p-form-card">
              <label className="p-form-label" htmlFor="issue-desc">Description</label>
              <textarea
                id="issue-desc"
                className="p-input"
                style={{ minHeight: 120, resize: 'vertical' }}
                placeholder="Describe the problem…"
                value={description}
                onChange={e => setDescription(e.target.value)}
                required
              />
            </div>

            {status === 'error' && errorMsg && (
              <div className="p-banner p-banner--error">{errorMsg}</div>
            )}

            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={!category || !description.trim() || status === 'submitting'}
            >
              {status === 'submitting' ? 'Submitting…' : 'Submit report'}
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
