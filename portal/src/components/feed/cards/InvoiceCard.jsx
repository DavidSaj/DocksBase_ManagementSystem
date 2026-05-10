// portal/src/components/feed/cards/InvoiceCard.jsx
function formatAmount(amount) {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (num == null || isNaN(num)) return '—';
  return `€${num.toFixed(2)}`;
}

export default function InvoiceCard({ item }) {
  const isOverdue = item.overdue;
  const accent    = isOverdue ? 'red' : 'orange';

  function handlePay() {
    window.dispatchEvent(new CustomEvent('portal:navigate', { detail: { tab: 'wallet' } }));
  }

  return (
    <div className={`p-feed-card p-feed-card--${accent}`}>
      <p className="p-feed-card__eyebrow">{isOverdue ? 'Overdue' : 'Payment due'}</p>
      <p className="p-feed-card__title">{item.label}</p>
      {item.due_date && (
        <p className="p-feed-card__sub">Due {item.due_date}</p>
      )}
      <p className="p-feed-card__amount">{formatAmount(item.amount)}</p>
      <button className="p-btn p-btn--gold" onClick={handlePay}>
        Pay now
      </button>
    </div>
  );
}
