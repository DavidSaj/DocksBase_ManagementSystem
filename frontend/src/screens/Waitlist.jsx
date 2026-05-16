import { useEffect, useState } from 'react';
import api from '../api';

// Seasonal-slip waitlist management. Lists pending entries, filters by
// slip-size fit, lets the manager offer a freed slip and handles the
// "Mark as Refunded Offline" action for the Stripe-180-day fallback.
export default function Waitlist() {
  const [entries, setEntries] = useState([]);
  const [berths, setBerths] = useState([]);
  const [selectedBerthId, setSelectedBerthId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [eRes, bRes] = await Promise.all([
          api.get('/waitlist/'),
          api.get('/berths/'),
        ]);
        if (cancelled) return;
        setEntries(eRes.data.results || eRes.data || []);
        setBerths(bRes.data.results || bRes.data || []);
      } catch (err) {
        setError(err?.response?.data?.detail || err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const selectedBerth = berths.find((b) => String(b.id) === String(selectedBerthId));
  const filtered = selectedBerth
    ? entries.filter((e) => (
        Number(e.pref_min_loa_m) <= Number(selectedBerth.length_m) &&
        Number(e.pref_max_loa_m) >= Number(selectedBerth.length_m) &&
        Number(e.vessel_beam_m) <= Number(selectedBerth.max_beam_m || 999) &&
        Number(e.vessel_draft_m) <= Number(selectedBerth.max_draft_m || 999)
      ))
    : entries;

  async function offer(entry) {
    if (!selectedBerthId) return;
    try {
      await api.post(`/waitlist/${entry.id}/offer/`, {
        berth_id: selectedBerthId,
        expires_in_hours: 48,
      });
      const eRes = await api.get('/waitlist/');
      setEntries(eRes.data.results || eRes.data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    }
  }

  async function markRefundedOffline(entry) {
    const actions = entry.refund_actions || [];
    const pending = actions.find((a) => !a.completed_at);
    if (!pending) return;
    try {
      await api.post(
        `/waitlist/${entry.id}/refund-actions/${pending.id}/complete/`,
        { audit_note: 'Marked as refunded offline by manager' }
      );
      const eRes = await api.get('/waitlist/');
      setEntries(eRes.data.results || eRes.data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    }
  }

  if (loading) return <div className="p-6">Loading waitlist…</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Seasonal Waitlist</h1>
      {error && <div className="bg-red-50 text-red-800 p-3 mb-4 rounded">{error}</div>}

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-gray-600">Filter by berth fit:</label>
        <select
          className="border rounded px-2 py-1"
          value={selectedBerthId}
          onChange={(e) => setSelectedBerthId(e.target.value)}
        >
          <option value="">— All entries —</option>
          {berths.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} ({b.length_m} m)
            </option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm border">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-2">#</th>
            <th className="text-left p-2">Applicant</th>
            <th className="text-left p-2">Vessel LOA</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Deposit</th>
            <th className="text-left p-2">Declines</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e, idx) => (
            <tr key={e.id} className="border-t">
              <td className="p-2">{idx + 1}</td>
              <td className="p-2">{e.applicant_name}<br /><span className="text-xs text-gray-500">{e.applicant_email}</span></td>
              <td className="p-2">{e.vessel_loa_m} m</td>
              <td className="p-2">{e.status}</td>
              <td className="p-2">{e.deposit_state}</td>
              <td className="p-2">{e.decline_count}</td>
              <td className="p-2">
                {e.status === 'pending' && selectedBerthId && (
                  <button className="px-3 py-1 bg-blue-600 text-white rounded"
                          onClick={() => offer(e)}>
                    Offer this slip
                  </button>
                )}
                {e.deposit_state === 'manual_refund_required' && (
                  <button className="ml-2 px-3 py-1 bg-amber-600 text-white rounded"
                          onClick={() => markRefundedOffline(e)}>
                    Mark Refunded Offline
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
