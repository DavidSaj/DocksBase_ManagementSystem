// portal/src/screens/WorkOrderScreen.jsx
import { useState } from 'react';
import { submitWorkOrder } from '../api';

export default function WorkOrderScreen({ onBack }) {
  const [description, setDescription] = useState('');
  const [urgency, setUrgency]         = useState('routine');
  const [submitting, setSubmitting]   = useState(false);
  const [ref, setRef]                 = useState(null);
  const [error, setError]             = useState(null);

  function submit(e) {
    e.preventDefault();
    if (!description.trim()) return;
    setError(null);
    setSubmitting(true);
    submitWorkOrder({ description: description.trim(), urgency })
      .then(r => setRef(r.data.ref))
      .catch(() => setError('Could not submit request. Please try again.'))
      .finally(() => setSubmitting(false));
  }

  if (ref) {
    return (
      <div className="p-wo-root">
        <button className="p-wo-back" onClick={onBack} type="button">← Back</button>
        <div className="p-wo-confirm-card">
          <div className="p-wo-confirm-ref">{ref}</div>
          <div className="p-wo-confirm-title">Request received</div>
          <div className="p-wo-confirm-sub">The harbour team has been notified. They will contact you to arrange access to your vessel.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-wo-root">
      <button className="p-wo-back" onClick={onBack} type="button">← Back</button>
      <div className="p-wo-card">
        <div className="p-wo-title">Boatyard Work Request</div>
        <form onSubmit={submit}>
          <label className="p-wo-label" htmlFor="wo-description">Describe the work needed</label>
          <textarea
            id="wo-description"
            className="p-wo-textarea"
            rows={5}
            placeholder="e.g. Engine making a knocking sound when starting. Needs inspection."
            value={description}
            onChange={e => setDescription(e.target.value)}
            required
          />
          <label className="p-wo-label" htmlFor="wo-urgency">Urgency</label>
          <select
            id="wo-urgency"
            className="p-wo-select"
            value={urgency}
            onChange={e => setUrgency(e.target.value)}
          >
            <option value="routine">Routine — schedule when convenient</option>
            <option value="urgent">Urgent — within 48 hours</option>
            <option value="emergency">Emergency — immediate attention needed</option>
          </select>
          {error && <div className="p-wo-error">{error}</div>}
          <button className="p-wo-submit" type="submit" disabled={submitting || !description.trim()}>
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}
