import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { categoryBadge, Loading, Empty, Err, SecHdr, Field, inputStyle, fmt } from '../shared.jsx';

export default function CatalogueTab() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', category: 'other', description: '', duration_minutes: 60,
    capacity_min: 1, capacity_max: 10, min_age: 0,
    season_start: '', season_end: '', is_active: true,
  });

  const load = useCallback(() => {
    setLoading(true);
    api.get('/activity-catalogue/')
      .then(r => setActivities(r.data.results ?? r.data))
      .catch(() => setError('Failed to load activity types.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = activities.filter(a => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = !catFilter || a.category === catFilter;
    return matchSearch && matchCat;
  });

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/activity-catalogue/', {
        ...form,
        duration_minutes: Number(form.duration_minutes),
        capacity_min: Number(form.capacity_min),
        capacity_max: Number(form.capacity_max),
        min_age: Number(form.min_age),
        season_start: form.season_start || null,
        season_end: form.season_end || null,
      });
      setShowForm(false);
      setForm({ name: '', category: 'other', description: '', duration_minutes: 60, capacity_min: 1, capacity_max: 10, min_age: 0, season_start: '', season_end: '', is_active: true });
      load();
    } catch {
      alert('Failed to create activity type.');
    } finally {
      setSaving(false);
    }
  }

  const categories = [
    { value: 'water_sport', label: 'Water Sport' },
    { value: 'lesson', label: 'Lesson' },
    { value: 'equipment', label: 'Equipment Hire' },
    { value: 'guided_trip', label: 'Guided Trip' },
    { value: 'wellness', label: 'Wellness' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <div>
      <SecHdr title="Activity Catalogue">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Activity</>}
        </button>
      </SecHdr>

      {/* Filters */}
      <div className="filter-row">
        <input
          className="form-control form-control-sm"
          style={{ width: 220 }}
          placeholder="Search activities…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="form-control form-control-sm"
          style={{ width: 160 }}
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* New activity form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>New Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Name" required>
                <input required style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kayaking Tour" />
              </Field>
            </div>
            <Field label="Category" required>
              <select style={inputStyle} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Duration (min)" required>
              <input type="number" style={inputStyle} value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} min={1} />
            </Field>
            <Field label="Min capacity">
              <input type="number" style={inputStyle} value={form.capacity_min} onChange={e => setForm(f => ({ ...f, capacity_min: e.target.value }))} min={1} />
            </Field>
            <Field label="Max capacity" required>
              <input type="number" style={inputStyle} value={form.capacity_max} onChange={e => setForm(f => ({ ...f, capacity_max: e.target.value }))} min={1} />
            </Field>
            <Field label="Min age">
              <input type="number" style={inputStyle} value={form.min_age} onChange={e => setForm(f => ({ ...f, min_age: e.target.value }))} min={0} />
            </Field>
            <Field label="Season start">
              <input type="date" style={inputStyle} value={form.season_start} onChange={e => setForm(f => ({ ...f, season_start: e.target.value }))} />
            </Field>
            <Field label="Season end">
              <input type="date" style={inputStyle} value={form.season_end} onChange={e => setForm(f => ({ ...f, season_end: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Description">
                <textarea style={{ ...inputStyle, height: 72, resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Activity'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : filtered.length === 0 ? (
        <Empty title="No activities found" subtitle="Add your first activity to start taking bookings." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {filtered.map(a => (
            <div key={a.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, flex: 1, marginRight: 8 }}>{a.name}</div>
                {a.is_active
                  ? <span className="badge badge-green" style={{ flexShrink: 0 }}>Active</span>
                  : <span className="badge badge-gray" style={{ flexShrink: 0 }}>Inactive</span>}
              </div>
              <div style={{ marginBottom: 8 }}>{categoryBadge(a.category)}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span>Duration: {a.duration_minutes} min</span>
                <span>Capacity: {a.capacity_min}–{a.capacity_max} pax</span>
                {a.min_age > 0 && <span>Min age: {a.min_age}</span>}
                {a.season_start && <span>Season: {fmt(a.season_start)} → {fmt(a.season_end)}</span>}
              </div>
              {a.description && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 8 }}>
                  {a.description.length > 100 ? a.description.slice(0, 100) + '…' : a.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
