export default function ReportIssueScreen({ onBack }) {
  return (
    <div className="p-subscreen">
      <div className="p-subscreen__header">
        <button className="p-subscreen__back" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <div className="p-subscreen__title">Report an Issue</div>
      </div>
      <div className="p-subscreen__body">Coming soon.</div>
    </div>
  );
}
