# Platform Admin — frontend-admin Standalone App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Vite+React app (`frontend-admin/`) that serves the DocksBase platform admin portal — dashboard, accounts, finance, feature flags, and audit log — protected by `is_platform_admin` JWT gate.

**Architecture:** Separate Vite project at `frontend-admin/`. Own `api.js`, own `AuthContext`, own routing. Shares zero code with `frontend/`. All data from existing `/api/admin/` endpoints. Impersonate button calls `/api/admin/marinas/<id>/impersonate/` and redirects to the marina app with the impersonation token.

**Tech Stack:** React 18, Vite, React Router v6, Axios, no charting library (tables only)

**Prerequisite:** Plan A (backend Level 2) must be deployed for the impersonate flow to work. Level 1 screens (dashboard, accounts, finance, flags, audit) work against existing endpoints with no prerequisites.

---

## File Map

```
frontend-admin/
├── index.html
├── package.json
├── vite.config.js
├── .env.local                         (VITE_API_URL, VITE_MARINA_APP_URL)
└── src/
    ├── main.jsx
    ├── App.jsx                        (router, protected route)
    ├── api.js                         (axios instance, login, token helpers)
    ├── context/
    │   └── AuthContext.jsx            (JWT decode, is_platform_admin gate)
    ├── components/
    │   └── layout/
    │       ├── AdminLayout.jsx        (sidebar + main content wrapper)
    │       └── Sidebar.jsx            (nav links)
    └── screens/
        ├── Login.jsx
        ├── Dashboard.jsx              (GET /api/admin/overview/)
        ├── Accounts.jsx               (GET /api/admin/marinas/ + detail drawer)
        ├── Finance.jsx                (GET /api/admin/finance/ + payments)
        ├── FeatureFlags.jsx           (GET/PATCH /api/admin/feature-flags/)
        └── AuditLog.jsx              (GET /api/admin/audit-logs/)
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `frontend-admin/package.json`
- Create: `frontend-admin/vite.config.js`
- Create: `frontend-admin/index.html`
- Create: `frontend-admin/src/main.jsx`
- Create: `frontend-admin/.env.local`

- [ ] **Step 1: Create package.json**

Create `frontend-admin/package.json`:

```json
{
  "name": "docksbase-admin",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.22.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.2.0"
  }
}
```

- [ ] **Step 2: Create vite.config.js**

Create `frontend-admin/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
```

- [ ] **Step 3: Create index.html**

Create `frontend-admin/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DocksBase Admin</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f6f8; color: #1a1a2e; }
      button { cursor: pointer; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create src/main.jsx**

Create `frontend-admin/src/main.jsx`:

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 5: Create .env.local**

Create `frontend-admin/.env.local`:

```
VITE_API_URL=http://localhost:8000/api/v1
VITE_MARINA_APP_URL=http://localhost:5173
```

- [ ] **Step 6: Install dependencies**

```
cd frontend-admin
npm install
```

- [ ] **Step 7: Verify dev server starts**

```
npm run dev
```

Expected: Server starts on `http://localhost:5174`. Browser shows blank page with no console errors (root div is empty, App.jsx not written yet).

- [ ] **Step 8: Commit**

```bash
git add frontend-admin/
git commit -m "chore(admin): scaffold frontend-admin Vite+React project"
```

---

### Task 2: api.js and AuthContext

**Files:**
- Create: `frontend-admin/src/api.js`
- Create: `frontend-admin/src/context/AuthContext.jsx`

- [ ] **Step 1: Create api.js**

Create `frontend-admin/src/api.js`:

```js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

export function storeTokens(access, refresh) {
  localStorage.setItem('admin_access_token', access);
  localStorage.setItem('admin_refresh_token', refresh);
}

export function clearAuth() {
  localStorage.removeItem('admin_access_token');
  localStorage.removeItem('admin_refresh_token');
}

export function getAccessToken() {
  return localStorage.getItem('admin_access_token');
}

export function isAuthenticated() {
  return !!getAccessToken();
}

export function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

export async function login(email, password) {
  const { data } = await api.post('/auth/token/', { email, password });
  storeTokens(data.access, data.refresh);
  return decodeJwtPayload(data.access);
}

api.interceptors.request.use(cfg => {
  const token = getAccessToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('admin_refresh_token');
      if (refresh) {
        try {
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/auth/token/refresh/`,
            { refresh }
          );
          storeTokens(data.access, refresh);
          original.headers.Authorization = `Bearer ${data.access}`;
          return api(original);
        } catch {
          clearAuth();
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
```

- [ ] **Step 2: Create AuthContext**

Create `frontend-admin/src/context/AuthContext.jsx`:

```jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { isAuthenticated, getAccessToken, decodeJwtPayload, clearAuth } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }
    const token = getAccessToken();
    const payload = decodeJwtPayload(token);
    if (!payload.is_platform_admin) {
      clearAuth();
      setLoading(false);
      return;
    }
    setUser(payload);
    setLoading(false);
  }, []);

  function signIn(payload) {
    if (!payload.is_platform_admin) {
      clearAuth();
      throw new Error('This account does not have platform admin access.');
    }
    setUser(payload);
  }

  function signOut() {
    clearAuth();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/api.js frontend-admin/src/context/AuthContext.jsx
git commit -m "feat(admin): add api.js and AuthContext with is_platform_admin gate"
```

---

### Task 3: App.jsx routing and Layout

**Files:**
- Create: `frontend-admin/src/App.jsx`
- Create: `frontend-admin/src/components/layout/AdminLayout.jsx`
- Create: `frontend-admin/src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Create Sidebar**

Create `frontend-admin/src/components/layout/Sidebar.jsx`:

```jsx
import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/',        label: 'Dashboard' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/finance',  label: 'Finance' },
  { to: '/flags',    label: 'Feature Flags' },
  { to: '/audit',    label: 'Audit Log' },
];

const sidebarStyle = {
  width: 200, minHeight: '100vh', background: '#1a1a2e', padding: '24px 0',
  display: 'flex', flexDirection: 'column',
};

const linkStyle = ({ isActive }) => ({
  display: 'block', padding: '10px 24px', color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
  textDecoration: 'none', fontSize: 14, fontWeight: isActive ? 600 : 400,
  background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
});

export default function Sidebar({ onSignOut }) {
  return (
    <nav style={sidebarStyle}>
      <div style={{ padding: '0 24px 24px', color: '#fff', fontWeight: 700, fontSize: 15 }}>
        DocksBase Admin
      </div>
      {NAV.map(({ to, label }) => (
        <NavLink key={to} to={to} end={to === '/'} style={linkStyle}>{label}</NavLink>
      ))}
      <div style={{ marginTop: 'auto', padding: '0 24px' }}>
        <button
          onClick={onSignOut}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Create AdminLayout**

Create `frontend-admin/src/components/layout/AdminLayout.jsx`:

```jsx
import { useAuth } from '../../context/AuthContext.jsx';
import Sidebar from './Sidebar.jsx';

export default function AdminLayout({ children }) {
  const { signOut } = useAuth();
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar onSignOut={signOut} />
      <main style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Create App.jsx**

Create `frontend-admin/src/App.jsx`:

```jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import Login from './screens/Login.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Accounts from './screens/Accounts.jsx';
import Finance from './screens/Finance.jsx';
import FeatureFlags from './screens/FeatureFlags.jsx';
import AuditLog from './screens/AuditLog.jsx';

function ProtectedRoute({ element }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AdminLayout>{element}</AdminLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/"        element={<ProtectedRoute element={<Dashboard />} />} />
      <Route path="/accounts" element={<ProtectedRoute element={<Accounts />} />} />
      <Route path="/finance"  element={<ProtectedRoute element={<Finance />} />} />
      <Route path="/flags"    element={<ProtectedRoute element={<FeatureFlags />} />} />
      <Route path="/audit"    element={<ProtectedRoute element={<AuditLog />} />} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Create placeholder screens** (so the app renders without import errors)

Create `frontend-admin/src/screens/Login.jsx` with just `export default function Login() { return <div>Login</div>; }`

Repeat for `Dashboard.jsx`, `Accounts.jsx`, `Finance.jsx`, `FeatureFlags.jsx`, `AuditLog.jsx`.

- [ ] **Step 5: Verify routing works**

```
npm run dev
```

Open `http://localhost:5174`. Should redirect to `/login`. Manually navigate to `/` — should show "Login" (the ProtectedRoute renders Login redirect). No console errors.

- [ ] **Step 6: Commit**

```bash
git add frontend-admin/src/
git commit -m "feat(admin): add App routing, AdminLayout, Sidebar with nav"
```

---

### Task 4: Login screen

**Files:**
- Modify: `frontend-admin/src/screens/Login.jsx`

- [ ] **Step 1: Implement Login screen**

Replace `frontend-admin/src/screens/Login.jsx` with:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = await login(email, password);
      signIn(payload);
      navigate('/');
    } catch (err) {
      const msg = err.message || err.response?.data?.detail || 'Login failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8' }}>
      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 40, borderRadius: 8, width: 360, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>DocksBase Admin</h1>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 24 }}>Platform administration — authorised access only</p>
        {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Email</label>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)} required
          style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, marginBottom: 16 }}
        />
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Password</label>
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)} required
          style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, marginBottom: 24 }}
        />
        <button
          type="submit" disabled={loading}
          style={{ display: 'block', width: '100%', padding: '10px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600 }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manual test**

Open `http://localhost:5174/login`. Enter `info@docksbase.com` / `testpass123`. Should redirect to `/` (Dashboard placeholder). Entering wrong credentials should show an error message.

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/screens/Login.jsx
git commit -m "feat(admin): implement Login screen"
```

---

### Task 5: Dashboard screen

**Files:**
- Modify: `frontend-admin/src/screens/Dashboard.jsx`

- [ ] **Step 1: Implement Dashboard**

Replace `frontend-admin/src/screens/Dashboard.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import api from '../api.js';

function StatTile({ label, value, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AlertRow({ label, items, color }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {items.map((m, i) => (
        <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
          {m.name} {m.trial_ends ? `— expires ${m.trial_ends}` : ''} {m.suspend_reason ? `— ${m.suspend_reason}` : ''}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/overview/')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load overview data.'));
  }, []);

  if (error) return <div style={{ color: '#dc2626' }}>{error}</div>;
  if (!data) return <div style={{ color: '#999' }}>Loading…</div>;

  const fmt = n => n != null ? `€${Number(n).toLocaleString()}` : '—';

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Platform Overview</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatTile label="MRR" value={fmt(data.mrr)} />
        <StatTile label="ARR" value={fmt(data.arr)} />
        <StatTile label="Active Marinas" value={data.active_marinas} />
        <StatTile label="Trial Marinas" value={data.trial_marinas} />
        <StatTile label="Total Berths" value={data.total_berths?.toLocaleString()} />
        <StatTile label="GMV" value={fmt(data.gmv)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Alerts</h3>
          <AlertRow label="Trials Ending Soon" items={data.alerts?.trials_ending_soon} color="#d97706" />
          <AlertRow label="Overdue Payments" items={data.alerts?.overdue_payments?.map(p => ({ name: p.marina_name || p.marina, trial_ends: null }))} color="#dc2626" />
          <AlertRow label="Suspended" items={data.alerts?.suspended} color="#6b7280" />
          {!data.alerts?.trials_ending_soon?.length && !data.alerts?.overdue_payments?.length && !data.alerts?.suspended?.length && (
            <div style={{ color: '#999', fontSize: 13 }}>No active alerts</div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Recent Signups</h3>
          {data.recent_signups?.map((m, i) => (
            <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
              <span>{m.name}</span>
              <span style={{ color: '#999' }}>{m.created_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test**

Log in and navigate to `/`. Confirm stat tiles show MRR, ARR, counts. Confirm alerts section shows data or "No active alerts".

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/screens/Dashboard.jsx
git commit -m "feat(admin): Dashboard screen with MRR tiles and alerts rail"
```

---

### Task 6: Accounts screen with detail drawer

**Files:**
- Modify: `frontend-admin/src/screens/Accounts.jsx`

- [ ] **Step 1: Implement Accounts screen**

Replace `frontend-admin/src/screens/Accounts.jsx` with:

```jsx
import { useEffect, useState, useRef } from 'react';
import api from '../api.js';

const STATUS_COLORS = { active: '#16a34a', trial: '#d97706', suspended: '#dc2626', pending_payment: '#6b7280' };

function Badge({ status }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: STATUS_COLORS[status] + '20', color: STATUS_COLORS[status] }}>
      {status}
    </span>
  );
}

function MarinaDrawer({ marina: initial, onClose, onUpdated }) {
  const [marina, setMarina] = useState(initial);
  const [users, setUsers] = useState([]);
  const [suspendReason, setSuspendReason] = useState('');
  const [bypassReason, setBypassReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const marinaAppUrl = import.meta.env.VITE_MARINA_APP_URL || 'http://localhost:5173';

  useEffect(() => {
    api.get(`/admin/marinas/${marina.id}/`).then(r => setMarina(r.data));
    api.get(`/admin/marinas/${marina.id}/`).then(r => setUsers(r.data.users || []));
  }, [marina.id]);

  async function act(fn, successMsg) {
    setLoading(true); setMsg('');
    try { const r = await fn(); setMarina(r.data); onUpdated(r.data); setMsg(successMsg); }
    catch (e) { setMsg(e.response?.data?.detail || 'Error'); }
    finally { setLoading(false); }
  }

  async function impersonate() {
    setLoading(true); setMsg('');
    try {
      const { data } = await api.post(`/admin/marinas/${marina.id}/impersonate/`, bypassReason ? { bypass_reason: bypassReason } : {});
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);
      window.open(marinaAppUrl, '_blank');
    } catch (e) {
      setMsg(e.response?.data?.detail || 'Impersonation failed');
    } finally { setLoading(false); }
  }

  const consentActive = marina.support_access_granted_until && new Date(marina.support_access_granted_until) > new Date();

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', padding: 32, overflowY: 'auto', zIndex: 100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{marina.name}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#999' }}>×</button>
      </div>

      <div style={{ marginBottom: 24, fontSize: 13, lineHeight: 1.8 }}>
        <div><b>Plan:</b> {marina.plan} &nbsp; <b>Status:</b> <Badge status={marina.status} /></div>
        <div><b>MRR:</b> €{marina.mrr ?? '—'}</div>
        <div><b>Berths:</b> {marina.total_berths}</div>
        <div><b>Created:</b> {marina.created_at?.slice(0, 10)}</div>
        {marina.suspend_reason && <div style={{ color: '#dc2626' }}><b>Suspend reason:</b> {marina.suspend_reason}</div>}
        <div><b>Support consent:</b> {consentActive ? `Granted until ${new Date(marina.support_access_granted_until).toLocaleString()}` : 'Not granted'}</div>
      </div>

      {msg && <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {marina.status === 'active' && (
          <>
            <input placeholder="Suspend reason (required)" value={suspendReason} onChange={e => setSuspendReason(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
            <button disabled={loading || !suspendReason} onClick={() => act(() => api.post(`/admin/marinas/${marina.id}/suspend/`, { reason: suspendReason }), 'Suspended')} style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
              Suspend Marina
            </button>
          </>
        )}
        {marina.status === 'suspended' && (
          <button disabled={loading} onClick={() => act(() => api.post(`/admin/marinas/${marina.id}/reinstate/`), 'Reinstated')} style={{ padding: '8px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
            Reinstate Marina
          </button>
        )}
        {marina.status === 'trial' && (
          <button disabled={loading} onClick={() => act(() => api.post(`/admin/marinas/${marina.id}/convert/`), 'Converted to active')} style={{ padding: '8px 12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
            Convert Trial → Active
          </button>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Impersonate</h3>
        {!consentActive && (
          <input placeholder="Bypass reason (required for admin override)" value={bypassReason} onChange={e => setBypassReason(e.target.value)} style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, marginBottom: 8 }} />
        )}
        <button disabled={loading} onClick={impersonate} style={{ padding: '8px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
          Impersonate Harbor Master
        </button>
        {!consentActive && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠ No consent granted — bypass reason required (admin only)</div>}
      </div>
    </div>
  );
}

export default function Accounts() {
  const [marinas, setMarinas] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    api.get('/admin/marinas/', { params })
      .then(r => setMarinas(r.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [search, statusFilter]);

  function onUpdated(updated) {
    setMarinas(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
    setSelected(updated);
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Accounts</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Search name or address…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, width: 240 }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="pending_payment">Pending payment</option>
        </select>
      </div>

      {loading ? <div style={{ color: '#999' }}>Loading…</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              {['Name', 'Plan', 'Status', 'Berths', 'Created'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600, fontSize: 12, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {marinas.map(m => (
              <tr key={m.id} onClick={() => setSelected(m)} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{m.name}</td>
                <td style={{ padding: '10px 12px' }}>{m.plan}</td>
                <td style={{ padding: '10px 12px' }}><Badge status={m.status} /></td>
                <td style={{ padding: '10px 12px' }}>{m.total_berths}</td>
                <td style={{ padding: '10px 12px', color: '#999' }}>{m.created_at?.slice(0, 10)}</td>
              </tr>
            ))}
            {!marinas.length && <tr><td colSpan={5} style={{ padding: 24, color: '#999', textAlign: 'center' }}>No marinas found</td></tr>}
          </tbody>
        </table>
      )}

      {selected && (
        <MarinaDrawer marina={selected} onClose={() => setSelected(null)} onUpdated={onUpdated} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual test**

Navigate to `/accounts`. Confirm marina table loads. Click a row — drawer should open with marina metadata and action buttons. Test suspend/reinstate/convert on a test marina. Test impersonate: with consent not granted, ensure bypass reason field appears.

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/screens/Accounts.jsx
git commit -m "feat(admin): Accounts screen with marina table and detail drawer"
```

---

### Task 7: Finance screen

**Files:**
- Modify: `frontend-admin/src/screens/Finance.jsx`

- [ ] **Step 1: Implement Finance screen**

Replace `frontend-admin/src/screens/Finance.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Finance() {
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    api.get('/admin/finance/').then(r => setData(r.data));
    api.get('/admin/payments/').then(r => setPayments(r.data));
  }, []);

  const fmt = n => n != null ? `€${Number(n).toLocaleString()}` : '—';

  if (!data) return <div style={{ color: '#999' }}>Loading…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Finance</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        {[['MRR', data.mrr], ['ARR', data.arr], ['Avg per Account', data.avg_revenue_per_account]].map(([l, v]) => (
          <div key={l} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>{l}</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{fmt(v)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Revenue by Plan</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr>{['Plan', 'Marinas', 'Revenue/mo'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 0', color: '#999', fontSize: 12 }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.revenue_by_plan?.map(p => (
                <tr key={p.plan}><td style={{ padding: '6px 0' }}>{p.plan}</td><td>{p.count}</td><td>{fmt(p.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Revenue by Marina</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr>{['Marina', 'Plan', 'MRR'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 0', color: '#999', fontSize: 12 }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.revenue_by_marina?.slice(0, 10).map((m, i) => (
                <tr key={i}><td style={{ padding: '6px 0' }}>{m.name}</td><td>{m.plan}</td><td>{fmt(m.mrr)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Payment History</h3>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr>{['Marina', 'Amount', 'Status', 'Period', 'Paid At'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 0', color: '#999', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr></thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f9f9f9' }}>
                <td style={{ padding: '8px 0' }}>{p.marina_name || p.marina}</td>
                <td>{fmt(p.amount)}</td>
                <td style={{ color: p.status === 'overdue' ? '#dc2626' : p.status === 'paid' ? '#16a34a' : '#d97706' }}>{p.status}</td>
                <td style={{ color: '#999' }}>{p.period_start}</td>
                <td style={{ color: '#999' }}>{p.paid_at?.slice(0, 10) || '—'}</td>
              </tr>
            ))}
            {!payments.length && <tr><td colSpan={5} style={{ padding: 16, color: '#999', textAlign: 'center' }}>No payment records</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test** — Navigate to `/finance`. Confirm MRR/ARR tiles, plan breakdown, and payment history load.

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/screens/Finance.jsx
git commit -m "feat(admin): Finance screen — MRR breakdown and payment history"
```

---

### Task 8: Feature Flags screen

**Files:**
- Modify: `frontend-admin/src/screens/FeatureFlags.jsx`

- [ ] **Step 1: Implement FeatureFlags screen**

Replace `frontend-admin/src/screens/FeatureFlags.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import api from '../api.js';

function Toggle({ on, onChange, disabled }) {
  return (
    <div onClick={!disabled ? onChange : undefined} style={{ width: 36, height: 20, borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer', background: on ? '#16a34a' : '#d1d5db', position: 'relative', transition: 'background 0.15s', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  );
}

export default function FeatureFlags() {
  const [flags, setFlags] = useState([]);
  const [toggling, setToggling] = useState(null);

  useEffect(() => {
    api.get('/admin/feature-flags/').then(r => setFlags(r.data));
  }, []);

  async function toggle(flag) {
    setToggling(flag.name);
    try {
      const { data } = await api.patch(`/admin/feature-flags/${flag.name}/`, { enabled: !flag.enabled });
      setFlags(prev => prev.map(f => f.name === flag.name ? data : f));
    } finally {
      setToggling(null);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Feature Flags</h2>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        {flags.length === 0 && <div style={{ padding: 24, color: '#999', fontSize: 13 }}>No feature flags configured.</div>}
        {flags.map((flag, i) => (
          <div key={flag.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: i < flags.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{flag.name}</div>
              {flag.updated_at && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Last updated: {flag.updated_at?.slice(0, 10)}</div>}
            </div>
            <Toggle on={flag.enabled} onChange={() => toggle(flag)} disabled={toggling === flag.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test** — Navigate to `/flags`. Confirm flags list loads. Toggle a flag — confirm it persists on page refresh.

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/screens/FeatureFlags.jsx
git commit -m "feat(admin): Feature Flags screen with inline toggles"
```

---

### Task 9: Audit Log screen

**Files:**
- Modify: `frontend-admin/src/screens/AuditLog.jsx`

- [ ] **Step 1: Implement AuditLog screen**

Replace `frontend-admin/src/screens/AuditLog.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import api from '../api.js';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [marinaId, setMarinaId] = useState('');
  const [marinas, setMarinas] = useState([]);

  useEffect(() => {
    api.get('/admin/marinas/').then(r => setMarinas(r.data));
  }, []);

  useEffect(() => {
    const params = marinaId ? { marina: marinaId } : {};
    api.get('/admin/audit-logs/', { params }).then(r => setLogs(r.data));
  }, [marinaId]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Audit Log</h2>
        <select value={marinaId} onChange={e => setMarinaId(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}>
          <option value="">All marinas</option>
          {marinas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
              {['Time', 'Admin', 'Action', 'Marina', 'Detail'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: '#666', fontSize: 12, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => {
              const isOverride = log.action === 'impersonate_override';
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: isOverride ? '#fffbeb' : 'transparent' }}>
                  <td style={{ padding: '10px 14px', color: '#999', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px' }}>{log.admin_user_email || log.admin_user || '—'}</td>
                  <td style={{ padding: '10px 14px', fontWeight: isOverride ? 700 : 400, color: isOverride ? '#d97706' : 'inherit' }}>{log.action}</td>
                  <td style={{ padding: '10px 14px' }}>{log.target_marina_name || log.target_marina || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#999', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof log.detail === 'object' ? JSON.stringify(log.detail) : log.detail}
                  </td>
                </tr>
              );
            })}
            {!logs.length && <tr><td colSpan={5} style={{ padding: 24, color: '#999', textAlign: 'center' }}>No audit log entries</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test** — Navigate to `/audit`. Confirm log table loads. `impersonate_override` rows should be amber-highlighted. Filter by marina using the dropdown.

- [ ] **Step 3: Commit**

```bash
git add frontend-admin/src/screens/AuditLog.jsx
git commit -m "feat(admin): Audit Log screen with marina filter and override highlighting"
```

---

### Task 10: AuditLogSerializer — expose email and marina name

The frontend uses `log.admin_user_email` and `log.target_marina_name`. Check the existing `AuditLogSerializer` in `apps/admin_portal/serializers.py` and confirm these fields are included. If they use integer FKs only, add:

- [ ] **Step 1: Update AuditLogSerializer if needed**

In `apps/admin_portal/serializers.py`, find `AuditLogSerializer`. Update so it includes readable email and marina name fields. Example:

```python
class AuditLogSerializer(serializers.ModelSerializer):
    admin_user_email = serializers.CharField(source='admin_user.email', read_only=True, default=None)
    target_marina_name = serializers.CharField(source='target_marina.name', read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = ['id', 'admin_user_email', 'action', 'target_marina_name', 'detail',
                  'created_at', 'impersonation_session_id', 'impersonator_user_id']
```

- [ ] **Step 2: Run backend tests**

```
python manage.py test apps.admin_portal --settings=config.settings.test
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin_portal/serializers.py
git commit -m "fix(admin_portal): expose admin_user_email and target_marina_name in AuditLogSerializer"
```
