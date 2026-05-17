import { useState } from 'react';
import api from '@docksbase/portal-ui/api';

export default function WaitlistApplyScreen({ marina }) {
  const [form, setForm] = useState({
    applicant_name: '',
    applicant_email: '',
    applicant_phone: '',
    vessel_type: 'sail',
    vessel_loa_m: '',
    vessel_beam_m: '',
    vessel_draft_m: '',
    pref_min_loa_m: '',
    pref_max_loa_m: '',
  });
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [entryId, setEntryId] = useState(null);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setState('submitting');
    setError('');
    try {
      const res = await api.post('/waitlist/', { ...form, marina: marina?.id });
      setEntryId(res.data.id);
      setState('done');
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-2">Application received</h2>
        <p>You are entry #{entryId}. We will email you when a berth is offered.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="p-6 space-y-3 max-w-lg">
      <h2 className="text-xl font-semibold">Join the Seasonal Waitlist</h2>
      {error && <div className="bg-red-50 text-red-800 p-2 rounded">{error}</div>}
      <input className="border p-2 w-full" placeholder="Your full name"
             value={form.applicant_name} onChange={(e) => set('applicant_name', e.target.value)} required />
      <input className="border p-2 w-full" type="email" placeholder="Email"
             value={form.applicant_email} onChange={(e) => set('applicant_email', e.target.value)} required />
      <input className="border p-2 w-full" placeholder="Phone"
             value={form.applicant_phone} onChange={(e) => set('applicant_phone', e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <input className="border p-2" placeholder="LOA (m)" type="number" step="0.1"
               value={form.vessel_loa_m} onChange={(e) => set('vessel_loa_m', e.target.value)} required />
        <input className="border p-2" placeholder="Beam (m)" type="number" step="0.01"
               value={form.vessel_beam_m} onChange={(e) => set('vessel_beam_m', e.target.value)} required />
        <input className="border p-2" placeholder="Draft (m)" type="number" step="0.01"
               value={form.vessel_draft_m} onChange={(e) => set('vessel_draft_m', e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="border p-2" placeholder="Pref. min LOA (m)" type="number" step="0.1"
               value={form.pref_min_loa_m} onChange={(e) => set('pref_min_loa_m', e.target.value)} required />
        <input className="border p-2" placeholder="Pref. max LOA (m)" type="number" step="0.1"
               value={form.pref_max_loa_m} onChange={(e) => set('pref_max_loa_m', e.target.value)} required />
      </div>
      <button className="px-4 py-2 bg-blue-600 text-white rounded"
              disabled={state === 'submitting'}>
        {state === 'submitting' ? 'Submitting…' : 'Apply'}
      </button>
    </form>
  );
}
