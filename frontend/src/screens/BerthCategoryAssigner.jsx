import { useState, useMemo, useEffect, useRef } from 'react';
import useBerths from '../hooks/useBerths.js';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function GroupCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
      style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
    />
  );
}

function ExpandArrow({ expanded }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, cursor: 'pointer',
      color: expanded ? 'var(--navy)' : 'rgba(0,0,0,0.4)',
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.18s ease, color 0.15s',
    }}>
      <Ic n="chevron" s={17} />
    </div>
  );
}

export default function BerthCategoryAssigner({ open, onClose, categories }) {
  const { berths, loading, refetch } = useBerths();
  const [groupBy, setGroupBy]        = useState('pier');
  const [expandedKeys, setExpandedKeys] = useState(new Set());
  const [selected, setSelected]      = useState(new Set());
  const [search, setSearch]          = useState('');
  const [selectedCatId, setSelectedCatId] = useState('');
  const [applying, setApplying]      = useState(false);
  const [applyError, setApplyError]  = useState('');

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSelectedCatId('');
      setApplyError('');
      setSearch('');
      setExpandedKeys(new Set());
    }
  }, [open]);

  const filteredBerths = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? berths.filter(b => b.code.toLowerCase().includes(q)) : berths;
  }, [berths, search]);

  const groups = useMemo(() => {
    const map = {};
    filteredBerths.forEach(b => {
      const key = groupBy === 'pier' ? (b.pier_code || '—') : (b.berth_type || 'Other');
      if (!map[key]) map[key] = [];
      map[key].push(b);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredBerths, groupBy]);

  function toggleExpand(key) {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleBerth(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleGroupCheck(groupBerths, fullySelected) {
    setSelected(prev => {
      const next = new Set(prev);
      if (fullySelected) {
        groupBerths.forEach(b => next.delete(b.id));
      } else {
        groupBerths.forEach(b => next.add(b.id));
      }
      return next;
    });
  }

  async function applyCategory() {
    if (selected.size === 0 || !selectedCatId) return;
    setApplying(true);
    setApplyError('');
    try {
      await api.patch('/berths/bulk-category/', {
        berth_ids: [...selected],
        category_id: selectedCatId === 'unassign' ? null : Number(selectedCatId),
      });
      await refetch();
      setSelected(new Set());
      setSelectedCatId('');
    } catch (e) {
      const detail = e?.response?.data?.detail ?? 'Update failed — please try again.';
      setApplyError(String(detail));
    } finally {
      setApplying(false);
    }
  }

  const totalSelected  = selected.size;
  const activeCategories = (categories ?? []).filter(c => c.is_active);

  // Helper to get category name for a berth
  function getCategoryName(berth) {
    if (!berth.category) return null;
    const cat = (categories ?? []).find(c => c.id === berth.category);
    return cat ? cat.name : `Cat #${berth.category}`;
  }

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 290 }}
        />
      )}

      <div style={{
        position: 'fixed', top: 0, right: 0,
        height: '100vh',
        width: 680,
        background: '#fff',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.16)',
        zIndex: 300,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 24px 12px', borderBottom: 'var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Assign Berth Categories</div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
              <Ic n="x" s={14} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{
              display: 'flex',
              border: 'var(--border)', borderRadius: 6,
              overflow: 'hidden', flexShrink: 0,
            }}>
              {[['pier', 'By Pier'], ['type', 'By Type']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setGroupBy(v)}
                  style={{
                    padding: '5px 14px', fontSize: 12, fontWeight: 600,
                    border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
                    background: groupBy === v ? 'var(--navy)' : '#fff',
                    color:      groupBy === v ? '#fff' : 'rgba(0,0,0,0.55)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search berth code…"
              style={{
                flex: 1, border: 'var(--border)', borderRadius: 6,
                padding: '5px 10px', fontSize: 13,
                fontFamily: 'var(--font)', outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Accordion body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
              Loading berths…
            </div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
              No berths found.
            </div>
          ) : groups.map(([key, groupBerths]) => {
            const isExpanded      = expandedKeys.has(key);
            const fullySelected   = groupBerths.length > 0 && groupBerths.every(b => selected.has(b.id));
            const partialSelected = !fullySelected && groupBerths.some(b => selected.has(b.id));
            const selectedInGroup = groupBerths.filter(b => selected.has(b.id)).length;

            return (
              <div key={key} style={{ borderBottom: 'var(--border)' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 20px',
                  background: isExpanded ? '#f4f6fb' : '#fafafa',
                  userSelect: 'none',
                }}>
                  <GroupCheckbox
                    checked={fullySelected}
                    indeterminate={partialSelected}
                    onChange={() => handleGroupCheck(groupBerths, fullySelected)}
                  />
                  <div
                    style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    onClick={() => toggleExpand(key)}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {groupBy === 'pier' ? `Pier ${key}` : key}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)',
                      background: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: '1px 7px',
                    }}>
                      {groupBerths.length}
                    </span>
                    {selectedInGroup > 0 && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--navy)',
                        background: 'rgba(0,80,200,0.1)', borderRadius: 10, padding: '1px 7px',
                      }}>
                        {selectedInGroup} selected
                      </span>
                    )}
                  </div>
                  <div onClick={() => toggleExpand(key)}>
                    <ExpandArrow expanded={isExpanded} />
                  </div>
                </div>

                {isExpanded && (
                  <div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '52px 1fr 90px 1fr',
                      padding: '5px 20px',
                      borderBottom: '1px solid rgba(0,0,0,0.06)',
                      background: '#fefefe',
                    }}>
                      {['', 'Code', 'Length', 'Current Category'].map((h, i) => (
                        <div key={i} style={{
                          fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)',
                          textTransform: 'uppercase', letterSpacing: '0.4px',
                        }}>{h}</div>
                      ))}
                    </div>

                    {groupBerths.map(berth => {
                      const catName = getCategoryName(berth);
                      return (
                        <label
                          key={berth.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '52px 1fr 90px 1fr',
                            padding: '7px 20px',
                            borderBottom: '1px solid rgba(0,0,0,0.04)',
                            cursor: 'pointer',
                            background: selected.has(berth.id) ? 'rgba(0,80,200,0.04)' : 'transparent',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(berth.id)}
                            onChange={() => toggleBerth(berth.id)}
                            style={{ width: 14, height: 14, cursor: 'pointer', marginTop: 1, flexShrink: 0 }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{berth.code}</span>
                          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                            {berth.length_m ? `${berth.length_m}m` : '—'}
                          </span>
                          <span style={{ fontSize: 12 }}>
                            {catName
                              ? <span style={{ color: 'var(--navy)', fontWeight: 500 }}>{catName}</span>
                              : <span style={{ color: 'rgba(0,0,0,0.3)', fontStyle: 'italic' }}>Unassigned</span>
                            }
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action bar */}
        <div style={{
          borderTop: 'var(--border)',
          padding: '12px 20px',
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
          background: totalSelected > 0 ? 'rgba(0,80,200,0.05)' : '#fafafa',
          transition: 'background 0.2s',
        }}>
          {totalSelected === 0 ? (
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
              Select berths above to assign a category
            </span>
          ) : (
            <>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', flexShrink: 0 }}>
                {totalSelected} berth{totalSelected !== 1 ? 's' : ''} selected
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelected(new Set())}
                style={{ fontSize: 11, flexShrink: 0 }}
              >
                Clear
              </button>
              <select
                value={selectedCatId}
                onChange={e => setSelectedCatId(e.target.value)}
                style={{
                  flex: 1, border: 'var(--border)', borderRadius: 6,
                  padding: '6px 10px', fontSize: 13,
                  fontFamily: 'var(--font)', outline: 'none',
                  background: '#fff',
                }}
              >
                <option value="">— Assign category —</option>
                {activeCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="unassign">Remove category (unassign)</option>
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!selectedCatId || applying}
                onClick={applyCategory}
                style={{ flexShrink: 0 }}
              >
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </>
          )}
          {applyError && (
            <span style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, width: '100%' }}>{applyError}</span>
          )}
        </div>
      </div>
    </>
  );
}
