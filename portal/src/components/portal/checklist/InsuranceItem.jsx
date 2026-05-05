import { useState } from 'react';
import api from '../../../api';

const BTN = {
  width: '100%', height: 52, borderRadius: 12, background: '#f4f6f8',
  color: '#1a2d4a', border: '1.5px solid rgba(0,0,0,0.12)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
};

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
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        Optional: upload a copy of your vessel insurance certificate.
      </div>
      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <label style={{ ...BTN, display: 'block', lineHeight: '52px', textAlign: 'center', cursor: uploading ? 'wait' : 'pointer' }}>
        {uploading ? 'Uploading…' : '📎 Upload Insurance Certificate'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
    </div>
  );
}
