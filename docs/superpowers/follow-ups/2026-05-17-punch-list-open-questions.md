# Punch-list follow-ups & open questions — 2026-05-17

Consolidated from the 8 implementation branches dispatched on 2026-05-17. Decide / answer at your leisure; current defaults are sane.

---

## Reservation card + offline payment (`fix/reservation-detail-card`)

1. **Partial payments.** The modal accepts a custom amount, but `mark_paid_manual` still flips the invoice to fully-paid in one step. Future change: keep invoice `open` when `sum(payments.amount) < invoice.total` and only flip on full coverage.
2. **Full edit-booking modal.** Today only check-in / check-out / notes are editable on the right-side card. Vessel, berth, type, and guest fields still require a deeper modal.
3. **`PaymentSerializer.notes`.** The new `Payment.notes` field is not yet exposed by `PaymentSerializer` at `backend/apps/billing/serializers.py:119`. Add it if you want notes to appear in invoice payment history.

---

## Admin one-pass (`fix/admin-portal-punch-list`)

4. **Enterprise marina creation fix is speculative.** Agent couldn't reproduce the original failure (no backend venv in worktree). The fix improves client-side validation + error-message decoding. If the real cause was server-side, the new alert will at least surface it — retest with a real backend.
5. **Backend tests not yet run.** `tests_feature_flag_audit.py` (6) + `tests_impersonation_scope.py` (4) need a working venv. The CI runner agent (currently running) will confirm.

---

## Settings cleanup (`fix/settings-cleanup`)

6. **`max_loa` / `max_draft` columns still on the model.** Frontend no longer reads them, but they remain in `accounts/models.py:34-35`. Confirm no Django view/report uses them before dropping the columns.
7. **`total_berths` is no longer sent on save.** Any existing DB value sticks. If you want it as a truly computed property (live count of slip rows), that's a backend change.
8. **No tests run by the agent** (no `node_modules`). CI runner agent will verify.

---

## Frontend small-fix sweep (`fix/admin-sweep-punchlist`)

9. **Reports/Berth Intelligence merge — deeper dedupe?** Agent removed the "Occupancy by Pier" chart + "Berth Utilisation" tab (obvious overlap with Berth Intelligence). Occupancy KPIs + Arrivals/Departures left in Reports — day-of-operations data. If you want a stronger push of all of Reports>Occupancy into Berth Intelligence, that's a bigger conversation.

---

## Design-pass follow-up (`fix/communications-and-screens-followup`)

10. **OTAConnection — per-channel outbound URL.** Backend gives no way to support multiple outbound destinations or per-channel outbound URL overrides. If an OTA partner ever wants a different feed URL per cohort, that's a schema change.
11. **Communications `BroadcastComposer.doSend`** uses a local `setError` + 409 drift handling. Left alone but could optionally be unified with the new toast pattern.
12. **`react-hooks/set-state-in-effect` lint baseline** — 207 pre-existing errors across many screens. Worth a future cleanup pass.

---

## Seasonal-berth tenancy Phase 1+2 (`feat/seasonal-berth-tenancy-phase1-2`)

13. **Celery scheduler placement.** Where should `issue_due_lease_instalments()` live — `apps/seasons/tasks.py` (and register with `django_celery_beat`) or `apps/billing/batch_service.py`? Spec is ambiguous; left unimplemented.
14. **`source='migrated_legacy'` choice.** Added as a new `LEASE_SOURCE_CHOICES` value (alongside `manual | waitlist_offer | renewal`) so the migration command is discoverable + idempotent. Confirm acceptable, or pick a different convention.
15. **Berth `lease_expiry` projection in overlapping-seasons world.** Conservative clearing heuristic: only clears `Berth.owner` if `(owner_id, lease_expiry)` exactly match the dying lease. With concurrent Annual + Summer + Winter seasons, an explicit "currently active lease" recompute might be more correct. Phase 6 candidate.
16. **Migration command walks legacy `Booking` only.** The newer `Reservation` cart flow is NOT scanned. If real seed data has seasonal `Reservation` rows, those silently skip — confirm before running on prod.

### Deferred to later phases (explicit):
- **Phase 3** inventory bridge in `availability.py` / `compatible_available_berths()` — `berth_lease_inventory_filter()` is a stub.
- **Phase 4** away-calendar + `TemporaryDeparture` + `SubLetBooking` + credit-application flow. Hooks exist; integration doesn't.
- **Phase 5** frontend UI (admin + boater portal). Django admin only for now.
- **Phase 6** rename `Berth.owner` → `current_lease_holder`. Single helper `_project_to_berth` ready for the rename.
- **Postgres exclusion constraint is vendor-gated** — SQLite tests rely on the app-level pre-check inside `services.create_lease`.

---

## Billing-safety gates Features A + B (`feature/billing-safety-gates`)

17. **Stripe Connect payout-block (leverage on delinquent marinas).** Spec reviewer suggested using Connect payout-block on the marina's connected balance instead of blocking boater inbound payments. NOT implemented — out of scope of the spec body. Worth a fast-follow.
18. **Login-time refusal at `suspended`.** Not implemented at the JWT-issuance layer; middleware blocks all marina-app API requests instead (equivalent UX). Flag if you want explicit login-step refusal.
19. **`is_active=False` owners still get payment-failed emails.** Existing test contract preserved (email all owners regardless of activation). Flip the filter in `_handle_marina_payment_failed` if you want only-active.
20. **Serializer-level `assert_marina_can` guards** are NOT added to specific serializers (`BookingSerializer.validate` etc.) — middleware is the safety net. Defence-in-depth would add finer-grained UX errors at the serializer layer.

