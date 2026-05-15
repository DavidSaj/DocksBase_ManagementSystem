API_DOCS_MARKDOWN = """# DocksBase API

Programmatic access to your marina's data. Use your API key to integrate with accounting systems,
dashboards, and automations without exposing your login credentials.

---

## Authentication

All requests require an `Authorization` header with your API key:

```
Authorization: Bearer db_live_YOUR_API_KEY
```

**Example:**
```bash
curl https://app.docksbase.com/api/v1/berths/ \\
  -H "Authorization: Bearer db_live_aB3xK9pQ_yourfullkeyhere"
```

Your API key acts as the user who created it. It inherits the full permissions of that owner account.

> **Note:** JWT tokens from the web dashboard also work but are short-lived and not intended for integrations.
> Use API keys for programmatic access.

---

## Base URL

```
https://app.docksbase.com/api/v1/
```

> **Note:** Replace `app.docksbase.com` with your marina's actual URL if you are on a custom domain.
> Contact support if you are unsure of your marina's API base URL.

---

## Rate Limits

| Scope | Limit |
|---|---|
| Authenticated (owner key) | 200 requests / minute |

If you exceed the rate limit, you will receive a `429 Too Many Requests` response.
The `Retry-After` header indicates how many seconds to wait before retrying.

---

## Common Endpoints

### Bookings

**List bookings**
```bash
curl https://app.docksbase.com/api/v1/bookings/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY"
```

**Get a single booking**
```bash
curl https://app.docksbase.com/api/v1/bookings/123/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY"
```

**Create a booking**
```bash
curl -X POST https://app.docksbase.com/api/v1/bookings/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "berth": 42,
    "vessel": 7,
    "start_date": "2026-06-01",
    "end_date": "2026-06-14"
  }'
```

Required fields: `berth` (ID), `vessel` (ID), `start_date`, `end_date`.

---

### Berths

**List berths**
```bash
curl https://app.docksbase.com/api/v1/berths/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY"
```

Response includes berth name, pier, dimensions, status, and current occupant (if any).

---

### Members

**List members**
```bash
curl https://app.docksbase.com/api/v1/members/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY"
```

Supports filtering by `?search=name` and pagination via `?page=2`.

---

### Vessels

**List vessels**
```bash
curl https://app.docksbase.com/api/v1/vessels/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY"
```

---

### Invoices

**List invoices**
```bash
curl https://app.docksbase.com/api/v1/invoices/ \\
  -H "Authorization: Bearer db_live_YOUR_KEY"
```

---

## Errors

| Status | Meaning |
|---|---|
| `401 Unauthorized` | Missing or invalid API key. Check the `Authorization` header. |
| `403 Forbidden` | Your key is valid but does not have permission (e.g. endpoint requires a different role). |
| `429 Too Many Requests` | Rate limit exceeded. See the `Retry-After` header. |
| `400 Bad Request` | Invalid request body. Check the `detail` field in the response JSON. |
| `404 Not Found` | The requested resource does not exist (or belongs to a different marina). |
| `500 Internal Server Error` | Something went wrong on our end. Contact support with the timestamp of the request. |

---

## Versioning

The current API version is **v1** (`/api/v1/`).

We will add a deprecation notice at least **90 days** before retiring any endpoint or version.
Breaking changes will only be introduced in a new version (e.g. `/api/v2/`).

Pin your integration to `/api/v1/` and you will receive no unexpected breaking changes.

---

## Pagination

List endpoints are paginated. Default page size is 100 results.

```json
{
  "count": 250,
  "next": "https://app.docksbase.com/api/v1/berths/?page=2",
  "previous": null,
  "results": [...]
}
```

Use `?page=N` to navigate pages, or `?page_size=N` (up to 100) to change the page size.

---

*For support, contact your DocksBase account manager or email support@docksbase.com.*
"""
