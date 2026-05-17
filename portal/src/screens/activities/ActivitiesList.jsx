import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '@docksbase/portal-ui/api';

export default function ActivitiesList() {
  const { slug } = useParams();
  const [items, setItems]     = useState([]);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/public/activities/?marina=${slug}`)
      .then(r => setItems(r.data))
      .catch(() => setError('Could not load activities.'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="p-feed__empty">Loading…</div>;
  if (error)   return <div className="p-feed__empty">{error}</div>;

  return (
    <div className="p-page">
      <h1 className="p-eyebrow" style={{ marginBottom: 16 }}>Activities</h1>
      {items.length === 0 ? (
        <div className="p-feed__empty">No activities available right now.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {items.map(a => (
            <Link key={a.id} to={`/${slug}/activities/${a.id}`} className="p-card" style={{ textDecoration: 'none', color: 'inherit', padding: 12 }}>
              {a.photo_url && (
                <img
                  src={a.photo_url}
                  alt={a.name}
                  style={{ width: '100%', borderRadius: 8, aspectRatio: '4/3', objectFit: 'cover' }}
                />
              )}
              <div style={{ fontWeight: 700, marginTop: 8 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 2 }}>
                {a.duration_minutes} min · up to {a.capacity_max}
              </div>
              {a.price_from != null && (
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>from £{a.price_from}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
