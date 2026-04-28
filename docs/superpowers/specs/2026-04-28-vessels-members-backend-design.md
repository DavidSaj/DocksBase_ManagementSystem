# Vessels & Members Backend — Design Spec

**Date:** 2026-04-28
**Status:** Approved
**Branch:** feat/operations-reservations
**Scope:** Complete the `vessels` and `members` Django apps — model enrichment, new models, API endpoints, tests, and Segments frontend wire-up.

---

## Context

The `vessels` and `members` apps were scaffolded in a prior session alongside the `reservations` and `berths` backends. Both apps have working models, serializers, views, URLs, and initial migrations. This spec covers the gaps:

- `Member` model lacks contact and emergency fields needed operationally
- No `Segment` model or API — the Members Segments tab is still on mock data
- No `VesselCertificate` model — cert expiry tracking per vessel is unimplemented
- No tests for either app

---

## 1. Member Model Enrichment

### Changes to `apps/members/models.py`

Add two groups of nullable fields to the existing `Member` model via migration `0002_add_contact_fields`.

**Contact fields:**

| Field | Type | Notes |
|---|---|---|
| `preferred_name` | `CharField(max_length=100, blank=True)` | Shown in greetings and comms |
| `nationality` | `CharField(max_length=100, blank=True)` | |
| `address` | `TextField(blank=True)` | Free-form, covers multi-line international addresses |
| `address_country` | `CharField(max_length=100, blank=True)` | |

**Emergency contact (inline on Member):**

| Field | Type |
|---|---|
| `emergency_name` | `CharField(max_length=200, blank=True)` |
| `emergency_relationship` | `CharField(max_length=100, blank=True)` |
| `emergency_phone` | `CharField(max_length=50, blank=True)` |

All fields are `blank=True` / `null=True` where applicable — no existing rows are broken.

### Serializer

`MemberSerializer` adds all new fields to its `fields` list. No new view or URL — new fields are accessible through the existing `PATCH /api/v1/members/<pk>/` endpoint.

---

## 2. Segment Model + API

### New model in `apps/members/models.py`

```
Segment
  marina            ForeignKey → accounts.Marina (CASCADE)
  name              CharField(max_length=200)
  description       CharField(max_length=500, blank=True)  — display label shown in UI
  filter_params     JSONField(default=dict)  — e.g. {"member_type": "seasonal"}
```

`filter_params` is machine-readable and drives a live ORM count. It maps directly to `Member.objects.filter(**filter_params)` scoped to the marina — no denormalized count stored.

### Serializer

`SegmentSerializer` adds a `count` `SerializerMethodField` that runs:

```python
Member.objects.filter(marina=obj.marina, **obj.filter_params).count()
```

This is always live and always accurate. Marina scale (dozens–hundreds of members) makes this trivially fast.

`SegmentSerializer` also implements `validate_filter_params` — called automatically by DRF on POST and PUT. It checks every key in the submitted JSON against a hardcoded allowlist of safe `Member` filter fields (e.g. `member_type`, `insurance_status`, `docs_status`). Any unrecognised key raises a `serializers.ValidationError` with a descriptive message, returning a 400 before the record is written. This prevents bad data from ever reaching the database and crashing the GET endpoint.

**Response shape matches what the frontend mock expects:**

```json
{
  "id": 1,
  "name": "Seasonal Holders",
  "description": "member_type=seasonal",
  "filter_params": {"member_type": "seasonal"},
  "count": 12
}
```

### Endpoints

| Method | URL | Purpose |
|---|---|---|
| GET / POST | `/api/v1/segments/` | List marina's segments; create new segment |
| GET / PUT | `/api/v1/segments/<pk>/` | Retrieve / update a segment |

Marina scoping: `get_queryset` filters by `request.user.marina`; `perform_create` injects `marina=request.user.marina`.

### Frontend wire-up

- New hook: `frontend/src/hooks/useSegments.js` — same structure as `useMembers.js`, calls `GET /api/v1/segments/`
- `Members.jsx` Segments tab: remove `import { SEGMENTS } from '../data/mock.js'`; replace with `const { segments, loading } = useSegments()`
- The mock shape used `seg.filter`; the API returns `seg.description`. Update the JSX reference from `seg.filter` → `seg.description` in the Segments tab render.

---

## 3. VesselCertificate Model + API

### New model in `apps/vessels/models.py`

