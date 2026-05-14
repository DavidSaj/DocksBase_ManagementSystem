---
name: utility-meter-setup
description: Manager-facing UI + backend for utility meter integration with three ingest paths (vendor-pull, push webhook, direct device push). Hashed credentials, bulk reading ingest, throttled auth-tracking writes.
metadata:
  type: project
---

# Utility Meter Setup — Design Spec

## Overview

Today, smart-meter readings flow into DocksBase only via the **vendor-pull** path (`UtilityIntegration` rows + Celery `poll_smart_meters_all_marinas` against the Rolec / MarineSync cloud APIs). The harbour master has no UI for any of this — `UtilityIntegration` and `SmartMeter` records can only be created through Django admin, and there is no path for hardware that DocksBase has not pre-integrated with.

This spec adds:

1. A **manager-facing UI** under `frontend/src/screens/Utilities.jsx` (new "Meters" tab, four sub-tabs).
2. Backend endpoints for `UtilityIntegration` CRUD and a "test connection" action.
3. Two new ingest paths, each functional end-to-end:
   - **Push webhook** — one rotatable API key per marina; vendor clouds (or any system) POST readings to a documented endpoint.
   - **Direct device push** — per-meter `hardware_id` + `device_token` pair; the meter hardware POSTs readings directly.

The system is designed for IoT-class load (hundreds of meters per marina, 4–12 readings/hour each) and treats marina-issued credentials as security-critical from Day 1.

---

## Non-Goals

- "Discover devices" via vendor API (manager still types each `device_id`). Captured as a follow-up.
- Multi-key per marina for the webhook path (one rotatable key — trivial to extend later).
- Webhook signature verification (HMAC `X-Signature`) on top of the API key.
- Per-vendor onboarding wizards. Generic form fields per integration.

---

## Architecture

```
┌─ Manager UI (Utilities → Meters tab) ──────────────────────────────────────┐
│                                                                            │
│ Sub-tab: Integrations    →  /utilities/integrations/         (CRUD + test) │
│ Sub-tab: Push Endpoint   →  /utilities/webhook-key/          (GET / DELETE)│
│                              /utilities/webhook-key/rotate/  (POST)        │
│ Sub-tab: Device Tokens   →  /utilities/smart-meters/{id}/    (POST/DELETE) │
│                              device-token/                                 │
│ Sub-tab: Meters          →  /utilities/smart-meters/         (CRUD)        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

         (1) vendor pull             (2) push webhook         (3) device push
              │                            │                         │
              ▼                            ▼                         ▼
     Celery beat polls          External system POSTs       Meter hardware POSTs
     vendor cloud API           with X-Webhook-Key           with X-Hardware-ID +
     every 15 min                                            X-Device-Token
              │                            │                         │
              └────────────────────────────┴─────────────────────────┘
                                          ▼
                          ┌─ Bulk validate (in-memory) ─┐
                          │ Drop unknown device_ids,    │
                          │ wrong-marina meters,        │
                          │ malformed timestamps.       │
                          └─────────────┬───────────────┘
                                        ▼
                          bulk_create(ignore_conflicts=True)
                          on partitioned `utilities_meterreading`
                          (unique on meter_id, recorded_at)
```

---

## Security Model

### Why hashed credentials matter on Day 1

Webhook keys and device tokens grant write access to billing-source data. A leaked plaintext key in our database (via SQL injection, a misconfigured backup, an accidentally exported pg_dump, a curious DBA) lets an attacker push fake kWh readings that turn into invoices. Plaintext storage is **not** a v2 optimization — it is a Day-1 critical issue.

### Pattern: prefix + hash (the "Stripe pattern")

For both `MarinaMeterWebhookKey` and `SmartMeter` device credentials, we store:

- `*_prefix` — first 8 chars of the plaintext key (plaintext, indexed). Used for fast lookup and UI display ("sk_a7c3…").
- `*_hash`   — Django-hashed full plaintext, via `django.contrib.auth.hashers.make_password()`. Used for verification via `check_password()`.

The plaintext is generated server-side via `secrets.token_urlsafe(48)` (64 chars after base64-encoding) and returned to the client **exactly once**, in the immediate response to the rotate/issue action. We never store, log, or re-emit the plaintext. There is no `?reveal` endpoint.

