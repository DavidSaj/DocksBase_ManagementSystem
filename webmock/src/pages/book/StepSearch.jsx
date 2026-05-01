export default function StepSearch({ onSearch }) {
  function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSearch({
      arrival:   fd.get('arrival'),
      departure: fd.get('departure'),
      length:    parseFloat(fd.get('length')) || 0,
      draft:     parseFloat(fd.get('draft'))  || 0,
    });
  }

  return (
    <div>
      <h2 className="step-title">Find your berth.</h2>
      <p className="step-sub">Enter your dates and vessel dimensions to see available berths.</p>
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="arrival">Arrival date</label>
          <input id="arrival" name="arrival" type="date" className="form-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="departure">Departure date</label>
          <input id="departure" name="departure" type="date" className="form-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="length">Vessel length (m)</label>
          <input id="length" name="length" type="number" step="0.1" min="1" placeholder="e.g. 11.5" className="form-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="draft">Vessel draft (m)</label>
          <input id="draft" name="draft" type="number" step="0.1" min="0.1" placeholder="e.g. 1.8" className="form-input" required />
        </div>
        <button type="submit" className="btn-gold" style={{ height: 40, whiteSpace: 'nowrap' }}>Search</button>
      </form>
    </div>
  );
}
