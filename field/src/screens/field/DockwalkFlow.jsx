// frontend/src/screens/field/DockwalkFlow.jsx
import { useState, useEffect, useRef } from 'react';
import api from '../../api.js';

export default function DockwalkFlow({ onBack }) {
  const [meters, setMeters]     = useState([]);
  const [index, setIndex]       = useState(0);
  const [value, setValue]       = useState('');
  const [rollover, setRollover] = useState(false);
  const [error, setError]       = useState(null);
  const [done, setDone]         = useState(false);
  const [stats, setStats]       = useState({ entered: 0, skipped: 0 });
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.get('/utilities/dockwalk/')
      .then(r => { if (active) setMeters(r.data.meters); })
      .catch(() => { if (active) setLoadError('Could not load meters. Check connection.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setValue('');
    setRollover(false);
    setError(null);
    inputRef.current?.focus();
  }, [index]);

  const meter = meters[index];
  const lastValue = meter
    ? (meter.meter_type === 'electricity' ? meter.last_reading_kwh : meter.last_reading_m3)
    : null;
  const unit = meter?.meter_type === 'electricity' ? 'kWh' : 'm³';

  function skip() {
    setStats(s => ({ ...s, skipped: s.skipped + 1 }));
    if (index + 1 >= meters.length) { setDone(true); return; }
    setIndex(i => i + 1);
  }

  function submit() {
    if (!value) return;
    setError(null);
    const payload = {
      rollover,
      ...(meter.meter_type === 'electricity'
        ? { reading_kwh: parseFloat(value) }
        : { reading_m3:  parseFloat(value) }),
    };
    setSubmitting(true);
    api.post(`/utilities/dockwalk/${meter.id}/reading/`, payload)
      .then(() => {
        setStats(s => ({ ...s, entered: s.entered + 1 }));
        if (index + 1 >= meters.length) { setDone(true); return; }
        setIndex(i => i + 1);
      })
      .catch(e => {
        const msg = e.response?.data?.detail || 'Submission failed.';
        setError(msg);
      })
      .finally(() => { setSubmitting(false); });
  }

  if (loadError) {
    return (
      <div className="f-dw-root">
        <button className="f-dw-back" onClick={onBack} type="button">← Back</button>
        <div className="f-dw-error">{loadError}</div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="f-dw-root">
        <button className="f-dw-back" onClick={onBack} type="button">← Back</button>
        <div className="f-dw-done">
          <div className="f-dw-done-title">All done</div>
          <div className="f-dw-done-stats">{stats.entered} entered · {stats.skipped} skipped</div>
        </div>
      </div>
    );
  }

  if (!meter) return <div className="f-dw-root"><div className="f-dw-loading">Loading…</div></div>;

  const remaining = meters.length - index;

  return (
    <div className="f-dw-root">
      <div className="f-dw-topbar">
        <button className="f-dw-back" onClick={onBack} type="button">← Back</button>
        <span className="f-dw-progress">{remaining} left</span>
      </div>

      <div className="f-dw-card">
        <div className="f-dw-berth">{meter.pier_label ? `${meter.pier_label} · ` : ''}{meter.berth_code || 'Unassigned'}</div>
        <div className="f-dw-meter-type">{meter.meter_type === 'electricity' ? 'Electricity' : 'Water'} · {meter.label || meter.device_id || `Meter ${meter.id}`}</div>
        {lastValue !== null && lastValue !== undefined && (
          <div className="f-dw-last">
            Last: <strong>{lastValue} {unit}</strong>
            {meter.last_recorded_at && ` (${new Date(meter.last_recorded_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`}
          </div>
        )}

        <input
          ref={inputRef}
          className="f-dw-input"
          type="number"
          step="0.001"
          inputMode="decimal"
          placeholder={lastValue ?? '0.000'}
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); }}
          aria-label={`New ${unit} reading`}
        />
        <span className="f-dw-unit">{unit}</span>

        {error && (
          <div className="f-dw-error-block">
            <div className="f-dw-error-msg">{error}</div>
            {error.includes('lower than last') && (
              <label className="f-dw-rollover-label">
                <input
                  type="checkbox"
                  checked={rollover}
                  onChange={e => setRollover(e.target.checked)}
                />
                {' '}This meter rolled over or was replaced
              </label>
            )}
          </div>
        )}
      </div>

      <div className="f-dw-actions">
        <button className="f-dw-skip" onClick={skip} type="button">Skip</button>
        <button className="f-dw-next" onClick={submit} disabled={!value || submitting || (error?.includes('lower than last') && !rollover)} type="button">Next →</button>
      </div>
    </div>
  );
}
