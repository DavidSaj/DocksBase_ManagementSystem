import { useEffect, useMemo, useState } from 'react';
import api from '../../api.js';

const REASONS = [
  { value: 'requested_by_customer', label: 'Requested by customer' },
  { value: 'duplicate',             label: 'Duplicate charge' },
  { value: 'fraudulent',            label: 'Fraudulent' },
  { value: 'other',                 label: 'Other' },
];

/**
 * RefundModal — issue a Stripe refund (or record an offline one) against a
 * paid invoice.
 *
 * Props:
 *   invoice  – invoice object with at least { id, total, amount_paid_so_far?,
 *              stripe_payment_intent_id?, currency? }
 *   onClose  – called on dismiss
 *   onSuccess(refund) – called when a refund row is created
 */
export default function RefundModal({ invoice: initialInvoice, memberId, onClose, onSuccess }) {
  // If no invoice was passed in directly, let the user pick from a list of
  // paid invoices belonging to `memberId` (or any paid invoice for the marina
  // if memberId is null).
  const [pickList, setPickList] = useState(null); // null=loading, []=loaded
  const [invoice, setInvoice]   = useState(initialInvoice || null);

  useEffect(() => {
    if (invoice) return;
    let cancelled = false;
    api.get('/billing/invoices/').then(r => {
      if (cancelled) return;
      const paid = (r.data || []).filter(i => i.status === 'paid' && (
        memberId == null || i.member === memberId
      ));
      setPickList(paid);
    }).catch(() => !cancelled && setPickList([]));
    return () => { cancelled = true; };
  }, [invoice, memberId]);

  // Compute remaining refundable in cents from invoice.total (no prior refunds
  // in cents available on the boater drawer payload — assume full total).
  const remainingCents = useMemo(
    () => Math.max(0, Math.round(Number(invoice?.total || 0) * 100)),
    [invoice]
  );

  const [amount, setAmount]   = useState('');
  useEffect(() => {
    if (invoice) setAmount((remainingCents / 100).toFixed(2));
  }, [invoice, remainingCents]);
  const [reason, setReason]   = useState('requested_by_customer');
  const [notes,  setNotes]    = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,  setError]    = useState('');
  const [manualPrompt, setManualPrompt] = useState(false);

  const amountCents = Math.round(Number(amount || 0) * 100);
  const amountInvalid =
    !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > remainingCents;

  async function submit(asOffline = false) {
    if (amountInvalid) {
      setError(`Amount must be between 0.01 and ${(remainingCents / 100).toFixed(2)}.`);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/billing/refunds/', {
        invoice_id: invoice.id,
        amount_cents: amountCents,
        reason,
        notes,
        offline: asOffline,
      });
      if (data.status === 'manual_required') {
        setManualPrompt(true);
        return;
      }
      onSuccess?.(data);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.detail ?? 'Refund failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Issue refund"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 8, padding: 24,
          width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <h3 style={{ margin: 0, marginBottom: 12 }}>Issue Refund</h3>
        {!invoice ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginBottom: 8 }}>
              Select a paid invoice to refund:
            </div>
            {pickList == null ? (
              <div style={{ fontSize: 13 }}>Loading…</div>
            ) : pickList.length === 0 ? (
              <div style={{ fontSize: 13, color: '#b00020' }}>
                No paid invoices found for this account.
              </div>
            ) : (
              <select
                onChange={e => {
                  const id = Number(e.target.value);
                  const found = pickList.find(i => i.id === id);
                  if (found) setInvoice(found);
                }}
                defaultValue=""
                style={{ width: '100%', padding: '6px 8px', border: 'var(--border)',
                         borderRadius: 5, fontSize: 13 }}
              >
                <option value="" disabled>— select invoice —</option>
                {pickList.map(i => (
                  <option key={i.id} value={i.id}>
                    #{i.invoice_number} • €{Number(i.total).toFixed(2)}
                  </option>
                ))}
              </select>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        ) : (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginBottom: 16 }}>
          Invoice #{invoice?.invoice_number ?? invoice?.id} • Remaining refundable:
          &nbsp;€{(remainingCents / 100).toFixed(2)}
        </div>
        )}
        {invoice && (<>

        {manualPrompt ? (
          <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            <strong>Refund is older than Stripe's 180-day window.</strong> Process
            this refund offline (e.g. cut a check) and click
            <em> Mark as Refunded Offline</em> to record it.
          </div>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Amount (€)
            </label>
            <input
              type="number" step="0.01" min="0.01" max={(remainingCents / 100).toFixed(2)}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: 'var(--border)',
                       borderRadius: 5, fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Reason
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: 'var(--border)',
                       borderRadius: 5, fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
            >
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '6px 8px', border: 'var(--border)',
                       borderRadius: 5, fontSize: 13, marginBottom: 12, boxSizing: 'border-box',
                       resize: 'vertical' }}
            />
          </>
        )}

        {error && (
          <div style={{ color: '#b00020', fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          {manualPrompt ? (
            <button
              className="btn btn-primary"
              onClick={() => submit(true)}
              disabled={submitting}
            >
              {submitting ? 'Recording…' : 'Mark as Refunded Offline'}
            </button>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => submit(true)}
                disabled={submitting || amountInvalid}
                title="Record a refund handled outside Stripe (e.g. cheque)"
              >
                Offline
              </button>
              <button
                className="btn btn-primary"
                onClick={() => submit(false)}
                disabled={submitting || amountInvalid}
              >
                {submitting ? 'Refunding…' : 'Issue Refund'}
              </button>
            </>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
