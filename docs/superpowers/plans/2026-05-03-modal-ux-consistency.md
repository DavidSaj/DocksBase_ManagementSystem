# Modal UX Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all modal dialogs in the app so they render as proper centered overlays instead of unstyled inline content, and convert the Operations "Add to Queue" inline form to a modal.

**Architecture:** Add the six missing modal CSS classes to `app.css`, standardise `Maintenance.jsx` to use those class names (renaming its local `Modal` component from `modal-overlay`/`modal-header` to `modal-backdrop`/`modal-hdr`), and convert `Operations.jsx`'s `AddQueueForm` from an inline card to a `modal-backdrop`/`modal` overlay. No new components are created; no backend changes.

**Tech Stack:** React 19, Vite, custom CSS with CSS variables (`var(--white)` etc.), Lucide React icons via `<Ic>` wrapper.

**Spec:** `docs/superpowers/specs/2026-05-03-modal-ux-consistency-design.md`

---

### Task 1: Add modal CSS classes to app.css

**Files:**
- Modify: `frontend/src/styles/app.css` (append after existing styles)

- [ ] **Step 1: Open `app.css` and append the six modal classes at the end of the file**

```css
/* ── MODALS ─────────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--white);
  border-radius: 10px;
  padding: 24px;
  min-width: 360px;
  max-width: 520px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  max-height: 90vh;
  overflow-y: auto;
}
.modal-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: rgba(0,0,0,0.88);
}
.modal-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
```

- [ ] **Step 2: Start the dev server and visually verify Staff.jsx modals now work**

```
cd DocksBase_ManagementSystem/frontend
npm run dev
```

Navigate to **Staff → Directory**, click **Invite Staff**. Expected: a centered modal overlay appears with a dark backdrop. The form should be contained in a white box in the middle of the screen. Click the × button — modal closes.

Also click **Certifications → Add Cert** and verify it renders correctly.

If the modal still appears inline, double-check that `app.css` is imported in the entry point (`src/main.jsx` or `src/App.jsx`).

- [ ] **Step 3: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/styles/app.css
git commit -m "fix: add missing modal CSS classes to app.css"
```

---

### Task 2: Standardise Maintenance.jsx local Modal component

**Files:**
- Modify: `frontend/src/screens/Maintenance.jsx` (lines 20–32 only — the `Modal` function component)

The current `Modal` component at the top of the file looks like this:

```jsx
function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 1: Replace the `Modal` function component with the standardised version**

Replace the entire `Modal` function (lines 20–32) with:

```jsx
function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

No other changes are needed in `Maintenance.jsx` — all five modal usages (`showAddTask`, `showAddMT`, `showAddInc`, `showAddAsset`, `showAddDefect`) call this same component and already use `modal-body` / `modal-footer` class names which match the new CSS.

- [ ] **Step 2: Visually verify all five Maintenance modals**

With the dev server running, navigate to **Maintenance** and test each button:

| Tab | Button | Expected |
|---|---|---|
| Staff Tasks | Add Task | Centered modal with dark backdrop |
| Maintenance Tasks | New Task | Centered modal |
| Incidents | Log Incident | Centered modal |
| Asset Register | Add Asset | Centered modal |
| Defect Log | Log Defect | Centered modal |

For each: confirm the backdrop is dark, the modal is centered, the × button closes it, and clicking outside (on the backdrop) also closes it.

- [ ] **Step 3: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/screens/Maintenance.jsx
git commit -m "fix: standardise Maintenance.jsx Modal component to shared CSS class names"
```

---

### Task 3: Convert Operations.jsx AddQueueForm to modal

**Files:**
- Modify: `frontend/src/screens/Operations.jsx` (the `AddQueueForm` function, approximately lines 8–74)

The current `AddQueueForm` returns a `<div className="card">` that expands inline. Replace the entire return value with a `modal-backdrop`/`modal` structure. The component logic and state stay identical — only the JSX wrapper changes.

- [ ] **Step 1: Replace the `AddQueueForm` return statement**

The current return (lines 37–73) is:

```jsx
return (
  <div className="card" style={{ padding: 18, marginBottom: 16 }}>
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Add to Queue</div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {[['member','Known Vessel'],['stranger','Free Text']].map(([v,l]) => (
        <button key={v} className={`btn ${mode === v ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(v)}>{l}</button>
      ))}
    </div>
    <form onSubmit={submit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mode === 'member' ? (
          <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required>
            <option value="">Select vessel…</option>
            {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        ) : (
          <>
            <input className="input" placeholder='Description (e.g. "White Sailboat")' value={form.guest_description} onChange={e => set('guest_description', e.target.value)} />
            <input className="input" placeholder="Phone number" value={form.guest_phone} onChange={e => set('guest_phone', e.target.value)} />
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <select className="input" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
            <option value="pump_out">Pump-out</option>
          </select>
          <input className="input" placeholder="Est. litres" type="number" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>{submitting ? 'Adding…' : 'Add to Queue'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </form>
  </div>
);
```

Replace it with:

```jsx
return (
  <div className="modal-backdrop" onClick={onCancel}>
    <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
      <div className="modal-hdr">
        <span className="modal-title">Add to Queue</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}><Ic n="x" s={13}/></button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['member','Known Vessel'],['stranger','Free Text']].map(([v,l]) => (
          <button key={v} type="button" className={`btn ${mode === v ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(v)}>{l}</button>
        ))}
      </div>
      <form onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === 'member' ? (
            <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required>
              <option value="">Select vessel…</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          ) : (
            <>
              <input className="input" placeholder='Description (e.g. "White Sailboat")' value={form.guest_description} onChange={e => set('guest_description', e.target.value)} />
              <input className="input" placeholder="Phone number" value={form.guest_phone} onChange={e => set('guest_phone', e.target.value)} />
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select className="input" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
              <option value="diesel">Diesel</option>
              <option value="petrol">Petrol</option>
              <option value="pump_out">Pump-out</option>
            </select>
            <input className="input" placeholder="Est. litres" type="number" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add to Queue'}</button>
          </div>
        </div>
      </form>
    </div>
  </div>
);
```

- [ ] **Step 2: Visually verify the Operations modal**

Navigate to **Operations → Fuel Dock**, click **Add to Queue**. Expected:
- A centered modal overlay appears with a dark backdrop
- "Known Vessel" / "Free Text" toggle buttons work as before
- Selecting a vessel or filling in description/phone works
- Fuel type and estimated litres fields work
- Submit adds to queue and closes the modal
- Cancel button closes the modal
- Clicking the dark backdrop also closes the modal

- [ ] **Step 3: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/screens/Operations.jsx
git commit -m "fix: convert Operations AddQueueForm from inline card to modal"
```
