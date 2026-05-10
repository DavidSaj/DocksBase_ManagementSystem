// portal/src/components/feed/DynamicFeed.jsx
import { useState, useEffect } from 'react';
import api from '../../api';
import InvoiceCard      from './cards/InvoiceCard';
import VesselStatusCard from './cards/VesselStatusCard';
import InsuranceCard    from './cards/InsuranceCard';

const CARD_MAP = {
  invoice_overdue: InvoiceCard,
  invoice_open:    InvoiceCard,
  vessel_status:   VesselStatusCard,
  insurance_alert: InsuranceCard,
};

export default function DynamicFeed() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/portal/feed/')
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-feed">
        {[1, 2].map(i => (
          <div key={i} className="p-feed-card" style={{ height: 80, opacity: 0.3, background: '#e0e0e0', border: 'none' }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-feed">
        <div className="p-feed__empty">
          All clear — nothing needs your attention right now.
        </div>
      </div>
    );
  }

  return (
    <div className="p-feed">
      {items.map((item, i) => {
        const Card = CARD_MAP[item.type];
        if (!Card) return null;
        return <Card key={`${item.type}-${item.id || i}`} item={item} />;
      })}
    </div>
  );
}
