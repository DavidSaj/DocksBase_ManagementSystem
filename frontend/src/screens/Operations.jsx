import { useState, useEffect, useCallback, useRef } from 'react';
import useFuelQueue from '../hooks/useFuelQueue.js';
import useBerths from '../hooks/useBerths.js';
import useVessels from '../hooks/useVessels.js';
import useFuelEntries from '../hooks/useFuelEntries.js';
import usePOSCatalog from '../hooks/usePOSCatalog.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import FuelPricesWidget from './FuelPricesWidget.jsx';
import api from '../api.js';

const FUEL_DOCK_FILTER = { operational_type: 'fuel_dock' };

function AddQueueForm({ vessels, onAdd, onCancel }) {
  const [mode, setMode] = useState('stranger');
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
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add to Queue'}</button>
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

function BerthPickerModal({ entry, fuelBerths, serviceEntries, onPick, onCancel }) {
  const occupiedIds = new Set(serviceEntries.map(e => e.fuel_berth).filter(Boolean));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">Assign to Fuel Berth</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}><Ic n="x" s={13}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 8px' }}>
          {fuelBerths.length === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', fontStyle: 'italic' }}>
              No fuel dock berths configured. Add them in Harbor Infrastructure.
            </div>
          )}
          {fuelBerths.map(berth => {
            const occupied = occupiedIds.has(berth.id);
            return (
              <button
                key={berth.id}
                type="button"
                disabled={occupied}
                onClick={() => onPick(berth.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 6, cursor: occupied ? 'not-allowed' : 'pointer',
                  border: '1.5px solid rgba(0,0,0,0.12)',
                  background: occupied ? 'rgba(0,0,0,0.04)' : '#fff8e8',
                  opacity: occupied ? 0.6 : 1,
                  fontFamily: 'var(--font)',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{berth.code}</span>
                {occupied
                  ? <span className="badge badge-teal">In Use</span>
                  : <span className="badge badge-green">Available</span>
                }
              </button>
            );
          })}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function FuelDockTab() {
  const { queue, loading, addToQueue, advanceEntry, removeEntry } = useFuelQueue();
  const { vessels } = useVessels();
  const { berths: fuelBerths } = useBerths(FUEL_DOCK_FILTER);
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [completingId,   setCompletingId]   = useState(null);
  const [berthPickingId, setBerthPickingId] = useState(null);

  const NEXT_LABEL = { waiting: 'Next', next: 'To Berth', service: 'Complete' };

  async function handleAdvance(entry) {
    if (entry.status === 'service') {
      setCompletingId(entry.id);
    } else if (entry.status === 'next') {
      setBerthPickingId(entry.id);
    } else {
      await advanceEntry(entry.id, { status: 'next' });
    }
  }

  async function handleBerthPick(berthId) {
    await advanceEntry(berthPickingId, { status: 'service', fuel_berth: berthId });
    setBerthPickingId(null);
  }

  async function handleComplete(id, patch) {
    await advanceEntry(id, patch);
    setCompletingId(null);
  }

  const serviceEntries = queue.filter(e => e.status === 'service');
  const berthPickingEntry = queue.find(e => e.id === berthPickingId);

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

      {berthPickingEntry && (
        <BerthPickerModal
          entry={berthPickingEntry}
          fuelBerths={fuelBerths}
          serviceEntries={serviceEntries}
          onPick={handleBerthPick}
          onCancel={() => setBerthPickingId(null)}
        />
      )}

      <FuelPricesWidget />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Fuel Dock Berths</div>
            {fuelBerths.length === 0 && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic', padding: '10px 0' }}>
                No fuel dock berths. Create berths with Classification → Operational → Fuel Dock in Harbor Infrastructure.
              </div>
            )}
            {fuelBerths.map(berth => {
              const occ = serviceEntries.find(e => e.fuel_berth === berth.id);
              return (
                <div key={berth.id} className="fuel-berth">
                  <div className="fuel-berth-id">{berth.code}</div>
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
                            {q.fuel_berth_code ? ` · Berth ${q.fuel_berth_code}` : ''}
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

const FUEL_COLORS = { diesel: '#0075de', petrol: '#dd5b00', pump_out: '#2a9d99' };

export default function Operations() {
  const [tab, setTab] = useState('fueldock');

  // Fuel Dock POS state
  const { entries: fuelEntries, loading: fuelLoading, refetch: refetchFuelEntries } = useFuelEntries({ limit: 20 });
  const { items: posCatalog, loading: posLoading } = usePOSCatalog();
  const [selectedPOSItem, setSelectedPOSItem] = useState(null);
  const [posLitres,       setPosLitres]       = useState('');
  const [posQuery,        setPosQuery]        = useState('');
  const [posSuggestions,  setPosSuggestions]  = useState([]);
  const [posResolved,     setPosResolved]     = useState(null);
  const [posSubmitting,   setPosSubmitting]   = useState(false);
  const [posError,        setPosError]        = useState('');
  const debounceRef = useRef(null);

  function posTotal() {
    if (!selectedPOSItem) return 0;
    if (selectedPOSItem.pricing_model === 'per_litre') {
      const l = parseFloat(posLitres);
      return (isNaN(l) || l <= 0) ? 0 : +(l * parseFloat(selectedPOSItem.unit_price)).toFixed(2);
    }
    return parseFloat(selectedPOSItem.unit_price);
  }

  function posPriceLabel(item) {
    return item.pricing_model === 'per_litre'
      ? `€${Number(item.unit_price).toFixed(2)}/L`
      : `€${Number(item.unit_price).toFixed(2)} flat`;
  }

  function handlePosQueryChange(e) {
    const val = e.target.value;
    setPosQuery(val);
    setPosResolved(null);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setPosSuggestions([]); return; }
    debounceRef.current = setTimeout(() => {
      api.get('/members/', { params: { search: val } })
        .then(r => setPosSuggestions((r.data.results ?? r.data).slice(0, 5)))
        .catch(() => {});
    }, 300);
  }

  function handlePosSuggestionSelect(member) {
    const vessel = member.vessels?.[0] ?? null;
    setPosResolved({ id: member.id, vesselId: vessel?.id ?? null });
    setPosQuery(vessel ? `${member.name} — ${vessel.name}` : member.name);
    setPosSuggestions([]);
  }

  function clearPosForm() {
    clearTimeout(debounceRef.current);
    setSelectedPOSItem(null);
    setPosLitres('');
    setPosQuery('');
    setPosSuggestions([]);
    setPosResolved(null);
    setPosSubmitting(false);
    setPosError('');
  }

  async function handleProcessSale() {
    const total = posTotal();
    if (total <= 0) return;
    setPosSubmitting(true);
    setPosError('');
    try {
      const isPerLitre = selectedPOSItem.pricing_model === 'per_litre';
      await api.post('/fuel-dock/queue/', {
        status:          'completed',
        fuel_type:       selectedPOSItem.fuel_dock_type,
        actual_litres:   isPerLitre ? posLitres : null,
        price_per_litre: isPerLitre ? selectedPOSItem.unit_price : null,
        total_amount:    isPerLitre ? null : String(parseFloat(selectedPOSItem.unit_price).toFixed(2)),
        ...(posResolved
          ? { member: posResolved.id, ...(posResolved.vesselId ? { vessel: posResolved.vesselId } : {}) }
          : { guest_description: posQuery || 'Walk-up' }),
      });
      clearPosForm();
      refetchFuelEntries();
    } catch {
      setPosError('Sale failed — please try again.');
    } finally {
      setPosSubmitting(false);
    }
  }

  const posTotalAmount = posTotal();

  return (
    <div>
      <div className="tabs">
        {[['fueldock', 'Fuel Dock'], ['pos', 'Fuel Dock POS']].map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>
      {tab === 'fueldock' && <FuelDockTab />}

      {tab === 'pos' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="card-header"><div className="card-header-title">Fuel Dock — Quick Sale</div></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {posLoading ? (
                  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 8 }}>Loading catalog…</div>
                ) : posCatalog.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 8 }}>
                    No POS items configured. Add items in Settings → Service Catalog and enable "Show in POS".
                  </div>
                ) : posCatalog.map(item => (
                  <div key={item.id}
                    onClick={() => { setPosLitres(''); setPosError(''); setPosSubmitting(false); setSelectedPOSItem(item); }}
                    style={{
                      background: selectedPOSItem?.id === item.id ? 'var(--bg-active, #eef4ff)' : 'var(--bg)',
                      borderRadius: 8, padding: '14px', cursor: 'pointer',
                      border: selectedPOSItem?.id === item.id ? '1.5px solid var(--blue, #0075de)' : 'var(--border)',
                      transition: 'box-shadow 0.1s',
                    }}
                    onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow2)'}
                    onMouseOut={e  => e.currentTarget.style.boxShadow = ''}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.8)' }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: FUEL_COLORS[item.fuel_dock_type] ?? '#888', fontWeight: 600, marginTop: 4 }}>
                      {posPriceLabel(item)}
                    </div>
                  </div>
                ))}
              </div>

              {selectedPOSItem && (
                <div style={{ marginTop: 12, padding: '12px 0 4px', borderTop: 'var(--border)' }}>

                  {/* Member / Guest combobox */}
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 3 }}>
                      Vessel / Member <span style={{ fontWeight: 400 }}>(optional)</span>
                    </div>
                    <input
                      value={posQuery}
                      onChange={handlePosQueryChange}
                      onBlur={() => setTimeout(() => setPosSuggestions([]), 200)}
                      placeholder="Search member or type guest name…"
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px',
                        border: 'var(--border)', borderRadius: 6, outline: 'none',
                        borderColor: posResolved ? 'var(--green, #2a9d50)' : undefined }}
                    />
                    {posResolved && (
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-2px)',
                        color: 'var(--green, #2a9d50)', fontSize: 13, fontWeight: 700 }}>✓</span>
                    )}
                    {posSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                        background: '#fff', border: 'var(--border)', borderRadius: 6,
                        boxShadow: 'var(--shadow2)', marginTop: 2 }}>
                        {posSuggestions.map(m => (
                          <div key={m.id}
                            onMouseDown={() => handlePosSuggestionSelect(m)}
                            style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
                            onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow2)'}
                            onMouseOut={e  => e.currentTarget.style.boxShadow = ''}>
                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                            {m.vessels?.[0] && <span style={{ color: 'rgba(0,0,0,0.4)', marginLeft: 6 }}>— {m.vessels[0].name}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Litres input (per_litre items only) */}
                  {selectedPOSItem.pricing_model === 'per_litre' && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 3 }}>Litres</div>
                      <input
                        type="number" min="0" step="0.1"
                        value={posLitres}
                        onChange={e => setPosLitres(e.target.value)}
                        placeholder="0.0"
                        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px',
                          border: 'var(--border)', borderRadius: 6, outline: 'none' }}
                      />
                    </div>
                  )}

                  {/* Total */}
                  {posTotalAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: 10, fontSize: 13 }}>
                      <span style={{ color: 'rgba(0,0,0,0.5)' }}>Total</span>
                      <span style={{ fontWeight: 700 }}>€{posTotalAmount.toFixed(2)}</span>
                    </div>
                  )}

                  {posError && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{posError}</div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={clearPosForm} style={{ flex: 1 }}>Cancel</button>
                    <button
                      className="btn btn-gold"
                      onClick={handleProcessSale}
                      disabled={posSubmitting || posTotalAmount <= 0}
                      style={{ flex: 2, justifyContent: 'center', fontSize: 13, padding: '10px' }}>
                      {posSubmitting ? 'Processing…' : 'Process Sale'}
                    </button>
                  </div>
                </div>
              )}

              {!selectedPOSItem && (
                <button className="btn btn-gold" style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: '10px', marginTop: 12 }} disabled>
                  Select item above
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-header-title">Recent Fuel Sales</div></div>
            <div className="card-body" style={{ padding: 0 }}>
              {fuelLoading ? (
                <div style={{ padding: '16px 18px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
              ) : fuelEntries.length === 0 ? (
                <div style={{ padding: '16px 18px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No completed sales yet.</div>
              ) : fuelEntries.map(e => {
                const name = e.vessel_name ?? e.guest_description ?? '—';
                const litres = e.actual_litres ? `${e.actual_litres}L` : '—';
                const fuelLabel = e.fuel_type === 'pump_out' ? 'Pump-out' : (e.fuel_type ?? '—').charAt(0).toUpperCase() + (e.fuel_type ?? '').slice(1);
                const amount = e.total_amount != null ? `€${Number(e.total_amount).toFixed(2)}` : '—';
                const when = e.completed_at ? new Date(e.completed_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
                return (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: 'var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>{fuelLabel} · {litres} · {when}</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{amount}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
