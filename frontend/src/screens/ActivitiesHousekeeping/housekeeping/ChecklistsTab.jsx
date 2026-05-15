import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { Loading, Empty, Err, SecHdr, Field, inputStyle } from '../shared.jsx';

export default function ChecklistsTab() {
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ unit_type: 'vessel', text: '', order: 0 });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/checklist-templates/')
      .then(r => setChecklists(r.data.results ?? r.data))
      .catch(() => setError('Failed to load checklists.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/checklist-templates/', { ...form, order: Number(form.order) });
      setShowForm(false);
      setForm({ unit_type: 'vessel', text: '', order: 0 });
      load();
    } catch {
      alert('Failed to create checklist item.');
    } finally {
      setSaving(false);
    }
  }

  const grouped = checklists.reduce((acc, item) => {
    const g = item.unit_type ?? 'other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const unitTypeLabel = { vessel: 'Vessel', accommodation: 'Accommodation', facility: 'Facility' };

  return (
    <div>
      <SecHdr title="Inspection Checklist Templates">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />Add Item</>}
        </button>
      </SecHdr>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Unit type">
              <select style={inputStyle} value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
                <option value="vessel">Vessel</option>
                <option value="accommodation">Accommodation</option>
                <option value="facility">Facility</option>
              </select>
            </Field>
            <Field label="Order">
              <input type="number" style={inputStyle} min={0} value={form.order} onChange={e => setForm(f => ({ ...f, order: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Checklist item text" required>
                <input required style={inputStyle} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="e.g. Check life jacket storage…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Item'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : checklists.length === 0 ? (
        <Empty title="No checklist templates" subtitle="Add items for each unit type — they'll be pre-loaded when tasks are assigned." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(grouped).map(([unitType, items]) => (
            <div key={unitType} className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{unitTypeLabel[unitType] ?? unitType}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', width: 24, textAlign: 'right', flexShrink: 0 }}>{item.order}</span>
                    <span style={{ fontSize: 13 }}>{item.text}</span>
                    {!item.is_active && <span className="badge badge-gray" style={{ fontSize: 10, marginLeft: 'auto' }}>Inactive</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
