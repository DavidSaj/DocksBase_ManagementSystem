import { useState, useRef, useEffect } from 'react';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function isoDate(date) {
  return date.toISOString().split('T')[0];
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function CalendarGrid({ year, month, startDate, endDate, hoverDate, onDayClick, onDayHover }) {
  const today    = isoDate(new Date());
  const firstDow = new Date(year, month, 1).getDay();
  const offset   = (firstDow + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const effectiveEnd = endDate || hoverDate;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
        {DAYS.map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: 10, fontWeight: 700,
            color: 'rgba(0,0,0,0.28)', padding: '0 0 6px', letterSpacing: '0.5px',
          }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} />;
          const ds = isoDate(date);
          const isPast    = ds < today;
          const isStart   = ds === startDate;
          const isEnd     = ds === endDate;
          const isToday   = ds === today;
          const inRange   = !!(startDate && effectiveEnd && ds > startDate && ds < effectiveEnd);

          let bg = 'transparent';
          let color = isPast ? 'rgba(0,0,0,0.2)' : '#1a1a1a';
          let radius = '4px';
          let fw = isToday ? 600 : 400;

          if (isStart || isEnd) {
            bg = '#b8965a'; color = '#fff'; fw = 700;
            radius = isStart ? '4px 0 0 4px' : '0 4px 4px 0';
            if (isStart && isEnd) radius = '4px';
          } else if (inRange) {
            bg = 'rgba(184,150,90,0.13)'; radius = '0';
          }

          return (
            <div
              key={ds}
              onClick={() => !isPast && onDayClick(ds)}
              onMouseEnter={() => !isPast && onDayHover(ds)}
              onMouseLeave={() => onDayHover(null)}
              style={{
                textAlign: 'center', padding: '7px 1px',
                fontSize: 12.5, fontWeight: fw,
                background: bg, color,
                borderRadius: radius,
                cursor: isPast ? 'default' : 'pointer',
                position: 'relative',
                transition: 'background 0.1s',
              }}
            >
              {date.getDate()}
              {isToday && !isStart && !isEnd && (
                <div style={{
                  position: 'absolute', bottom: 2, left: '50%',
                  transform: 'translateX(-50%)',
                  width: 3, height: 3, borderRadius: '50%', background: '#b8965a',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ checkIn, checkOut, onChange }) {
  const [open, setOpen]           = useState(false);
  const [openedFrom, setOpenedFrom] = useState('start');
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

  function openFor(field) {
    const anchor = field === 'start' ? checkIn : checkOut;
    if (anchor) {
      const d = new Date(anchor + 'T12:00:00');
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
    setOpenedFrom(field);
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

  function fmt(iso) {
    if (!iso) return null;
    return new Date(iso + 'T12:00:00')
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const calLeft = openedFrom === 'end' ? '50%' : '0';
  const hint = !checkIn
    ? 'Select your arrival date'
    : !checkOut
    ? 'Now select your departure date'
    : '';

  return (
    <div ref={wrapRef} style={{ position: 'relative', gridColumn: 'span 2' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Arrival */}
        <div className="p-field" style={{ marginBottom: 0 }}>
          <label className="p-label">Arrival</label>
          <div
            className="p-input"
            onClick={() => openFor('start')}
            style={{
              cursor: 'pointer', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderColor: open && openedFrom === 'start' ? '#b8965a' : undefined,
            }}
          >
            <span style={{ color: checkIn ? '#1a1a1a' : 'rgba(0,0,0,0.3)', fontSize: 13 }}>
              {fmt(checkIn) || 'Select date'}
            </span>
            <CalendarIcon />
          </div>
        </div>

        {/* Departure */}
        <div className="p-field" style={{ marginBottom: 0 }}>
          <label className="p-label">Departure</label>
          <div
            className="p-input"
            onClick={() => openFor('end')}
            style={{
              cursor: 'pointer', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderColor: open && openedFrom === 'end' ? '#b8965a' : undefined,
            }}
          >
            <span style={{ color: checkOut ? '#1a1a1a' : 'rgba(0,0,0,0.3)', fontSize: 13 }}>
              {fmt(checkOut) || 'Select date'}
            </span>
            <CalendarIcon />
          </div>
        </div>
      </div>

      {/* Dropdown calendar */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: calLeft,
          background: '#fff', border: '1px solid #e5e5e5',
          borderRadius: 10, padding: '16px 18px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.13)',
          zIndex: 300, width: 280,
        }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <button type="button" onClick={prevMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.35)', padding: '0 8px', lineHeight: 1 }}>‹</button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{monthLabel}</span>
            <button type="button" onClick={nextMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.35)', padding: '0 8px', lineHeight: 1 }}>›</button>
          </div>

          <CalendarGrid
            year={viewYear} month={viewMonth}
            startDate={checkIn} endDate={checkOut}
            hoverDate={hoverDate}
            onDayClick={handleDayClick}
            onDayHover={setHoverDate}
          />

          {hint && (
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
              {hint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
