# Boater Portal Redesign — Design Spec
**Date:** 2026-05-10
**Status:** Approved

---

## 1. Overview

A ground-up redesign of the DocksBase boater-facing PWA. The current portal is a single-flow boarding-pass screen with basic styling and emojis. This redesign transforms it into a full five-tab mobile PWA serving two user types: transient guests (booking magic link) and marina members (email magic link). All marina data remains strictly siloed per the v1 multi-tenant architecture (Option A — marina-specific URLs).

**Core philosophy:** Contextual awareness. The app acts as a proactive digital concierge — it knows why the boater is opening it and surfaces what matters most right now.

**Excluded from this spec:** electricity toggle, waitlist, sub-let redemption UI (backend not built), dry stack launch scheduling (no launch model in utilities app yet).

---

## 2. Authentication & Session

### 2.1 Two magic link flows, one session shape

**Guest flow (unchanged entry point)**
1. Booking confirmation email contains `?token=` magic link
2. Portal exchanges token at `POST /portal/checkin/auth/magic/`
3. Response: `{ token, booking_id, marina_slug }`
4. Token stored in localStorage as `portal_session_token`
5. Token payload: `{ booking_id, marina_slug, boater_email }`
6. Salt: `portal-magic-v1` (existing)

**Member flow (new)**
1. Boater visits `/{slug}`, sees branded login screen, enters email
2. Frontend posts `POST /portal/auth/member-magic/request/` with `{ email }` + `X-Marina-Slug` header
3. Backend: `Member.objects.get(email=email, marina__slug=slug)` — finds exactly one record (strict marina isolation)
4. Backend generates signed token, sends magic link email to member
5. Boater clicks link → `POST /portal/auth/member-magic/verify/` with `{ token }`
6. Response: `{ session_token, member_id, marina_slug }`
7. Token stored in localStorage as `portal_session_token`
8. Token payload: `{ member_id, marina_slug, email }`
9. Salt: `portal-member-v1` (new)

Both token types use Django's `signing.dumps` / `signing.loads` infrastructure. Member tokens expire after 7 days; booking tokens expire after 72 hours (unchanged).

### 2.2 UserContext and capabilities

`UserContext` parses the token from localStorage on app load and exposes:

```js
const { user, capabilities } = useUserContext();

// capabilities object
{
  canViewBookingCheckin:  boolean,  // guest only
  canViewFullLedger:      boolean,  // member only
  canViewLoyalty:         boolean,  // member only
  canBookServices:        boolean,  // member only
  canManageVessel:        boolean,  // member only
  canAccessGates:         boolean,  // member only (access_control app)
  canViewMarketplace:     boolean,  // member only
  canSublet:              boolean,  // member + opt-in only (coming soon)
}
```

Components never check `role === 'guest'` or `role === 'member'`. They only check capabilities. This keeps all components clean and makes the v2 universal auth transition seamless.

### 2.3 Login screen

Shown at `/{slug}` when no session token exists in localStorage. Marina-branded (name + logo from `MarinaPublicView`). Single email input, "Send me a link" button. On submit shows "Check your email" confirmation. No password field anywhere in the app.

If localStorage has a `portal_session_token`, skip login and render the shell directly.

---

## 3. PWA Shell & Navigation

### 3.1 AppShell

Single `<AppShell>` wraps all authenticated content. Layout:

```
┌─────────────────────────────┐
│  Content area (scrollable)  │
│                             │
│                             │
├─────────────────────────────┤
│  Bottom nav (fixed)         │
└─────────────────────────────┘
```

Content area: `padding-bottom: calc(64px + env(safe-area-inset-bottom))` to clear the nav on iPhones.

Bottom nav: `position: fixed; bottom: 0; width: 100%`. White background, `1px solid rgba(0,0,0,0.08)` top border, `box-shadow: 0 -2px 12px rgba(0,0,0,0.06)`. Height: 64px + safe area.

**Guest mode exception:** Guests with `canViewBookingCheckin` and no other capabilities do not see the bottom nav. They see the full-screen checkin flow only.

### 3.2 Bottom navigation tabs

| Tab | Icon | Visible to |
|-----|------|-----------|
| Home | anchor SVG | members only (guests see full-screen checkin, no nav) |
| Services | wrench SVG | members only |
| Book | calendar SVG | members only |
| Wallet | card SVG | members only |
| Account | person SVG | members only |

