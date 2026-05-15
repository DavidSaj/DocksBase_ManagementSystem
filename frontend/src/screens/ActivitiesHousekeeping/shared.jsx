import Ic from '../../components/ui/Icon.jsx';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDT(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from, to) {
  const days = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

export function bookingStatusBadge(s) {
  const map = {
    confirmed: 'badge-green',
    cancelled: 'badge-red',
    completed: 'badge-gray',
    no_show:   'badge-orange',
  };
  const label = { confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed', no_show: 'No Show' };
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{label[s] ?? s}</span>;
}

export function categoryBadge(c) {
  const map = {
    water_sport: 'badge-blue',
    lesson:      'badge-purple',
    equipment:   'badge-navy',
    guided_trip: 'badge-teal',
    wellness:    'badge-green',
    other:       'badge-gray',
  };
  const label = {
    water_sport: 'Water Sport', lesson: 'Lesson', equipment: 'Equipment Hire',
    guided_trip: 'Guided Trip', wellness: 'Wellness', other: 'Other',
  };
  return <span className={`badge ${map[c] ?? 'badge-gray'}`}>{label[c] ?? c}</span>;
}

export function taskStatusBadge(s) {
  const map = {
    dirty:            'badge-red',
    in_progress:      'badge-orange',
    ready_inspection: 'badge-blue',
    clean:            'badge-teal',
    ready_guest:      'badge-green',
  };
  const label = {
    dirty: 'Dirty', in_progress: 'In Progress', ready_inspection: 'Ready for Inspection',
    clean: 'Clean', ready_guest: 'Ready for Guest',
  };
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{label[s] ?? s}</span>;
}

export function priorityBadge(p) {
  const map = { normal: 'badge-gray', high: 'badge-orange', urgent: 'badge-red' };
  return <span className={`badge ${map[p] ?? 'badge-gray'}`}>{p}</span>;
}

// ─── Loading / empty states ──────────────────────────────────────────────────

export function Loading({ label = 'Loading…' }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      {label}
    </div>
  );
}

export function Empty({ title, subtitle }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export function Err({ msg = 'Failed to load data.' }) {
  return (
    <div style={{ padding: 20, color: '#c92a2a', fontSize: 13 }}>{msg}</div>
  );
}

// ─── Shared: Section header ──────────────────────────────────────────────────

export function SecHdr({ title, children }) {
  return (
    <div className="sec-hdr">
      <span className="sec-hdr-title">{title}</span>
      {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}

// ─── Shared: Drawer shell ───────────────────────────────────────────────────

export function Drawer({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Shared: Form field ──────────────────────────────────────────────────────

export function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#c92a2a' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

export const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box', background: '#fff',
};
