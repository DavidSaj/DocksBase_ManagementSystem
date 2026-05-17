// portal/src/screens/tabs/UtilitiesTab.jsx
import { useState, useEffect } from 'react';
import { fetchMemberUtilities } from '@docksbase/portal-ui/api';

function MeterCard({ meter }) {
  const value  = meter.last_reading_value;
  const unit   = meter.last_reading_unit;
  const when   = meter.last_reading_at
    ? new Date(meter.last_reading_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const isElec = meter.meter_type === 'electricity';

  return (
    <div className="p-util-card">
      <div className="p-util-card-header">
        <div>
          <div className="p-util-type">{isElec ? 'Shore Power' : 'Water'}</div>
          {meter.berth_code && <div className="p-util-berth">{meter.berth_code}</div>}
        </div>
        <div className="p-util-icon">
          {isElec
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z"/></svg>
          }
        </div>
      </div>
      <div className="p-util-reading">
        {value !== null && value !== undefined ? `${value} ${unit}` : 'No readings yet'}
      </div>
      {when && <div className="p-util-updated">Last updated: {when}</div>}
      {!when && <div className="p-util-updated">Awaiting first reading from marina staff</div>}
    </div>
  );
}

export default function UtilitiesTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  function load() {
    setLoading(true);
    fetchMemberUtilities()
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e.response?.status === 403 ? 'disabled' : 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-tab-loading">Loading utilities…</div>;
  if (error === 'disabled') return <div className="p-tab-stub">Utility tracking is not enabled for this marina.</div>;
  if (error) return <div className="p-tab-stub">Could not load utility data.</div>;

  const meters = data?.meters || [];

  return (
    <div className="p-util-root">
      <div className="p-util-header">Utilities</div>
      {meters.length === 0 && (
        <div className="p-tab-stub">No meters assigned to your berth yet.</div>
      )}
      {meters.map(m => <MeterCard key={m.id} meter={m} />)}
      <div className="p-util-note">
        Readings entered daily by marina staff. Contact the harbour master if your berth is not listed.
      </div>
    </div>
  );
}
