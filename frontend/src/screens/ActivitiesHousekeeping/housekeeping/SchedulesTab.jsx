import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { fmt, Loading, Empty, Err, SecHdr, Field, inputStyle } from '../shared.jsx';

export default function SchedulesTab() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ unit_label: '', unit_type: 'vessel', interval_days: 1, notes: '' });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/cleaning-schedules/', { params: {} })
      .then(r => setSchedules(r.data.results ?? r.data))
      .catch(() => setError('Failed to load cleaning schedules.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/cleaning-schedules/', { ...form, interval_days: Number(form.interval_days) });
      setShowForm(false);
      setForm({ unit_label: '', unit_type: 'vessel', interval_days: 1, notes: '' });
      load();
    } catch {
      alert('Failed to create schedule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SecHdr title="Recurring Cleaning Schedules">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Schedule</>}
        </button>
      </SecHdr>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Unit name" required>
              <input required style={inputStyle} value={form.unit_label} onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} placeholder="e.g. Sea Sprite" />
            </Field>
            <Field label="Unit type">
              <select style={inputStyle} value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
                <option value="vessel">Vessel</option>
                <option value="accommodation">Accommodation</option>
                <option value="facility">Facility</option>
              </select>
            </Field>
            <Field label="Repeat every (days)" required>
              <input required type="number" style={inputStyle} min={1} value={form.interval_days} onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...inputStyle, height: 56, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Schedule'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : schedules.length === 0 ? (
        <Empty title="No recurring schedules" subtitle="Set up mid-stay recurring cleaning for vessels and accommodation." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr><th>Unit</th><th>Type</th><th>Interval</th><th>Next run</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.unit_label}</td>
                  <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{s.unit_type}</span></td>
                  <td style={{ fontSize: 12 }}>Every {s.interval_days} day{s.interval_days !== 1 ? 's' : ''}</td>
                  <td style={{ fontSize: 12 }}>{fmt(s.next_run_date)}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{s.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
