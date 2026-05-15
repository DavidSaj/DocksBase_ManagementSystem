// frontend/src/screens/settings/DataTab.jsx
//
// Settings → Data tab. Lets a manager request a marina-wide CSV/JSON
// export and download recent exports.

import { useEffect, useRef, useState } from 'react';
import api from '../../api.js';

const ENTITIES = [
  'Members',
  'Vessels',
  'Berths',
  'Reservations',
  'Invoices',
  'Payments',
];

function fmtBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }) {
  const cls = {
    pending: 'badge-gray',
    running: 'badge-blue',
    ready:   'badge-green',
    failed:  'badge-red',
  }[status] || 'badge-gray';
  const label = {
    pending: 'Queued',
    running: 'Generating',
    ready:   'Ready',
    failed:  'Failed',
  }[status] || status;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function DataTab() {
  const [exports, setExports] = useState(null); // null = loading
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const pollTimer = useRef(null);

  function load() {
    return api.get('/marina/exports/')
      .then(r => setExports(r.data.results ?? []))
      .catch(() => setExports([]));
  }

  useEffect(() => { load(); }, []);

  // Poll every 4s while any export is pending or running.
  useEffect(() => {
    if (!exports) return;
    const active = exports.some(e => e.status === 'pending' || e.status === 'running');
    clearTimeout(pollTimer.current);
    if (active) pollTimer.current = setTimeout(load, 4000);
    return () => clearTimeout(pollTimer.current);
  }, [exports]);

  async function handleRequest() {
    setCreating(true);
    setError(null);
    try {
      await api.post('/marina/exports/', {});
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not start export.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDownload(exp) {
    try {
      // Endpoint 302-redirects to the signed URL; let the browser follow it.
      const url = `${api.defaults.baseURL}/marina/exports/${exp.id}/download/`;
      // Use a hidden link so the Authorization header on api.* doesn't matter —
      // the redirect target is a signed URL anyway. We need a Bearer token to
      // hit our endpoint, so go via api and follow the redirect manually.
      const res = await api.get(`/marina/exports/${exp.id}/download/`, {
        maxRedirects: 0,
        validateStatus: s => s === 302 || (s >= 200 && s < 300),
      });
      const signed = res.headers?.location || res.request?.responseURL || url;
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (e) {
      // axios in browsers auto-follows redirects, so the GET likely already
      // resolved to the signed URL by the time we got here.
      if (e?.request?.responseURL) {
        window.open(e.request.responseURL, '_blank', 'noopener,noreferrer');
      } else {
        setError(e?.response?.data?.detail || 'Could not generate download link.');
      }
    }
  }

  const inProgress = exports?.some(e => e.status === 'pending' || e.status === 'running');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Request export */}
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Data Export</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>
              Download a CSV archive of your marina's data
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', lineHeight: 1.5 }}>
              Generates a zip file containing one CSV per entity. The link is sent
              to your email and stays available here for 7 days.
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Includes
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ENTITIES.map(e => (
                  <span key={e} className="badge badge-gray" style={{ fontSize: 11 }}>{e}</span>
                ))}
              </div>
            </div>
            {error && (
              <div style={{ background: '#fff5f5', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={creating || inProgress}
                onClick={handleRequest}
                title={inProgress ? 'Another export is in progress' : ''}
              >
                {creating ? 'Requesting…' : inProgress ? 'Export in progress…' : 'Request Export'}
              </button>
            </div>
          </div>
        </div>

        {/* Scheduled exports — Pro plan placeholder */}
        <div className="card" style={{ opacity: 0.65 }}>
          <div className="card-header">
            <div className="card-header-title">Scheduled Exports</div>
            <span className="badge badge-gold" style={{ fontSize: 10 }}>Pro plan</span>
          </div>
          <div className="card-body" style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', lineHeight: 1.5 }}>
            Send a weekly or monthly export automatically to S3, Dropbox, or email.
            Available on Professional and Enterprise plans.
          </div>
        </div>

        {/* Restore — Pro plan placeholder */}
        <div className="card" style={{ opacity: 0.65 }}>
          <div className="card-header">
            <div className="card-header-title">Point-in-time Restore</div>
            <span className="badge badge-gold" style={{ fontSize: 10 }}>Pro plan</span>
          </div>
          <div className="card-body" style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', lineHeight: 1.5 }}>
            Roll back your marina to a previous moment (e.g. before an accidental
            bulk update). Requests are reviewed by support to prevent data loss.
          </div>
        </div>
      </div>

      {/* Export history */}
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Recent Exports</div>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            {exports == null ? '' : `${exports.length} total`}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Status</th>
                <th>Size</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {exports == null && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px 16px', color: 'rgba(0,0,0,0.35)' }}>Loading…</td></tr>
              )}
              {exports && exports.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px 16px', color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>
                  No exports yet. Click <strong>Request Export</strong> to create one.
                </td></tr>
              )}
              {exports && exports.map(e => (
                <tr key={e.id}>
                  <td style={{ fontSize: 12 }}>{fmtTime(e.created_at)}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtBytes(e.size_bytes)}</td>
                  <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{fmtTime(e.expires_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {e.downloadable ? (
                      <button className="btn btn-sm btn-ghost" onClick={() => handleDownload(e)}>
                        Download
                      </button>
                    ) : e.status === 'failed' ? (
                      <span title={e.error_message} style={{ fontSize: 11, color: '#b91c1c' }}>
                        {e.error_message ? e.error_message.slice(0, 60) : 'Failed'}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
