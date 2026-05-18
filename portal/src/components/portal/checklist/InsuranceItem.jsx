// portal/src/components/portal/checklist/InsuranceItem.jsx
import { useState } from 'react';
import api from '@docksbase/portal-ui/api';

export default function InsuranceItem({ booking, onUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/portal/checkin/bookings/${booking.id}/insurance/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUpdate();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        Optional: upload a copy of your vessel insurance certificate.
      </p>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <label className="p-btn p-btn--ghost" style={{ display: 'block', textAlign: 'center', lineHeight: '44px', cursor: uploading ? 'wait' : 'pointer' }}>
        <svg style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>
        {uploading ? 'Uploading…' : 'Upload Insurance Certificate'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
    </div>
  );
}
