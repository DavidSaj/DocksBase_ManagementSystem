import { useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api';

const CREAM = '#f5f0e6';
const GOLD  = '#b8965a';

const DOCK_PILINGS = [72, 136, 200, 264];

function HeroScene() {
  return (
    <svg
      style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 180, pointerEvents: 'none' }}
      viewBox="0 0 1440 180"
      preserveAspectRatio="xMidYMax slice"
      fill="none"
    >
      {/* ── Horizon ── */}
      <line x1="0" y1="108" x2="1440" y2="108"
        stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.15" />

      {/* ── Water tint ── */}
      <rect x="0" y="108" width="1440" height="72" fill={CREAM} fillOpacity="0.015" />

      {/* ── Waves ── */}
      <path d="M 0,118 C 240,111 480,125 720,118 C 960,111 1200,125 1440,118"
        stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.10" />
      <path d="M 0,136 C 200,126 450,146 720,136 C 990,126 1240,146 1440,136"
        stroke={CREAM} strokeWidth="1.0" strokeOpacity="0.11" />
      <path d="M -20,158 C 180,146 410,170 680,158 C 950,146 1180,170 1440,158"
        stroke={CREAM} strokeWidth="1.1" strokeOpacity="0.09" />

      {/* ── Gold water glints ── */}
      <line x1="480"  y1="124" x2="514"  y2="124" stroke={GOLD} strokeWidth="0.8" strokeOpacity="0.18" />
      <line x1="492"  y1="130" x2="506"  y2="130" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.11" />
      <line x1="760"  y1="141" x2="796"  y2="141" stroke={GOLD} strokeWidth="0.7" strokeOpacity="0.14" />
      <line x1="1080" y1="130" x2="1112" y2="130" stroke={GOLD} strokeWidth="0.7" strokeOpacity="0.14" />
      <line x1="1220" y1="152" x2="1250" y2="152" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.10" />

      {/* ── Dock — left edge ── */}
      <rect x="0" y="96" width="310" height="12" fill={CREAM} fillOpacity="0.05" />
      <line x1="0" y1="96"  x2="310" y2="96"  stroke={CREAM} strokeWidth="1.6" strokeOpacity="0.20" />
      <line x1="0" y1="108" x2="310" y2="108" stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.13" />
      <line x1="0" y1="100" x2="310" y2="100" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.07" />
      <line x1="0" y1="104" x2="310" y2="104" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.06" />

      {/* Pilings */}
      {DOCK_PILINGS.map(x => (
        <rect key={x} x={x - 3} y="108" width="7" height="52" rx="2"
          fill={CREAM} fillOpacity="0.12" />
      ))}

      {/* Cross-bracing */}
      {DOCK_PILINGS.slice(0, -1).map((x, i) => {
        const nx = DOCK_PILINGS[i + 1];
        return (
          <g key={x}>
            <line x1={x}  y1="110" x2={nx} y2="142" stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.07" />
            <line x1={nx} y1="110" x2={x}  y2="142" stroke={CREAM} strokeWidth="0.6" strokeOpacity="0.07" />
          </g>
        );
      })}

      {/* Bollard caps */}
      {DOCK_PILINGS.map(x => (
        <rect key={x} x={x - 5} y="89" width="10" height="7" rx="1.5"
          fill={CREAM} fillOpacity="0.16" />
      ))}

      {/* ── Main sailboat — centre-right, bobs ── */}
      <motion.g
        animate={{ y: [0, -5, 1, -3, 0] }}
        transition={{ duration: 5.4, repeat: Infinity, ease: 'easeInOut', times: [0, 0.28, 0.52, 0.74, 1] }}
      >
        {/* Hull */}
        <path d="M 780,108 L 783,116 Q 836,121 896,115 L 900,108 L 892,102 L 781,102 Z"
          fill={CREAM} fillOpacity="0.16" stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.20" />
        {/* Cabin */}
        <path d="M 812,102 L 864,102 L 864,96 Q 848,93 834,93 Q 818,93 812,95 Z"
          fill={CREAM} fillOpacity="0.12" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.14" />
        {/* Mast */}
        <line x1="836" y1="102" x2="836" y2="18"
          stroke={CREAM} strokeWidth="1.3" strokeOpacity="0.22" />
        {/* Main sail */}
        <path d="M 836,18 L 836,102 L 900,110 Z"
          fill={CREAM} fillOpacity="0.11" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.15" />
        {/* Jib */}
        <path d="M 836,18 L 898,107 L 836,102 Z"
          fill={CREAM} fillOpacity="0.07" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.11" />
        {/* Boom */}
        <line x1="836" y1="102" x2="900" y2="110"
          stroke={CREAM} strokeWidth="0.8" strokeOpacity="0.14" />
      </motion.g>

      {/* ── Distant sailboat — mid-left, slower ── */}
      <motion.g
        animate={{ y: [0, -3, 0.8, -2, 0] }}
        transition={{ duration: 7.0, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
        opacity="0.65"
      >
        <path d="M 540,106 L 541,112 Q 568,116 600,112 L 602,106 L 598,103 L 542,103 Z"
          fill={CREAM} fillOpacity="0.13" stroke={CREAM} strokeWidth="0.5" strokeOpacity="0.16" />
        <line x1="564" y1="103" x2="564" y2="72"
          stroke={CREAM} strokeWidth="0.9" strokeOpacity="0.17" />
        <path d="M 564,72 L 564,103 L 601,108 Z"
          fill={CREAM} fillOpacity="0.07" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.11" />
      </motion.g>

      {/* ── Far distant boat — right ── */}
      <motion.g
        animate={{ y: [0, -2, 0.5, -1.5, 0] }}
        transition={{ duration: 8.2, repeat: Infinity, ease: 'easeInOut', delay: 3.2 }}
        opacity="0.40"
      >
        <path d="M 1160,107 L 1161,112 Q 1182,115 1208,112 L 1210,107 L 1206,104 L 1162,104 Z"
          fill={CREAM} fillOpacity="0.10" stroke={CREAM} strokeWidth="0.4" strokeOpacity="0.13" />
        <line x1="1178" y1="104" x2="1178" y2="80"
          stroke={CREAM} strokeWidth="0.7" strokeOpacity="0.14" />
        <path d="M 1178,80 L 1178,104 L 1208,108 Z"
          fill={CREAM} fillOpacity="0.06" stroke={CREAM} strokeWidth="0.3" strokeOpacity="0.09" />
      </motion.g>
    </svg>
  );
}

export default function SearchScreen({ state, navigate, marina }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    checkIn:   state.checkIn   || '',
    checkOut:  state.checkOut  || '',
    boatLoa:   state.boatLoa   || '',
    boatBeam:  state.boatBeam  || '',
    boatDraft: state.boatDraft || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const nights =
    form.checkIn && form.checkOut
      ? Math.round((new Date(form.checkOut) - new Date(form.checkIn)) / 86400000)
      : 0;

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    const params = new URLSearchParams({ check_in: form.checkIn, check_out: form.checkOut });
    if (form.boatLoa)   params.set('boat_loa',   form.boatLoa);
    if (form.boatBeam)  params.set('boat_beam',  form.boatBeam);
    if (form.boatDraft) params.set('boat_draft', form.boatDraft);

    try {
      const { data: cats } = await api.get(`/public/bookings/berth-categories/?${params}`);
      if (cats.length > 0) { navigate('options', { ...form, categories: cats }); return; }

      const { data: berths } = await api.get(`/public/bookings/available-berths/?${params}`);
      if (berths.length > 0) {
        const price = parseFloat(berths[0].pricing_tier_unit_price || 0);
        navigate('quote', { ...form, quotedPrice: price, quotedTotal: price * nights, selectedCategory: null });
        return;
      }
      const { data: alts } = await api.get(`/public/bookings/availability-alternatives/?${params}`);
      if (alts.length > 0) { navigate('alternatives', { ...form, alternatives: alts }); return; }
      setError('No availability for those dates or vessel size. Please contact the marina directly.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      {/* Dark hero section */}
      <div className="p-hero" style={{ minHeight: 300 }}>
        <nav style={{ maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56, display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>

        <div className="p-hero-inner">
          <div className="p-eyebrow">Online Reservations</div>
          <h1 className="p-title">Book a Berth</h1>
          <p className="p-sub">Check real-time availability and reserve your spot.</p>
        </div>

        <HeroScene />
      </div>

      {/* White form card */}
      <div className="p-form-card">
        <div className="p-form-card-inner">
          {state.errorBanner && (
            <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{state.errorBanner}</p>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Arrival</label>
                <input className="p-input" type="date" required min={today}
                  value={form.checkIn} onChange={e => set('checkIn', e.target.value)} />
              </div>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Departure</label>
                <input className="p-input" type="date" required min={form.checkIn || today}
                  value={form.checkOut} onChange={e => set('checkOut', e.target.value)} />
              </div>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Vessel length (m)</label>
                <input className="p-input" type="number" step="0.1" min="1" placeholder="e.g. 12"
                  value={form.boatLoa} onChange={e => set('boatLoa', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Beam (m) — optional</label>
                <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 4.2"
                  value={form.boatBeam} onChange={e => set('boatBeam', e.target.value)} />
              </div>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Draft (m) — optional</label>
                <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 1.8"
                  value={form.boatDraft} onChange={e => set('boatDraft', e.target.value)} />
              </div>
              <button type="submit" className="p-btn-gold" disabled={busy}
                style={{ whiteSpace: 'nowrap', height: 41 }}>
                {busy ? 'Checking…' : 'Check availability →'}
              </button>
            </div>

            {nights > 0 && (
              <p className="p-nights-note" style={{ marginTop: 10 }}>
                {nights} night{nights !== 1 ? 's' : ''}
              </p>
            )}

            {error && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 12 }}>{error}</p>}
          </form>
        </div>
      </div>

      <p className="p-powered">Powered by DocksBase</p>
    </div>
  );
}
