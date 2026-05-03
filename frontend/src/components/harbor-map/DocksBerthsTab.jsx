import { useState } from 'react';
import BulkGenerateModal from './BulkGenerateModal';
import useServiceCatalog from '../../hooks/useServiceCatalog.js';

const STATUS_OPTIONS = ['available', 'occupied', 'reserved', 'maintenance'];

export default function DocksBerthsTab({ piers, berths, onCreatePier, onUpdatePier, onDeletePier, onBulkGenerate, onUpdateBerth, onDeleteBerth }) {
  const { items: pricingTiers } = useServiceCatalog('berth');
  const [selectedPierId, setSelectedPierId] = useState(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [newPierCode, setNewPierCode] = useState('');
  const [newPierLabel, setNewPierLabel] = useState('');
  const [editingBerthId, setEditingBerthId] = useState(null);
  const [editValues, setEditValues] = useState({});

  const selectedPier = piers.find(p => p.id === selectedPierId);
  const pierBerths = selectedPierId
    ? berths.filter(b => b.pier === selectedPierId)
    : [];

  const handleCreatePier = async (e) => {
    e.preventDefault();
    if (!newPierCode.trim()) return;
    await onCreatePier({ code: newPierCode.trim(), label: newPierLabel.trim() });
    setNewPierCode('');
    setNewPierLabel('');
  };

  const startEditBerth = (berth) => {
    setEditingBerthId(berth.id);
    setEditValues({
      code: berth.code,
      length_m: berth.length_m || '',
      max_beam_m: berth.max_beam_m || '',
      max_draft_m: berth.max_draft_m || '',
      pricing_tier: berth.pricing_tier || '',
      status: berth.status,
    });
  };

  const saveEditBerth = async (berthId) => {
    await onUpdateBerth(berthId, editValues);
    setEditingBerthId(null);
  };

  const inputStyle = {
    padding: '3px 6px', fontSize: 12, border: '1px solid #d1d5db',
    borderRadius: 4, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: Dock list */}
      <div style={{
        width: 220, borderRight: '1px solid #e5e7eb', display: 'flex',
        flexDirection: 'column', background: '#f9fafb',
      }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', fontWeight: 700, fontSize: 13 }}>
          Docks / Piers
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {piers.map(pier => (
            <div
              key={pier.id}
              onClick={() => setSelectedPierId(pier.id)}
              style={{
                padding: '8px 14px', cursor: 'pointer', fontSize: 13,
                background: pier.id === selectedPierId ? '#eff6ff' : 'transparent',
                borderLeft: pier.id === selectedPierId ? '3px solid #2563eb' : '3px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>
                <span style={{ fontWeight: 600 }}>{pier.code}</span>
                {pier.label && <span style={{ color: '#6b7280', marginLeft: 4 }}>{pier.label}</span>}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{pier.berth_count}</span>
            </div>
          ))}
        </div>

        <form onSubmit={handleCreatePier} style={{ padding: '10px 12px', borderTop: '1px solid #e5e7eb' }}>
          <input
            placeholder="Code (e.g. A)" value={newPierCode}
            onChange={e => setNewPierCode(e.target.value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <input
            placeholder="Label (optional)" value={newPierLabel}
            onChange={e => setNewPierLabel(e.target.value)}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <button type="submit" style={{
            width: '100%', background: '#2563eb', color: 'white',
            border: 'none', borderRadius: 5, padding: '6px', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}>
            + Add Dock
          </button>
        </form>
      </div>

      {/* Right: Berth grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedPier ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
            Select a dock on the left to manage its berths.
          </div>
        ) : (
          <>
            <div style={{
              padding: '10px 16px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {selectedPier.label || selectedPier.code} — {pierBerths.length} berths
              </span>
              <button
                onClick={() => setShowBulkModal(true)}
                style={{
                  marginLeft: 'auto', background: '#059669', color: 'white',
                  border: 'none', borderRadius: 6, padding: '6px 14px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                ⚡ Bulk Generate
              </button>
              <button
                onClick={() => onDeletePier(selectedPier.id).then(() => setSelectedPierId(null))}
                style={{
                  background: '#fee2e2', color: '#991b1b',
                  border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 12px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Delete Dock
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f3f4f6', position: 'sticky', top: 0 }}>
                    {['Code', 'Length (m)', 'Beam (m)', 'Draft (m)', 'Pricing Tier', 'Status', 'Placed', ''].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pierBerths.map(berth => {
                    const isEditing = editingBerthId === berth.id;
                    return (
                      <tr key={berth.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing
                            ? <input value={editValues.code} onChange={e => setEditValues(p => ({ ...p, code: e.target.value }))} style={inputStyle} />
                            : <span style={{ fontWeight: 600 }}>{berth.code}</span>}
                        </td>
                        {['length_m', 'max_beam_m', 'max_draft_m'].map(field => (
                          <td key={field} style={{ padding: '6px 10px' }}>
                            {isEditing
                              ? <input type="number" step="0.1" value={editValues[field]} onChange={e => setEditValues(p => ({ ...p, [field]: e.target.value }))} style={inputStyle} />
                              : (berth[field] || '—')}
                          </td>
                        ))}
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing ? (
                            <select
                              value={editValues.pricing_tier}
                              onChange={e => setEditValues(p => ({ ...p, pricing_tier: e.target.value }))}
                              style={inputStyle}
                              required
                            >
                              <option value="" disabled>Select pricing tier…</option>
                              {pricingTiers.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          ) : (
                            pricingTiers.find(t => t.id === berth.pricing_tier)?.name ?? berth.pricing_tier ?? '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing
                            ? (
                              <select value={editValues.status} onChange={e => setEditValues(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
                                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            )
                            : berth.status}
                        </td>
                        <td style={{ padding: '6px 10px', color: berth.canvas_x != null ? '#059669' : '#9ca3af', fontSize: 11 }}>
                          {berth.canvas_x != null ? '✓ Yes' : 'No'}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEditBerth(berth.id)} style={{ fontSize: 11, padding: '2px 8px', marginRight: 4, background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
                              <button onClick={() => setEditingBerthId(null)} style={{ fontSize: 11, padding: '2px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEditBerth(berth)} style={{ fontSize: 11, padding: '2px 8px', marginRight: 4, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>Edit</button>
                              <button onClick={() => onDeleteBerth(berth.id)} style={{ fontSize: 11, padding: '2px 8px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}>Del</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pierBerths.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>
                        No berths yet. Use Bulk Generate or add individually.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showBulkModal && selectedPier && (
        <BulkGenerateModal
          pier={selectedPier}
          onGenerate={onBulkGenerate}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
}
