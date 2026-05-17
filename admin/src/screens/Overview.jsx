import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function PlanBadge({ plan }) {
  const colors = { starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-gold' };
  const labels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  return <span className={`badge ${colors[plan] || 'badge-gray'}`}>{labels[plan] || plan}</span>;
}

function StatusBadge({ status }) {
  const map = { active: 'badge-green', trial: 'badge-teal', suspended: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

const EMPTY_ENTERPRISE = { name: '', slug: '', billing_contact_email: '', max_marinas: 2, base_currency: 'EUR' };

function CreateEnterpriseCard() {
  const [open, setOpen]       = useState(false);
  const [form, setForm]       = useState(EMPTY_ENTERPRISE);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);
  const [created, setCreated] = useState(null);

  function update(field, value) {
    setForm(p => ({ ...p, [field]: value }));
  }

  async function handleCreate() {
    setErr(null);
    if (!form.name.trim() || !form.slug.trim()) {
      setErr('Name and slug are required.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('admin/groups/', {
        ...form,
        // Django SlugField rejects spaces / mixed case — normalise here so
        // the form doesn't blow up on a perfectly reasonable user input.
        slug: form.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, ''),
        max_marinas: parseInt(form.max_marinas) || 1,
      });
      setCreated(data);
      setForm(EMPTY_ENTERPRISE);
    } catch (e) {
      const d = e.response?.data;
      setErr(typeof d === 'string' ? d : d?.detail || Object.values(d || {}).flat().join(', ') || 'Failed to create enterprise.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => { setOpen(o => !o); setCreated(null); setErr(null); }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic n="layers" s={14} c="rgba(180,140,0,0.9)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Create Enterprise account</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>Provision a new enterprise group (multi-marina, custom contract).</div>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); setCreated(null); setErr(null); }}>
          <Ic n="plus" s={12} /> {open ? 'Close' : 'New Enterprise'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)' }}>
          {created ? (
            <div style={{ fontSize: 12, color: 'var(--green, #2e7d32)' }}>
              <Ic n="check" s={12} /> Enterprise <strong>{created.name}</strong> created. Add marinas and assign an admin from the Groups screen.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreated(null); }}>Create another</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                {[
                  ['Name',            'name',                  'text',   'Acme Holdings'],
                  ['Slug',            'slug',                  'text',   'acme'],
                  ['Billing email',   'billing_contact_email', 'email',  'billing@acme.com'],
                  ['Marina limit',    'max_marinas',           'number', '2'],
                  ['Base currency',   'base_currency',         'text',   'EUR'],
                ].map(([label, field, type, ph]) => (
                  <label key={field} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 }}>
                    <span style={{ color: 'rgba(0,0,0,0.55)' }}>{label}</span>
                    <input
                      type={type}
                      placeholder={ph}
                      value={form[field]}
                      onChange={e => update(field, e.target.value)}
                      style={{ fontSize: 12, padding: '4px 6px' }}
                    />
                  </label>
                ))}
              </div>
              {err && <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={handleCreate}>
                  {saving ? 'Creating…' : 'Create enterprise'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => { setForm(EMPTY_ENTERPRISE); setErr(null); }}>
                  Reset
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Overview() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    api.get('admin/overview/')
      .then(r => setData(r.data))
      .catch(() => setError('Could not load overview data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">{error}</div></div>;

  const { mrr, arr, active_marinas, trial_marinas, total_berths, gmv, alerts, recent_signups } = data;
  const { overdue_payments, trials_ending_soon, suspended } = alerts;

  return (
    <div>
      {/* Alerts */}
      {(overdue_payments.length > 0 || suspended.length > 0 || trials_ending_soon.length > 0) && (
        <div style={{ marginBottom: 20 }}>
          {suspended.map(m => (
            <div key={m.id} className="alert-row danger">
              <Ic n="alert-tri" s={14} c="#c0392b" />
              <div style={{ flex: 1 }}>
                <div className="alert-row-text"><strong>{m.name}</strong> — account suspended</div>
                <div className="alert-row-sub">{m.suspend_reason}</div>
              </div>
              <span className="badge badge-red">Suspended</span>
            </div>
          ))}
          {overdue_payments.map(p => (
            <div key={p.id} className="alert-row warn">
              <Ic n="alert-tri" s={14} c="#b04000" />
              <div style={{ flex: 1 }}>
                <div className="alert-row-text"><strong>{p.marina_name}</strong> — payment overdue</div>
                <div className="alert-row-sub">€{p.amount}</div>
              </div>
              <span className="badge badge-orange">Overdue</span>
            </div>
          ))}
          {trials_ending_soon.map(t => {
            const days = Math.ceil((new Date(t.trial_ends) - new Date()) / 86400000);
            return (
              <div key={t.id} className="alert-row warn">
                <Ic n="alert-tri" s={14} c="#b04000" />
                <div style={{ flex: 1 }}>
                  <div className="alert-row-text"><strong>{t.name}</strong> — trial ends in {days} days</div>
                  <div className="alert-row-sub">{t.timezone} · on {t.plan} plan</div>
                </div>
                <span className="badge badge-teal">Trial</span>
              </div>
            );
          })}
        </div>
      )}

      <CreateEnterpriseCard />

      {/* KPI cards */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Monthly Recurring Revenue', val: `€${Number(mrr).toLocaleString()}`,       sub: `€${Math.round(arr/1000)}k ARR`,             icon: 'dollar' },
          { label: 'Active Marinas',             val: active_marinas,                           sub: `${active_marinas + trial_marinas} total`,   icon: 'anchor' },
          { label: 'Trial Accounts',             val: trial_marinas,                            sub: `${trials_ending_soon.length} ending ≤14 days`, icon: 'users' },
          { label: 'Total Berths Managed',       val: Number(total_berths).toLocaleString(),    sub: 'across active accounts',                     icon: 'globe' },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div className="stat-label">{k.label}</div>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.4)' }}>
                <Ic n={k.icon} s={13} />
              </div>
            </div>
            <div className="stat-val">{k.val}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent signups */}
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Recent signups</span>
        </div>
        <table className="tbl">
          <tbody>
            {recent_signups.map(m => (
              <tr key={m.id} style={{ cursor: 'default' }}>
                <td>
                  <div className="tbl-name">{m.name}</div>
                  <div className="tbl-sub">{m.timezone}</div>
                </td>
                <td><PlanBadge plan={m.plan} /></td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ marginBottom: 4 }}><StatusBadge status={m.status} /></div>
                  <div className="tbl-sub">{new Date(m.created_at).toLocaleDateString()}</div>
                </td>
              </tr>
            ))}
            {recent_signups.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No signups yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
