import { useEffect, useState } from 'react';
import api from '@docksbase/portal-ui/api';

const STATUS_BADGE = {
  confirmed:       { label: 'Confirmed',  cls: 'badge-green' },
  pending:         { label: 'Pending',    cls: 'badge-gold'  },
  pending_payment: { label: 'Unpaid',     cls: 'badge-gold'  },
  awaiting_payment:{ label: 'Unpaid',     cls: 'badge-gold'  },
  pending_approval:{ label: 'In review',  cls: 'badge-gray'  },
  checked_in:      { label: 'Checked in', cls: 'badge-green' },
  checked_out:     { label: 'Past',       cls: 'badge-gray'  },
  overstay:        { label: 'Overstay',   cls: 'badge-gold'  },
  no_show:         { label: 'No show',    cls: 'badge-gray'  },
};

function fmtRange(checkIn, checkOut) {
  if (!checkIn) return '';
  const opts = { month: 'short', day: 'numeric' };
  const a = new Date(checkIn).toLocaleDateString(undefined, opts);
  if (!checkOut) return a;
  const b = new Date(checkOut).toLocaleDateString(undefined, { ...opts, year: 'numeric' });
  return `${a} → ${b}`;
}

function TripRow({ trip, highlighted, onOpen }) {
  const badge = STATUS_BADGE[trip.status] || { label: trip.status, cls: 'badge-gray' };
  return (
    <button
      type="button"
      onClick={() => onOpen(trip)}
      className="p-trip-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '14px 16px',
        marginBottom: 10,
        background: highlighted ? 'rgba(212,175,55,0.08)' : 'white',
        border: highlighted ? '1px solid var(--gold, #d4af37)' : '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'IBM Plex Sans, sans-serif',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(0,0,0,0.85)' }}>
          {trip.marina.name}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
          {fmtRange(trip.check_in, trip.check_out)} · {trip.ref}
        </div>
      </div>
      <span className={`badge ${badge.cls}`} style={{ flexShrink: 0, marginLeft: 12 }}>
        {badge.label}
      </span>
    </button>
  );
}

export default function MyTripsScreen() {
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'unauth' | 'error'
  const [data, setData] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const highlightedRef = params.get('ref') || null;

  useEffect(() => {
    const token = localStorage.getItem('portal_boater_session_token')
               || localStorage.getItem('portal_session_token');
    if (!token) {
      setState('unauth');
      return;
    }
    let cancelled = false;
    api.get('/portal/my-trips/')
      .then(r => { if (!cancelled) { setData(r.data); setState('ready'); } })
      .catch(err => {
        if (cancelled) return;
        if (err.response?.status === 401) setState('unauth');
        else setState('error');
      });
    return () => { cancelled = true; };
  }, []);

  function openTrip(trip) {
    localStorage.setItem('portal_marina_slug', trip.marina.slug);
    window.location.assign(trip.deep_link);
  }

  if (state === 'loading') {
    return (
      <div style={center}>
        <div style={muted}>Loading your trips…</div>
      </div>
    );
  }

  if (state === 'unauth') {
    return (
      <div style={center}>
        <div style={{ ...muted, maxWidth: 320, textAlign: 'center' }}>
          You need to sign in first. Open the secure link from your booking confirmation email.
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={center}>
        <div style={muted}>Could not load your trips. Please try again later.</div>
      </div>
    );
  }

  const upcoming = data.trips.filter(t => t.upcoming);
  const past = data.trips.filter(t => !t.upcoming);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #faf7f0)', padding: '24px 16px 80px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 28,
            fontWeight: 600,
            margin: '8px 0 4px',
            color: 'rgba(0,0,0,0.85)',
          }}
        >
          My Trips
        </h1>
        <div style={{ ...muted, marginBottom: 20 }}>{data.email}</div>

        <Section title="Upcoming" empty="No upcoming trips.">
          {upcoming.map(t => (
            <TripRow
              key={`${t.type}-${t.id}`}
              trip={t}
              highlighted={t.ref === highlightedRef}
              onOpen={openTrip}
            />
          ))}
        </Section>

        {past.length > 0 && (
          <Section title="Past">
            {past.map(t => (
              <TripRow
                key={`${t.type}-${t.id}`}
                trip={t}
                highlighted={t.ref === highlightedRef}
                onOpen={openTrip}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, empty, children }) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <div style={{ marginTop: 16 }}>
      <h2
        style={{
          fontFamily: 'IBM Plex Sans, sans-serif',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: 'rgba(0,0,0,0.45)',
          margin: '0 0 10px 4px',
        }}
      >
        {title}
      </h2>
      {isEmpty
        ? <div style={{ ...muted, padding: '8px 4px' }}>{empty}</div>
        : children
      }
    </div>
  );
}

const center = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg, #faf7f0)',
  padding: 24,
};

const muted = {
  color: 'rgba(0,0,0,0.5)',
  fontSize: 14,
  fontFamily: 'IBM Plex Sans, sans-serif',
};
