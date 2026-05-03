# Member Financial Snapshot & Boater Account UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Financial Snapshot card to the Member profile detail panel, enhance the Boater Accounts tab with aging bucket summaries and sorted table, and wire a one-click "View Full Ledger →" jump between the two screens via localStorage.

**Architecture:** All changes are purely frontend (React). No new API endpoints are required — `GET /billing/accounts/{id}/` (snapshot + open invoices) and `POST /billing/accounts/{id}/payments/` (record payment) already exist and are used by `Billing.jsx`. The cross-screen handoff writes a single localStorage key (`billing_open_member`) on the Members side and reads+clears it on mount in Billing.

**Tech Stack:** React 19, Vitest + jsdom, `api.js` (axios wrapper), existing CSS variables (`--red`, `--green`, `--navy`, `--bg`, `--border`, `badge-*`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/utils/ageDays.js` | Pure date-diff utility — normalized to local midnight |
| Create | `src/utils/ageDays.test.js` | Unit tests for `ageDays` |
| Modify | `src/screens/Billing.jsx` | Tab reorder, aging bucket cards, sorted table, placeholder action buttons, localStorage mount-check |
| Modify | `src/screens/Members.jsx` | Accept `setScreen` prop, Financial Snapshot card, Record Payment modal, View Full Ledger button |

---

## Task 1: `ageDays` utility with tests

**Files:**
- Create: `src/utils/ageDays.js`
- Create: `src/utils/ageDays.test.js`

- [ ] **Step 1: Create the utility**

Create `src/utils/ageDays.js`:

```js
export function ageDays(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  return Math.floor((today - due) / 86_400_000);
}
```

- [ ] **Step 2: Write the tests**

Create `src/utils/ageDays.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ageDays } from './ageDays';

