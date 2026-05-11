// portal/src/components/feed/cards/VesselStatusCard.jsx
export default function VesselStatusCard({ item }) {
  return (
    <div className="p-feed-card p-feed-card--navy">
      <p className="p-feed-card__eyebrow">Your vessel</p>
      <p className="p-feed-card__title">{item.label}</p>
      {(item.loa || item.beam) && (
        <p className="p-feed-card__sub">
          {[item.loa && `LOA ${item.loa}m`, item.beam && `Beam ${item.beam}m`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
