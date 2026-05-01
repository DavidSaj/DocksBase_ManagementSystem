import { useState } from 'react';
import { PIERS, BOOKINGS } from '@shared/mock.js';
import StepSearch from './book/StepSearch.jsx';
import StepResults from './book/StepResults.jsx';
import StepBerthDetail from './book/StepBerthDetail.jsx';
import StepDetails from './book/StepDetails.jsx';
import StepConfirmation from './book/StepConfirmation.jsx';

const STEPS = ['Search', 'Results', 'Select', 'Details', 'Confirm'];

function Progress({ step }) {
  return (
    <div className="book-progress">
      {STEPS.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'active' : 'pending';
        return (
          <div key={label} className="progress-step">
            <div className={`progress-dot ${state}`}>
              {state === 'done' ? '✓' : i + 1}
            </div>
            <span className={`progress-label ${state}`}>{label}</span>
            {i < STEPS.length - 1 && (
              <div className={`progress-line ${i < step ? 'done' : 'pending'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Book() {
  const [step, setStep]           = useState(0);
  const [search, setSearch]       = useState(null);
  const [results, setResults]     = useState([]);
  const [selected, setSelected]   = useState(null);
  const [bookingId, setBookingId] = useState(null);

  function handleSearch(params) {
    const available = PIERS
      .flatMap(p => p.slips.map(s => ({ ...s, pier: p.id })))
      .filter(s =>
        s.status === 'available' &&
        parseFloat(s.len) >= params.length &&
        parseFloat(s.maxDraft) >= params.draft
      );
    setSearch(params);
    setResults(available);
    setStep(1);
  }

  function handleSelect(slip) {
    setSelected(slip);
    setStep(2);
  }

  function handleDetailConfirm() {
    setStep(3);
  }

  function handleDetailsSubmit(vesselInfo) {
    const id = 'MB94-' + String(Math.floor(1000 + Math.random() * 9000));
    const nights = search
      ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
      : 1;
    BOOKINGS.push({
      id,
      vessel: vesselInfo.vesselName,
      owner:  vesselInfo.skipperName,
      berth:  selected.id,
      checkin: search.arrival,
      checkout: search.departure,
      nights,
      type: 'Transient',
      status: 'pending',
      paid: false,
      amount: `€${selected.pricePerNight * nights}`,
    });
    selected.status = 'reserved';
    setBookingId(id);
    setStep(4);
  }

  return (
    <main>
      <div style={{ background: 'var(--navy2)', padding: '40px 40px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 32 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>Marina Bay 94</div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 600, color: 'var(--cream)' }}>Book a berth.</h1>
        </div>
      </div>
      <div className="book-page">
        <Progress step={step} />
        {step === 0 && <StepSearch onSearch={handleSearch} />}
        {step === 1 && <StepResults results={results} search={search} onSelect={handleSelect} onBack={() => setStep(0)} />}
        {step === 2 && <StepBerthDetail slip={selected} search={search} onConfirm={handleDetailConfirm} onBack={() => setStep(1)} />}
        {step === 3 && <StepDetails slip={selected} search={search} onSubmit={handleDetailsSubmit} onBack={() => setStep(2)} />}
        {step === 4 && <StepConfirmation bookingId={bookingId} slip={selected} search={search} />}
      </div>
    </main>
  );
}
