# Follow-up — cross-marina portal session tokens (2026-05-18)

**Origin:** Surfaced while implementing the `booking.docksbase.com` / `portal.docksbase.com` split (audit + 8-item punch list completed 2026-05-18). The dashboard ships, but tapping a trip in a marina different from the one the user signed in for will fail silently. See also: `docs/deploy-subdomains.md`.

---

## The trap

Today's portal session tokens are **marina-scoped**:

- Guest session token (`make_portal_token` — `backend/apps/portal/checkin_utils.py:34`) embeds `{booking_id, marina_slug, boater_email}`.
- Reservation session token (`make_reservation_portal_token` — same file) embeds `{reservation_id, marina_slug, boater_email}`.
- Member session token (`make_member_session_token` — `backend/apps/portal/member_auth_utils.py:23`) embeds `{member_id, marina_slug, email}`.

Every existing portal endpoint (e.g. `/portal/member/gate/`, `/portal/checkin/bookings/<id>/`) trusts the `marina_slug` claim on the token and/or requires the request to come through with `X-Marina-Slug` matching it. The frontend `api.js` interceptor sets `X-Marina-Slug` from `localStorage['portal_marina_slug']`.

So the boater journey breaks at one specific step:

1. Bob signs in via Marina A magic link → session token claims `marina_slug=marina-a`, localStorage has `portal_marina_slug=marina-a`.
2. Bob taps the home-screen icon → lands on `/dashboard`.
3. The new `GET /api/v1/portal/my-trips/` correctly ignores the marina claim and lists trips at Marina A *and* Marina B (queries by email — see `backend/apps/portal/my_trips_views.py`).
4. Bob taps the Marina B trip. `MyTripsScreen.openTrip` updates `portal_marina_slug` to `marina-b` and navigates to `/marina-b/booking/<id>/confirmed`.
5. The portal makes its first API call inside Marina B (e.g. fetching the boarding pass). The request goes out with `Authorization: Bearer <marina-a token>` + `X-Marina-Slug: marina-b`. The marina-scoped view either:
   - looks up `Booking.objects.get(pk=…, marina__slug=request.user.marina_slug)` → 404, **or**
   - serves the wrong marina's data because the view trusts the header over the token (worst case).

Neither is acceptable. Today this is masked because the dashboard route did not exist; only magic-link arrivals worked, and each magic link is one-marina by construction.

## Target behaviour

A boater is one identity (email). A session should authorize them to *see their portal history at any marina they have ever interacted with*, on the principle that the existence of *any* record (active, completed, cancelled, archived) is the grant. Whether they can take a destructive *action* (open the gate, request a stay extension) is a separate gate that lives on the action endpoint, not on portal access.

Concretely:

- After magic-link verification, mint a **boater session token** with claims `{boater_email, type: 'boater'}` — no `marina_slug`.
- When the frontend hits a marina-scoped endpoint, it sends both the boater token and `X-Marina-Slug`. The view authorizes if and only if **any** `Booking` / `Reservation` / `Member` record exists for `(email, marina_slug)`, regardless of status. Past stays, cancellations, and archived records all qualify — Bob retrieving his 2024 tax invoice must not 403.
- Action endpoints (gate codes, check-in, extend-stay, etc.) layer their own status check on top: "yes you can *view* Marina B; no, you cannot open the gate today because your most recent booking is `checked_out`."
- Tokens issued before this change keep working (decoders accept both shapes for a deprecation window).

## Scope

### Backend

