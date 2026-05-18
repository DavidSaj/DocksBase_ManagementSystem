import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import api, { createReservationIntent } from '@docksbase/portal-ui/api';
import { HarbourScene, WaveLines } from '../components/HarbourScene';
import VesselStep from './quote/VesselStep';
import GuestStep from './quote/GuestStep';
import PaymentStep from './quote/PaymentStep';
import BookingSummary from './quote/BookingSummary';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

const EMPTY_GUEST = {
  name: '', email: '', phone: '',
  billing_street: '', billing_city: '', billing_postcode: '', billing_country: '',
  company_name: '', vat_number: '',
  estimated_arrival_time: '', special_requests: '', shore_power_amperage: '',
  terms_accepted: false,
};

export default function QuoteScreen({ state, navigate, marina }) {
  const marinaSlug = marina?.slug || localStorage.getItem('portal_marina_slug') || '';

  const [currentStep, setCurrentStep] = useState('vessel');
  const [boats, setBoats] = useState(() => state.boats.map(b => ({
    ...b,
    vesselName: b.vesselName || '',
    airDraft: b.airDraft || '',
    vesselRegistration: b.vesselRegistration || '',
    vesselFlag: b.vesselFlag || '',
    crewCount: b.crewCount || '',
    insurance: b.insurance || null,
    shareInsuranceFromBoat0: false,
  })));
  const [guest, setGuest] = useState(EMPTY_GUEST);
  const [intentData, setIntentData] = useState(null);
  const [error, setError] = useState('');

  const updateBoat = (idx, key, value) =>
    setBoats(bs => bs.map((b, i) => i === idx ? { ...b, [key]: value } : b));
  const addBoat = () => setBoats(bs => [...bs, {
    loa: '', beam: '', draft: '', vesselName: '', airDraft: '',
    vesselRegistration: '', vesselFlag: '', crewCount: '',
    insurance: null, shareInsuranceFromBoat0: true,
  }]);
  const removeBoat = (idx) => setBoats(bs => bs.filter((_, i) => i !== idx));
  const updateGuest = (key, value) => setGuest(g => ({ ...g, [key]: value }));

  async function submitIntent() {
    setError('');
    const payload = {
      check_in:  state.checkIn,
      check_out: state.checkOut,
      guest_name:  guest.name,
      guest_email: guest.email,
      guest_phone: guest.phone,
      estimated_arrival_time: guest.estimated_arrival_time || null,
      special_requests: guest.special_requests,
      shore_power_amperage: guest.shore_power_amperage || null,
      billing_street:   guest.billing_street,
      billing_city:     guest.billing_city,
      billing_postcode: guest.billing_postcode,
      billing_country:  guest.billing_country,
      company_name:     guest.company_name,
      vat_number:       guest.vat_number,
      terms_accepted:   !!guest.terms_accepted,
      items: boats.map((boat, i) => {
        const token =
          boat.insurance?.token
          || (i > 0 && boat.shareInsuranceFromBoat0 ? boats[0].insurance?.token : '')
          || '';
        return {
          boat_loa:          parseFloat(boat.loa),
          boat_beam:         boat.beam  ? parseFloat(boat.beam)  : null,
          boat_draft:        boat.draft ? parseFloat(boat.draft) : null,
          boat_air_draft:    boat.airDraft ? parseFloat(boat.airDraft) : null,
          berth_category_id: boat.category?.id ?? null,
          vessel_name:           boat.vesselName,
          vessel_registration:   boat.vesselRegistration,
          vessel_flag:           boat.vesselFlag,
          crew_count:            boat.crewCount ? parseInt(boat.crewCount, 10) : null,
          insurance_upload_token: token,
        };
      }),
    };
    try {
      const { data } = await createReservationIntent(marinaSlug, payload);
      if (!data.requires_payment) {
        navigate('confirmed', {
          reservationReference: data.reference,
          reservationStatus: 'pending_review',
        });
        return;
      }
      setIntentData({
        clientSecret:  data.client_secret,
        reservationId: data.reservation_id,
        total:         data.total,
        reference:     data.reference,
        lockedUntil:   data.locked_until,
        marinaSlug,
        items:         data.items,
      });
      setCurrentStep('payment');
    } catch (err) {
      if (err.response?.status === 409) {
        const params = new URLSearchParams({
          check_in:  state.checkIn,
          check_out: state.checkOut,
          boat_loa:  boats[0].loa,
        });
        api.get(`/public/bookings/availability-alternatives/?${params}`)
          .then(r => navigate('alternatives', { alternatives: r.data }))
          .catch(() => navigate('alternatives', { alternatives: [] }));
        return;
      }
      const detail = err.response?.data?.detail;
      const map = {
        terms_not_accepted: 'You must accept the booking terms to continue.',
        insurance_token_invalid: 'Your insurance upload could not be found. Please re-upload.',
        insurance_token_consumed: 'Your insurance upload was already used. Please re-upload.',
        insurance_token_expired: 'Your insurance upload has expired. Please re-upload.',
      };
      setError(map[detail] || detail || 'Something went wrong. Please try again.');
    }
  }

  const stripeOptions = intentData ? {
    clientSecret: intentData.clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#b8965a', colorBackground: '#ede7d8',
        colorText: '#1a1a1a', fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        borderRadius: '5px',
      },
    },
  } : null;

  const stateForSummary = { checkIn: state.checkIn, checkOut: state.checkOut, boats };

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 280 }}>
        <nav style={{
          maxWidth: 1180, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline"
            onClick={() => navigate(state.boats.some(b => b.categories?.length > 0) ? 'options' : 'search')}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back to search
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>
        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Complete your booking</div>
          <h1 className="p-title">
            {currentStep === 'vessel' && 'Vessel details'}
            {currentStep === 'guest' && 'Your details'}
            {currentStep === 'payment' && 'Payment'}
          </h1>
        </div>
        <HarbourScene />
      </div>

      <div className="q-checkout-section">
        <WaveLines />
        <div className="q-checkout-grid">
          <div className="q-checkout-form">
            {currentStep === 'vessel' && (
              <VesselStep
                state={{ boats }}
                updateBoat={updateBoat} addBoat={addBoat} removeBoat={removeBoat}
                marina={marina}
                onBack={() => navigate(state.boats.some(b => b.categories?.length > 0) ? 'options' : 'search')}
                onNext={() => setCurrentStep('guest')}
              />
            )}
            {currentStep === 'guest' && (
              <GuestStep
                state={{ guest }}
                updateGuest={updateGuest}
                marina={marina}
                onBack={() => setCurrentStep('vessel')}
                onNext={submitIntent}
                error={error}
              />
            )}
            {currentStep === 'payment' && intentData && (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PaymentStep
                  state={{ guest }}
                  intentData={intentData}
                  onBack={() => setCurrentStep('guest')}
                  onConfirmed={ref => navigate('confirmed', {
                    reservationReference: ref,
                    reservationStatus: 'confirmed',
                  })}
                />
              </Elements>
            )}
          </div>
          <BookingSummary
            state={stateForSummary}
            marina={marina}
            intentData={intentData}
            onHoldExpired={() => {
              setIntentData(null);
              setCurrentStep('vessel');
              setError('Your hold expired. Please redo the booking.');
            }}
          />
        </div>
        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
