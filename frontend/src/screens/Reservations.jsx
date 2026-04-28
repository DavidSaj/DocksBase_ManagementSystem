import { useState } from 'react';
import useBookings from '../hooks/useBookings.js';
import useBookingRequests from '../hooks/useBookingRequests.js';
import useVessels from '../hooks/useVessels.js';
import useBerths from '../hooks/useBerths.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api from '../api.js';

const filterMap = {
  all:       {},
  transient: { booking_type: 'transient' },
  seasonal:  { booking_type: 'seasonal' },
  pending:   { status: 'pending' },
  overdue:   { status: 'overstay' },
};

const bookingTabs = ['all', 'transient', 'seasonal', 'pending', 'overdue'];

function fmt(b) {
  return {
    ...b,
    vessel:   b.vessel_name  ?? b.vessel  ?? '—',
    owner:    b.owner_name   ?? b.owner   ?? '—',
    berth:    b.berth_code   ?? b.berth   ?? '—',
    checkin:  b.check_in     ?? b.checkin ?? '—',
    checkout: b.check_out    ?? b.checkout ?? '—',
    type:     b.booking_type ? (b.booking_type.charAt(0).toUpperCase() + b.booking_type.slice(1)) : (b.type ?? '—'),
    amount:   b.amount != null ? `€${Number(b.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—',
  };
}

function NewBookingModal({ onClose, onCreated }) {
  const { vessels } = useVessels();
  const { berths }  = useBerths();
  const availableBerths = berths.filter(b => b.status === 'available');

  const [form, setForm] = useState({
    vessel: '', berth: '', booking_type: 'transient', check_in: '', check_out: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const selectedBerth = availableBerths.find(b => b.id === Number(form.berth));
  const nights = (form.check_in && form.check_out)
    ? Math.max(1, Math.round((new Date(form.check_out) - new Date(form.check_in)) / 86400000))
    : null;
  const amountPreview = (selectedBerth?.price_per_night && nights)
    ? `€${(selectedBerth.price_per_night * nights).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`
    : '—';

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/bookings/', {
        vessel:       Number(form.vessel),
        berth:        Number(form.berth),
        booking_type: form.booking_type,
        check_in:     form.check_in,
        check_out:    form.check_out,
        notes:        form.notes,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data ? JSON.stringify(err.response.data) : 'Failed to create booking.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 480, padding: 24, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>New Booking</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={12} /></button>
        </div>
        <form onSubmit={submit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Vessel
              <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required style={{ marginTop: 4, width: '100%' }}>
                <option value="">Select vessel…</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Berth (available only)
              <select className="input" value={form.berth} onChange={e => set('berth', e.target.value)} required style={{ marginTop: 4, width: '100%' }}>
                <option value="">Select berth…</option>
                {availableBerths.map(b => (
                  <option key={b.id} value={b.id}>{b.code}{b.price_per_night ? ` — €${b.price_per_night}/night` : ''}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Type
              <select className="input" value={form.booking_type} onChange={e => set('booking_type', e.target.value)} style={{ marginTop: 4, width: '100%' }}>
                <option value="transient">Transient</option>
                <option value="seasonal">Seasonal</option>
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Check-in
                <input type="date" className="input" value={form.check_in} onChange={e => set('check_in', e.target.value)} required style={{ marginTop: 4, width: '100%' }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Check-out
                <input type="date" className="input" value={form.check_out} onChange={e => set('check_out', e.target.value)} required style={{ marginTop: 4, width: '100%' }} />
              </label>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Notes
              <textarea className="input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ marginTop: 4, width: '100%', resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f5f8ff', borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Estimated amount {nights ? `(${nights} nights)` : ''}</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>{amountPreview}</span>
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: '#fff5f5', borderRadius: 6 }}>{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
              {submitting ? 'Creating…' : 'Create Booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Reservations() {
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const { bookings, loading, updateBooking, refetch } = useBookings(
    bookingTabs.includes(tab) ? filterMap[tab] : {}
  );
  const { requests, loading: wlLoading, convertRequest } = useBookingRequests(
    tab === 'waitlist' ? { status: 'pending' } : {}
  );

  const rows = bookings.map(fmt);

  async function markPaid(b) {
    await updateBooking(b.id, { paid: true, status: 'checked_in' });
    setSel(prev => prev?.id === b.id ? { ...prev, paid: true, status: 'checked_in' } : prev);
  }

  async function offerBerth(id) {
    await convertRequest(id);
  }

  return (
    <div>
      {showModal && (
        <NewBookingModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); refetch(); }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div className="search"><Ic n="search" s={13} /><input placeholder="Search vessel, owner, booking…" /></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Ic n="plus" s={12} />New Booking</button>
      </div>
      <div className="tabs">
        {[['all','All'],['transient','Transient'],['seasonal','Seasonal'],['pending','Pending'],['overdue','Overdue'],['waitlist','Wait List']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => { setTab(v); setSel(null); }}>{l}</div>
        ))}
      </div>

      {bookingTabs.includes(tab) && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Booking</th><th>Vessel / Owner</th><th>Slip</th><th>Dates</th><th>Type</th><th>Status</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No bookings found.</td></tr>
                ) : rows.map(b => (
                  <tr key={b.id} style={{ cursor: 'pointer', background: sel?.id === b.id ? '#f5f8ff' : '' }} onClick={() => setSel(b)}>
                    <td><div className="tbl-name">{b.id}</div></td>
                    <td><div className="tbl-name">{b.vessel}</div><div className="tbl-sub">{b.owner}</div></td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{b.berth}</td>
                    <td><div style={{ fontSize: 12 }}>{b.checkin} → {b.checkout}</div><div className="tbl-sub">{b.nights} nights</div></td>
                    <td><StatusBadge s={b.type} /></td>
                    <td><StatusBadge s={b.status} /></td>
                    <td><div style={{ fontWeight: 600 }}>{b.amount}</div><div className="tbl-sub">{b.paid ? 'Paid' : 'Unpaid'}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sel && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div className="detail-title">{sel.id}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
              </div>
              <StatusBadge s={sel.status} />
              <div style={{ marginTop: 14 }}>
                {[['Vessel',sel.vessel],['Owner',sel.owner],['Slip',sel.berth],['Check-in',sel.checkin],['Check-out',sel.checkout],['Duration',`${sel.nights} nights`],['Type',sel.type],['Amount',sel.amount],['Payment',sel.paid?'Paid':'Outstanding']].map(([k,v]) => (
                  <div key={k} className="detail-row">
                    <div className="detail-key">{k}</div>
                    <div className="detail-val" style={{ color: k==='Payment' && !sel.paid ? 'var(--orange)' : k==='Payment' ? 'var(--green)' : undefined }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="detail-actions">
                {!sel.paid && <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => markPaid(sel)}>Mark as Paid</button>}
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Edit Booking</button>
                <button className="btn btn-danger" style={{ justifyContent: 'center' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'waitlist' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Berth Wait List</div>
              <span className="badge badge-navy">{requests.length}</span>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Applicant / Vessel</th><th>LOA</th><th>Berth Requested</th><th>Dates</th><th>Type</th><th>Status</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {wlLoading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</td></tr>
                ) : requests.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No pending requests.</td></tr>
                ) : requests.map(w => (
                  <tr key={w.id}>
                    <td>
                      <div className="tbl-name">{w.member_name || w.guest_name || '—'}</div>
                      <div className="tbl-sub">{w.vessel_name || w.guest_vessel || '—'}</div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{w.guest_loa ? `${w.guest_loa}m` : '—'}</td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{w.berth_code}</td>
                    <td style={{ fontSize: 12 }}>{w.start_date} → {w.end_date}</td>
                    <td><span className="badge badge-navy">{w.booking_type}</span></td>
                    <td><StatusBadge s={w.status} /></td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{w.notes || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => offerBerth(w.id)}>Offer Berth</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
