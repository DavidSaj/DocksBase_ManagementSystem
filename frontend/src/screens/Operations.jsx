import { useState } from 'react';
import useFuelQueue from '../hooks/useFuelQueue.js';
import useVessels from '../hooks/useVessels.js';
import { useMarinaContext } from '../context/MarinaContext.jsx';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';

function AddQueueForm({ vessels, onAdd, onCancel }) {
  const [mode, setMode] = useState('stranger'); // 'member' | 'stranger'
  const [form, setForm] = useState({
    vessel: '', guest_description: '', guest_phone: '',
    fuel_type: 'diesel', estimated_litres: '',
  });
  const [submitting, setSubmitting] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      fuel_type:        form.fuel_type,
      estimated_litres: form.estimated_litres || null,
    };
    if (mode === 'member' && form.vessel) {
      const v = vessels.find(v => v.id === Number(form.vessel));
      payload.vessel = Number(form.vessel);
      if (v?.owner) payload.member = v.owner;
    } else {
      payload.guest_description = form.guest_description;
      payload.guest_phone       = form.guest_phone;
    }
    await onAdd(payload);
    setSubmitting(false);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">Add to Queue</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}><Ic n="x" s={13}/></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['member','Known Vessel'],['stranger','Free Text']].map(([v,l]) => (
            <button key={v} type="button" className={`btn ${mode === v ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(v)}>{l}</button>
          ))}
        </div>
        <form onSubmit={submit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mode === 'member' ? (
              <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required>
                <option value="">Select vessel…</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : (
              <>
                <input className="input" placeholder='Description (e.g. "White Sailboat")' value={form.guest_description} onChange={e => set('guest_description', e.target.value)} />
                <input className="input" placeholder="Phone number" value={form.guest_phone} onChange={e => set('guest_phone', e.target.value)} />
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <select className="input" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
                <option value="diesel">Diesel</option>
                <option value="petrol">Petrol</option>
                <option value="pump_out">Pump-out</option>
              </select>
              <input className="input" placeholder="Est. litres" type="number" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add to Queue'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function CompletionForm({ entry, onComplete, onCancel }) {
  const [litres, setLitres]  = useState('');
  const [price,  setPrice]   = useState('');
  const [saving, setSaving]  = useState(false);

  const preview = (litres && price) ? `€${(litres * price).toFixed(2)}` : '—';

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    await onComplete(entry.id, {
      status:          'completed',
      actual_litres:   litres,
      price_per_litre: price,
    });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" placeholder="Actual litres" type="number" step="0.01" value={litres} onChange={e => setLitres(e.target.value)} style={{ width: 110 }} required />
      <input className="input" placeholder="€/litre" type="number" step="0.0001" value={price} onChange={e => setPrice(e.target.value)} style={{ width: 90 }} required />
      <span style={{ fontSize: 12, fontWeight: 700 }}>{preview}</span>
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Complete'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function FuelDockTab() {
  const { queue, loading, addToQueue, advanceEntry, removeEntry } = useFuelQueue();
  const { vessels } = useVessels();
  const { marina } = useMarinaContext();
  const fuelBerths = marina?.fuel_berths?.length ? marina.fuel_berths : ['FD-1', 'FD-2'];
  const [showAddForm, setShowAddForm]   = useState(false);
  const [completingId, setCompletingId] = useState(null);

  const NEXT_LABEL = { waiting: 'Next', next: 'To Berth', service: 'Complete' };

  async function handleAdvance(entry) {
    if (entry.status === 'service') {
      setCompletingId(entry.id);
    } else {
      const nextStatus = { waiting: 'next', next: 'service' }[entry.status];
      await advanceEntry(entry.id, { status: nextStatus });
    }
  }

  async function handleComplete(id, patch) {
    await advanceEntry(id, patch);
    setCompletingId(null);
  }

  const serviceEntries = queue.filter(e => e.status === 'service');

  return (
    <div>
      <div className="sec-hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sec-hdr-title">Fuel Dock — Live Queue</div>
          <span className="badge badge-teal">{queue.filter(q => q.status === 'service').length} Fuelling</span>
          <span className="badge badge-gray">{queue.filter(q => q.status === 'waiting').length} Waiting</span>
          {queue.filter(q => q.status === 'next').length > 0 && (
            <span className="badge badge-gold">{queue.filter(q => q.status === 'next').length} Next</span>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(v => !v)}>
          <Ic n="plus" s={11} />Add to Queue
        </button>
      </div>

      {showAddForm && (
        <AddQueueForm
          vessels={vessels}
          onAdd={async payload => { await addToQueue(payload); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Fuel Dock Berths</div>
            {fuelBerths.map(berth => {
              const occ = serviceEntries.find(e => e.fuel_berth === berth);
              return (
                <div key={berth} className="fuel-berth">
                  <div className="fuel-berth-id">{berth}</div>
                  {occ ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{occ.vessel_name || occ.guest_description}</div>
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>{occ.member_name || ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-teal">{occ.fuel_type}</span>
                        <span className="badge badge-teal">Fuelling</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>Available</div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Queue</div>
            {queue.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic', padding: '12px 0' }}>Queue is empty.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queue.map((q, idx) => (
                  <div key={q.id} className="card" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="lq-num">{idx + 1}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{q.vessel_name || q.guest_description}</div>
                          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
                            {q.member_name || q.guest_phone || ''}
                            {q.estimated_litres ? ` · ~${q.estimated_litres}L` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {q.fuel_type && <span className="badge badge-navy">{q.fuel_type}</span>}
                        <span className={`badge ${q.status === 'service' ? 'badge-teal' : q.status === 'next' ? 'badge-gold' : 'badge-gray'}`}>{q.status}</span>
                        {q.status !== 'completed' && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleAdvance(q)}>
                            {NEXT_LABEL[q.status]}
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => removeEntry(q.id)} title="Remove from queue">
                          <Ic n="x" s={11} />
                        </button>
                      </div>
                    </div>
                    {completingId === q.id && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                        <CompletionForm
                          entry={q}
                          onComplete={handleComplete}
                          onCancel={() => setCompletingId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Operations() {
  const [tab, setTab] = useState('fueldock');

  return (
    <div>
      <div className="tabs">
        {[['fueldock', 'Fuel Dock']].map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>
      {tab === 'fueldock' && <FuelDockTab />}
    </div>
  );
}
