import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function WaitlistOfferScreen() {
  const { token } = useParams();
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    api.get(`/waitlist/offers/${token}/`)
      .then((res) => setOffer(res.data))
      .catch((err) => setError(err?.response?.data?.detail || err.message));
  }, [token]);

  async function respond(decision) {
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post(`/waitlist/offers/${token}/respond/`, {
        response: decision,
        reason: decision === 'decline' ? reason : '',
      });
      setDone(res.data);
    } catch (err) {
      // 409 conflict -> tell user to refresh
      if (err?.response?.status === 409) {
        setError('This offer is no longer available. Please refresh your page.');
      } else {
        setError(err?.response?.data?.detail || err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <div className="p-4 text-red-700">{error}</div>;
  if (!offer) return <div className="p-4">Loading…</div>;

  if (done) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold">Thanks - your response has been recorded.</h2>
        <pre className="text-xs bg-gray-100 p-2 mt-2">{JSON.stringify(done, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-xl font-semibold mb-2">A berth has been offered to you</h2>
      <p>Expires at: {offer.expires_at}</p>
      <p>Outcome: {offer.outcome}</p>
      <div className="mt-4 space-x-2">
        <button disabled={submitting}
                className="px-3 py-2 bg-green-600 text-white rounded"
                onClick={() => respond('accept')}>
          Accept
        </button>
        <button disabled={submitting}
                className="px-3 py-2 bg-red-600 text-white rounded"
                onClick={() => respond('decline')}>
          Decline
        </button>
      </div>
      <textarea className="mt-3 border w-full p-2" placeholder="Reason (decline only)"
                value={reason} onChange={(e) => setReason(e.target.value)} />
    </div>
  );
}