The UI is explicit about this: the modal shows "Copy this now — it will not be shown again. If you lose it, rotate the key."

Auth path (webhook):

```
client sends:   X-Webhook-Key: sk_a7c3................................
server splits:  prefix = first 11 chars  (e.g. "sk_a7c3xyz")
server lookups: MarinaMeterWebhookKey.objects.get(key_prefix=prefix, is_active=True)
server verifies: check_password(plaintext, row.key_hash)
                 → True → return (None, row);  False → 401
```

Auth path (device): same shape, but the lookup key is `hardware_id` (which is per-meter and not secret).

### `last_used_at` throttling

A 200-meter marina pushing every 5 min issues 200 auth writes per push cycle. Both `MarinaMeterWebhookKey` and `SmartMeter` are *configuration* tables that many other parts of the app read. Continuously bouncing `UPDATE` statements on those rows causes write-contention, vacuum churn, and tail-latency spikes on otherwise-cold reads.

Rule: **update `last_used_at` only if the current value is `NULL` or older than 1 hour**. The "Last seen" indicator in the UI rounds to "minutes / hours / days ago", so 1-hour resolution is sufficient and drops write volume by ~98%.

Implementation lives in the auth class:

```python
now = timezone.now()
if row.last_used_at is None or (now - row.last_used_at).total_seconds() > 3600:
    type(row).objects.filter(pk=row.pk).update(last_used_at=now)
```

(We use a `.filter(...).update()` instead of `row.save()` to avoid loading + re-saving the whole row — pure SQL update with no signals fired.)

---

## Performance Model — Bulk Ingest

### Why `get_or_create` per reading is a bottleneck

A vendor pushing 500 readings in one batch becomes 500 round-trips to Postgres (each `get_or_create` is a SELECT + optional INSERT inside a transaction). That blocks the request worker, holds DB connections, and at peak times can exhaust the connection pool.

### Solution: validate in memory, then `bulk_create(ignore_conflicts=True)`

```python
def post(self, request):
    marina = request.auth.marina  # or request.auth (a SmartMeter)
    payload = request.data.get('readings', [])

    # 1. Validate the envelope
    if not isinstance(payload, list) or not payload:
        return Response({'detail': 'readings[] required'}, status=400)

    # 2. Resolve meters in ONE query
    device_ids = {p.get('device_id') for p in payload if p.get('device_id')}
    meters_by_device = {
        m.device_id: m for m in
        SmartMeter.objects.filter(marina=marina, device_id__in=device_ids, is_active=True)
    }

    # 3. Build objects + reject in memory
    rows, rejected = [], []
    for item in payload:
        meter = meters_by_device.get(item.get('device_id'))
        if not meter:
            rejected.append({'device_id': item.get('device_id'), 'reason': 'unknown'})
            continue
        try:
            rows.append(MeterReading(
                meter=meter,
                recorded_at=parse_datetime(item['recorded_at']),
                reading_kwh=item.get('cumulative_kwh'),
                reading_m3=item.get('cumulative_m3'),
                source='auto',
            ))
        except (KeyError, TypeError, ValueError):
            rejected.append({'device_id': item.get('device_id'), 'reason': 'malformed'})

    # 4. One round-trip; Postgres drops duplicates at the C level
    MeterReading.objects.bulk_create(rows, ignore_conflicts=True)

    return Response({'accepted': len(rows), 'rejected': rejected})
```

For this to work, `MeterReading` needs a **unique constraint** on `(meter, recorded_at)`, not just the current non-unique `Index`. The existing index is replaced by a `UniqueConstraint`.

> **Partition note:** `MeterReading` is range-partitioned by `recorded_at` (per `INSTALL.md`). Postgres requires unique constraints on partitioned tables to include the partition key. `(meter_id, recorded_at)` includes `recorded_at`, so this is valid.

For the `/devices/readings/` endpoint, the meter is `request.auth` directly — we skip the `device_ids` lookup and validate that the meter is active (already verified at auth time).

---

## Backend — Models

### New: `MarinaMeterWebhookKey` (`apps/utilities/models.py`)