describe('ageDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-03T14:32:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns 0 for today', () => {
    expect(ageDays('2026-05-03')).toBe(0);
  });

  it('returns 2 for two days ago', () => {
    expect(ageDays('2026-05-01')).toBe(2);
  });

  it('returns negative for a future date', () => {
    expect(ageDays('2026-05-10')).toBe(-7);
  });

  it('is not affected by time-of-day (midnight normalization)', () => {
    vi.setSystemTime(new Date('2026-05-03T23:59:59'));
    expect(ageDays('2026-05-01')).toBe(2);

    vi.setSystemTime(new Date('2026-05-03T00:00:01'));
    expect(ageDays('2026-05-01')).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests (expect PASS)**

```
cd DocksBase_ManagementSystem/frontend
npx vitest run src/utils/ageDays.test.js
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/ageDays.js src/utils/ageDays.test.js
git commit -m "feat: add ageDays utility with timezone-safe normalization"
```

---

## Task 2: Reorder Billing tabs

**Files:**
- Modify: `src/screens/Billing.jsx:384`

- [ ] **Step 1: Reorder the tabs array**

In `Billing.jsx` line 384, replace the tabs array. Old:

```jsx
{[['invoices','Invoices'],['utilities','Utility Meters'],['pos','Fuel Dock POS'],['debtors','Aged Debtors'],['accounts','Accounts'],['boater-accounts','Boater Accounts']].map(([v,l]) => (
```

New:

```jsx
{[['invoices','Invoices'],['boater-accounts','Boater Accounts'],['utilities','Utility Meters'],['pos','Fuel Dock POS'],['debtors','Aged Debtors'],['accounts','Accounts']].map(([v,l]) => (
```

- [ ] **Step 2: Verify in browser**

Run `npm run dev` from `DocksBase_ManagementSystem/frontend`. Open Billing — confirm tab order is now: Invoices | Boater Accounts | Utility Meters | Fuel Dock POS | Aged Debtors | Accounts.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Billing.jsx
git commit -m "feat: move Boater Accounts tab to second position in Billing"
```

---

## Task 3: Aging bucket cards + sorted table in Boater Accounts list view

**Files:**
- Modify: `src/screens/Billing.jsx` (top imports + boater-accounts list block)

- [ ] **Step 1: Import `ageDays`**

At the top of `Billing.jsx`, add after the last import line:

```js
import { ageDays } from '../utils/ageDays.js';
```

- [ ] **Step 2: Insert bucket cards and sorted table in the list view**

Find the boater-accounts list view block (starts at `{tab === 'boater-accounts' && !selectedId && (`). Replace the entire block with the version below. The only additions are: (a) three bucket cards above the `sec-hdr`, and (b) `sortedAccounts` used in place of `accounts` in the `tbody`.

```jsx
{tab === 'boater-accounts' && !selectedId && (
  <div>
    {/* Aging bucket summary */}
    {(() => {
      const today = new Date();
      const overdue = accounts.filter(a =>
        Number(a.total_outstanding) > 0 &&
        a.oldest_due_date &&
        new Date(a.oldest_due_date) < today
      );
      const under30 = overdue.filter(a => ageDays(a.oldest_due_date) < 30).length;
      const d30to60 = overdue.filter(a => { const d = ageDays(a.oldest_due_date); return d >= 30 && d < 60; }).length;
      const over60  = overdue.filter(a => ageDays(a.oldest_due_date) >= 60).length;
      return (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {[
            ['< 30 Days',  under30, 'badge-orange'],
            ['30–60 Days', d30to60, 'badge-red'],
            ['60+ Days',   over60,  'badge-red'],
          ].map(([label, count, cls]) => (
            <div key={label} className="card" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
              <span className={`badge ${cls}`} style={{ fontSize: 15, fontWeight: 700, minWidth: 26, textAlign: 'center' }}>{count}</span>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{label}</span>
            </div>
          ))}
        </div>
      );
    })()}

    <div className="sec-hdr">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          placeholder="Search member name…"
          value={acctSearch}
          onChange={e => setAcctSearch(e.target.value)}
          style={{ border: 'var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font)', width: 220 }}
        />
        <label style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={acctShowAll} onChange={e => setAcctShowAll(e.target.checked)} />
          Show settled
        </label>
      </div>
    </div>
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Berth</th>
            <th>Outstanding</th><th>Credit</th>
            <th>Open Inv.</th><th>Oldest Due</th><th>Portal</th><th></th>
          </tr>
        </thead>
        <tbody>
          {acctLoading ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
          ) : accounts.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No outstanding balances.</td></tr>
          ) : [...accounts].sort((a, b) => {
            if (!a.oldest_due_date) return 1;
            if (!b.oldest_due_date) return -1;
            return new Date(a.oldest_due_date) - new Date(b.oldest_due_date);
          }).map(a => {
            const isOverdue = a.oldest_due_date && new Date(a.oldest_due_date) < new Date();
            return (
              <tr key={a.member_id}>
                <td className="tbl-name">{a.name}</td>
                <td><span className="badge badge-navy">{a.member_type}</span></td>
                <td style={{ fontSize: 12 }}>{a.berth_code ?? '—'}</td>
                <td style={{ fontWeight: 700, color: isOverdue ? 'var(--red)' : 'inherit' }}>
                  €{Number(a.total_outstanding).toFixed(2)}
                </td>
                <td style={{ fontSize: 12, color: Number(a.credit_on_account) > 0 ? 'var(--green)' : 'rgba(0,0,0,0.35)' }}>
                  {Number(a.credit_on_account) > 0 ? `€${Number(a.credit_on_account).toFixed(2)}` : '—'}
                </td>
                <td style={{ fontSize: 12 }}>{a.open_invoice_count}</td>
                <td style={{ fontSize: 12, color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.45)' }}>
                  {a.oldest_due_date ?? '—'}
                </td>
                <td>
                  {a.portal_active
                    ? <span className="badge badge-green">Active</span>
                    : <span className="badge badge-gray">No portal</span>}
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => openDrawer(a.member_id)}>
                    View Account →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify in browser**

Open Billing → Boater Accounts. Confirm three bucket cards appear above the table. Confirm the table rows sort with the most overdue at the top. Buckets show 0 if no one is in that age range (correct).

- [ ] **Step 4: Commit**

```bash
git add src/screens/Billing.jsx src/utils/ageDays.js
git commit -m "feat: add aging bucket cards and sorted table to Boater Accounts"
```

---

## Task 4: Placeholder heavy-action buttons in Boater Accounts drawer

**Files:**
- Modify: `src/screens/Billing.jsx` (inside the drawer block, after the Record Payment form)

- [ ] **Step 1: Add the three placeholder buttons**

In `Billing.jsx`, find the closing tag of the "Record Payment" form block inside the drawer. It ends with:

```jsx
                  {payLoading ? 'Recording…' : 'Record Payment'}
                  </button>
                </div>

                {/* Invoice groups */}
```

Insert between the closing `</div>` of the Record Payment section and the `{/* Invoice groups */}` comment:

```jsx
                {/* Heavy account actions — placeholder until backend endpoints exist */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                  {[
                    'Apply Credit',
                    'Issue Refund',
                    'Send Payment Reminder',
                  ].map(label => (
                    <button
                      key={label}
                      className="btn btn-ghost"
                      style={{ justifyContent: 'center', opacity: 0.4, cursor: 'not-allowed' }}
                      disabled
                      title="Coming soon"
                    >
                      {label}
                    </button>
                  ))}
                </div>
```

- [ ] **Step 2: Verify in browser**

Open Billing → Boater Accounts → View Account on any row. Confirm three greyed-out buttons appear below the Record Payment form. Hovering shows "Coming soon" tooltip. Clicking does nothing.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Billing.jsx
git commit -m "feat: add placeholder Apply Credit / Issue Refund / Send Reminder buttons to account drawer"
```

---

## Task 5: localStorage mount-check in Billing.jsx (jump target)

**Files:**
- Modify: `src/screens/Billing.jsx:26` (function signature), `~line 104` (new useEffect)

- [ ] **Step 1: Add the mount-check `useEffect`**

In `Billing.jsx`, after the two existing `useEffect` blocks (around line 104), add:

```js
  // Cross-screen jump: Members screen stores a member ID here before navigating to Billing
  useEffect(() => {
    const pendingId = localStorage.getItem('billing_open_member');
    if (!pendingId) return;
    localStorage.removeItem('billing_open_member');
    setTab('boater-accounts');
    openDrawer(Number(pendingId));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Verify in browser (manual)**

In the browser console, run:
```js
localStorage.setItem('billing_open_member', '1');
```
Then navigate away (e.g. to Overview) and back to Billing. The Boater Accounts tab should be active and the drawer for member ID 1 should open automatically. If member 1 doesn't exist, the drawer shows "Could not load account data." — that's correct behaviour.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Billing.jsx
git commit -m "feat: auto-open Boater Accounts drawer from localStorage on Billing mount"
```

---

## Task 6: Financial Snapshot card in Members.jsx

**Files:**
- Modify: `src/screens/Members.jsx` (imports, function signature, new state, new useEffect, card JSX)

- [ ] **Step 1: Update imports**

Replace the first two lines of `Members.jsx`:

Old:
```js
import { useState } from 'react';
```
```js
import { sendMagicLink } from '../api.js';
```

New:
```js
import { useState, useEffect } from 'react';
```
```js
import api, { sendMagicLink } from '../api.js';
```

- [ ] **Step 2: Accept `setScreen` prop**

Change the function signature on line 141:

Old:
```js
export default function Members() {
```

New:
```js
export default function Members({ setScreen }) {
```

- [ ] **Step 3: Add Financial Snapshot state**

In the `Members` function body, after the existing `useState` declarations (after line 147), add:

```js
  const [financialSnap, setFinancialSnap] = useState(null);
  const [snapLoading, setSnapLoading]     = useState(false);
  const [showPayModal, setShowPayModal]   = useState(false);
  const [payAmount, setPayAmount]         = useState('');
  const [payMethod, setPayMethod]         = useState('cash');
  const [payNotes, setPayNotes]           = useState('');
  const [payLoading, setPayLoading]       = useState(false);
  const [payError, setPayError]           = useState(null);
```

- [ ] **Step 4: Add fetch `useEffect`**

After the `handleSendPortalLink` function (after line 161), add:

```js
  useEffect(() => {
    if (!sel?.id) { setFinancialSnap(null); return; }
    setSnapLoading(true);
    setFinancialSnap(null);
    api.get(`/billing/accounts/${sel.id}/`)
      .then(r => setFinancialSnap(r.data))
      .catch(() => setFinancialSnap(null))
      .finally(() => setSnapLoading(false));
  }, [sel?.id]);
```

- [ ] **Step 5: Insert the Financial Snapshot card into the detail panel**

In the detail panel JSX (starting around line 206), find:

```jsx
              <div className="detail-sub">{sel.vessel} · {sel.type}</div>
              {[['Email',sel.email],
```

Insert the snapshot card between those two lines:

```jsx
              <div className="detail-sub">{sel.vessel} · {sel.type}</div>

              {/* Financial Snapshot */}
              {snapLoading && (
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>Loading balance…</div>
              )}
              {financialSnap && (() => {
                const outstanding = Number(financialSnap.summary.total_outstanding);
                const anyOverdue  = financialSnap.open_invoices.some(
                  inv => inv.due_date && new Date(inv.due_date) < new Date()
                );
                const balColor = outstanding === 0 ? 'var(--green)' : anyOverdue ? 'var(--red)' : 'var(--navy)';
                const sortedInv = [...financialSnap.open_invoices].sort((a, b) =>
                  (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1
                );
                return (
                  <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 14px', margin: '8px 0 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Outstanding Balance</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: balColor, marginBottom: 8 }}>
                      €{outstanding.toFixed(2)}
                      {outstanding === 0 && <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 8 }}>✓ Settled</span>}
                    </div>
                    {sortedInv.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        {sortedInv.slice(0, 3).map(inv => {
                          const isOverdue = inv.due_date && new Date(inv.due_date) < new Date();
                          const remaining = Number(inv.total) - Number(inv.amount_paid_so_far);
                          return (
                            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: 'var(--border)' }}>
                              <span style={{ color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.55)' }}>
                                {inv.invoice_number}
                                {isOverdue && <span className="badge badge-red" style={{ marginLeft: 5, fontSize: 9 }}>OVERDUE</span>}
                              </span>
                              <span style={{ fontWeight: 600 }}>€{remaining.toFixed(2)}</span>
                            </div>
                          );
                        })}
                        {sortedInv.length > 3 && (
                          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>…and {sortedInv.length - 3} more</div>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ flex: 1, justifyContent: 'center' }}
                        disabled={sortedInv.length === 0}
                        onClick={() => { setPayAmount(''); setPayMethod('cash'); setPayNotes(''); setPayError(null); setShowPayModal(true); }}
                      >
                        Record Payment
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ flex: 1, justifyContent: 'center' }}
                        onClick={() => { localStorage.setItem('billing_open_member', String(sel.id)); setScreen('billing'); }}
                      >
                        View Full Ledger →
                      </button>
                    </div>
                  </div>
                );
              })()}

              {[['Email',sel.email],
```

- [ ] **Step 6: Verify in browser**

Open Directory → Members. Select a member from the list. Confirm:
- The Financial Snapshot card appears between the vessel/type line and the CRM fields.
- Balance shows in the correct colour (red if overdue, green if settled, navy otherwise).
- Up to 3 invoices show with amounts.
- "Record Payment" is disabled when there are no open invoices.
- "View Full Ledger →" button is visible.

- [ ] **Step 7: Commit**

```bash
git add src/screens/Members.jsx
git commit -m "feat: add Financial Snapshot card to Member detail panel"
```

---

## Task 7: Record Payment modal in Members.jsx

**Files:**
- Modify: `src/screens/Members.jsx` (new `recordPayment` function + modal JSX at bottom of return)

- [ ] **Step 1: Add the `recordPayment` handler**

In the `Members` function body, after the `useEffect` added in Task 6, add:

```js
  async function recordPayment() {
    if (!payAmount || !sel?.id) return;
    setPayLoading(true);
    setPayError(null);
    try {
      await api.post(`/billing/accounts/${sel.id}/payments/`, {
        amount: payAmount,
        method: payMethod,
        notes: payNotes,
      });
      setShowPayModal(false);
      const r = await api.get(`/billing/accounts/${sel.id}/`);
      setFinancialSnap(r.data);
    } catch (ex) {
      setPayError(ex?.response?.data?.detail ?? 'Payment failed. Please try again.');
    } finally {
      setPayLoading(false);
    }
  }
```

- [ ] **Step 2: Add the modal JSX**

In the `return (...)` block of `Members`, find the very last closing tag before the final `</div>` of the return root — it comes just before the root closing div, after the `{showAdd && ...}` block:

```jsx
      {showAdd && (
        <NewMemberModal
          onClose={() => setShowAdd(false)}
          onCreate={async (payload) => { await createMember(payload); setShowAdd(false); }}
        />
      )}
    </div>
  );
```

Insert the payment modal before the `</div>`:

```jsx
      {showAdd && (
        <NewMemberModal
          onClose={() => setShowAdd(false)}
          onCreate={async (payload) => { await createMember(payload); setShowAdd(false); }}
        />
      )}

      {showPayModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setShowPayModal(false)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Record Payment</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>{sel?.name}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>AMOUNT (€)</div>
              <input
                type="number" step="0.01" min="0.01" autoFocus
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>PAYMENT METHOD</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[['cash','Cash'],['external_card','Card'],['bank_transfer','Bank Transfer']].map(([v,l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setPayMethod(v)}
                    style={{
                      padding: '10px 4px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: payMethod === v ? '2px solid var(--navy)' : '1px solid rgba(0,0,0,0.15)',
                      background: payMethod === v ? 'var(--navy)' : '#fff',
                      color: payMethod === v ? '#fff' : 'rgba(0,0,0,0.6)',
                    }}
                  >{l}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>NOTES (optional)</div>
              <input
                placeholder="e.g. Cash received at desk"
                value={payNotes}
                onChange={e => setPayNotes(e.target.value)}
                style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>

            {payError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{payError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setShowPayModal(false)}
                disabled={payLoading}
              >Cancel</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={recordPayment}
                disabled={!payAmount || payLoading}
              >{payLoading ? 'Recording…' : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 3: Verify in browser**

1. Select a member with open invoices.
2. Click "Record Payment" in the Financial Snapshot card.
3. Confirm modal opens, dimming the background.
4. Enter an amount, select Cash.
5. Click "Record Payment".
6. Confirm modal closes and the balance in the snapshot card updates (balance decreases or shows €0.00 ✓ Settled).
7. Verify clicking the modal backdrop (outside the white card) closes it without submitting.
8. Verify submitting with no amount is not possible (button remains disabled).

- [ ] **Step 4: Commit**

```bash
git add src/screens/Members.jsx
git commit -m "feat: add Record Payment modal to Member Financial Snapshot"
```

---

## Task 8: View Full Ledger → jump (end-to-end test)

No code changes — the "View Full Ledger →" button was already wired in Task 6. This task is the end-to-end verification.

- [ ] **Step 1: Verify the jump**

1. Open Directory → Members.
2. Select any member with open invoices.
3. Click "View Full Ledger →".
4. Confirm the app navigates to Billing, the Boater Accounts tab is active, and the account drawer opens for that member.
5. Click "← Back" in the drawer.
6. Confirm the Boater Accounts list view shows, with the aging bucket cards and sorted table.
7. Navigate back to Members. Select a settled member (€0). Confirm "Record Payment" is disabled and "View Full Ledger →" still works.

- [ ] **Step 2: Run full test suite**

```
cd DocksBase_ManagementSystem/frontend
npx vitest run
```

Expected: all existing tests still pass, plus the 4 `ageDays` tests.

- [ ] **Step 3: Final commit**

```bash
git add -p   # review any unstaged changes
git commit -m "feat: complete Member Financial Snapshot and Boater Account UX"
```
