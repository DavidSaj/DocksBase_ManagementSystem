# Reservation Cart — Phase 2B: Portal Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the portal BookingWizard to the Reservation cart API — multi-boat support, per-boat categories, and a unified intent endpoint that handles both auto-tetris (Stripe payment) and manual (request-only) marinas.

**Architecture:** A small backend patch adds `pending_review`/`unassigned` status choices and a manual marina branch in `ReservationIntentView` that returns `requires_payment: false` instead of a 400. On the frontend, `BookingWizard` state changes from flat `boatLoa/boatBeam/boatDraft` to a `boats[]` array; `SearchScreen` fetches categories per boat; `OptionsScreen` shows per-boat pickers; `QuoteScreen` always calls `createReservationIntent()` and branches on `requires_payment`.

**Tech Stack:** Django 6 + DRF (backend), React 19 + Axios + Stripe React SDK (frontend), pytest-django (backend tests), manual browser testing (frontend).

---

## File Map

**Backend (modify):**
- `backend/apps/reservations/models.py` — add status choices
- `backend/apps/reservations/migrations/0018_reservation_pending_review_unassigned.py` — generated
- `backend/apps/reservations/public_reservation_views.py` — manual marina branch
- `backend/apps/reservations/tests.py` — 2 new tests

**Frontend (modify):**
- `portal/src/api.js` — 2 new functions
- `portal/src/BookingWizard.jsx` — boats[] state, 'confirmed' screen route
- `portal/src/screens/SearchScreen.jsx` — multi-boat UI, per-boat category fetch
- `portal/src/screens/OptionsScreen.jsx` — per-boat category picker
- `portal/src/screens/QuoteScreen.jsx` — new API calls, two-stage UI

**Frontend (create):**
- `portal/src/screens/ReservationConfirmedScreen.jsx` — two copy variants

---

### Task 1: Backend — Add `pending_review` and `unassigned` status choices

**Files:**
- Modify: `backend/apps/reservations/models.py`
- Create: `backend/apps/reservations/migrations/0018_reservation_pending_review_unassigned.py`
- Test: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Write the failing test**

Open `backend/apps/reservations/tests.py`. Find the `TestReservationCheckoutFields` class (already exists). Add two new test methods inside it:

```python
def test_pending_review_status_is_valid_choice(self):
    from apps.reservations.models import Reservation
    marina = Marina.objects.create(name='Status Test Marina', slug='status-test')
    res = Reservation.objects.create(
        marina=marina,
        guest_email='test@test.com',
        status='pending_review',
    )
    res.full_clean()  # raises ValidationError if not a valid choice
    self.assertEqual(res.status, 'pending_review')

def test_unassigned_item_status_is_valid_choice(self):
    from apps.reservations.models import Reservation, ReservationItem
    marina = Marina.objects.create(name='Item Status Marina', slug='item-status-test')
    res = Reservation.objects.create(marina=marina, guest_email='t@t.com', status='pending_review')
    item = ReservationItem(
        reservation=res,
        check_in=datetime.date(2028, 5, 1),
        check_out=datetime.date(2028, 5, 4),
        nights=3,
        status='unassigned',
    )
    item.full_clean()
    self.assertEqual(item.status, 'unassigned')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest apps/reservations/tests.py::TestReservationCheckoutFields::test_pending_review_status_is_valid_choice apps/reservations/tests.py::TestReservationCheckoutFields::test_unassigned_item_status_is_valid_choice -v
```

Expected: FAIL — `ValidationError: Value 'pending_review' is not a valid choice.`

- [ ] **Step 3: Add status choices to models**

In `backend/apps/reservations/models.py`, find `Reservation.STATUS_CHOICES`. Add the new entry after `('abandoned', 'Abandoned')`:

```python
STATUS_CHOICES = [
    ('pending_approval',  'Pending Approval'),
    ('awaiting_payment',  'Awaiting Payment'),
    ('pending_payment',   'Pending Payment'),
    ('pending_checkout',  'Pending Checkout'),
    ('pending_review',    'Pending Manager Review'),   # <-- add this
    ('confirmed',         'Confirmed'),
    ('pending',           'Pending'),
    ('checked_in',        'Checked In'),
    ('checked_out',       'Checked Out'),
    ('overstay',          'Overstay'),
    ('no_show',           'No Show'),
    ('cancelled',         'Cancelled'),
    ('abandoned',         'Abandoned'),
]
```

In `backend/apps/reservations/models.py`, find `ReservationItem.status` field (near the bottom of the class). Add `'unassigned'` to its choices list:

```python
status = models.CharField(
    max_length=20,
    choices=[
        ('locked',      'Locked'),
        ('confirmed',   'Confirmed'),
        ('released',    'Released'),
        ('unassigned',  'Unassigned'),   # <-- add this
    ],
    default='confirmed',
)
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend
python manage.py makemigrations reservations --name reservation_pending_review_unassigned
```

Expected output: `Migrations for 'reservations': apps/reservations/migrations/0018_reservation_pending_review_unassigned.py`

- [ ] **Step 5: Apply the migration**

```bash
python manage.py migrate reservations
```

Expected: `Applying reservations.0018_reservation_pending_review_unassigned... OK`

- [ ] **Step 6: Run tests to verify they pass**

```bash
python -m pytest apps/reservations/tests.py::TestReservationCheckoutFields -v
```

Expected: all 5 tests in the class PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/migrations/0018_reservation_pending_review_unassigned.py backend/apps/reservations/tests.py
git commit -m "feat(reservations): add pending_review and unassigned status choices"
```

---

### Task 2: Backend — Manual marina branch in `ReservationIntentView`

**Files:**
- Modify: `backend/apps/reservations/public_reservation_views.py`
- Modify: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/apps/reservations/tests.py`. Add a new test class after `TestReservationConfirmView`:

```python
class TestReservationIntentManualMarina(TestCase):
    BASE_URL = '/public/reservations/intent/'

    def _setup_marina(self):
        from apps.billing.service import seed_default_tax_rates
        from apps.billing.models import TaxRate, ChargeableItem
        marina = Marina.objects.create(
            name='Manual Marina', slug='manual-m', booking_mode='manual',
        )
        seed_default_tax_rates(marina)
        return marina

    def test_manual_marina_returns_requires_payment_false(self):
        from apps.reservations.models import Reservation, ReservationItem
        marina = self._setup_marina()
        client = Client()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2028-06-01',
                'check_out': '2028-06-04',
                'guest_name': 'Manual Guest',
                'guest_email': 'manual@test.com',
                'items': [{'boat_loa': '12.0'}],
            },
            content_type='application/json',
            HTTP_X_MARINA_SLUG='manual-m',
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertFalse(data['requires_payment'])
        self.assertIn('reservation_id', data)
        self.assertIn('RES-', data['reference'])
        self.assertNotIn('client_secret', data)

    def test_manual_marina_creates_pending_review_reservation(self):
        from apps.reservations.models import Reservation, ReservationItem
        marina = self._setup_marina()
        client = Client()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2028-07-01',
                'check_out': '2028-07-03',
                'guest_name': 'Request Guest',
                'guest_email': 'req@test.com',
                'items': [
                    {'boat_loa': '10.0', 'vessel_name': 'My Yacht'},
                    {'boat_loa': '5.0',  'vessel_name': 'Tender'},
                ],
            },
            content_type='application/json',
            HTTP_X_MARINA_SLUG='manual-m',
        )
        self.assertEqual(resp.status_code, 201)
        res_id = resp.json()['reservation_id']
        res = Reservation.objects.get(pk=res_id)
        self.assertEqual(res.status, 'pending_review')
        self.assertFalse(res.paid)
        items = ReservationItem.objects.filter(reservation=res)
        self.assertEqual(items.count(), 2)
        self.assertTrue(all(i.status == 'unassigned' for i in items))
        self.assertTrue(all(i.berth_id is None for i in items))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest apps/reservations/tests.py::TestReservationIntentManualMarina -v
```

Expected: FAIL — both tests return 400 because the current view rejects non-auto_tetris marinas.

- [ ] **Step 3: Update `ReservationIntentView` to handle manual marinas**

In `backend/apps/reservations/public_reservation_views.py`, replace the block that currently rejects non-auto_tetris marinas:

