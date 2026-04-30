# Staff Module — Design Spec

**Date:** 2026-04-30
**Status:** Approved
**Scope:** Backend models, serializers, views, URLs for Staff, Shifts, Certifications; invite flow; Supabase Storage for cert PDFs; frontend wire-up of Staff.jsx (3 tabs: Directory, Weekly Rota, Certifications).

---

## Context

`Staff.jsx` has 3 tabs all running on mock data. The `staff` app has `StaffMember`, `Shift`, and `Certification` models with a placeholder view. This spec makes all 3 tabs real, adds a staff invite email flow, and adds PDF upload for certifications stored in Supabase Storage.

---

## Decisions

| Concern | Decision |
|---|---|
| PDF storage | Supabase Storage (S3-compatible) via `django-storages` + `boto3` |
| Staff login | No staff login yet — admin manages all data. Mobile app will add staff login in future. |
| Cert approval | No approval flow until mobile app. Admin uploads and updates certs directly. |
| Invite flow | Creates inactive User + StaffMember + sends setup email. SMTP not yet configured — `send_mail()` prints to console in dev. |
| Cert status | Auto-computed on `save()` from expiry date — not manually set |
| Rota entry | Two paths (cell popover + global modal) both call the same `createShift(payload)` hook |

---

## 1. Model Changes

### `StaffMember` — add field

```
user    OneToOneField → settings.AUTH_USER_MODEL (SET_NULL, null=True, blank=True)
```

Links the staff record to their future login account. Optional because staff can be created before they have a login.

### `Certification` — add field

```
pdf_file    FileField(upload_to='certs/', null=True, blank=True)
```

Stored in Supabase Storage via `django-storages`. The serializer returns the full absolute URL so the frontend can render a direct "View PDF" link.

### `Certification.status` — auto-computed

Override `save()`:

```python
def save(self, *args, **kwargs):
    if self.expires:
        today = date.today()
        if self.expires < today:
            self.status = 'expired'
        elif self.expires <= today + timedelta(days=30):
            self.status = 'due_soon'
        else:
            self.status = 'valid'
    else:
        self.status = 'valid'
    super().save(*args, **kwargs)
```

### Migration

`staff/migrations/0002_staffmember_user_certification_pdf.py`
- Add `user` OneToOneField to `StaffMember`
- Add `pdf_file` FileField to `Certification`

---

## 2. Supabase Storage Setup

Install: `django-storages[s3]` + `boto3`

Settings (`dev.py` and `prod.py`):

```python
DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
AWS_S3_ENDPOINT_URL = env('SUPABASE_S3_ENDPOINT')   # https://<project>.supabase.co/storage/v1/s3
AWS_STORAGE_BUCKET_NAME = env('SUPABASE_S3_BUCKET')  # e.g. 'staff-certs'
AWS_ACCESS_KEY_ID = env('SUPABASE_S3_KEY')
AWS_SECRET_ACCESS_KEY = env('SUPABASE_S3_SECRET')
AWS_S3_FILE_OVERWRITE = False
AWS_DEFAULT_ACL = 'public-read'
```

`dev.py` falls back to `FileSystemStorage` (local `MEDIA_ROOT`) when the env vars are absent so local dev works without Supabase credentials.

---

## 3. API Endpoints

All endpoints JWT-authenticated. All querysets filtered by `request.user.marina`.

### Staff

| Method | URL | View |
|---|---|---|
| POST | `/api/v1/staff/invite/` | `StaffInviteView` |
| GET | `/api/v1/staff/` | `StaffList` |
| GET / PATCH / DELETE | `/api/v1/staff/<pk>/` | `StaffDetail` |

### Shifts

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/shifts/` | `ShiftList` |
| GET / PATCH / DELETE | `/api/v1/shifts/<pk>/` | `ShiftDetail` |

`ShiftList` accepts `?week_start=YYYY-MM-DD` query param to filter shifts for a given week.

### Certifications

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/certifications/` | `CertificationList` |
| GET / PATCH / DELETE | `/api/v1/certifications/<pk>/` | `CertificationDetail` |

`CertificationList` and `CertificationDetail` accept `multipart/form-data` to support PDF upload alongside text fields.

`CertificationList` accepts `?staff_member=<pk>` query param to filter certs for a specific staff member.

---

## 4. Invite Flow

`POST /api/v1/staff/invite/` — custom `APIView`, input: `name`, `email`, `role`

Logic:

1. Validate email is not already in use — return 400 `{"detail": "A user with this email already exists."}` if duplicate
2. Create `User(email=email, is_active=False, marina=request.user.marina, role=role, username=email)`
3. Create `StaffMember(user=user, name=name, email=email, role=role, marina=request.user.marina)`
4. `uid = urlsafe_base64_encode(force_bytes(user.pk))`
5. `token = default_token_generator.make_token(user)`
6. `setup_link = f"https://app.docksbase.com/setup/{uid}/{token}/"`
7. `send_mail(subject="You've been invited to DocksBase", message=..., from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[email])` — prints to console in dev
8. Return `StaffMemberSerializer(staff).data` with HTTP 201

---

## 5. Serializers

### `StaffMemberSerializer`
Fields: `id`, `name`, `initials`, `role`, `department`, `email`, `phone`, `contract`, `start_date`, `is_active`

`initials` — `SerializerMethodField`: returns `obj.initials` if set on the model, otherwise computes from first letter of each word in `name`, max 3 chars, uppercase.

