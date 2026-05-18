import { useState } from 'react';

const COUNTRIES = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO',
  'CH','GB','US','CA','AU','NZ','TR','MC','ME','RS',
];

export default function GuestStep({ state, updateGuest, marina, onNext, onBack, error }) {
  const [showCompany, setShowCompany] = useState(!!state.guest.company_name);
  const termsRequired = !!marina?.booking_terms_pdf_url;

  const billingComplete =
    state.guest.billing_street && state.guest.billing_city &&
    state.guest.billing_postcode && state.guest.billing_country;
  const canContinue =
    state.guest.name && state.guest.email &&
    (!termsRequired || (billingComplete && state.guest.terms_accepted));

  return (
    <form
      className="q-step"
      onSubmit={e => { e.preventDefault(); if (canContinue) onNext(); }}
    >
      <h3>Your details</h3>
      <div className="p-grid-2">
        <div className="p-field">
          <label className="p-label">Full name *</label>
          <input className="p-input" required value={state.guest.name}
            onChange={e => updateGuest('name', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Email *</label>
          <input className="p-input" type="email" required value={state.guest.email}
            onChange={e => updateGuest('email', e.target.value)} />
        </div>
      </div>
      <div className="p-field" style={{ maxWidth: 240 }}>
        <label className="p-label">Phone</label>
        <input className="p-input" type="tel" value={state.guest.phone || ''}
          onChange={e => updateGuest('phone', e.target.value)} />
      </div>

      <h3>Billing address</h3>
      <div className="p-field">
        <label className="p-label">Street{termsRequired ? ' *' : ''}</label>
        <input className="p-input" required={termsRequired} value={state.guest.billing_street}
          onChange={e => updateGuest('billing_street', e.target.value)} />
      </div>
      <div className="p-grid-3">
        <div className="p-field">
          <label className="p-label">City{termsRequired ? ' *' : ''}</label>
          <input className="p-input" required={termsRequired} value={state.guest.billing_city}
            onChange={e => updateGuest('billing_city', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Postcode{termsRequired ? ' *' : ''}</label>
          <input className="p-input" required={termsRequired} value={state.guest.billing_postcode}
            onChange={e => updateGuest('billing_postcode', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Country{termsRequired ? ' *' : ''}</label>
          <select className="p-input" required={termsRequired} value={state.guest.billing_country}
            onChange={e => updateGuest('billing_country', e.target.value)}>
            <option value="">—</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
        <input
          type="checkbox"
          checked={showCompany}
          onChange={e => {
            setShowCompany(e.target.checked);
            if (!e.target.checked) {
              updateGuest('company_name', '');
              updateGuest('vat_number', '');
            }
          }}
        />
        Booking on behalf of a company
      </label>
      {showCompany && (
        <div className="p-grid-2">
          <div className="p-field">
            <label className="p-label">Company name</label>
            <input className="p-input" value={state.guest.company_name}
              onChange={e => updateGuest('company_name', e.target.value)} />
          </div>
          <div className="p-field">
            <label className="p-label">VAT number</label>
            <input className="p-input" value={state.guest.vat_number}
              onChange={e => updateGuest('vat_number', e.target.value)} />
          </div>
        </div>
      )}

      <h3>Stay details</h3>
      <div className="p-grid-2">
        <div className="p-field">
          <label className="p-label">Estimated arrival time</label>
          <input className="p-input" type="time" value={state.guest.estimated_arrival_time || ''}
            onChange={e => updateGuest('estimated_arrival_time', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Shore power</label>
          <select className="p-input" value={state.guest.shore_power_amperage || ''}
            onChange={e => updateGuest('shore_power_amperage', e.target.value)}>
            <option value="">—</option>
            <option value="16A">16A</option>
            <option value="32A">32A</option>
            <option value="63A">63A</option>
            <option value="none">None needed</option>
          </select>
        </div>
      </div>
      <div className="p-field">
        <label className="p-label">Special requests</label>
        <textarea className="p-input" rows={3} value={state.guest.special_requests || ''}
          onChange={e => updateGuest('special_requests', e.target.value)} />
      </div>

      <div className="p-field" style={{ maxWidth: 240 }}>
        <label className="p-label">Promo code</label>
        <input className="p-input" disabled placeholder="Promo codes coming soon" />
      </div>

      {termsRequired && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, margin: '12px 0' }}>
          <input
            type="checkbox"
            checked={!!state.guest.terms_accepted}
            onChange={e => updateGuest('terms_accepted', e.target.checked)}
          />
          <span>
            I accept the{' '}
            <a href={marina.booking_terms_pdf_url} target="_blank" rel="noreferrer">
              booking terms and cancellation policy
            </a>
            .
          </span>
        </label>
      )}

      {error && <p style={{ fontSize: 13, color: '#dc2626', margin: '8px 0' }}>{error}</p>}

      <div className="q-step-footer">
        <button type="button" className="p-btn-outline" onClick={onBack}>← Back</button>
        <button type="submit" className="p-btn-gold" disabled={!canContinue}>Continue to payment →</button>
      </div>
    </form>
  );
}
