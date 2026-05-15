import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { today, addDays, dateRange, Loading, Empty, Err, SecHdr } from '../shared.jsx';

const STATUS_BG = {
  dirty:            '#ffe3e3',
  in_progress:      '#fff3bf',
  ready_inspection: '#d0ebff',
  clean:            '#c3fae8',
  ready_guest:      '#d3f9d8',
};

const STATUS_TEXT = {
  dirty: '#c92a2a', in_progress: '#e67700',
  ready_inspection: '#1864ab', clean: '#0b7a6a', ready_guest: '#2b8a3e',
};

export default function MatrixTab({ onSelectTaskId }) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromDate, setFromDate] = useState(today());

  const toDate = addDays(fromDate, 6);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/matrix/', { params: { from: fromDate, to: toDate } })
      .then(r => {
        // Try to handle both matrix format and plain list
        const raw = r.data;
        if (raw.units) {
          setMatrix(raw);
        } else {
          setMatrix(null);
        }
      })
      .catch(() => setError('Failed to load housekeeping matrix.'))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const dates = dateRange(fromDate, toDate);

  // Summary chips from matrix data
  const allCells = matrix
    ? matrix.units.flatMap(u => Object.values(u.cells).filter(c => c.status))
    : [];
  const counts = {};
  for (const c of allCells) counts[c.status] = (counts[c.status] ?? 0) + 1;

  return (
    <div>
      <SecHdr title="Housekeeping Matrix">
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>From</label>
        <input type="date" className="form-control form-control-sm" style={{ width: 150 }} value={fromDate} onChange={e => setFromDate(e.target.value)} />
      </SecHdr>

      {/* Summary chips */}
      {matrix && (
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <span className="badge badge-red">{counts['dirty'] ?? 0} Dirty</span>
          <span className="badge badge-orange">{counts['in_progress'] ?? 0} In Progress</span>
          <span className="badge badge-blue">{counts['ready_inspection'] ?? 0} Inspection</span>
          <span className="badge badge-teal">{counts['clean'] ?? 0} Clean</span>
          <span className="badge badge-green">{counts['ready_guest'] ?? 0} Ready</span>
        </div>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : !matrix ? (
        <Empty title="Matrix data not available" subtitle="The housekeeping matrix endpoint will be available once the backend is deployed." />
      ) : matrix.units.length === 0 ? (
        <Empty title="No units in range" subtitle="No vessels or accommodation units with tasks in this period." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 600 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: `180px repeat(${dates.length}, 1fr)`, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)' }}>UNIT</div>
              {dates.map(d => (
                <div key={d} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: d === today() ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.45)', background: d === today() ? 'rgba(26,45,74,0.04)' : undefined }}>
                  {new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
              ))}
            </div>
            {/* Rows */}
            {matrix.units.map(unit => (
              <div key={unit.unit_id} style={{ display: 'grid', gridTemplateColumns: `180px repeat(${dates.length}, 1fr)`, borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'rgba(0,0,0,0.35)' }}>
                    {unit.unit_type === 'vessel'
                      ? <Ic n="home" s={12} />
                      : unit.unit_type === 'accommodation'
                        ? <Ic n="home" s={12} />
                        : <Ic n="package" s={12} />}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{unit.unit_label}</span>
                </div>
                {dates.map(d => {
                  const cell = unit.cells?.[d];
                  if (!cell || !cell.status) {
                    return <div key={d} style={{ padding: 6, background: 'rgba(0,0,0,0.02)', borderLeft: '1px solid rgba(0,0,0,0.04)' }} />;
                  }
                  const isDelayed = cell.target_ready_by && cell.status !== 'ready_guest' &&
                    (new Date(cell.target_ready_by) - Date.now()) < 2 * 60 * 60 * 1000 &&
                    new Date(cell.target_ready_by) > Date.now();
                  return (
                    <div
                      key={d}
                      onClick={() => cell.task_id && onSelectTaskId(cell.task_id)}
                      style={{
                        padding: 6,
                        background: STATUS_BG[cell.status] ?? '#f8f9fa',
                        borderLeft: '1px solid rgba(0,0,0,0.04)',
                        cursor: cell.task_id ? 'pointer' : 'default',
                        boxShadow: isDelayed ? 'inset 0 0 0 2px #e67700' : undefined,
                        transition: 'opacity 0.1s',
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: STATUS_TEXT[cell.status] ?? '#495057' }}>
                        {cell.status.replace('_', ' ').toUpperCase()}
                      </div>
                      {cell.assigned_to && (
                        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{cell.assigned_to}</div>
                      )}
                      {isDelayed && <div style={{ fontSize: 9, color: '#e67700', fontWeight: 700 }}><Ic n="alert-circle" s={9} /> Due soon</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