Active tab: gold `3px` underline + `Jost 700` label weight. Inactive: `rgba(0,0,0,0.4)` label, normal weight. Icon size: 22×22px, thin stroke. No filled icons, no emoji.

Tabs with no member capabilities render a locked state (icon + label visible, tap shows "Members only" nudge card) rather than disappearing — layout remains stable.

### 3.3 Design system

All existing inline `style={{}}` objects migrated to CSS classes in `portal.css`. No new CSS framework.

**Typography**
- Body: `IBM Plex Sans`, 14px base, `#1a1a1a`
- Display / card headings: `Cormorant Garamond`, used for amounts, names, hero titles
- Labels / buttons / eyebrows / nav: `Jost`, uppercase tracking for labels

**Palette** (from existing tokens — unchanged)
- `--navy: #0c1f3d`
- `--gold: #b8965a`
- `--cream: #f5f0e6`
- `--bg: #f4f3f0` (page background)
- White cards on `--bg`
- Semantic: `--red: #c0392b`, `--orange: #dd5b00`, `--green: #1a8c2e`

**Components**
- Card radius: `12px`
- Button radius: `6px`
- Touch targets: minimum `44px` tall
- Shadows: `var(--shadow)` = `0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05)`
- Left-border accent cards: `4px solid <colour>` on left edge, white background

**No emoji anywhere.** All existing emoji replaced with inline SVG icons.

### 3.4 URL structure

```
/{slug}                          → login or shell root
/{slug}?token=<booking_token>    → guest magic link entry
/{slug}?member_token=<token>     → member magic link entry
/{slug}/booking/{id}/confirmed   → Stripe success redirect (unchanged)
/{slug}/booking/{id}/cancelled   → Stripe cancel redirect (unchanged)
```

Bottom nav uses React state (`activeTab`) not URL routing. No server-side routing changes needed.

### 3.5 Service worker

Existing service worker (`/sw.js`) unchanged. It already caches the app shell. Offline-available data: gate codes, WiFi password, VHF channel (cached from last successful `marina_wallet` fetch).

---

## 4. Home Tab

### 4.1 Guest mode (canViewBookingCheckin)

Full-screen, no bottom nav. Existing state machine preserved:

```
checklist → countdown → arrival → boarding_pass
```

`deriveState.js` logic unchanged. What changes: full design system applied, all emojis removed, navy hero strip with marina name in Jost + dates in Cormorant Garamond, white card overlapping hero (existing technique kept), gold CTA button for primary action.

### 4.2 Member mode

**Header:** Compact navy strip (56px). Marina name in Jost 700 cream left-aligned. Member first name right-aligned in muted cream. No hero strip — screen is a feed.

**Quick Actions row** (pinned below header, above feed):

Four circular tappable buttons, 56px diameter, white on `--bg`, `var(--shadow)`:
- WiFi Password → copies to clipboard, shows "Copied" toast
- Gate Code → copies to clipboard
- Call Harbour Master → `tel:` link
- Wash Token → shows wash token status modal

Each button checks capability / data availability. If data absent, button is greyed and tap shows "Not configured by marina."

**`<DynamicFeed>`**

Fetches `GET /portal/feed/` on mount. Backend returns `ActionableItem[]` pre-sorted by `priority` integer (lower = higher priority). React maps `item.type` to card component.

| priority | type | component | accent colour |
|----------|------|-----------|---------------|
| 10 | `invoice_overdue` | `<InvoiceCard>` | `--red` |
| 10 | `utility_low` | `<UtilityCard>` | `--orange` |
| 10 | `estimate_pending` | `<EstimateCard>` | `--orange` |
| 20 | `vessel_status` | `<VesselStatusCard>` | none (always shown) |
| 30 | `sublet_prompt` | `<SubletCard>` | `--teal` |
| 30 | `haul_out_prompt` | `<SeasonalCard>` | `--teal` |
| 40 | `loyalty_status` | `<LoyaltyCard>` | `--gold` |
| 40 | `carbon_offset` | `<CarbonCard>` | `--green` |

All cards: white, `12px` radius, `var(--shadow)`, `4px` left accent border, `12px` vertical padding. Card body: label in Jost 10px uppercase, value in Cormorant or IBM Plex Sans depending on content type. Primary action button in gold, secondary in outline.

**New backend endpoint required:**
`GET /api/v1/portal/feed/` — authenticated member session. Returns sorted `ActionableItem[]`. Logic: query invoices, utility wallet, pending estimates, vessel record, loyalty membership. Assemble items with hardcoded priority integers. No AI, no ML.

---

