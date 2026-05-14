import { Link, useParams, useSearchParams } from 'react-router-dom';

export default function RequestConfirmed() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const ref = params.get('ref');
  return (
    <div className="p-page" style={{ maxWidth: 540 }}>
      <h1>Request received</h1>
      <p>We've forwarded your request to the marina. They will contact you within 24 hours to confirm.</p>
      {ref && <p>Reference: <strong>#{ref}</strong></p>}
      <p><Link to={`/${slug}/activities`}>← Back to activities</Link></p>
    </div>
  );
}
