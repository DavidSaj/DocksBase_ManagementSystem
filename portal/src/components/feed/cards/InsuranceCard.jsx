// portal/src/components/feed/cards/InsuranceCard.jsx
const STATUS_COPY = {
  due_soon: { label: 'Due soon',   accent: 'orange', msg: 'Your insurance expires soon. Upload a new certificate.' },
  expired:  { label: 'Expired',    accent: 'red',    msg: 'Your insurance has expired. Please update your certificate.' },
  missing:  { label: 'Missing',    accent: 'red',    msg: 'No insurance certificate on file. Please upload one.' },
};

export default function InsuranceCard({ item }) {
  const cfg = STATUS_COPY[item.status] || STATUS_COPY['missing'];
  return (
    <div className={`p-feed-card p-feed-card--${cfg.accent}`}>
      <p className="p-feed-card__eyebrow">Insurance · {cfg.label}</p>
      <p className="p-feed-card__title">Vessel Insurance</p>
      <p className="p-feed-card__sub">{cfg.msg}</p>
      <button
        className="p-btn p-btn--outline"
        onClick={() => window.dispatchEvent(new CustomEvent('portal:navigate', { detail: { tab: 'account' } }))}
      >
        Update in Account
      </button>
    </div>
  );
}