```python
class MarinaMeterWebhookKey(models.Model):
    """
    One rotatable webhook key per marina. Stored hashed.
    Plaintext is shown to the manager exactly once, when rotated.
    """
    PREFIX_LEN = 11  # "sk_" + 8 chars

    marina       = models.OneToOneField(
        'accounts.Marina', on_delete=models.CASCADE, related_name='meter_webhook_key'
    )
    key_prefix   = models.CharField(max_length=16, db_index=True, blank=True)
    key_hash     = models.CharField(max_length=128, blank=True)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    rotated_at   = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'Webhook key — {self.marina} ({self.key_prefix or "unissued"})'
```

`key_hash == ''` means "no key issued yet". The row is created lazily on first GET so the manager can see the endpoint URL even before issuing a key.

### Modified: `SmartMeter` (`apps/utilities/models.py:43`)

Add four fields:

```python
hardware_id          = models.CharField(max_length=64, blank=True, db_index=True)
device_token_prefix  = models.CharField(max_length=16, blank=True, db_index=True)
device_token_hash    = models.CharField(max_length=128, blank=True)
device_token_last_used_at = models.DateTimeField(null=True, blank=True)
```

`hardware_id` is **public** (it's the lookup key — the meter sends it as `X-Hardware-ID`). The secret half is the token.

Vendor-pull meters leave all four blank.

### Modified: `MeterReading` constraint (`apps/utilities/models.py:75`)

Replace the existing non-unique index with a unique constraint:

```python
class Meta:
    ordering = ['recorded_at']
    constraints = [
        models.UniqueConstraint(
            fields=['meter', 'recorded_at'],
            name='utilities_meterreading_meter_recorded_uniq',
        ),
    ]
```

The composite still functions as a covering index for time-series queries. Drop the old non-unique `Index` to avoid duplication.

---

## Backend — Endpoints

All paths under `api/v1/utilities/`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`    | `/integrations/`                              | JWT             | List integrations for the user's marina |
| `POST`   | `/integrations/`                              | JWT             | Create — `{vendor, credentials: {api_key, base_url}}` (credentials write-only) |
| `PATCH`  | `/integrations/{id}/`                         | JWT             | Update / toggle `is_active`. Credentials replaceable. |
| `DELETE` | `/integrations/{id}/`                         | JWT             | Delete |
| `POST`   | `/integrations/{id}/test/`                    | JWT             | Calls vendor adapter's `test_connection()`. Returns `{ok, error?}` |
| `GET`    | `/webhook-key/`                               | JWT             | Returns prefix + endpoint URL + last-used. Never plaintext. |
| `POST`   | `/webhook-key/rotate/`                        | JWT             | Generates new key, hashes + stores, returns plaintext **once**. |
| `DELETE` | `/webhook-key/`                               | JWT             | Revoke (clears prefix + hash, sets `is_active=False`). |
| `POST`   | `/smart-meters/{id}/device-token/`            | JWT             | Issue or rotate. Auto-generates `hardware_id` if blank. Returns plaintext once. |
| `DELETE` | `/smart-meters/{id}/device-token/`            | JWT             | Revoke (clears `hardware_id` + token fields). |
| `POST`   | `/webhook/readings/`                          | `X-Webhook-Key` | Ingest one or many readings (option 2). |
| `POST`   | `/devices/readings/`                          | `X-Hardware-ID` + `X-Device-Token` | Ingest readings from one device (option 3). |

### Ingest payload (shared shape)

```json
{
  "readings": [
    {
      "device_id": "ROLEC-12345",
      "recorded_at": "2026-05-14T10:00:00Z",
      "cumulative_kwh": 1234.567,
      "cumulative_m3": null
    }
  ]
}
```

Response: `{ "accepted": N, "rejected": [{"device_id": "...", "reason": "unknown|malformed|wrong-marina"}] }`. Status 200 if anything was accepted OR no readings were valid but auth succeeded; 400 only on a malformed envelope.

For `/devices/readings/`, `device_id` is ignored (meter is fixed by auth).

### Vendor `test_connection`

```python
class BaseMeterVendor(ABC):
    @abstractmethod
    def test_connection(self) -> None:
        """Raises VendorConnectionError if the configured credentials are invalid."""
```

Rolec / MarineSync each implement a cheap GET against the vendor's auth-protected root (e.g. `GET {base_url}/v1/sites/?limit=1`). 2xx → return; anything else → raise with `(status, body[:200])`.

---

## Backend — Auth Classes (`apps/utilities/authentication.py`)

### `MeterWebhookAuthentication`

```python
class MeterWebhookAuthentication(BaseAuthentication):
    def authenticate(self, request):
        plaintext = request.headers.get('X-Webhook-Key')
        if not plaintext:
            return None
        prefix = plaintext[:MarinaMeterWebhookKey.PREFIX_LEN]
        try:
            row = MarinaMeterWebhookKey.objects.select_related('marina').get(
                key_prefix=prefix, is_active=True,
            )
        except MarinaMeterWebhookKey.DoesNotExist:
            raise AuthenticationFailed('Invalid webhook key.')
        if not row.key_hash or not check_password(plaintext, row.key_hash):
            raise AuthenticationFailed('Invalid webhook key.')
        _touch_last_used(MarinaMeterWebhookKey, row.pk, row.last_used_at, 'last_used_at')
        return (None, row)

    def authenticate_header(self, request):
        return 'X-Webhook-Key'
```

### `MeterDeviceAuthentication`

Same shape, but lookup is `SmartMeter.objects.get(hardware_id=..., is_active=True)` and verification uses `device_token_hash`. Touches `device_token_last_used_at`.

### Shared `_touch_last_used` helper

```python
def _touch_last_used(model, pk, current, field='last_used_at'):
    now = timezone.now()
    if current is None or (now - current).total_seconds() > 3600:
        model.objects.filter(pk=pk).update(**{field: now})
```

---

## Frontend

### Location

`frontend/src/screens/Utilities.jsx` already exists with three tabs (Bollards / Wash Tokens / OFGEM). We:

- Add a new first tab: **Meters**.
- Move the shared helpers (`Badge`, `Spinner`, `EmptyState`, `ErrorMsg`, `SuccessMsg`) into `frontend/src/screens/utilities/_shared.jsx` so both `Utilities.jsx` and the new sub-modules can import them.
- Implement the Meters tab as a small composition: `MetersTab.jsx` (sub-tab bar) + four panels.

### Files

```
frontend/src/screens/utilities/
  _shared.jsx                   ← extracted helpers
  MetersTab.jsx                 ← sub-tab bar
  IntegrationsPanel.jsx
  PushEndpointPanel.jsx
  DeviceTokensPanel.jsx
  MetersListPanel.jsx
```

### Sub-tab layout

```
┌────────────────────────────────────────────────────────────┐
│ Utilities & Drystack                                        │
│ Meters | Bollards | Wash Tokens | OFGEM Reports             │
├────────────────────────────────────────────────────────────┤
│ Integrations | Push Endpoint | Device Tokens | Meters       │
├────────────────────────────────────────────────────────────┤
│  …panel content…                                            │
└────────────────────────────────────────────────────────────┘
```

### Critical UX: one-time-reveal modal

Used by both Push Endpoint (rotate) and Device Tokens (generate/rotate). Shape:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ Save this — it will not be shown again.                    │
├──────────────────────────────────────────────────────────────┤
│  Hardware ID  hw_a7c3...                          [📋 Copy]  │
│  Device Token sk_•••••• [click to reveal]         [📋 Copy]  │
├──────────────────────────────────────────────────────────────┤
│  After closing this window, the token cannot be retrieved.   │
│  If you lose it, rotate to issue a new one.                  │
│                                                              │
│                                          [I have saved it]   │
└──────────────────────────────────────────────────────────────┘
```

Rules:
- The plaintext is held in component state only — never written to localStorage / sessionStorage.
- The "I have saved it" button is the only way to dismiss; clicking the backdrop is disabled.
- The token shows as masked by default with a one-time click-to-reveal (so over-the-shoulder is harder).
- After dismissal, the parent panel refetches the list. The plaintext is gone from React state.

### Sub-tabs

**Integrations** (`IntegrationsPanel.jsx`):
- List card per integration: vendor + `is_active` badge + last-sync chip + Test / Edit / Delete.
- "+ Add Integration" → modal: vendor select, api_key (password input), base_url, "Test before saving" toggle.

**Push Endpoint** (`PushEndpointPanel.jsx`):
- Single card showing endpoint URL (copy-able) + the key's prefix ("sk_a7c3…") + last-used.
- If no key is issued: prominent **Generate key** button.
- If a key exists: **Rotate** (replaces) + **Revoke** (deactivates).
- Below: expandable "How to use" with a `curl` example.

**Device Tokens** (`DeviceTokensPanel.jsx`):
- Table of `SmartMeter`s. Columns: label, device_id, hardware_id (or "—"), token prefix (or "Not issued"), last used, actions.
- Actions: **Generate** (no token) / **Rotate** + **Revoke** (existing token).
- Tip card at top: "Use these for meters that talk directly to DocksBase instead of going through a vendor cloud."

**Meters** (`MetersListPanel.jsx`):
- Standard CRUD table for `SmartMeter`. Add/edit modal.
- Empty-state hint: "Add an integration first — or use the Device Tokens tab to register a direct-push meter."

### Design tokens

Reuse what `Utilities.jsx` already uses: `var(--navy)`, `var(--bg)`, `var(--border)`, `var(--green)`, `var(--red)`, `.card`, `.card-header`, `.tbl`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm`. No new tokens.

---

## Migration Plan

One migration file `apps/utilities/migrations/0004_meter_setup.py`:

1. `CreateModel` `MarinaMeterWebhookKey` (with indexes on `key_prefix`).
2. `AddField` `SmartMeter.hardware_id` (blank).
3. `AddField` `SmartMeter.device_token_prefix` (blank).
4. `AddField` `SmartMeter.device_token_hash` (blank).
5. `AddField` `SmartMeter.device_token_last_used_at` (null).
6. `RemoveIndex` on `MeterReading` for `(meter, recorded_at)`.
7. `AddConstraint` `UniqueConstraint(['meter', 'recorded_at'], name=...)` on `MeterReading`.

No data backfill needed — all new fields are blank/null and the unique constraint matches what was effectively already true (no duplicate readings recorded in practice; if any exist they must be cleaned manually before applying).

**Operator note:** before applying step 7 in production, run

```sql
SELECT meter_id, recorded_at, count(*) FROM utilities_meterreading
GROUP BY meter_id, recorded_at HAVING count(*) > 1;
```

and resolve any duplicates. Document this in the migration's docstring.

---

## Test Plan (summary — full list in the plan doc)

Backend:
- CRUD scoping (cross-marina forbidden).
- Vendor `test` endpoint (mock adapter success + failure).
- Webhook key issue / rotate / revoke flows.
- Webhook auth: missing header, invalid prefix, valid prefix wrong hash, valid.
- Webhook ingest: happy path, unknown device_id rejected, duplicate `(meter, recorded_at)` silently deduped via `ignore_conflicts`, malformed timestamps rejected.
- Device token issue / rotate / revoke flows.
- Device auth: missing headers, wrong token, inactive meter rejected.
- `last_used_at` throttling: second auth within 1 hour does **not** update; auth after 1 hour does.

Frontend (manual):
- Walk through each sub-tab.
- Rotate key, copy, paste, run a `curl` ingest — reading appears in the meter's readings list.
- Generate device token, simulate a hardware POST, reading appears.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Pre-existing duplicate `(meter, recorded_at)` rows block the unique constraint migration | Document the dedup SQL in the migration docstring; require it be run before deploy. |
| Hash check is CPU-bound (PBKDF2 is intentionally slow) — adds ~50ms per request | Acceptable for marina-class load (max ~1k req/min/marina). If we ever need higher throughput, switch the hasher to BLAKE2 or HMAC — drop-in via Django's `PASSWORD_HASHERS`. |
| Manager loses the plaintext key | UI is unambiguous about one-time reveal; rotating is one click. |
| Vendor pushes 10k readings in one POST | Bulk-create handles this in one SQL round-trip. We add a `len(payload) > 5000` guard returning 413 to protect against pathological payloads. |
| Partitioned-table unique constraint nuance | The partition key (`recorded_at`) is part of the constraint, so it works on partitioned tables. Spelled out in INSTALL.md update. |
