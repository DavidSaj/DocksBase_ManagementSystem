import { useState } from 'react';
import { uploadInsuranceCertificate } from '@docksbase/portal-ui/api';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

export default function InsuranceUpload({ marinaSlug, value, onChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('Use PDF, JPG, or PNG.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const { data } = await uploadInsuranceCertificate(marinaSlug, file);
      onChange({ token: data.token, filename: file.name, expiresAt: data.expires_at });
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-field">
      <label className="p-label">Insurance certificate</label>
      {value?.token ? (
        <div className="p-insurance-uploaded">
          <span>✓ {value.filename}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            style={{ marginLeft: 8, fontSize: 12, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={handleFile}
          disabled={uploading || disabled}
        />
      )}
      {uploading && <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Uploading…</p>}
      {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}