```
VesselCertificate
  marina        ForeignKey → accounts.Marina (CASCADE)
  vessel        ForeignKey → Vessel (CASCADE, related_name='certificates')
  cert_type     CharField(choices) — see below
  name          CharField(max_length=200)  — e.g. "RYA Day Skipper"
  issued        DateField(null=True, blank=True)
  expires       DateField(null=True, blank=True)
  status        CharField(choices: valid / due_soon / expired / missing)
  notes         TextField(blank=True)
```

**`cert_type` choices:**

| Value | Label |
|---|---|
| `registration` | Registration Certificate |
| `ssr` | Small Ships Register (SSR) |
| `part1` | Part 1 Registry |
| `commercial` | Commercial Certificate |
| `competence` | Competence Certificate |
| `vhf` | VHF / SRC Licence |
| `other` | Other |

`status` is set explicitly by staff (not auto-computed) so that edge cases (manual overrides, pending review) are handled cleanly. The frontend can apply the same `safetyStatus(dateStr)` helper for display colouring.

### Migration

`apps/vessels/migrations/0002_add_vesselcertificate.py`

### Serializer

`VesselCertificateSerializer` — all fields, no nesting required.

### Endpoints

Follows the existing `vessels/<pk>/insurance/` sub-resource pattern:

| Method | URL | Purpose |
|---|---|---|
| GET / POST | `/api/v1/vessels/<pk>/certificates/` | List all certs for a vessel; add new cert |
| GET / PUT | `/api/v1/vessels/<pk>/certificates/<cert_pk>/` | Retrieve / update a cert |

Both views scope by `marina=request.user.marina` and `vessel=<pk>`.

### Frontend

No frontend change this phase — the Vessels screen currently shows Insurance + Safety tabs (both already backed). The cert endpoint is ready for when the Certificates tab is wired up.

---

## 4. Tests

Test style follows `apps/reservations/tests.py`: `APIClient` + `force_authenticate`, factory helpers at the top, `TestCase` classes grouped by concern.

### `apps/vessels/tests.py`

| Class | Tests |
|---|---|
| `VesselCRUDTest` | POST creates vessel; GET list scoped to marina; vessel from another marina not returned |
| `VesselInsuranceTest` | GET auto-creates `InsuranceRecord`; PUT updates fields |
| `VesselSafetyTest` | GET auto-creates `SafetyEquipment`; PUT updates fields |
| `VesselCertificateTest` | POST adds cert to vessel; GET lists only that vessel's certs; cert from another vessel not returned |

### `apps/members/tests.py`

| Class | Tests |
|---|---|
| `MemberCRUDTest` | POST creates member; GET list; PATCH updates new contact fields (address, emergency_name etc.) |
| `MemberFilterTest` | Filter by `member_type`, `insurance_status`; search by name/email returns correct results |
| `SegmentTest` | POST creates segment with `filter_params`; GET returns correct live `count`; count changes correctly when a matching member is added |

All tests reuse the `make_marina()` / `make_user()` helpers established in the reservations tests.

---

## API Surface Summary

### New / changed endpoints

| Method | URL | App | Status |
|---|---|---|---|
| GET / POST | `/api/v1/members/` | members | Exists — enriched |
| GET / PUT | `/api/v1/members/<pk>/` | members | Exists — enriched |
| GET / POST | `/api/v1/segments/` | members | **New** |
| GET / PUT | `/api/v1/segments/<pk>/` | members | **New** |
| GET / POST | `/api/v1/vessels/<pk>/certificates/` | vessels | **New** |
| GET / PUT | `/api/v1/vessels/<pk>/certificates/<cert_pk>/` | vessels | **New** |

### Unchanged endpoints

`/api/v1/vessels/`, `/api/v1/vessels/<pk>/`, `/api/v1/vessels/<pk>/insurance/`, `/api/v1/vessels/<pk>/safety/` — no changes to existing behaviour.

---

## Design Constraints

- All new models carry a `marina` FK — no cross-marina data leakage is possible
- All new migrations use `null=True, blank=True` on new fields — zero-downtime compatible
- No new dependencies required — existing DRF + django-filter stack is sufficient
- `Segment.filter_params` keys are validated on write (POST/PUT) in `SegmentSerializer.validate_filter_params`. A hardcoded allowlist of permitted `Member` filter fields is checked; any unrecognised key raises a `ValidationError` (400). This protects GET endpoints from ever seeing bad data — a corrupt segment would crash the entire Segments tab on every page load with no recovery path short of a direct DB edit.
