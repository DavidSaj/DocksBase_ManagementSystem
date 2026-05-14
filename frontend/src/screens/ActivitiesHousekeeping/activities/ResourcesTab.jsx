import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { Loading, Empty, Err, SecHdr, Field, inputStyle } from '../shared.jsx';

export default function ResourcesTab() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activities, setActivities] = useState([]);
  const [form, setForm] = useState({
    activity: '', resource_type: 'instructor', required_role: '', quantity_required: 1,
  });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/activity-resource-requirements/')
      .then(r => setResources(r.data.results ?? r.data))
      .catch(() => setError('Failed to load resources.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/activity-catalogue/').then(r => setActivities(r.data.results ?? r.data)).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/activity-resource-requirements/', { ...form, quantity_required: Number(form.quantity_required) });
      setShowForm(false);
      setForm({ activity: '', resource_type: 'instructor', required_role: '', quantity_required: 1 });
      load();
    } catch {
      alert('Failed to create resource requirement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SecHdr title="Resource Requirements">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />Add Requirement</>}
        </button>
      </SecHdr>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Activity" required>
                <select required style={inputStyle} value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}>
                  <option value="">Select activity…</option>
                  {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Resource type">
              <select style={inputStyle} value={form.resource_type} onChange={e => setForm(f => ({ ...f, resource_type: e.target.value }))}>
                <option value="instructor">Instructor (Staff)</option>
                <option value="asset">Equipment Asset</option>
              </select>
            </Field>
            <Field label="Required role / asset">
              <input style={inputStyle} value={form.required_role} onChange={e => setForm(f => ({ ...f, required_role: e.target.value }))} placeholder="e.g. Kayak Instructor" />
            </Field>
            <Field label="Quantity required">
              <input type="number" style={inputStyle} min={1} value={form.quantity_required} onChange={e => setForm(f => ({ ...f, quantity_required: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Requirement'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : resources.length === 0 ? (
        <Empty title="No resource requirements" subtitle="Define what staff and equipment each activity requires." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr><th>Activity</th><th>Type</th><th>Role / Asset</th><th>Qty</th></tr>
            </thead>
            <tbody>
              {resources.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.activity_name ?? `Activity #${r.activity}`}</td>
                  <td>
                    <span className={`badge ${r.resource_type === 'instructor' ? 'badge-purple' : 'badge-navy'}`}>
                      {r.resource_type === 'instructor' ? 'Instructor' : 'Asset'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{r.required_role || r.asset_name || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.quantity_required}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