### `ShiftSerializer`
Fields: `id`, `staff_member`, `staff_member_name` (read-only, source `staff_member.name`), `week_start`, `day`, `start_time`, `end_time`, `department`, `is_off`

### `CertificationSerializer`
Fields: `id`, `staff_member`, `staff_member_name` (read-only, source `staff_member.name`), `name`, `issuing_body`, `issued`, `expires`, `status` (read-only — auto-computed), `pdf_file` (SerializerMethodField returning absolute URL or `null`)

`pdf_file` SerializerMethodField:
```python
def get_pdf_file(self, obj):
    if obj.pdf_file:
        request = self.context.get('request')
        return request.build_absolute_uri(obj.pdf_file.url) if request else obj.pdf_file.url
    return None
```

---

## 6. Views

Standard DRF generics for `StaffList`, `StaffDetail`, `ShiftList`, `ShiftDetail`, `CertificationList`, `CertificationDetail`.

All views:
- Override `get_queryset()` to filter by `request.user.marina`
- `perform_create()` sets `marina=request.user.marina`

`CertificationList` and `CertificationDetail` both use `MultiPartParser` + `FormParser` — POST (create) and PATCH (update) both accept PDF uploads.

`StaffDetail` PATCH `{is_active: false}` deactivates the staff member. If a linked `User` exists, also sets `user.is_active = False`.

---

## 7. Frontend Hooks

| Hook | File | Key functions |
|---|---|---|
| `useStaff` | `hooks/useStaff.js` | `inviteStaff(payload)`, `updateStaff(id, payload)`, `deactivateStaff(id)` |
| `useShifts` | `hooks/useShifts.js` | `fetchShifts(weekStart)`, `createShift(payload)`, `updateShift(id, payload)`, `deleteShift(id)` |
| `useCertifications` | `hooks/useCertifications.js` | `fetchCerts(staffId?)`, `createCert(formData)`, `updateCert(id, formData)`, `deleteCert(id)` |

### `createCert` / `updateCert` multipart pattern

```javascript
async function createCert(formData) {
  // formData is a FormData object with: staff_member, name, issuing_body, issued, expires, pdf_file (optional)
  const { data } = await api.post('/certifications/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  setCerts(prev => [...prev, data]);
  return data;
}
```

---

## 8. Staff.jsx — 3 Tabs

### Directory Tab

- Table wired to `useStaff`: Name (avatar + initials), Role, Department, Contact, Contract badge, cert count
- Search input filters client-side by name/role
- "Invite Staff" button → modal (name, email, role) → calls `inviteStaff()` → appends to list
- Row click → detail panel (right sidebar, 280px):
  - Avatar, name, role · department
  - Detail rows: Email, Phone, Start Date, Contract
  - Certifications section: list of certs with status badge + "View PDF" link (opens in new tab)
  - "Add Cert" button → cert create modal
  - "Edit Profile" button → edit modal (all StaffMember fields)
  - "Deactivate Account" button → confirmation → `deactivateStaff(id)`

### Weekly Rota Tab

- Grid: staff rows × 7 day columns, for the current `week_start`
- Week navigation (← Previous / Next →) updates `week_start` state, re-fetches `useShifts(weekStart)`
- Shift cells: show department pill if shift exists, "Off" label if `is_off`, empty if no shift record
- **"Add Shift" button** (global modal): staff member dropdown, day select, start time, end time, department → `createShift(payload)`
- **Click empty cell**: small popover with start time, end time, department pre-filled with staff + day → same `createShift(payload)`
- Both paths call identical `createShift({ staff_member, week_start, day, start_time, end_time, department })`
- Department color legend below grid (same 6 colors as current mock)

### Certifications Tab

- Header: "Certification Register" + expired count badge + due-soon count badge + Export button (stub)
- Table wired to `useCertifications()` (all certs for marina): Staff Member, Certification, Issuing Body, Issued, Expiry, Status, PDF
- "View PDF" cell: link icon if `pdf_file` exists, dash otherwise — clicking opens URL in new tab
- "Add Cert" button → cert create modal: staff member select, name, issuing_body, issued date, expires date, PDF file input (optional)
- Click cert row → cert edit modal: all fields editable, "Replace PDF" file input, current PDF shown as link

---

## 9. Tests

### `apps/staff/tests.py`

| Class | Tests |
|---|---|
| `StaffInviteTest` | POST creates User + StaffMember; is_active=False on User; 400 on duplicate email; email sent (mock send_mail) |
| `StaffTest` | GET list scoped to marina; PATCH updates fields; PATCH is_active=False also deactivates linked User |
| `ShiftTest` | POST creates shift; GET filters by week_start; PATCH updates; DELETE removes |
| `CertificationTest` | POST creates with PDF (multipart); PATCH updates cert + replaces PDF; GET scoped to marina; status auto-computed on save (valid/due_soon/expired) |

---

## Design Constraints

- All models carry `marina` FK — no cross-marina data leakage
- `Certification.status` is server-computed — never accepted from client input (read-only in serializer)
- `User.is_active = False` on invite — staff cannot log in until setup flow is completed (future)
- `send_mail()` is used as-is; SMTP credentials are not configured yet — dev prints to console
- Supabase Storage is accessed via the S3-compatible API — Django sees it as a standard S3 bucket
- `pdf_file` URL is resolved to an absolute URL in the serializer — frontend never constructs storage paths
- Deactivating a staff member cascades to their linked User account if one exists