## 5. Services Tab

Scrollable list. Each service is a tappable row (icon + title + chevron) that pushes a sub-screen into view. Back button returns to Services list. No full-page navigation.

### 5.1 Available to all members

Guests (checkin flow) do not reach the Services tab via the bottom nav. However, Crane/Lift and Extend Stay remain accessible to guests as action buttons directly on the boarding pass screen (existing behaviour preserved).

**Crane / Lift Request**
- Redesign of existing `CraneRequestScreen`
- Form: date, time, notes
- Submitted requests list with status badge (pending / confirmed / completed)
- API: existing `CraneRequestListCreateView`

**Extend Stay**
- Redesign of existing `ExtendStayScreen`
- Date picker, availability check
- API: existing extend stay endpoint

**Report an Issue**
- New screen
- Text description (required) + photo upload (optional, single image)
- Submits to new `POST /api/v1/portal/issues/` endpoint — creates a housekeeping or maintenance ticket
- Confirmation screen with reference number

### 5.2 Member-only

Locked for guests with soft nudge: "This feature is available to marina members. Ask your marina to set up your member account."

**Utility Wallet**
- Balance from `UtilityWallet`, displayed in Cormorant Garamond
- Top Up button → Stripe Payment Intent via `billing_service.create_payment_intent`
- Transaction history: date, description, amount (credit/debit)
- Wash token status with "Request token" action

**Activities**
- Browse `Activity` catalogue: name, description, price, availability
- Tap to book: date/time picker, participant count, extras selector
- API: `POST /api/v1/portal/activities/book/`

**Charter & Rentals**
- Browse `CharterVessel` and `RentalUnit` listings
- Detail view: photos, specs, rates, availability calendar
- Enquiry / booking form
- API: `POST /api/v1/portal/charter/book/`

**Maintenance Request**
- Scheduled boatyard work on their vessel (distinct from "Report an Issue")
- Form: job description, urgency, preferred dates
- API: `POST /api/v1/portal/boatyard/request/`

### 5.3 Coming soon

Visible but greyed with "Coming soon" label:
- Dry stack launch scheduling
- Valet wash booking

---

## 6. Book Tab

Two sections on one scrollable screen.

### 6.1 Book a Slip

Existing `BookingWizard` (Search → Options → Alternatives → Quote) embedded in this tab.

**Member enhancement:** Boat dimensions pre-fill from `PortalVesselView`. Search form only asks for dates — no re-entering LOA/beam/draft.

**Carbon offset toggle:** Checkbox on QuoteScreen. Frontend-only in v1 — stored as metadata on booking. No pricing change.

### 6.2 Berth Marketplace

Member-only. Guests see soft "Members only" nudge.

Two sub-tabs: "For Sale" | "Exchange"

Each listing card: berth location, length, monthly rate or asking price, marina name, "Enquire" button.

Detail view: full description, photos, contact form.
API: `POST /api/v1/portal/marketplace/enquire/`

Data from `BerthListing` and `ExchangeListing` (marketplace app).

---

## 7. Wallet Tab

### 7.1 Guest mode

Receipt card only: amount paid, booking reference, check-in/check-out dates. Read-only.

### 7.2 Member mode

Four stacked sections:

**Current Balance**
- Total outstanding across all open invoices in Cormorant Garamond gold
- "Pay All" button if outstanding > 0 → Stripe via existing `PortalInvoicePayView`
- Invoice list below: invoice number, date, amount, status badge
- Tap invoice to expand line items

**On-Account Credit**
- Balance from `MemberCreditAccount` (loyalty app)
- "Auto-deduct from invoices" toggle → `PATCH /api/v1/portal/wallet/credit-settings/`

**Loyalty & Referrals**
- Tier badge (Silver / Gold / Platinum) from `LoyaltyMembership`
- Points balance from `PointsLedger`
- Visual progress bar to next tier: `width: (current/target * 100)%`, gold fill
- "Redeem points" → coming soon state
- Referral code in copyable pill → `GET /api/v1/portal/wallet/referral/`

**Sub-let Revenue**
- Coming soon card: "Earn credit when you're away. Register a temporary departure to put your slip back on the market."

---

## 8. Account Tab

### 8.1 Guest mode

Shows: name, email, booking reference. Single prompt: "Save your details for next time" — entering email triggers member magic link request if member profile exists, otherwise shows "Ask your marina to set up your member account."

### 8.2 Member mode

Four sections:

**My Vessel**
- Boat name, LOA, beam, draft, certificate list from `PortalVesselView`
- Edit button → inline form, `PATCH /api/v1/portal/vessel/`
- Certificates: expiry date, amber warning if within 30 days

**Security & Access**
- RFID cards: list of `AccessCard` entries with card ID + status badge
- ANPR vehicles: list of `VehicleRegistration` entries, add/remove plates → `POST /api/v1/portal/access/vehicles/`
- Biometric consent: GDPR toggle for FaceID/fingerprint gate access (`BiometricEnrolment`). Off by default. One-sentence GDPR explanation shown before enabling.

**Notifications**
- Toggles: booking confirmations, invoice reminders, marina announcements, promotional offers
- Channel preference: email / WhatsApp / both
- API: `PATCH /api/v1/portal/notifications/preferences/`

**Session**
- "Sign out" button — clears localStorage
- No account deletion in v1

---

## 9. New Backend Endpoints Required

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/portal/auth/member-magic/request/` | Send member magic link email |
| POST | `/api/v1/portal/auth/member-magic/verify/` | Exchange token for session |
| GET | `/api/v1/portal/feed/` | DynamicFeed ActionableItem[] |
| POST | `/api/v1/portal/issues/` | Submit issue report |
| POST | `/api/v1/portal/activities/book/` | Book an activity |
| POST | `/api/v1/portal/charter/book/` | Book charter/rental |
| POST | `/api/v1/portal/boatyard/request/` | Request boatyard work |
| POST | `/api/v1/portal/marketplace/enquire/` | Berth marketplace enquiry |
| GET | `/api/v1/portal/wallet/referral/` | Get member referral code |
| PATCH | `/api/v1/portal/wallet/credit-settings/` | Toggle auto-deduct credit |
| POST | `/api/v1/portal/access/vehicles/` | Add ANPR vehicle |
| DELETE | `/api/v1/portal/access/vehicles/{id}/` | Remove ANPR vehicle |
| PATCH | `/api/v1/portal/notifications/preferences/` | Update notification prefs |
| PATCH | `/api/v1/portal/vessel/` | Update vessel dimensions |

All new endpoints use the existing `PortalMemberAuthentication` (new auth class, mirrors `PortalTokenAuthentication` but validates `portal-member-v1` salt).

---

## 10. Files to Create / Modify

### New files (portal/src)
```
src/context/UserContext.jsx          ← capabilities hook
src/components/shell/AppShell.jsx    ← bottom nav + content wrapper
src/components/shell/BottomNav.jsx   ← 5-tab nav bar
src/components/shell/TabBar.jsx      ← individual tab buttons
src/screens/LoginScreen.jsx          ← email magic link entry
src/screens/tabs/HomeTab.jsx         ← guest checkin or member DynamicFeed
src/screens/tabs/ServicesTab.jsx
src/screens/tabs/BookTab.jsx
src/screens/tabs/WalletTab.jsx
src/screens/tabs/AccountTab.jsx
src/components/feed/DynamicFeed.jsx
src/components/feed/cards/           ← InvoiceCard, VesselStatusCard, etc.
src/components/feed/QuickActions.jsx
src/components/services/             ← CraneRequest, ExtendStay, ReportIssue, etc.
src/components/wallet/               ← InvoiceList, LoyaltySection, etc.
src/components/account/              ← VesselForm, AccessControl, etc.
```

### Modified files
```
src/App.jsx           ← replace current routing with shell/login logic
src/api.js            ← add member session token header
src/styles/portal.css ← add all new classes, remove inline styles
src/main.jsx          ← wrap with UserContext provider
```

### Retired files (logic absorbed into new structure)
```
src/screens/BookingDashboard.jsx  → HomeTab.jsx (guest mode)
src/components/portal/WalletCard.jsx → HomeTab boarding pass card
src/components/portal/ChecklistView.jsx → HomeTab checklist card
src/components/portal/CountdownView.jsx → HomeTab countdown card
src/components/portal/ArrivalView.jsx → HomeTab arrival card
```

---

## 11. Out of Scope (v1)

- Google / Apple SSO (magic link only)
- Universal login at `app.docksbase.com` (v2 Boater Network)
- Sub-let revenue display (backend not built)
- Loyalty points redemption (redemption engine not built)
- Dry stack launch scheduling (no launch model in utilities app)
- Electricity on/off toggle (hardware integration deferred)
- Waitlist (excluded by product decision)
- NPS / review flow (Track 7 — separate implementation)
- Native iOS / Android app (PWA only)
