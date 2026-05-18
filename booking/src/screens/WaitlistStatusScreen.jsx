import { useEffect, useState } from 'react';
import api from '@docksbase/portal-ui/api';

export default function WaitlistStatusScreen({ entryId }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!entryId) return;
    api.get(`/waitlist/${entryId}/`)
      .then((res) => setEntry(res.data))
      .catch((err) => setError(err?.response?.data?.detail || err.message));
  }, [entryId]);

  async function withdraw() {
    if (!entry) return;
    if (!confirm('Withdraw from the waitlist? A refund will be initiated.')) return;
    try {
      await api.post(`/waitlist/${entry.id}/withdraw/`);
      const res = await api.get(`/waitlist/${entry.id}/`);
      setEntry(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    }
  }

  if (error) return <div className="p-4 text-red-700">{error}</div>;
  if (!entry) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-xl font-semibold mb-2">Your Waitlist Status</h2>
      <p>Name: {entry.applicant_name}</p>
      <p>Status: <strong>{entry.status}</strong></p>
      <p>Deposit: {entry.deposit_state}</p>
      <p>Declines: {entry.decline_count}</p>
      {entry.status === 'pending' && (
        <button className="mt-4 px-3 py-2 bg-red-600 text-white rounded" onClick={withdraw}>
          Withdraw
        </button>
      )}
    </div>
  );
}
