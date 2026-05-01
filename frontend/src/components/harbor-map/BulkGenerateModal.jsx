import { useState } from 'react';

export default function BulkGenerateModal({ pier, onGenerate, onClose }) {
  const [form, setForm] = useState({
    prefix: pier.code,
    start: 1,
    end: 10,
    length_m: '',
    max_beam_m: '',
    price_per_night: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = {
        prefix: form.prefix,
        start: parseInt(form.start, 10),
        end: parseInt(form.end, 10),
        ...(form.length_m     && { length_m: form.length_m }),
        ...(form.max_beam_m   && { max_beam_m: form.max_beam_m }),
        ...(form.price_per_night && { price_per_night: form.price_per_night }),
      };
      await onGenerate(pier.id, payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data) || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const count = Math.max(0, parseInt(form.end, 10) - parseInt(form.start, 10) + 1) || 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'white', borderRadius: 10, padding: 24, width: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
          Bulk Generate Berths — {pier.label || pier.code}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Prefix</label>
              <input value={form.prefix} onChange={e => set('prefix', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>From #</label>
              <input type="number" min="1" value={form.start} onChange={e => set('start', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>To #</label>
              <input type="number" min="1" value={form.end} onChange={e => set('end', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 4 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Max Length (m)</label>
              <input type="number" step="0.1" value={form.length_m} onChange={e => set('length_m', e.target.value)} placeholder="e.g. 12"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Max Beam (m)</label>
              <input type="number" step="0.1" value={form.max_beam_m} onChange={e => set('max_beam_m', e.target.value)} placeholder="e.g. 4"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Price/night</label>
              <input type="number" step="0.01" value={form.price_per_night} onChange={e => set('price_per_night', e.target.value)} placeholder="e.g. 50"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
            </div>
          </div>

          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
            <button type="submit" disabled={loading || count === 0} style={{
              background: '#2563eb', color: 'white', border: 'none',
              borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
            }}>
              {loading ? 'Generating…' : `Generate ${count} Berths`}
            </button>
            <button type="button" onClick={onClose} style={{
              background: 'transparent', border: '1px solid #d1d5db',
              borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