1. **New token type.** In `apps/portal/checkin_utils.py` and `apps/portal/member_auth_utils.py`, add `make_boater_session_token({boater_email})` / `make_boater_refresh_token({boater_email})` with a fresh salt (`portal-boater-v1`). Decoders return a uniform `BoaterUser` (`is_authenticated=True`, `.email`, no marina).
2. **New authentication class.** `BoaterTokenAuthentication` accepts `Bearer ` *or* `MemberBearer ` (whichever scheme survives — pick one and migrate) and returns a `BoaterUser`. Keep the old `PortalTokenAuthentication` / `PortalMemberAuthentication` registered as fallbacks during the deprecation window so existing sessions don't 401.
3. **Marina-context resolver.** New helper `resolve_marina_for_boater(user, slug)`:
   - Returns the marina iff *any* `Booking` / `Reservation` / `Member` row exists for `(email, slug)` — **no status filter** (see "Historical access" above).
   - Returns `None` otherwise → views translate to 403 with a clear "no access to this marina" message.
   - **Must be cached.** A typical portal page fires 4–6 parallel API calls (profile, active trip, gate, weather, invoices); without caching, each one re-runs an `OR` query across three tables. Cache the boolean result in Redis under `portal:boater_access:{sha256(email)}:{slug}` with a 30-minute TTL. Invalidate on the events that *create* access (new `Booking` / `Reservation` / `Member` row with that email) — there are only a handful of write paths and they're already centralised. Never invalidate on status changes; access does not depend on status.
   - Hash the email in the cache key (don't store plain email in Redis keys); compare against the value via constant-time equality if you ever stash the email itself.
4. **Action-vs-access split.** This resolver gates *portal context only*. Endpoints that perform actions (open gate, mark self-checked-in, request extension, request crane) keep their existing status checks — e.g. `PortalGateView` should still refuse to return gate codes unless there's an *active* booking for the boater at that marina today. The two checks compose: access first, then action.
5. **View migration.** Every view in `apps/portal/member_views.py`, `apps/portal/checkin_views.py`, `apps/portal/services_views.py`, `apps/portal/views.py`, `apps/portal/feed_views.py` switches from "trust token's marina_slug" to "read slug from `X-Marina-Slug`, then call `resolve_marina_for_boater`". This is mechanical but touches every portal endpoint — sweep in one PR with a shared helper.
6. **Magic-link issuance.** `MemberMagicVerifyView`, the guest verify view in `checkin_views.py`, and `GuestInstantLoginView` all start issuing the new boater tokens. Response shape gains `session_token` (boater-scoped) alongside the legacy fields for one release.
7. **Tests.**
   - Cross-marina happy path: Bob signs in via Marina A link, opens the Marina B view (e.g. `/portal/feed/` or a read-only invoice endpoint) with `X-Marina-Slug: marina-b` and a Marina B booking → 200.
   - **Historical access:** Bob has only a `checked_out` (2024) booking at Marina B → 200 on read-only endpoints; the *action* endpoint (e.g. `/portal/member/gate/`) still 403s with a status-based reason.
   - Negative — no record: `X-Marina-Slug: marina-c` (Bob has never been there) → 403 from the resolver.
   - **Cache behaviour:** first call hits the DB, second call within the TTL does not (assert via `assertNumQueries` or a mocked Redis); writing a new `Booking` row for `(email, slug)` invalidates the negative cache entry on the next call.
   - Backwards compat: legacy marina-scoped token still works against the same-marina endpoints for the deprecation window.

### Frontend

1. **`api.js` interceptor.** Currently chooses `Bearer` vs `MemberBearer` based on `localStorage.portal_token_type`. After this change, all boater tokens use a single scheme; the type flag becomes vestigial. Plan to delete it after the back-compat window closes.
2. **`MyTripsScreen.openTrip`.** No code change needed for the navigation itself — but once the backend is migrated, the localStorage `portal_marina_slug` swap is what activates the new marina's permissions. Add a smoke test that confirms a cross-marina open does not 401.
3. **PortalGate.** Magic-link verification stores the new boater token without setting `portal_token_type='member'|'guest'` (or keeps storing it for one release for backwards compat).

### Deprecation

- One release: ship new code, both token shapes work.
- One release later: stop minting old tokens; decoders still accept them.
- One release later: remove old decoders and the `portal_token_type` localStorage flag.

## Out of scope (do not bundle into this work)

- Boater self-service password / "remember me" login UI. Magic links remain the only authentication factor.
- A "global" account distinct from per-marina Members. Members stay marina-scoped; this work is just about the *session*, not the identity model.
- Account linking (one email at two marinas → two Member rows). The system already handles this via email lookup; nothing changes here.

## Effort

~2.5 days backend (token + auth + cached resolver + view sweep + tests) + 0.5 day frontend (interceptor + storage cleanup) + 0.5 day for the deprecation rollout = **~3.5 days end-to-end**, single engineer. Added half-day vs. the original estimate covers the Redis cache plumbing and the invalidation hooks on `Booking` / `Reservation` / `Member` create paths.

## Priority

**High.** The `/dashboard` route is live as of 2026-05-18; without this follow-up, the multi-marina experience is a footgun for any boater who has reservations at more than one marina. Low-traffic today (most boaters are single-marina), but the failure mode is silent and confusing when it hits.