Find and replace this section (around line 60-65 in the view's `post` method):

```python
# OLD — replace this entire if-block:
if marina.booking_mode != 'auto_tetris':
    return Response(
        {'detail': 'This marina does not accept online bookings.'},
        status=status.HTTP_400_BAD_REQUEST,
    )
```

Replace it with the full manual branch. The new code goes right after `marina = request.tenant` and the serializer validation, BEFORE the auto_tetris logic:

```python
marina = request.tenant
if marina.booking_mode != 'auto_tetris':
    return self._handle_manual(request, marina)
```

Then add `_handle_manual` as a method on `ReservationIntentView`, before `post`:

```python
def _handle_manual(self, request, marina):
    ser = ReservationIntentSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    d = ser.validated_data
    check_in  = d['check_in']
    check_out = d['check_out']
    nights    = (check_out - check_in).days

    reservation = Reservation.objects.create(
        marina=marina,
        guest_name=d['guest_name'],
        guest_email=d['guest_email'],
        guest_phone=d.get('guest_phone', ''),
        status='pending_review',
        booking_source='portal',
    )
    for item in d['items']:
        ReservationItem.objects.create(
            reservation=reservation,
            berth=None,
            check_in=check_in,
            check_out=check_out,
            nights=nights,
            vessel_name=item.get('vessel_name', ''),
            boat_loa=item.get('boat_loa'),
            boat_beam=item.get('boat_beam'),
            boat_draft=item.get('boat_draft'),
            status='unassigned',
        )
    return Response({
        'reservation_id': reservation.pk,
        'reference': f'RES-{reservation.pk}',
        'requires_payment': False,
        'status': 'pending_review',
    }, status=status.HTTP_201_CREATED)
```

Also update the existing `post` method's auto_tetris return to include the new fields. Find the final `return Response(...)` at the bottom of `post` and add `requires_payment` and `reference`:

```python
return Response(
    {
        'reservation_id': reservation.pk,
        'reference': f'RES-{reservation.pk}',
        'requires_payment': True,
        'client_secret': client_secret,
        'total': str(reservation.total_price),
        'locked_until': reservation.locked_until.isoformat(),
        'items': items_data,
    },
    status=status.HTTP_201_CREATED,
)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python -m pytest apps/reservations/tests.py::TestReservationIntentManualMarina -v
```

Expected: both tests PASS.

- [ ] **Step 5: Run full reservation test suite to check no regressions**

```bash
python -m pytest apps/reservations/tests.py::TestReservationIntentView apps/reservations/tests.py::TestReservationConfirmView apps/reservations/tests.py::TestReservationIntentManualMarina -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/public_reservation_views.py backend/apps/reservations/tests.py
git commit -m "feat(reservations): manual marina branch in intent endpoint — no payment, pending_review"
```

---

### Task 3: Frontend — Add `createReservationIntent` and `confirmReservation` to `api.js`

**Files:**
- Modify: `portal/src/api.js`

- [ ] **Step 1: Add the two new exported functions**

Open `portal/src/api.js`. At the bottom of the file, after the last `export function`, add:

```js
export function createReservationIntent(marinaSlug, payload) {
  return api.post('/public/reservations/intent/', payload, {
    headers: { 'X-Marina-Slug': marinaSlug },
  });
}

export function confirmReservation(marinaSlug, reservationId, paymentIntentId) {
  return api.post('/public/reservations/confirm/', {
    reservation_id: reservationId,
    payment_intent_id: paymentIntentId,
  }, {
    headers: { 'X-Marina-Slug': marinaSlug },
  });
}
```

- [ ] **Step 2: Verify no import errors**

```bash
cd portal
npx vite build --mode development 2>&1 | grep -i error
```

Expected: no errors (or only pre-existing warnings).

- [ ] **Step 3: Commit**

```bash
git add portal/src/api.js
git commit -m "feat(portal): add createReservationIntent and confirmReservation API functions"
```

---

### Task 4: Frontend — Refactor `BookingWizard` state + add `ReservationConfirmedScreen`

**Files:**
- Modify: `portal/src/BookingWizard.jsx`
- Create: `portal/src/screens/ReservationConfirmedScreen.jsx`

- [ ] **Step 1: Create `ReservationConfirmedScreen.jsx`**

Create `portal/src/screens/ReservationConfirmedScreen.jsx`:

```jsx
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

export default function ReservationConfirmedScreen({ state, marina }) {
  const isPending = state.reservationStatus === 'pending_review';
  const slug = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
  const marinaName = marina?.name || 'Your Marina';
  const contactEmail = marina?.contact_email || '';
  const contactPhone = marina?.phone || '';

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)' }}>
            {marinaName}
          </span>
        </nav>
        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">{isPending ? 'Request received' : 'Reservation confirmed'}</div>
          <h1 className="p-title">{isPending ? 'We\'ll be in touch.' : 'You\'re all set.'}</h1>
        </div>
        <HarbourScene />
      </div>

      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />
        <div style={{ maxWidth: 560, margin: '-40px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>
          <div style={{
            background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10,
            padding: '36px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
            textAlign: 'center', marginBottom: 16,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', margin: '0 auto 16px',
              background: 'rgba(184,150,90,0.12)', border: '1.5px solid var(--gold)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: 'var(--gold)',
            }}>✓</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 6, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Your reference
            </div>
            <div style={{ fontSize: 28, fontFamily: 'var(--font-brand)', fontWeight: 700, color: 'var(--navy)', letterSpacing: '2px' }}>
              {state.reservationReference}
            </div>
          </div>

          <div style={{
            background: '#f7f7f7', border: '1px solid #ebebeb',
            borderRadius: 8, padding: '16px 20px',
            fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
            marginBottom: 12,
          }}>
            {isPending ? (
              <>
                Your reservation request has been received. The harbour master will review it
                and you'll receive an email once your berths are assigned. Keep your reference
                handy — you can use it along with your email address to check your status.
              </>
            ) : (
              <>
                A confirmation email is on its way — it includes your berth assignment,
                arrival details, and a personal boarding pass link for digital check-in.
                If you don't see it within a few minutes, check your spam folder.
              </>
            )}
          </div>

          {(contactEmail || contactPhone) && (
            <div style={{
              border: '1px solid #e8e8e8', borderRadius: 8, padding: '14px 20px',
              fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
            }}>
              <span style={{ fontWeight: 600, color: '#1a1a1a' }}>Questions?</span>{' '}
              Contact {marinaName} directly
              {contactEmail && <> at <a href={`mailto:${contactEmail}`} style={{ color: '#1a1a1a' }}>{contactEmail}</a></>}
              {contactEmail && contactPhone && ' or '}
              {contactPhone && <><a href={`tel:${contactPhone}`} style={{ color: '#1a1a1a' }}>{contactPhone}</a></>}
              .
            </div>
          )}
        </div>
        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `BookingWizard.jsx`**

Replace the entire contents of `portal/src/BookingWizard.jsx` with:

```jsx
import { useState } from 'react';
import SearchScreen from './SearchScreen';
import OptionsScreen from './OptionsScreen';
import AlternativesScreen from './AlternativesScreen';
import QuoteScreen from './QuoteScreen';
import BookingRequestSent from './BookingRequestSent';
import ReservationConfirmedScreen from './ReservationConfirmedScreen';

const INITIAL_STATE = {
  checkIn: '', checkOut: '',
  boats: [{ loa: '', beam: '', draft: '', category: null, categories: [] }],
  quotedTotal: null,
  alternatives: [],
  errorBanner: '',
  reservationReference: null,
  reservationStatus: null,
};

export default function BookingWizard({ marina }) {
  const [screen, setScreen] = useState('search');
  const [state, setState]   = useState(INITIAL_STATE);

  const navigate = (nextScreen, updates = {}) => {
    setState(s => ({ ...s, ...updates, errorBanner: updates.errorBanner ?? '' }));
    setScreen(nextScreen);
  };

  if (screen === 'options')       return <OptionsScreen state={state} navigate={navigate} marina={marina} />;
  if (screen === 'alternatives')  return <AlternativesScreen state={state} navigate={navigate} />;
  if (screen === 'quote')         return <QuoteScreen state={state} navigate={navigate} marina={marina} />;
  if (screen === 'sent')          return <BookingRequestSent marina={marina} />;
  if (screen === 'confirmed')     return <ReservationConfirmedScreen state={state} marina={marina} />;
  return <SearchScreen state={state} navigate={navigate} marina={marina} />;
}
```

- [ ] **Step 3: Verify dev server starts without errors**

```bash
cd portal
npm run dev 2>&1 | head -20
```

Expected: `VITE ready` with no import errors. (Ctrl+C to stop.)

- [ ] **Step 4: Commit**

```bash
git add portal/src/BookingWizard.jsx portal/src/screens/ReservationConfirmedScreen.jsx
git commit -m "feat(portal): refactor BookingWizard to boats[] state, add ReservationConfirmedScreen"
```

---

### Task 5: Frontend — Multi-boat UI in `SearchScreen`

**Files:**
- Modify: `portal/src/screens/SearchScreen.jsx`

- [ ] **Step 1: Replace `SearchScreen.jsx`**

Replace the entire file contents:

```jsx
import { useState } from 'react';
import api from '../api';
import DateRangePicker from '../components/portal/DateRangePicker';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const EMPTY_BOAT = { loa: '', beam: '', draft: '', category: null, categories: [] };

export default function SearchScreen({ state, navigate, marina }) {
  const initialBoats = state.boats?.length
    ? state.boats.map(b => ({ ...EMPTY_BOAT, loa: b.loa || '', beam: b.beam || '', draft: b.draft || '' }))
    : [{ ...EMPTY_BOAT }];

  const [checkIn,  setCheckIn]  = useState(state.checkIn  || '');
  const [checkOut, setCheckOut] = useState(state.checkOut || '');
  const [boats,    setBoats]    = useState(initialBoats);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const nights =
    checkIn && checkOut
      ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
      : 0;

  const updateBoat = (idx, field, value) =>
    setBoats(bs => bs.map((b, i) => i === idx ? { ...b, [field]: value } : b));

  const addBoat = () => setBoats(bs => [...bs, { ...EMPTY_BOAT }]);

  const removeBoat = (idx) =>
    setBoats(bs => bs.filter((_, i) => i !== idx));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!checkIn || !checkOut) return;
    setBusy(true); setError('');

    try {
      // Fetch categories for each boat in parallel
      const catResults = await Promise.all(
        boats.map(boat => {
          const params = new URLSearchParams({ check_in: checkIn, check_out: checkOut });
          if (boat.loa)   params.set('boat_loa',   boat.loa);
          if (boat.beam)  params.set('boat_beam',  boat.beam);
          if (boat.draft) params.set('boat_draft', boat.draft);
          return api.get(`/public/bookings/berth-categories/?${params}`)
            .then(r => r.data)
            .catch(() => []);
        })
      );

      const updatedBoats = boats.map((boat, i) => ({ ...boat, categories: catResults[i] }));
      const hasAnyCategories = updatedBoats.some(b => b.categories.length > 0);

      if (hasAnyCategories) {
        navigate('options', { checkIn, checkOut, boats: updatedBoats });
      } else {
        // No categories configured — go straight to quote; intent endpoint handles availability
        navigate('quote', { checkIn, checkOut, boats: updatedBoats });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 360 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>
        <div className="p-hero-inner">
          <div className="p-eyebrow">Online Reservations</div>
          <h1 className="p-title">Book a Berth</h1>
          <p className="p-sub">Check real-time availability and reserve your spot.</p>
        </div>
        <HarbourScene />
      </div>

      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)', paddingBottom: 280 }}>
        <WaveLines />

        <div className="p-form-card">
          <div className="p-form-card-inner" style={{ position: 'relative' }}>
            {state.errorBanner && (
              <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{state.errorBanner}</p>
            )}

            <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
              {/* Date row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <DateRangePicker
                  checkIn={checkIn}
                  checkOut={checkOut}
                  onChange={({ checkIn: ci, checkOut: co }) => { setCheckIn(ci); setCheckOut(co); }}
                />
              </div>

              {/* Per-boat dimension rows */}
              {boats.map((boat, idx) => (
                <div key={idx} style={{ marginBottom: 16 }}>
                  {boats.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Boat {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeBoat(idx)}
                        style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div className="p-field" style={{ marginBottom: 0 }}>
                      <label className="p-label">Length (m) *</label>
                      <input className="p-input" type="number" step="0.1" min="1" placeholder="e.g. 12"
                        required value={boat.loa} onChange={e => updateBoat(idx, 'loa', e.target.value)} />
                    </div>
                    <div className="p-field" style={{ marginBottom: 0 }}>
                      <label className="p-label">Beam (m)</label>
                      <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 4.2"
                        value={boat.beam} onChange={e => updateBoat(idx, 'beam', e.target.value)} />
                    </div>
                    <div className="p-field" style={{ marginBottom: 0 }}>
                      <label className="p-label">Draft (m)</label>
                      <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 1.8"
                        value={boat.draft} onChange={e => updateBoat(idx, 'draft', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addBoat}
                style={{ fontSize: 12, color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px', display: 'block' }}
              >
                + Add another boat
              </button>

              {nights > 0 && (
                <p className="p-nights-note">{nights} night{nights !== 1 ? 's' : ''}</p>
              )}

              <button
                type="submit"
                className="p-btn-gold"
                disabled={busy || !checkIn || !checkOut || boats.some(b => !b.loa)}
                style={{ width: '100%', marginTop: 8 }}
              >
                {busy ? 'Checking…' : 'Check availability →'}
              </button>

              {error && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 12 }}>{error}</p>}
            </form>
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test — open the booking wizard**

Start the dev server and open the marina's booking page in a browser.

```bash
cd portal && npm run dev
```

Verify:
- Single boat: LOA/beam/draft fields render, no label/remove button
- Click "+ Add another boat": second set of fields appears with "Boat 1" / "Boat 2" labels and a "Remove" button on each
- "Remove" button disappears when only 1 boat remains
- "Check availability →" button is disabled until all boat LOAs are filled in

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/SearchScreen.jsx
git commit -m "feat(portal): multi-boat dimensions UI in SearchScreen"
```

---

### Task 6: Frontend — Per-boat category picker in `OptionsScreen`

**Files:**
- Modify: `portal/src/screens/OptionsScreen.jsx`

- [ ] **Step 1: Replace `OptionsScreen.jsx`**

The file uses `state.categories` (single array) and a single `handleSelect` that navigates to quote. We need to change it to loop over `state.boats`, show each boat's categories, and update `boats[i].category` on selection. A "Continue" button appears once every boat has been given a category (or has no categories available).

Replace the entire `portal/src/screens/OptionsScreen.jsx` with:

```jsx
import { useState } from 'react';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const AMENITY_LABELS = {
  power_30a: '30A Power', power_50a: '50A Power', water: 'Water',
  wifi: 'WiFi', fuel_nearby: 'Fuel Nearby', pump_out: 'Pump-out',
};

const AMENITY_ICONS = {
  power_30a: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  power_50a: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  water:     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>,
  wifi:      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  fuel_nearby: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>,
  pump_out:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>,
};

const MOORING_LABELS = {
  finger: 'Finger Pontoon', alongside: 'Alongside',
  stern_to: 'Stern-to', mooring_ball: 'Mooring Ball',
};

export default function OptionsScreen({ state, navigate, marina }) {
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);

  // Local copy of boats so category selections are tracked without mutating wizard state
  const [boats, setBoats] = useState(state.boats.map(b => ({ ...b })));

  const selectCategory = (boatIdx, cat) => {
    setBoats(bs => bs.map((b, i) => i === boatIdx ? { ...b, category: cat } : b));
  };

  // All boats with available categories must have one selected before continuing
  const canContinue = boats.every(b => b.categories.length === 0 || b.category !== null);

  const handleContinue = () => {
    navigate('quote', { ...state, boats });
  };

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 360 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline" onClick={() => navigate('search')}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>
        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Available options</div>
          <h1 className="p-title">Choose your berth.</h1>
          <p className="p-sub">
            {state.checkIn} → {state.checkOut} · {nights} night{nights !== 1 ? 's' : ''}
          </p>
        </div>
        <HarbourScene />
      </div>

      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />

        <div style={{ maxWidth: 880, margin: '-36px auto 0', padding: '0 32px 24px', position: 'relative', zIndex: 2 }}>
          {boats.map((boat, boatIdx) => (
            boat.categories.length === 0 ? null : (
              <div key={boatIdx} style={{ marginBottom: 32 }}>
                {boats.length > 1 && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)', marginBottom: 12, opacity: 0.7 }}>
                    Boat {boatIdx + 1} — {boat.loa}m
                  </div>
                )}
                <div className="p-options-grid">
                  {boat.categories.map(cat => {
                    const selected = boat.category?.id === cat.id;
                    return (
                      <div key={cat.id ?? '__uncat'}
                        className="p-cat-card-light"
                        style={selected ? { outline: '2px solid var(--gold)' } : {}}
                      >
                        <div className="p-cat-card-body">
                          {cat.tier_note && (
                            <div style={{ fontSize: 11, color: '#b8965a', fontWeight: 600, letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                              {cat.tier_note}
                            </div>
                          )}
                          <div className="p-cat-name">{cat.name}</div>
                          {cat.tagline && <div className="p-cat-tagline">{cat.tagline}</div>}
                          {cat.mooring_type && <div className="p-cat-mooring">{MOORING_LABELS[cat.mooring_type] ?? cat.mooring_type}</div>}
                          {cat.description && <p className="p-cat-desc">{cat.description}</p>}
                          {cat.highlights?.length > 0 && (
                            <ul className="p-cat-highlights">{cat.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                          )}
                          {cat.amenities?.length > 0 && (
                            <div className="p-amenity-pills" style={{ marginTop: 4 }}>
                              {cat.amenities.map(a => (
                                <span key={a} className="p-amenity-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {AMENITY_ICONS[a]}{AMENITY_LABELS[a] ?? a}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="p-cat-card-sidebar">
                          <div>
                            <div className="p-cat-price">€{cat.price_per_night}<span>/night</span></div>
                            {nights > 1 && (
                              <div className="p-cat-avail">€{(parseFloat(cat.price_per_night) * nights).toFixed(2)} total</div>
                            )}
                            <div className="p-cat-avail" style={{ marginTop: 6 }}>{cat.available_count} berth{cat.available_count !== 1 ? 's' : ''} available</div>
                          </div>
                          <button className="p-btn-gold" onClick={() => selectCategory(boatIdx, cat)}
                            style={{ marginTop: 16, whiteSpace: 'nowrap', opacity: selected ? 0.5 : 1 }}>
                            {selected ? 'Selected ✓' : 'Select →'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ))}

          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <button
              className="p-btn-gold"
              disabled={!canContinue}
              onClick={handleContinue}
              style={{ minWidth: 160 }}
            >
              Continue →
            </button>
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test — options screen with 2 boats**

In the browser, add 2 boats in the search screen and submit. Verify:
- Options screen shows two separate sections ("Boat 1 — Xm" and "Boat 2 — Ym")
- Selecting a category in boat 1 doesn't affect boat 2's selection
- "Continue →" is disabled until all boats with available categories have a selection
- Single-boat: one section shown, no "Boat 1" label

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/OptionsScreen.jsx
git commit -m "feat(portal): per-boat category picker in OptionsScreen"
```

---

### Task 7: Frontend — Swap `QuoteScreen` to reservation endpoints

**Files:**
- Modify: `portal/src/screens/QuoteScreen.jsx`

The current `QuoteScreen` pre-creates a Stripe PI on mount. The new flow:
1. Show a guest details form (name, email, phone, vessel name per boat)
2. On submit: call `createReservationIntent()` with all details
3. If `requires_payment: false` → navigate to 'confirmed' immediately
4. If `requires_payment: true` → show `PaymentElement` with the returned `client_secret`
5. Guest enters card → `stripe.confirmPayment()` → `confirmReservation()` → navigate to 'confirmed'

- [ ] **Step 1: Replace `QuoteScreen.jsx`**

Replace the entire file with:

```jsx
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createReservationIntent, confirmReservation } from '../api';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function GuestDetailsForm({ state, marina, onIntentCreated, onNavigateConfirmed, onNavigateAlternatives }) {
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const marinaSlug = marina?.slug || localStorage.getItem('portal_marina_slug') || '';

  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vesselNames, setVesselNames] = useState(state.boats.map(() => ''));
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const updateVesselName = (idx, val) =>
    setVesselNames(vs => vs.map((v, i) => i === idx ? val : v));

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true); setError('');

    const payload = {
      check_in:    state.checkIn,
      check_out:   state.checkOut,
      guest_name:  name,
      guest_email: email,
      guest_phone: phone,
      items: state.boats.map((boat, i) => ({
        boat_loa:         parseFloat(boat.loa),
        boat_beam:        boat.beam  ? parseFloat(boat.beam)  : null,
        boat_draft:       boat.draft ? parseFloat(boat.draft) : null,
        berth_category_id: boat.category?.id ?? null,
        vessel_name:      vesselNames[i] || '',
      })),
    };

    try {
      const { data } = await createReservationIntent(marinaSlug, payload);

      if (!data.requires_payment) {
        onNavigateConfirmed(data.reference, 'pending_review');
        return;
      }
      onIntentCreated({
        clientSecret:  data.client_secret,
        reservationId: data.reservation_id,
        total:         data.total,
        reference:     data.reference,
        marinaSlug,
      });
    } catch (err) {
      if (err.response?.status === 409) {
        // No availability — fetch alternatives and navigate there
        import('../api').then(({ default: api }) => {
          const params = new URLSearchParams({
            check_in:  state.checkIn,
            check_out: state.checkOut,
            boat_loa:  state.boats[0].loa,
          });
          api.get(`/public/bookings/availability-alternatives/?${params}`)
            .then(r => onNavigateAlternatives(r.data))
            .catch(() => onNavigateAlternatives([]));
        });
        return;
      }
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title">Your details</div>
      <div className="p-grid-2">
        <div className="p-field">
          <label className="p-label">Full name *</label>
          <input className="p-input" required value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Email *</label>
          <input className="p-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="p-field" style={{ maxWidth: 220 }}>
        <label className="p-label">Phone</label>
        <input className="p-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>

      <div className="p-section-title" style={{ marginTop: 16 }}>Vessel{state.boats.length > 1 ? 's' : ''}</div>
      {state.boats.map((boat, idx) => (
        <div key={idx} className="p-field">
          <label className="p-label">
            {state.boats.length > 1 ? `Boat ${idx + 1} name (${boat.loa}m)` : 'Vessel name'}
          </label>
          <input className="p-input" value={vesselNames[idx]}
            onChange={e => updateVesselName(idx, e.target.value)} placeholder="e.g. Bella Mare" />
        </div>
      ))}

      {error && <p style={{ fontSize: 13, color: '#dc2626', margin: '12px 0' }}>{error}</p>}

      <button type="submit" className="p-btn-gold" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
        {busy ? 'Checking availability…' : 'Continue to payment →'}
      </button>
    </form>
  );
}

function PaymentForm({ intentData, navigate }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const handlePay = async e => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError('');

    const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
    });

    if (stripeErr) {
      setError(stripeErr.message || 'Payment failed. Please try again.');
      setBusy(false);
      return;
    }

    try {
      await confirmReservation(intentData.marinaSlug, intentData.reservationId, paymentIntent.id);
      navigate('confirmed', {
        reservationReference: intentData.reference,
        reservationStatus: 'confirmed',
      });
    } catch (err) {
      if (err.response?.status === 409) {
        // Already confirmed (webhook beat us) — treat as success
        navigate('confirmed', {
          reservationReference: intentData.reference,
          reservationStatus: 'confirmed',
        });
        return;
      }
      setError('Payment received but confirmation failed. Please contact the marina with reference ' + intentData.reference);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handlePay}>
      <div className="p-section-title">Payment</div>
      <div style={{ marginBottom: 20 }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      <button type="submit" className="p-btn-gold" disabled={busy || !stripe} style={{ width: '100%' }}>
        {busy ? 'Processing…' : `Confirm & Pay €${parseFloat(intentData.total).toFixed(2)}`}
      </button>
      <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 10 }}>
        Secure payment powered by Stripe.
      </p>
    </form>
  );
}

export default function QuoteScreen({ state, navigate, marina }) {
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const [intentData, setIntentData] = useState(null);

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

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline"
            onClick={() => navigate(state.boats.some(b => b.categories?.length > 0) ? 'options' : 'search')}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>
        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Complete your booking</div>
          <h1 className="p-title">{intentData ? 'Payment' : 'Your details'}</h1>
          <p className="p-sub">
            {formatDate(state.checkIn)} → {formatDate(state.checkOut)} · {nights} night{nights !== 1 ? 's' : ''}
            {state.boats.length > 1 ? ` · ${state.boats.length} boats` : ''}
          </p>
        </div>
        <HarbourScene />
      </div>

      <div className="q-checkout-section">
        <WaveLines />
        <div className="q-checkout-inner">
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            {!intentData ? (
              <GuestDetailsForm
                state={state}
                marina={marina}
                onIntentCreated={setIntentData}
                onNavigateConfirmed={(ref, status) => navigate('confirmed', {
                  reservationReference: ref,
                  reservationStatus: status,
                })}
                onNavigateAlternatives={alts => navigate('alternatives', { alternatives: alts })}
              />
            ) : (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PaymentForm intentData={intentData} navigate={navigate} />
              </Elements>
            )}
          </div>
        </div>
        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test — auto-tetris marina full flow**

With dev server running:
1. Fill in dates + 1 boat LOA → "Check availability"
2. If categories exist, pick one → "Continue"
3. On quote screen, fill in name + email → "Continue to payment"
4. Stripe PaymentElement appears
5. Use Stripe test card `4242 4242 4242 4242` expiry `12/34` CVC `123`
6. Submit → "confirmed" screen appears with RES-{pk} reference

- [ ] **Step 3: Manual test — manual marina flow**

Switch to a marina with `booking_mode = 'manual'` (or temporarily set one in Django shell):

```python
# In Django shell: python manage.py shell
from apps.accounts.models import Marina
m = Marina.objects.get(slug='your-slug')
m.booking_mode = 'manual'
m.save()
```

Then in browser:
1. Fill in search → submit
2. Fill in guest details → "Continue to payment"
3. Verify: no Stripe form appears, goes straight to "confirmed" screen
4. Confirmed screen shows "Request received / We'll be in touch." copy with reference

Reset marina booking_mode afterwards.

- [ ] **Step 4: Manual test — 409 alternatives flow**

Use dates where no berths are available (e.g. very far future or after blocking all berths in Django admin):
1. Fill in search → submit → fill in guest details → submit
2. Verify: alternatives screen appears with date suggestions

- [ ] **Step 5: Commit**

```bash
git add portal/src/screens/QuoteScreen.jsx
git commit -m "feat(portal): QuoteScreen — reservation intent API, requires_payment branch, multi-boat support"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Backend: `pending_review` + `unassigned` statuses | Task 1 |
| Backend: manual marina branch in intent view | Task 2 |
| `createReservationIntent()` + `confirmReservation()` in api.js | Task 3 |
| `boats[]` array state in BookingWizard | Task 4 |
| `ReservationConfirmedScreen` two copy variants | Task 4 |
| Multi-boat dimensions UI in SearchScreen | Task 5 |
| Per-boat category picker in OptionsScreen | Task 6 |
| QuoteScreen: always call `createReservationIntent()` | Task 7 |
| QuoteScreen: branch on `requires_payment` | Task 7 |
| 409 → alternatives screen | Task 7 |
| Confirmed screen: reference displayed prominently | Task 4 |
| `engine-request` not called | All tasks ✓ |

**Placeholder scan:** No TBDs or vague steps — all code blocks are complete.

**Type consistency:** `boats[i].loa` (string in form state, `parseFloat`'d in payload) used consistently across SearchScreen → OptionsScreen → QuoteScreen → api payload.
