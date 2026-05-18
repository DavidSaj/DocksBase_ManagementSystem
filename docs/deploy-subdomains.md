# Subdomain Deployment — booking + portal

Two separate frontend apps, two subdomains, one backend.

## Topology

| Subdomain                | App                      | Source dir | Vite port (dev) | PWA |
|--------------------------|--------------------------|------------|-----------------|-----|
| `booking.docksbase.com`  | Stateless booking storefront | `booking/` | 5176            | No  |
| `portal.docksbase.com`   | Authenticated boater PWA     | `portal/`  | 5178            | Yes |
| `app.docksbase.com` (TBD) | Management web frontend     | `frontend/`| 5173            | No  |
| (backend host)           | Django API                   | `backend/` | 8000            | —   |

The booking app is intentionally **not** a PWA — see the comment in `booking/index.html`. Installing the portal PWA at `portal.docksbase.com` keeps it scoped to `/`, so previously installed marina-specific portals can no longer hijack booking URLs.

## Deploy targets

`booking/vercel.json` and `portal/vercel.json` configure Vercel as the default target. Each app builds to `dist/` and rewrites every path to `/index.html` so React Router can take over.

If you deploy elsewhere (Netlify, Cloudflare Pages, S3+CloudFront, nginx), reproduce two things:

1. **SPA fallback** — every unknown path serves `index.html`.
2. **Service-worker headers (portal only)**:
   - `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js`
   - `Service-Worker-Allowed: /`

## DNS

```
booking.docksbase.com   CNAME   cname.vercel-dns.com.
portal.docksbase.com    CNAME   cname.vercel-dns.com.
api.docksbase.com       (backend — Heroku/Fly/etc.)
```

## Required env vars

### Both frontend apps

| Var              | Example                            | Purpose                                      |
|------------------|------------------------------------|----------------------------------------------|
| `VITE_API_URL`   | `https://api.docksbase.com/api/v1` | Backend base URL — read by `shared/portal-ui/src/api.js` |

### Django backend (prod)

| Var                     | Example                                                       |
|-------------------------|---------------------------------------------------------------|
| `PORTAL_BASE_URL`       | `https://portal.docksbase.com`                                |
| `ALLOWED_HOSTS`         | `api.docksbase.com,booking.docksbase.com,portal.docksbase.com` (if backend reads it) |
| `CORS_ALLOWED_ORIGINS`  | `https://booking.docksbase.com,https://portal.docksbase.com`  |
| `CSRF_TRUSTED_ORIGINS`  | `https://booking.docksbase.com,https://portal.docksbase.com`  |

`PORTAL_BASE_URL` is the most important: it determines the host used in magic-link emails. The default in `backend/config/settings/base.py:154` is `https://portal.docksbase.com`; override only if your portal lives elsewhere.

## Local dev

```powershell
# Backend
cd backend
.\venv\Scripts\Activate
python manage.py runserver

# Booking (in a separate terminal)
cd booking
npm run dev   # http://localhost:5176

# Portal (in a separate terminal)
cd portal
npm run dev   # http://localhost:5178
```

`backend/config/settings/dev.py` already has `PORTAL_BASE_URL = 'http://localhost:5178'`, so magic-link emails generated against the local backend point at the local portal.

## Flow recap

1. Boater pays on `booking.docksbase.com/{marina-slug}` (stateless, no auth UI).
2. Backend creates the trip + a `User`/`Member` row keyed on email and sends a magic-link email.
3. Email link → `portal.docksbase.com/{marina-slug}?token={g_|m_}…` — the portal verifies, stores a JWT in localStorage, redirects to `/{marina-slug}/`.
4. If the boater later opens the home-screen icon (no token, no slug), the app lands on `portal.docksbase.com/dashboard` and lists trips across all marinas the boater has reservations at (via `GET /api/v1/portal/my-trips/`).
