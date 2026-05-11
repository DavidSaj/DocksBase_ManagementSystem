import { useState, useRef, useEffect } from 'react';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function localIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmt(iso) {
  if (!iso) return null;
  return new Date(iso + 'T12:00:00')
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CalendarGrid({ year, month, startDate, endDate, hoverDate, onDayClick, onDayHover }) {
  const today = localIso(new Date());
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (firstDow + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const effectiveEnd = endDate || hoverDate;
  const hasRange = !!(startDate && effectiveEnd && effectiveEnd > startDate);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 6 }}>
        {DAYS.map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: 10, fontWeight: 700,
            color: 'rgba(0,0,0,0.28)', paddingBottom: 8, letterSpacing: '0.5px',
          }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} style={{ height: 34 }} />;

          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isPast    = ds < today;
          const isStart   = ds === startDate;
          const isEnd     = ds === endDate;
          const isToday   = ds === today;
          const inRange   = hasRange && ds > startDate && ds < effectiveEnd;
          const isEffEnd  = ds === effectiveEnd && !isStart;
          const isSelected = isStart || isEnd;

          return (
            <div
              key={ds}
              onClick={() => !isPast && onDayClick(ds)}
              onMouseEnter={() => !isPast && onDayHover(ds)}
              onMouseLeave={() => onDayHover(null)}
              style={{ position: 'relative', height: 34, cursor: isPast ? 'default' : 'pointer' }}
            >
              {/* Range stripe — right-half on start, full on in-range, left-half on end */}
              {hasRange && isStart && (
                <div style={{ position: 'absolute', top: 4, bottom: 4, left: '50%', right: 0, background: 'rgba(184,150,90,0.13)', zIndex: 0 }} />
              )}
              {inRange && (
                <div style={{ position: 'absolute', top: 4, bottom: 4, left: 0, right: 0, background: 'rgba(184,150,90,0.13)', zIndex: 0 }} />
              )}
              {hasRange && isEffEnd && (
                <div style={{ position: 'absolute', top: 4, bottom: 4, left: 0, right: '50%', background: 'rgba(184,150,90,0.13)', zIndex: 0 }} />
              )}

              {/* Day number circle */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                background: isSelected ? '#b8965a' : 'transparent',
                color: isPast ? 'rgba(0,0,0,0.18)' : isSelected ? '#fff' : '#1a1a1a',
                fontSize: 13,
                fontWeight: isSelected ? 700 : isToday ? 600 : 400,
                zIndex: 1,
              }}>
                {day}
                {isToday && !isSelected && (
                  <div style={{
                    position: 'absolute', bottom: 3, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 3, height: 3, borderRadius: '50%', background: '#b8965a',
                  }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ checkIn, checkOut, onChange }) {
  const [open, setOpen]           = useState(false);
  const [hoverDate, setHoverDate] = useState(null);
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const wrapRef = useRef(null);

  useEffect(() => {
    function outside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  function openCalendar(anchorIso) {
    if (anchorIso) {
      const d = new Date(anchorIso + 'T12:00:00');
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
    setOpen(o => !o);
  }

  function handleDayClick(ds) {
    if (!checkIn || (checkIn && checkOut)) {
      onChange({ checkIn: ds, checkOut: '' });
    } else {
      if (ds <= checkIn) {
        onChange({ checkIn: ds, checkOut: '' });
      } else {
        onChange({ checkIn, checkOut: ds });
        setOpen(false);
        setHoverDate(null);
      }
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const monthLabel = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const step = !checkIn ? 'arrival' : !checkOut ? 'departure' : 'done';

  const calendarIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
    </svg>
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative', gridColumn: 'span 2' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Arrival — identical styling to p-input/p-label */}
        <div className="p-field" style={{ marginBottom: 0 }}>
          <label className="p-label">Arrival</label>
          <div
            className="p-input"
            onClick={() => openCalendar(checkIn)}
            style={{
              cursor: 'pointer', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              borderColor: open ? '#b8965a' : undefined,
              padding: '7px 10px',
            }}
          >
            <span style={{ color: checkIn ? '#1a1a1a' : 'rgba(0,0,0,0.25)', fontSize: 14 }}>
              {fmt(checkIn) || 'Select date'}
            </span>
            {calendarIcon}
          </div>
        </div>

        {/* Departure — identical styling to p-input/p-label */}
        <div className="p-field" style={{ marginBottom: 0 }}>
          <label className="p-label">Departure</label>
          <div
            className="p-input"
            onClick={() => openCalendar(checkOut || checkIn)}
            style={{
              cursor: 'pointer', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              borderColor: open ? '#b8965a' : undefined,
              padding: '7px 10px',
            }}
          >
            <span style={{ color: checkOut ? '#1a1a1a' : 'rgba(0,0,0,0.25)', fontSize: 14 }}>
              {fmt(checkOut) || 'Select date'}
            </span>
            {calendarIcon}
          </div>
        </div>
      </div>

      {/* Single calendar dropdown — spans full width of both fields */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: '#fff', border: '1px solid #e5e5e5',
          borderRadius: 10, padding: '12px 16px 10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          zIndex: 300,
        }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <button type="button" onClick={e => { e.stopPropagation(); prevMonth(); }}
              style={{
                background: 'none', border: '1px solid #e8e8e8', borderRadius: 6,
                width: 30, height: 30, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(0,0,0,0.4)', flexShrink: 0,
              }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
              {monthLabel}
            </span>
            <button type="button" onClick={e => { e.stopPropagation(); nextMonth(); }}
              style={{
                background: 'none', border: '1px solid #e8e8e8', borderRadius: 6,
                width: 30, height: 30, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(0,0,0,0.4)', flexShrink: 0,
              }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          <CalendarGrid
            year={viewYear} month={viewMonth}
            startDate={checkIn} endDate={checkOut}
            hoverDate={hoverDate}
            onDayClick={handleDayClick}
            onDayHover={setHoverDate}
          />

          {step !== 'done' && (
            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.32)', textAlign: 'center', marginTop: 12, fontStyle: 'italic' }}>
              {step === 'arrival' ? 'Select your arrival date' : 'Now select your departure date'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
