# Settings Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Remove the feature flag card from Settings, repolish the OTA Connections card as compact rows with a status pill + kebab menu, then smoke-test the OTA flow end-to-end.

**Architecture:** Single file changes in `frontend/src/screens/Settings.jsx`. No backend, no schema, no new tests. Status pill colour is derived from existing fields (`inbound_ical_url`, `last_synced`); failed-sync state is in-session only.

**Tech Stack:** React + Vite (existing). Use the project's existing `.badge` + `.badge-<tone>` classes for the pill.

**Reference spec:** `docs/superpowers/specs/2026-05-14-settings-polish-design.md`

---

## Task 1: Remove the Feature Flags card

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

- [ ] **Step 1: Locate the targets.**

```bash
grep -n "FLAG_DEFS\|setFlags\|flagsSaving\|saveFlags\|Feature Flags\|Feature flag" frontend/src/screens/Settings.jsx
```

You should see references near lines 87, 479, 578, 1235. Read each section so you know what to remove.

- [ ] **Step 2: Delete the constant.**

Remove the entire `FLAG_DEFS` array near line 87.

- [ ] **Step 3: Delete the state hooks.**

Remove `flags`, `setFlags`, `flagsSaving`, and `saveFlags` declarations. If they live in a `useEffect` block with other state, delete only the relevant lines (don't disturb adjacent state).

- [ ] **Step 4: Delete the initialisation block.**

Inside the marina-load `useEffect` (around line 479) there's a `setFlags({...})` call seeded from `marina.features?.X`. Remove it. Leave the rest of the effect (the `setMf({...})` call) alone.

- [ ] **Step 5: Delete the JSX card.**

Remove the entire card div that contains the `FLAG_DEFS.map(...)` (roughly lines 1230–1250 — the wrapping `<div className="card">`, its `card-header`, the `.map(...)`, and the "Save Flags" button). Verify the surrounding grid still lays out correctly afterwards (it should — this card is one of several in a column).

- [ ] **Step 6: Verify nothing references the removed symbols.**

```bash
grep -n "FLAG_DEFS\|setFlags\|flagsSaving\|saveFlags" frontend/src/screens/Settings.jsx
```

Expected: no matches.

- [ ] **Step 7: Build.**

```bash
cd /home/david/.agent-os/worktrees/DocksBase_ManagementSystem-red-meadow/frontend && npm run build 2>&1 | tail -10
```

Expected: clean build. If a stray reference (e.g. inside a comment or an effect's deps array) breaks the build, fix it.

- [ ] **Step 8: Commit.**

```bash
cd /home/david/.agent-os/worktrees/DocksBase_ManagementSystem-red-meadow
git add frontend/src/screens/Settings.jsx
git commit -m "feat(settings): remove Feature Flags card"
```

---

## Task 2: Polish OTA Connections card

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

Read `OTAConnectionsCard` carefully first (currently around lines 200–340). Most of the API logic stays — only the render changes.

- [ ] **Step 1: Check for an existing kebab/dropdown component.**

```bash
ls frontend/src/components/ui/
```

If a `Menu` / `Dropdown` / `KebabMenu` / `PopoverMenu` already exists, use it. Otherwise define a small one inline in `Settings.jsx`. Don't extract to `components/ui/` in this PR — keep changes local until we know whether other screens want the same pattern.

- [ ] **Step 2: Confirm badge classes exist.**

```bash
grep -nE "\.badge-(green|amber|blue|gray|red|orange|teal|navy|purple)" frontend/src/styles/app.css
```

Capture which tones are actually defined. If `amber` doesn't exist but `orange` does, use `orange` for `never_synced`. Match what the codebase already uses (other cards in this same file already use `badge badge-green` etc. — grep `badge-` in the file for confirmation).

- [ ] **Step 3: Add `otaStatus` and `relTime` helpers above the `OTAConnectionsCard` function.**

```jsx
function relTime(ms) {
  const s = Math.max(Math.floor(ms / 1000), 0);
  if (s < 60)    return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)    return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)    return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function otaStatus(conn) {
  if (!conn.inbound_ical_url) {
    return { key: 'outbound_only', label: 'Outbound only', tone: 'gray' };
  }
  if (!conn.last_synced) {
    return { key: 'never_synced', label: 'Never synced', tone: 'orange' };  // adjust tone to match available classes
  }
  const ageMs = Date.now() - new Date(conn.last_synced).getTime();
  if (ageMs < 60 * 60 * 1000) {
    return { key: 'synced_recent', label: `Synced ${relTime(ageMs)} ago`, tone: 'green' };
  }
  return { key: 'synced_stale', label: `Synced ${relTime(ageMs)} ago`, tone: 'blue' };
}
```

Adjust the `tone` strings to whichever `badge-<x>` classes the codebase actually defines (per Step 2).

- [ ] **Step 4: Add a minimal `KebabMenu` component above `OTAConnectionsCard` (skip if you found one in Step 1 and use that instead).**

```jsx
function KebabMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(o => !o)}
        aria-label="More actions"
        style={{ padding: '4px 6px' }}
      >
        ⋮
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4,
          background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          minWidth: 180, zIndex: 10,
          display: 'flex', flexDirection: 'column',
        }}>
          {items.map((it, i) => (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => { if (!it.disabled) { setOpen(false); it.onClick(); } }}
              style={{
                textAlign: 'left', padding: '8px 12px', fontSize: 13,
                background: 'transparent', border: 0, cursor: it.disabled ? 'not-allowed' : 'pointer',
                color: it.danger ? '#c0392b' : 'inherit',
                opacity: it.disabled ? 0.4 : 1,
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Adjust `Ic` icon imports if you'd rather render an actual icon than `⋮` — but only if a `more-horizontal` / `more-vertical` icon is already in `frontend/src/components/ui/Icon.jsx`. Don't add new icons.

- [ ] **Step 5: Track per-row local state for editing and sync errors inside `OTAConnectionsCard`.**

Add two more pieces of state:

```jsx
const [editing, setEditing] = useState(null);       // { id, inbound_ical_url } | null
const [syncErrors, setSyncErrors] = useState({});   // { [connId]: string }
const [copied, setCopied] = useState(null);         // connection id whose outbound URL was just copied
```

Update `triggerSync` to clear/set `syncErrors[id]` instead of the single `error` state — keep the existing `error` state for add/remove failures.

```jsx
async function triggerSync(conn) {
  if (syncing === conn.id) return;
  setSyncing(conn.id);
  setSyncErrors(prev => ({ ...prev, [conn.id]: '' }));
  try {
    await api.post(`/ota-connections/${conn.id}/sync/`);
    const { data } = await api.get(`/ota-connections/${conn.id}/`);
    setConnections(prev => prev.map(c => c.id === conn.id ? data : c));
  } catch (e) {
    const detail = e?.response?.data?.detail || 'Sync failed.';
    setSyncErrors(prev => ({ ...prev, [conn.id]: detail }));
  } finally {
    setSyncing(null);
  }
}
```

Add a `saveEdit` function:

```jsx
async function saveEdit() {
  if (!editing) return;
  try {
    const { data } = await api.patch(`/ota-connections/${editing.id}/`, {
      inbound_ical_url: editing.inbound_ical_url,
    });
    setConnections(prev => prev.map(c => c.id === editing.id ? data : c));
    setEditing(null);
  } catch {
    alert('Failed to update URL.');
  }
}
```

Add `copyOutbound`:

```jsx
function copyOutbound(conn) {
  const url = `${window.location.origin}/api/v1/berths/ical/${conn.outbound_token}.ics`;
  navigator.clipboard?.writeText(url);
  setCopied(conn.id);
  setTimeout(() => setCopied(c => c === conn.id ? null : c), 1500);
}
```

- [ ] **Step 6: Replace the connection-list render block.**

Replace the existing `connections.map(conn => ...)` block with:

```jsx
{connections.map(conn => {
  const isEditing = editing?.id === conn.id;
  const syncErr   = syncErrors[conn.id];
  const status    = syncErr
    ? { key: 'sync_failed', label: 'Sync failed', tone: 'red' }
    : otaStatus(conn);
  const isCopied  = copied === conn.id;

  if (isEditing) {
    return (
      <div key={conn.id} style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 7, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{conn.name}</div>
        <input
          type="url"
          placeholder="Inbound iCal URL"
          value={editing.inbound_ical_url}
          onChange={e => setEditing(s => ({ ...s, inbound_ical_url: e.target.value }))}
          style={{ fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div key={conn.id} style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{conn.name}</div>
        <span className={`badge badge-${status.tone}`}>{status.label}</span>
        <KebabMenu items={[
          {
            label: syncing === conn.id ? 'Syncing…' : 'Sync now',
            disabled: !conn.inbound_ical_url || syncing === conn.id,
            onClick: () => triggerSync(conn),
          },
          {
            label: isCopied ? 'Copied!' : 'Copy outbound URL',
            onClick: () => copyOutbound(conn),
          },
          {
            label: 'Edit URLs',
            onClick: () => setEditing({ id: conn.id, inbound_ical_url: conn.inbound_ical_url || '' }),
          },
          {
            label: 'Remove',
            danger: true,
            disabled: removing === conn.id,
            onClick: () => deleteConnection(conn.id),
          },
        ]} />
      </div>
      {syncErr && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#c0392b' }}>{syncErr}</div>
      )}
    </div>
  );
})}
```

Leave the empty state (`No OTA connections yet`), the top-level `error` line (for add/remove failures), and the `form ? (...)` add-connection block untouched.

- [ ] **Step 7: Add the missing `useRef` import.**

Top of `Settings.jsx` — confirm `useRef` is imported (it is, line 1). The `KebabMenu` component uses it.

- [ ] **Step 8: Build.**

```bash
cd /home/david/.agent-os/worktrees/DocksBase_ManagementSystem-red-meadow/frontend && npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 9: Commit.**

```bash
cd /home/david/.agent-os/worktrees/DocksBase_ManagementSystem-red-meadow
git add frontend/src/screens/Settings.jsx
git commit -m "feat(settings): polish OTA card with status pill and kebab menu"
```

---

## Task 3: Smoke OTA end-to-end (manual)

This task is verification, not code. It produces no commit unless you find and fix a bug.

- [ ] **Step 1:** Generate a public Google Calendar (or any iCal-emitting service). Add one test event in the next 2 weeks, span 2 days. Title `OTA Smoke Test`.

- [ ] **Step 2:** Copy the calendar's public iCal URL.

- [ ] **Step 3:** Open Settings → Marina → OTA Connections. Click `+ Add connection`. Name `Smoke Test`. Paste URL. Add.

- [ ] **Step 4:** Status pill should read `Never synced` (orange/amber).

- [ ] **Step 5:** Kebab → `Sync now`. Wait.

- [ ] **Step 6:** Status pill flips to `Synced just now` (green) or similar. A booking should appear on a berth in the dev marina covering those dates.

- [ ] **Step 7:** If no booking appears, check backend logs for `sync_connection`. Likely cause: no berth is allocated to this OTA connection in the dev marina. If that's the case, document the setup steps in the PR description and do NOT widen scope to fix it.

- [ ] **Step 8:** Kebab → `Copy outbound URL`. Paste in a new browser tab. Verify the `.ics` file downloads with the marina's bookings.

- [ ] **Step 9:** Kebab → `Remove`. Confirm. Row disappears.

- [ ] **Step 10:** Record the result in the PR description as a smoke checklist. If anything broke and you fixed it, that's a separate commit on top of Tasks 1 and 2.

---

## Self-Review

- Spec coverage: every change in the spec maps to a task above.
- No placeholders.
- Type consistency: `otaStatus` return shape matches the JSX consumer; `editing` shape matches the saveEdit call.
- Out of scope reminder: any backend change, any test code, any change to the security/data-backup/api-access "Coming Soon" cards.

