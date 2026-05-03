# Modal UX Consistency — Design Spec

**Date:** 2026-05-03  
**Status:** Approved

## Problem

Modal CSS classes (`modal-backdrop`, `modal-overlay`, `.modal`, `modal-hdr`, `modal-header`, `modal-body`, `modal-footer`) are completely absent from `app.css`. As a result, every modal dialog in the app (invite staff, add task, log incident, etc.) renders as unstyled inline content at the top of the page flow instead of as a centered overlay. There is also an inconsistency between naming conventions used in different screens, and one form (Operations → Add to Queue) expands inline instead of in a modal.

## Scope

Three files change. No backend changes. No new components.

---

## Section 1 — Add modal CSS to app.css

Add six classes to `frontend/src/styles/app.css`:

```css
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

These classes are already referenced by `Staff.jsx` and `Reservations.jsx` — adding the CSS is the only change needed for those screens.

---

## Section 2 — Standardise Maintenance.jsx

`Maintenance.jsx` uses a locally-defined `Modal` component with different class names:
- `modal-overlay` → rename to `modal-backdrop`
- `modal-header` → rename to `modal-hdr`
- `modal-close` button (renders `×`) → replace with `<button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button>`
- Add `role="dialog"` and `aria-modal="true"` to the inner `.modal` div.
- Add backdrop-click-to-close: `onClick={onClose}` on the `.modal-backdrop` div, with `e.stopPropagation()` on the inner `.modal` div (ensure this is explicit regardless of whether it already exists).

The `modal-body` and `modal-footer` classes are already correct and match the new CSS.

No logic changes beyond the above — class name and button markup update inside the `Modal` function component at the top of that file.

---

## Section 3 — Convert Operations.jsx AddQueueForm to modal

Currently `AddQueueForm` renders as a `.card` that expands inline below the header when "Add to Queue" is clicked (`showAddForm` state).

Changes:
- Remove the `<div className="card">` wrapper and its inline `padding`/`marginBottom`.
- Wrap the entire form in `<div className="modal-backdrop">` / `<div className="modal" role="dialog" aria-modal="true">`.
- Add a `.modal-hdr` with title "Add to Queue" and a close button (`<button className="btn btn-ghost btn-sm" onClick={onCancel}><Ic n="x" s={13}/></button>`).
- Move the Cancel / "Add to Queue" submit buttons into a `.modal-footer` div at the bottom.
- Add backdrop-click-to-close: `onClick={onCancel}` on the backdrop div, with `e.stopPropagation()` on the inner `.modal` div.
- The existing `showAddForm` toggle in `FuelDockTab` stays unchanged.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/styles/app.css` | Add 6 modal CSS classes |
| `frontend/src/screens/Maintenance.jsx` | Rename class names in local `Modal` component, update close button |
| `frontend/src/screens/Operations.jsx` | Convert `AddQueueForm` from inline card to modal |

## Background Scrolling

The `position: fixed` backdrop prevents the modal from scrolling, but the page behind it can still be scrolled via mouse wheel. This is acceptable for this pass. When the shared `<Modal>` component is extracted in a future refactor, add a `useEffect` that sets `document.body.style.overflow = 'hidden'` on mount and restores it on unmount.

## Out of Scope

- No changes to `Staff.jsx`, `Reservations.jsx`, or any other screen (they already use the correct class names)
- No extraction of a shared `<Modal>` component (can be done in a future pass)
- No changes to `CompletionForm` inline in Operations (that renders inside a card row, which is intentional)