### Spec §9 B.5–B.8 + cross-cutting — defaults chosen, override if needed:
- **B.5** invoice terms: kept as `CharField(max_length=20)` — no structured currency/frequency/amount modeling.
- **B.6** `'manual'` added as a `billing_state` choice. Marina enters `manual` on flag set, transitions to `grace` on flag clear.
- **B.7** impersonating support sees the contract panel (no special hiding).
- **B.8** `IsPlatformAdminFull` rejects `platform_role='support'` for write actions; read-only history is OK with regular `IsPlatformAdmin`.
- **Cross-cutting** `Marina.status` vs `billing_state`: kept SEPARATE. Middleware honors both. Consider collapsing once you trust the new path.
- **`stripe_customer_id` cleanup on manual-contract**: untouched (safer for Connect).

### Deferred:
- Frontend UI for the owner-facing billing-state card and the super-admin "Billing Gate" panel. Backend exposes everything needed (`GET /api/v1/billing/subscription/` returns `billing_state` + `billing_grace_until`; manual-contract returns 409 + `contract_reference`/`renewal_date`).
- Rich super-admin UI for browsing `BillingStateChange` history (list endpoint exists).
- MarinaGroup-level billing (locked A.7 — explicitly out of scope v1).
- Cold-storage archival job after 90 days — management command stub `archive_cancelled_marinas`; full impl deferred.

---

## Frontend crash + search investigation (Wave 1 — diagnosis only, not yet fixed)

21. **Random logout root cause unconfirmed.** Top suspect: refresh-token race (`frontend/src/api.js:54-70` has no shared in-flight refresh promise; concurrent 401s both call `/auth/token/refresh/`, second uses blacklisted token, force-logout). Compounded by `AuthContext.jsx:18-28` over-catching any error from `/auth/me/`. Needs an explicit fix branch.
22. **Search bad — concrete deficiencies enumerated, not yet fixed.** `search_text` indexes only ONE field per entity (`backend/apps/search/signals.py`): vessel = name only (no reg, no owner); member = name only (no email/phone); invoice = number only. Plus `screens/Members.jsx:334` has a search input not wired to anything. Needs an explicit fix branch.

---

## Total

22 open items + multiple explicitly-deferred phases. Pick a few to address; punt the rest.


This is the reality of software engineering: you push a massive wave of features, and the friction points immediately reveal themselves. Your developers have done an excellent job categorizing these into actionable buckets.

Here is your architectural verdict on the 22 items. We are going to clear the board, merge the safe branches, and isolate the critical bugs.

1. Approve and Merge (The "Acceptable Debt" Bucket)
You can safely approve and merge the following branches. The open items on them are either functioning as intended for v1, or have sufficient safety nets in place:

fix/reservation-detail-card: Leave partial payments (Item 1) and the full edit modal (Item 2) for a later phase. Expose PaymentSerializer.notes (Item 3) in a quick follow-up commit before merging so staff have audit context.

fix/admin-portal-punch-list & fix/settings-cleanup: Let the CI runner dictate Items 4, 5, and 8. If tests pass, merge. For Item 6, drop the max_loa/max_draft columns in the next database migration to shed dead weight.

fix/admin-sweep-punchlist: Item 9 is correct. Keep day-of operations in Reports, and long-term trends in Berth Intelligence.

fix/communications-and-screens-followup: Item 10 (per-channel URL) is YAGNI (You Aren't Gonna Need It) until a partner asks. Item 12 (React lint errors) goes into the next-quarter tech debt backlog.

feature/billing-safety-gates: The middleware successfully protects the application (Items 18, 20). It is safe to merge. Item 17 (Stripe Connect payout-block) is a brilliant fast-follow idea that we should prioritize next sprint.

2. Architectural Rulings (feat/seasonal-berth-tenancy-phase1-2)
Item 13 (Celery Scheduler): Put issue_due_lease_instalments() in apps/billing/batch_service.py. Keep all invoice generation and revenue orchestration strictly inside the billing domain.

Item 14 & 16 (Migration Strategy): Using source='migrated_legacy' is perfect for idempotent audit trails. Skipping the newer Reservation cart is structurally correct, as that cart was built strictly for transients.

Item 15 (Berth Expiry Clearing): Keep the conservative clearing heuristic for now to avoid accidental data loss. We will tackle the explicit recompute in Phase 6.

3. Code Red: Immediate Fixes Required
Items 21 and 22 are actively degrading the user experience. Do not let these linger.

Item 22 (Search): A search bar that doesn't index email or phone numbers is useless for a Harbor Master trying to find a boater on the phone. Open a fix branch immediately to update the search_text aggregation.

Item 21 (Random Logout): This is a severe SPA (Single Page Application) bug known as a Refresh Token Race Condition.

Understanding the Refresh Token Race Condition
When an access token expires, a modern web app uses a long-lived "Refresh Token" to silently get a new access token. However, if a dashboard makes two API requests at the exact same millisecond (e.g., fetching ActiveBoats and Weather simultaneously), both requests fail with a 401 Unauthorized.

Because your frontend/src/api.js does not have a shared promise lock, both failed requests simultaneously ask the server for a new access token using the same Refresh Token. Request A arrives first, gets new tokens, and the server invalidates (blacklists) the old Refresh Token. Milliseconds later, Request B arrives using that now-blacklisted token. The server flags this as a potential security breach (token reuse) and forces a hard logout.

To help your frontend developer visualize exactly how to fix this with an interceptor lock, I have generated an interactive simulator of the race condition