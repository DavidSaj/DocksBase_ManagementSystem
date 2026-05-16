# Hosting & Environment Overview

A single-page map of every deployable in this repo and the environment variables each one needs. Use this as the checklist when you stand up a real hosting environment.

## Topology

| Service | Type | Stack | Public? | Notes |
|---|---|---|---|---|
| `backend/` | API + Celery worker + Celery beat | Django, Celery, Redis | yes (API) | Core app. Workers/beat share the same `.env`. |
| `frontend/` | Marina staff app | Vite/React SPA | yes | Tenant operator UI. |
| `portal/` | Customer portal | Vite/React SPA | yes | End-customer self-service. |
| `field/` | Field-ops app | Vite/React SPA | yes | Mobile-first marina staff. |
| `admin/` | Internal admin SPA | Vite/React SPA | internal | DocksBase staff console. |
| `marina-admin/` | Per-marina admin SPA | Vite/React SPA | yes | Marina-scoped admin. |
| `website/` | Marketing site (legacy) | Vite/React SPA | yes | Being migrated. |
| `website-astro/` | Marketing site (new) | Astro | yes | Replaces `website/`. |
| `webmock/` | Demo / mock site | Vite/React SPA | optional | Sandbox/demo. |

External infra needed:
- **PostgreSQL** (SQLite does NOT work — Celery requires Postgres).
- **Redis** (Celery broker + cache).
- **S3-compatible object storage** (Supabase Storage configured).
- DNS for each public app subdomain.

---

## Backend (`backend/`)

### Required (won't boot or core features break)
| Var | Purpose |
|---|---|
| `DJANGO_ENV` | `dev` / `prod`. Selects `config.settings.<env>`. |
| `SECRET_KEY` | Django signing key. Generate a fresh one for prod. |
| `DATABASE_URL` | Postgres DSN (`postgresql://user:pass@host/db`). |
| `REDIS_URL` | Celery broker + cache (`redis://host:6379/0`). |
| `ALLOWED_HOSTS` | Comma-separated host list. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origins for the SPAs. |
| `FERNET_KEY` / `DOCKSBASE_FERNET_KEY` | Symmetric key for at-rest encryption of stored secrets. Generate with `cryptography.fernet.Fernet.generate_key()`. **Rotating this breaks existing encrypted data.** |

### App URLs (used in emails, redirects, webhooks)
| Var | Example |
|---|---|
| `FRONTEND_URL` | `https://app.docksbase.com` |
| `PORTAL_BASE_URL` | `https://portal.docksbase.com` |
| `FIELD_URL` | `https://field.docksbase.com` |
| `WEBSITE_URL` | `https://www.docksbase.com` |

### Stripe (billing + Connect)
| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | API key. |
| `STRIPE_WEBHOOK_SECRET` | Platform webhook signing secret. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connected-account webhook signing secret. |
| `STRIPE_PRICE_STARTER` | Price ID for the Starter plan. |
| `STRIPE_PRICE_PROFESSIONAL` | Price ID for Professional. |
| `STRIPE_PRICE_ENTERPRISE` | Price ID for Enterprise. |
| `STRIPE_PRICE_ENTERPRISE_ADDON_MARINA` | Per-marina add-on price ID. |

### Email / SMS / e-sign
| Var | Purpose |
|---|---|
| `RESEND_API_KEY` | Transactional email. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS. |
| `DROPBOX_SIGN_API_KEY` | HelloSign/Dropbox Sign API. |
| `DROPBOX_SIGN_CLIENT_ID` | HelloSign client ID. |
| `DROPBOX_SIGN_WEBHOOK_SECRET` | HelloSign webhook signing. |

### Object storage (Supabase S3)
| Var | Purpose |
|---|---|
| `SUPABASE_S3_ENDPOINT` | Bucket endpoint URL. |
| `SUPABASE_S3_BUCKET` | Bucket name. |
| `SUPABASE_S3_KEY` | Access key. |
| `SUPABASE_S3_SECRET` | Secret key. |

### Captcha (portal sign-up / public forms)
| Var | Purpose |
|---|---|
| `CAPTCHA_PROVIDER` | e.g. `turnstile`, `hcaptcha`. |
| `CAPTCHA_SITE_KEY` | Public key (mirrored in `portal/`). |
| `CAPTCHA_SECRET_KEY` | Server verify key. |
| `CAPTCHA_BYPASS` | Truthy = disable (dev only). |

### Webhook ingress
| Var | Purpose |
|---|---|
| `INGRESS_WEBHOOK_SECRET` | Shared secret for the generic webhook ingress endpoint. |

