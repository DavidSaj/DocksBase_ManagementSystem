// portal/src/screens/tabs/AccountTab.jsx
import { useState, useEffect, useRef } from 'react';
import { useTenant } from '../../context/TenantContext';
import { fetchInvoices, fetchDocuments, uploadDocument, deleteDocument } from '../../api';

const STATUS_BADGE = {
  paid:   { label: 'Paid',   cls: 'badge-green' },
  unpaid: { label: 'Unpaid', cls: 'badge-gold'  },
  open:   { label: 'Due',    cls: 'badge-gold'  },
  draft:  { label: 'Draft',  cls: 'badge-gray'  },
  void:   { label: 'Void',   cls: 'badge-gray'  },
};

const DOC_STATUS_COLOR = {
  pending_upload: 'rgba(0,0,0,0.3)',
  uploaded:       '#2980b9',
  verified:       '#27ae60',
  due_soon:       '#e67e22',
  expired:        '#c0392b',
};

function InvoiceRow({ invoice }) {
  const badge = STATUS_BADGE[invoice.status] || { label: invoice.status, cls: 'badge-gray' };
  return (
    <div className="p-acct-invoice-row">
      <div>
        <div className="p-acct-invoice-num">{invoice.invoice_number}</div>
        <div className="p-acct-invoice-date">{invoice.due_date || invoice.created_at}</div>
      </div>
      <div className="p-acct-invoice-right">
        <div className="p-acct-invoice-amount">{invoice.total}</div>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </div>
    </div>
  );
}

function DocRow({ doc, onUpload }) {
  const fileRef = useRef();
  const color   = DOC_STATUS_COLOR[doc.status] || 'rgba(0,0,0,0.3)';
  return (
    <div className="p-acct-doc-row">
      <div>
        <div className="p-acct-doc-type">{doc.doc_type_display}</div>
        <div className="p-acct-doc-status" style={{ color }}>{doc.status_display}</div>
        {doc.expiry_date && <div className="p-acct-doc-expiry">Expires {doc.expiry_date}</div>}
      </div>
      <div className="p-acct-doc-actions">
        {doc.status === 'pending_upload' && (
          <>
            <input type="file" ref={fileRef} style={{ display: 'none' }}
              onChange={e => onUpload(doc.doc_type, e.target.files[0])}
              accept=".pdf,.jpg,.jpeg,.png" />
            <button className="p-acct-doc-btn" onClick={() => fileRef.current.click()} type="button">Upload</button>
          </>
        )}
        {doc.file && (
          <a className="p-acct-doc-btn" href={doc.file} target="_blank" rel="noreferrer">View</a>
        )}
      </div>
    </div>
  );
}

export default function AccountTab() {
  const { appConfig } = useTenant();
  const [invoices, setInvoices] = useState([]);
  const [docs, setDocs]         = useState([]);
  const [invoiceLoading, setIL] = useState(true);
  const [docLoading, setDL]     = useState(true);

  useEffect(() => {
    let ignore = false;
    setIL(true);
    fetchInvoices().then(r => { if (!ignore) setInvoices(r.data.results || r.data); }).finally(() => { if (!ignore) setIL(false); });
    if (appConfig?.enable_documents !== false) {
      setDL(true);
      fetchDocuments().then(r => { if (!ignore) setDocs(r.data.documents || []); }).finally(() => { if (!ignore) setDL(false); });
    } else {
      setDL(false);
    }
    return () => { ignore = true; };
  }, [appConfig?.enable_documents]);

  function handleUpload(docType, file) {
    if (!file) return;
    uploadDocument(docType, file)
      .then(r => setDocs(prev => prev.map(d => d.doc_type === docType ? r.data : d)))
      .catch(() => alert('Upload failed. Please try again.'));
  }

  return (
    <div className="p-acct-root">
      {/* Financial Ledger */}
      <div className="p-acct-section-title">Invoices</div>
      <div className="p-acct-card">
        {invoiceLoading && <div className="p-tab-loading">Loading…</div>}
        {!invoiceLoading && invoices.length === 0 && <div className="p-acct-empty">No invoices yet.</div>}
        {invoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)}
      </div>

      {/* Document Vault */}
      {appConfig?.enable_documents !== false && (
        <>
          <div className="p-acct-section-title">Documents</div>
          <div className="p-acct-card">
            {docLoading && <div className="p-tab-loading">Loading…</div>}
            {!docLoading && docs.length === 0 && <div className="p-acct-empty">No documents on file.</div>}
            {docs.map(doc => (
              <DocRow key={doc.id} doc={doc} onUpload={handleUpload} />
            ))}
          </div>
        </>
      )}

      {/* Settings */}
      <div className="p-acct-section-title">Settings</div>
      <div className="p-acct-card">
        <button
          className="p-acct-logout"
          type="button"
          onClick={() => {
            localStorage.removeItem('portal_session_token');
            localStorage.removeItem('portal_token_type');
            localStorage.removeItem('portal_refresh_token');
            localStorage.removeItem('portal_marina_slug');
            window.location.reload();
          }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}