### Accounting integrations (optional — only set the ones you use)
Each integration needs `*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_REDIRECT_URI` and possibly scopes:

- **Xero** — `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_SCOPES`
- **QuickBooks Online** — `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_SCOPES`, `QBO_SANDBOX`
- **Sage** — `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, `SAGE_REDIRECT_URI`, `SAGE_SCOPES`, `SAGE_COUNTRY`
- **MYOB** — `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET`, `MYOB_REDIRECT_URI`, `MYOB_SCOPES`
- **Dynamics 365 Business Central** — `D365_CLIENT_ID`, `D365_CLIENT_SECRET`, `D365_REDIRECT_URI`, `D365_TENANT`, `D365_ENVIRONMENT`
- **NetSuite** — `NETSUITE_CLIENT_ID`, `NETSUITE_CLIENT_SECRET`, `NETSUITE_REDIRECT_URI`, `NETSUITE_SCOPES`
- **Sage Intacct** — `INTACCT_SENDER_ID`, `INTACCT_SENDER_PASSWORD`

---

## Frontends

All SPAs are built at deploy-time — env vars must be set **when running `vite build`**, not at runtime. Astro `PUBLIC_*` vars work the same way.

### `frontend/` (marina staff)
- `VITE_API_URL` — backend base, e.g. `https://api.docksbase.com/api/v1`
- `VITE_WS_URL` — websocket base, e.g. `wss://api.docksbase.com/ws`
- `VITE_PORTAL_URL`, `VITE_ADMIN_URL`, `VITE_WEBSITE_URL` — cross-app links

### `portal/` (customer)
- `VITE_API_URL`
- `VITE_CAPTCHA_SITE_KEY` — must match backend `CAPTCHA_SITE_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY`

### `field/` (mobile staff)
- `VITE_API_URL`

### `admin/` (internal)
- `VITE_MARINA_URL`

### `marina-admin/`
- `VITE_MARINA_URL`

### `website/` (legacy marketing)
- `VITE_API_URL`
- `VITE_WEBSITE_URL`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PRICE_STARTER`, `VITE_STRIPE_PRICE_PROFESSIONAL`, `VITE_STRIPE_PRICE_ENTERPRISE`, `VITE_STRIPE_PRICE_ENTERPRISE_ADDON_MARINA`

### `website-astro/` (new marketing)
Same as `website/` but with `PUBLIC_` prefix:
- `PUBLIC_API_URL`
- `PUBLIC_WEBSITE_URL`
- `PUBLIC_GOOGLE_MAPS_API_KEY`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `PUBLIC_STRIPE_PRICE_STARTER`, `PUBLIC_STRIPE_PRICE_PROFESSIONAL`, `PUBLIC_STRIPE_PRICE_ENTERPRISE`, `PUBLIC_STRIPE_PRICE_ENTERPRISE_ADDON_MARINA`

### `webmock/`
No env vars in source — static demo build.

---

## Process layout in production

For each environment you'll typically run:

1. **Web** — Django/ASGI behind a reverse proxy (gunicorn/uvicorn).
2. **Celery worker** — same image, `celery -A config worker`.
3. **Celery beat** — same image, `celery -A config beat --scheduler django_celery_beat.schedulers:DatabaseScheduler`. **Exactly one** beat process.
4. **Redis** — managed or self-hosted.
5. **Postgres** — managed strongly preferred.
6. **Static SPA hosting** — any static host (Vercel, Cloudflare Pages, S3+CDN). One per app domain.

See `docker-compose.yml` for a working dev composition of items 1–4.

---

## Pre-launch checklist

- [ ] Postgres provisioned, `DATABASE_URL` set, migrations applied.
- [ ] Redis reachable from web + workers, `REDIS_URL` set.
- [ ] `SECRET_KEY` and `FERNET_KEY` generated and stored in a secrets manager (never commit).
- [ ] `ALLOWED_HOSTS` + `CORS_ALLOWED_ORIGINS` include every public SPA domain.
- [ ] Stripe live keys + webhook endpoints registered, both platform and Connect.
- [ ] Resend domain verified; Twilio number provisioned.
- [ ] Dropbox Sign webhook URL registered, secret matches.
- [ ] Supabase bucket created, IAM key restricted to it.
- [ ] Captcha keys configured on backend and `portal/`.
- [ ] Accounting integrations: only configure the ones you're going live with.
- [ ] Each SPA built with its production env vars (build-time, not runtime).
- [ ] Exactly one Celery beat process running.
- [ ] DNS + TLS for every public subdomain.
