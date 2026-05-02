# Service Catalog & Manual Invoicing Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Build a unified marina price book (ChargeableItem), per-item tax on invoices, a Service Catalog CRUD in Settings, a Manual Invoice creator in Billing, and booking-engine auto-invoicing.

**Architecture:**
- New `ChargeableItem` model (price book) owned per-marina. Six pricing models: flat_fee, per_night, per_meter_per_night, per_kwh, per_hour, per_meter_flat.
- `InvoiceLineItem` gains `tax_rate` (snapshot) and `chargeable_item` FK (nullable). Totals computed per-item.
- `Invoice` totals (`subtotal`, `tax_total`, `total`) remain stored fields, recomputed by `finalize_invoice`.
- `Invoice.vat_rate` kept as nullable legacy field — new invoices leave it null; totals come from line items.

**Tech Stack:** Django 4.x DRF backend, React 19 Vite frontend, existing app structure.

---

## Existing code facts (read before each task — do NOT re-derive)

- Latest billing migration: `0003_invoice_number_unique_per_marina.py`
- `Invoice` fields: `subtotal`, `vat_rate`, `tax_total`, `total`, `status` (draft/open/paid/void), `member` FK, `source_type`, `source_id`, `due_date`
- `InvoiceLineItem` fields: `invoice` FK, `description`, `quantity`, `unit_price`, `total_price`
- `service.py` functions: `create_invoice(marina, member, source_type, source_id, due_date)`, `add_line_item(invoice, description, quantity, unit_price)`, `finalize_invoice(invoice)`, `mark_paid_manual(invoice, method)`
- `Booking` fields: `vessel` FK, `boat_loa` (Decimal, nullable), `check_in`, `check_out`, `booking_type`, `member` (indirect via vessel or guest fields)
- `Marina` has `vat_rate` field
- Members endpoint: `GET /api/v1/members/?search=<q>` returns list with `id`, `name`, `email`
- Settings.jsx tab array: `[['marina','Marina Profile'],['rates','Rate Plans'],['users','Users & Roles'],['notifications','Notifications'],['system','System']]` — replace `rates` tab

---

### Task 1: Backend — ChargeableItem model + InvoiceLineItem update + migration

**Files:**
- Modify: `backend/apps/billing/models.py`
- Create: `backend/apps/billing/migrations/0004_chargeable_item_and_line_item_tax.py`

- [ ] **Step 1: Add ChargeableItem model to `models.py`**

Add after the `Payment` class:

```python
class ChargeableItem(models.Model):
    class Category(models.TextChoices):
        BERTH    = 'berth',   'Berth'
        UTILITY  = 'utility', 'Utility'
        SERVICE  = 'service', 'Service'
        RETAIL   = 'retail',  'Retail'

    class PricingModel(models.TextChoices):
        FLAT_FEE            = 'flat_fee',            'Flat Fee'
        PER_NIGHT           = 'per_night',           'Per Night'
        PER_METER_PER_NIGHT = 'per_meter_per_night', 'Per Meter Per Night'
        PER_KWH             = 'per_kwh',             'Per kWh'
        PER_HOUR            = 'per_hour',            'Per Hour'
        PER_METER_FLAT      = 'per_meter_flat',      'Per Meter (flat)'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='chargeable_items')
    name          = models.CharField(max_length=200)
    category      = models.CharField(max_length=20, choices=Category.choices, default=Category.SERVICE)
    pricing_model = models.CharField(max_length=30, choices=PricingModel.choices, default=PricingModel.FLAT_FEE)
    unit_price    = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate      = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    is_active     = models.BooleanField(default=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category', 'name']

    def __str__(self):
        return f'{self.name} ({self.get_pricing_model_display()})'
```

- [ ] **Step 2: Update `InvoiceLineItem` in `models.py`**

Add two fields to `InvoiceLineItem`:

```python
chargeable_item = models.ForeignKey(
    'ChargeableItem', on_delete=models.SET_NULL,
    null=True, blank=True, related_name='line_items'
)
tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
```

Add properties to `InvoiceLineItem` for computed values:

```python
@property
def line_subtotal(self):
    return self.total_price  # quantity * unit_price

@property
def line_tax(self):
    from decimal import ROUND_HALF_UP
    return (self.total_price * self.tax_rate / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

@property
def line_total(self):
    return self.line_subtotal + self.line_tax
```

- [ ] **Step 3: Make `Invoice.vat_rate` nullable**

Change `vat_rate` on `Invoice` to `null=True, blank=True`:
```python
vat_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, default=Decimal('0.00'))
```

- [ ] **Step 4: Write migration**

Run: `cd backend && python manage.py makemigrations billing --name chargeable_item_and_line_item_tax`

Check output is `0004_chargeable_item_and_line_item_tax.py`. If Django generates it cleanly, accept it.

Run: `python manage.py migrate`

Expected: `Applying billing.0004_chargeable_item_and_line_item_tax... OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/0004_chargeable_item_and_line_item_tax.py
git commit -m "feat(billing): add ChargeableItem model and per-item tax_rate on InvoiceLineItem"
```

---

### Task 2: Backend — service.py + serializers

**Files:**
- Modify: `backend/apps/billing/service.py`
- Modify: `backend/apps/billing/serializers.py`

- [ ] **Step 1: Update `add_line_item` in `service.py`**

Add optional `tax_rate` and `chargeable_item` params:

```python
def add_line_item(invoice, description, quantity, unit_price, tax_rate=None, chargeable_item=None):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot add line items to a {invoice.status} invoice.')
    q = Decimal(str(quantity))
    p = Decimal(str(unit_price))
    r = Decimal(str(tax_rate)) if tax_rate is not None else Decimal('0.00')
    total_price = (q * p).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return InvoiceLineItem.objects.create(
        invoice=invoice,
        description=description,
        quantity=q,
        unit_price=p,
        total_price=total_price,
        tax_rate=r,
        chargeable_item=chargeable_item,
    )
```

- [ ] **Step 2: Add `add_line_item_from_catalog` to `service.py`**

```python
def add_line_item_from_catalog(invoice, chargeable_item, quantity):
    """Snapshot price and tax from ChargeableItem at time of invoicing."""
    from .models import ChargeableItem
    return add_line_item(
        invoice=invoice,
        description=chargeable_item.name,
        quantity=quantity,
        unit_price=chargeable_item.unit_price,
        tax_rate=chargeable_item.tax_rate,
        chargeable_item=chargeable_item,
    )
```

- [ ] **Step 3: Update `finalize_invoice` to use per-item tax**

```python
def finalize_invoice(invoice):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot finalize a {invoice.status} invoice.')
    items = list(invoice.items.all())
    subtotal  = sum(i.total_price for i in items)
    tax_total = sum(i.line_tax     for i in items)
    invoice.subtotal  = subtotal.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.tax_total = tax_total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.total     = (subtotal + tax_total).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.status    = 'open'
    invoice.save(update_fields=['subtotal', 'tax_total', 'total', 'status'])
    return invoice
```

- [ ] **Step 4: Add `calculate_booking_invoice` to `service.py`**

This auto-creates a draft invoice when a booking is made, if a matching price book entry exists.

```python
def calculate_booking_invoice(booking):
    """
    Look up the best-match ChargeableItem for a booking and create a draft invoice.
    Silently returns None if no suitable item is found.
    """
    from .models import ChargeableItem
    from decimal import Decimal as D

    item = ChargeableItem.objects.filter(
        marina=booking.marina,
        category='berth',
        is_active=True,
    ).order_by('created_at').first()

    if not item:
        return None

    nights = (booking.check_out - booking.check_in).days
    if nights <= 0:
        return None

    loa = booking.boat_loa
    if loa is None and booking.vessel_id:
        loa = booking.vessel.loa

    if item.pricing_model == 'per_meter_per_night':
        if not loa:
            return None
        quantity = D(str(loa)) * D(str(nights))
        description = f'Berth — {loa}m × {nights} nights'
    elif item.pricing_model == 'per_night':
        quantity = D(str(nights))
        description = f'Berth — {nights} nights'
    else:  # flat_fee and others
        quantity = D('1')
        description = 'Berth fee'

    member = None
    if hasattr(booking, 'member') and booking.member:
        member = booking.member
    elif booking.vessel_id and hasattr(booking.vessel, 'owner'):
        member = booking.vessel.owner if hasattr(booking.vessel.owner, 'invoice') else None

    invoice = create_invoice(
        marina=booking.marina,
        member=member,
        source_type='booking',
        source_id=str(booking.pk),
    )
    add_line_item_from_catalog(invoice, item, quantity)
    return invoice
```

- [ ] **Step 5: Update `create_invoice` to NOT set vat_rate from marina**

Change the line `vat_rate=marina.vat_rate,` to `vat_rate=None,` so new invoices use per-item tax.

- [ ] **Step 6: Update serializers**

Add `ChargeableItemSerializer` and update `InvoiceLineItemSerializer`:

```python
from .models import Invoice, InvoiceLineItem, Payment, ChargeableItem

class ChargeableItemSerializer(serializers.ModelSerializer):
    pricing_model_display = serializers.CharField(source='get_pricing_model_display', read_only=True)
    category_display      = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model  = ChargeableItem
        fields = [
            'id', 'name', 'category', 'category_display',
            'pricing_model', 'pricing_model_display',
            'unit_price', 'tax_rate', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'pricing_model_display', 'category_display']

class InvoiceLineItemSerializer(serializers.ModelSerializer):
    line_subtotal = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    line_tax      = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    line_total    = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model  = InvoiceLineItem
        fields = ['id', 'description', 'quantity', 'unit_price', 'tax_rate',
                  'total_price', 'line_subtotal', 'line_tax', 'line_total']
```

- [ ] **Step 7: Commit**

```bash
git add backend/apps/billing/service.py backend/apps/billing/serializers.py
git commit -m "feat(billing): per-item tax service logic, catalog snapshot, auto-invoice from booking"
```

---

### Task 3: Backend — Views + URL wiring

**Files:**
- Modify: `backend/apps/billing/views.py`
- Modify: `backend/apps/billing/urls.py`

- [ ] **Step 1: Add new views to `views.py`**

Add these imports at the top (keep existing ones):
```python
from .models import Invoice, InvoiceLineItem, ChargeableItem
from .serializers import InvoiceSerializer, InvoiceLineItemSerializer, ChargeableItemSerializer
from . import service as billing_service
```

Add these view classes after existing ones:

```python
class ChargeableItemListCreateView(generics.ListCreateAPIView):
    serializer_class = ChargeableItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ChargeableItem.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ChargeableItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ChargeableItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ChargeableItem.objects.filter(marina=self.request.user.marina)


class InvoiceCreateView(APIView):
    """Create a blank draft invoice (for manual invoice flow)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.members.models import Member
        member = None
        member_id = request.data.get('member_id')
        if member_id:
            try:
                member = Member.objects.get(pk=member_id, marina=request.user.marina)
            except Member.DoesNotExist:
                pass
        due_date    = request.data.get('due_date') or None
        source_type = request.data.get('source_type', 'manual')
        source_id   = request.data.get('source_id', '')
        invoice = billing_service.create_invoice(
            marina=request.user.marina,
            member=member,
            source_type=source_type,
            source_id=source_id,
            due_date=due_date,
        )
        return Response(InvoiceSerializer(invoice).data, status=http_status.HTTP_201_CREATED)


class AddLineItemView(APIView):
    """Add a line item from the Service Catalog to a draft invoice."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        item_id  = request.data.get('chargeable_item_id')
        quantity = request.data.get('quantity', 1)

        try:
            item = ChargeableItem.objects.get(pk=item_id, marina=request.user.marina)
        except ChargeableItem.DoesNotExist:
            return Response({'detail': 'Chargeable item not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        try:
            line = billing_service.add_line_item_from_catalog(invoice, item, quantity)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(InvoiceLineItemSerializer(line).data, status=http_status.HTTP_201_CREATED)


class RemoveLineItemView(APIView):
    """Remove a line item from a draft invoice."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            line = InvoiceLineItem.objects.select_related('invoice').get(
                pk=pk, invoice__marina=request.user.marina
            )
        except InvoiceLineItem.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if line.invoice.status != 'draft':
            return Response({'detail': 'Can only remove items from draft invoices.'}, status=http_status.HTTP_400_BAD_REQUEST)
        line.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class FinalizeInvoiceView(APIView):
    """Finalize a draft invoice → status becomes open."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            invoice = billing_service.finalize_invoice(invoice)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(InvoiceSerializer(invoice).data)
```

- [ ] **Step 2: Update `urls.py`**

Add imports and new URL patterns:

```python
from .views import (
    StripeWebhookView, InvoiceListView, InvoiceDetailView, MarkPaidView,
    FromOrderView, PDFDownloadView, HTMLReceiptView,
    ChargeableItemListCreateView, ChargeableItemDetailView,
    InvoiceCreateView, AddLineItemView, RemoveLineItemView, FinalizeInvoiceView,
)

urlpatterns = [
    path('stripe/webhook/',                 StripeWebhookView.as_view(),           name='stripe_webhook'),
    path('invoices/',                        InvoiceListView.as_view(),             name='invoice_list'),
    path('invoices/create/',                 InvoiceCreateView.as_view(),           name='invoice_create'),
    path('invoices/from-order/',             FromOrderView.as_view(),               name='invoice_from_order'),
    path('invoices/<int:pk>/',               InvoiceDetailView.as_view(),           name='invoice_detail'),
    path('invoices/<int:pk>/mark-paid/',     MarkPaidView.as_view(),                name='invoice_mark_paid'),
    path('invoices/<int:pk>/finalize/',      FinalizeInvoiceView.as_view(),         name='invoice_finalize'),
    path('invoices/<int:pk>/line-items/',    AddLineItemView.as_view(),             name='invoice_add_line_item'),
    path('invoices/<int:pk>/pdf/',           PDFDownloadView.as_view(),             name='invoice_pdf'),
    path('invoices/<int:pk>/receipt/',       HTMLReceiptView.as_view(),             name='invoice_receipt'),
    path('line-items/<int:pk>/',             RemoveLineItemView.as_view(),          name='line_item_delete'),
    path('service-catalog/',                 ChargeableItemListCreateView.as_view(),name='service_catalog_list'),
    path('service-catalog/<int:pk>/',        ChargeableItemDetailView.as_view(),    name='service_catalog_detail'),
]
```

- [ ] **Step 3: Verify URL is wired in `config/urls.py`**

Confirm `path('billing/', include('apps.billing.urls'))` exists — it does per existing code. No change needed.

- [ ] **Step 4: Quick smoke test**

Start server: `cd backend && python manage.py runserver`
Check: `curl -s http://localhost:8000/api/v1/billing/service-catalog/` should return 401 (endpoint exists, not 404).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/views.py backend/apps/billing/urls.py
git commit -m "feat(billing): Service Catalog and manual invoice API endpoints"
```

---

### Task 4: Backend — Booking engine auto-invoicing

**Files:**
- Modify: `backend/apps/reservations/views.py`

- [ ] **Step 1: Read current `BookingListCreateView.create` logic in `views.py`**

Find the `create` method (or `perform_create`) on `BookingListCreateView`. It handles booking creation.

- [ ] **Step 2: Add auto-invoice call after booking is saved**

In the `create` or `perform_create` method, after the booking is saved (has a pk), call:

```python
from apps.billing import service as billing_service

# After booking.save() or serializer.save():
try:
    billing_service.calculate_booking_invoice(booking)
except Exception:
    pass  # Never fail a booking because of invoice generation
```

The `try/except` is intentional — invoice creation is supplemental, never a blocker.

- [ ] **Step 3: On checkout, finalize the booking's draft invoice**

In `BookingDetailView.partial_update` (or wherever status transitions to `checked_out`), add:

```python
if instance.status == 'checked_out':
    from apps.billing.models import Invoice
    from apps.billing import service as billing_service
    draft = Invoice.objects.filter(
        marina=instance.marina,
        source_type='booking',
        source_id=str(instance.pk),
        status='draft',
    ).first()
    if draft and draft.items.exists():
        try:
            billing_service.finalize_invoice(draft)
        except Exception:
            pass
```

- [ ] **Step 4: Commit**

```bash
git add backend/apps/reservations/views.py
git commit -m "feat(reservations): auto-create and auto-finalize booking invoices from price book"
```

---

### Task 5: Frontend — Settings > Service Catalog tab

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

- [ ] **Step 1: Add state and fetch logic at top of component**

Add to existing imports: nothing new needed (api.js already imported via pattern).

Add inside `Settings()` component function, after existing `useState` calls:

```js
import api from '../api.js';
// ... inside component:
const [catalog, setCatalog]       = useState([]);
const [catalogLoading, setCatLoading] = useState(true);
const [catalogForm, setCatalogForm]   = useState(null); // null = closed, {} = new, {id,...} = edit
const [catalogSaving, setCatSaving]   = useState(false);

useEffect(() => {
  api.get('/billing/service-catalog/')
    .then(r => setCatalog(r.data))
    .catch(() => {})
    .finally(() => setCatLoading(false));
}, []);

function saveCatalogItem(form) {
  setCatSaving(true);
  const req = form.id
    ? api.patch(`/billing/service-catalog/${form.id}/`, form)
    : api.post('/billing/service-catalog/', form);
  req
    .then(r => {
      setCatalog(prev => form.id
        ? prev.map(i => i.id === form.id ? r.data : i)
        : [...prev, r.data]);
      setCatalogForm(null);
    })
    .catch(() => {})
    .finally(() => setCatSaving(false));
}

function deleteCatalogItem(id) {
  if (!window.confirm('Delete this item?')) return;
  api.delete(`/billing/service-catalog/${id}/`)
    .then(() => setCatalog(prev => prev.filter(i => i.id !== id)))
    .catch(() => {});
}
```

- [ ] **Step 2: Replace 'rates' tab label with 'catalog'**

In the tabs array, change `['rates','Rate Plans']` to `['catalog','Service Catalog']`.

Change `{tab === 'rates' && (` to `{tab === 'catalog' && (`.

Default tab state stays `'marina'`.

- [ ] **Step 3: Replace the rates tab content with the Service Catalog UI**

Replace everything inside `{tab === 'catalog' && ( ... )}` with:

```jsx
{tab === 'catalog' && (
  <div>
    <div className="sec-hdr">
      <div className="sec-hdr-title">Service Catalog — Price Book</div>
      <button className="btn btn-primary" onClick={() => setCatalogForm({ name: '', category: 'service', pricing_model: 'flat_fee', unit_price: '', tax_rate: '0', is_active: true })}>
        + Add Item
      </button>
    </div>

    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th><th>Category</th><th>Pricing Model</th>
            <th>Unit Price</th><th>Tax Rate</th><th>Active</th><th></th>
          </tr>
        </thead>
        <tbody>
          {catalogLoading ? (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</td></tr>
          ) : catalog.length === 0 ? (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>No items yet. Add your first service.</td></tr>
          ) : catalog.map(item => (
            <tr key={item.id}>
              <td className="tbl-name">{item.name}</td>
              <td><span className="badge badge-navy">{item.category_display}</span></td>
              <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{item.pricing_model_display}</td>
              <td style={{ fontWeight: 600 }}>€{Number(item.unit_price).toFixed(2)}</td>
              <td style={{ fontSize: 12 }}>{item.tax_rate}%</td>
              <td>
                <span className={`badge ${item.is_active ? 'badge-green' : 'badge-gray'}`}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setCatalogForm({ ...item })}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => deleteCatalogItem(item.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* Add / Edit modal */}
    {catalogForm && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={e => e.target === e.currentTarget && setCatalogForm(null)}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>
            {catalogForm.id ? 'Edit Item' : 'New Service Catalog Item'}
          </div>
          {[
            ['Name', 'name', 'text'],
          ].map(([label, key, type]) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{label.toUpperCase()}</div>
              <input className="input" type={type} value={catalogForm[key] || ''} onChange={e => setCatalogForm(f => ({ ...f, [key]: e.target.value }))} style={{ width: '100%' }} />
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>CATEGORY</div>
              <select className="input" value={catalogForm.category} onChange={e => setCatalogForm(f => ({ ...f, category: e.target.value }))} style={{ width: '100%' }}>
                {[['berth','Berth'],['utility','Utility'],['service','Service'],['retail','Retail']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>PRICING MODEL</div>
              <select className="input" value={catalogForm.pricing_model} onChange={e => setCatalogForm(f => ({ ...f, pricing_model: e.target.value }))} style={{ width: '100%' }}>
                {[
                  ['flat_fee','Flat Fee'],
                  ['per_night','Per Night'],
                  ['per_meter_per_night','Per Meter / Night'],
                  ['per_kwh','Per kWh'],
                  ['per_hour','Per Hour'],
                  ['per_meter_flat','Per Meter (flat)'],
                ].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>UNIT PRICE (€)</div>
              <input className="input" type="number" step="0.01" value={catalogForm.unit_price} onChange={e => setCatalogForm(f => ({ ...f, unit_price: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>TAX RATE (%)</div>
              <input className="input" type="number" step="0.01" value={catalogForm.tax_rate} onChange={e => setCatalogForm(f => ({ ...f, tax_rate: e.target.value }))} style={{ width: '100%' }} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 20, cursor: 'pointer' }}>
            <input type="checkbox" checked={catalogForm.is_active} onChange={e => setCatalogForm(f => ({ ...f, is_active: e.target.checked }))} />
            Active (visible in invoice line item picker)
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setCatalogForm(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={catalogSaving} onClick={() => saveCatalogItem(catalogForm)}>
              {catalogSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)}
```

Check that `input` CSS class exists in `app.css` — if not, use `style={{ border: 'var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 13, fontFamily: 'var(--font)' }}` inline on each input instead of `className="input"`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Settings.jsx
git commit -m "feat(settings): Service Catalog tab — live CRUD for ChargeableItem price book"
```

---

### Task 6: Frontend — Billing > Manual Invoice Creator

**Files:**
- Modify: `frontend/src/screens/Billing.jsx`

- [ ] **Step 1: Add new state + data fetching for the invoice creator**

Add inside `Billing()` component (after existing `useState` calls):

```js
const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
const [invoiceStep, setInvoiceStep]       = useState(1); // 1=header, 2=items
const [invoiceDraft, setInvoiceDraft]     = useState(null); // the created invoice object
const [catalogItems, setCatalogItems]     = useState([]);
const [memberSearch, setMemberSearch]     = useState('');
const [memberResults, setMemberResults]   = useState([]);
const [selectedMember, setSelectedMember] = useState(null);
const [dueDate, setDueDate]               = useState('');
const [selectedItem, setSelectedItem]     = useState('');
const [itemQty, setItemQty]               = useState('1');
const [invoiceLines, setInvoiceLines]     = useState([]);
const [invoiceCreating, setInvoiceCreating] = useState(false);

function openNewInvoice() {
  setNewInvoiceOpen(true);
  setInvoiceStep(1);
  setInvoiceDraft(null);
  setInvoiceLines([]);
  setSelectedMember(null);
  setMemberSearch('');
  setDueDate('');
  api.get('/billing/service-catalog/')
    .then(r => setCatalogItems(r.data.filter(i => i.is_active)))
    .catch(() => {});
}

function searchMembers(q) {
  setMemberSearch(q);
  if (q.length < 2) { setMemberResults([]); return; }
  api.get('/members/', { params: { search: q } })
    .then(r => setMemberResults((r.data.results ?? r.data).slice(0, 6)))
    .catch(() => {});
}

async function createDraftAndProceed() {
  setInvoiceCreating(true);
  try {
    const r = await api.post('/billing/invoices/create/', {
      member_id:   selectedMember?.id || null,
      due_date:    dueDate || null,
      source_type: 'manual',
    });
    setInvoiceDraft(r.data);
    setInvoiceStep(2);
  } catch(e) {
    alert('Could not create invoice draft.');
  } finally {
    setInvoiceCreating(false);
  }
}

async function addLineItem() {
  if (!invoiceDraft || !selectedItem) return;
  const item = catalogItems.find(i => String(i.id) === String(selectedItem));
  if (!item) return;
  try {
    const r = await api.post(`/billing/invoices/${invoiceDraft.id}/line-items/`, {
      chargeable_item_id: item.id,
      quantity: itemQty,
    });
    setInvoiceLines(prev => [...prev, { ...r.data, _item: item }]);
    setSelectedItem('');
    setItemQty('1');
  } catch(e) {
    alert('Could not add line item.');
  }
}

async function removeLineItem(lineId) {
  await api.delete(`/billing/line-items/${lineId}/`);
  setInvoiceLines(prev => prev.filter(l => l.id !== lineId));
}

async function finalizeInvoice() {
  if (!invoiceDraft) return;
  try {
    const r = await api.post(`/billing/invoices/${invoiceDraft.id}/finalize/`);
    setInvoiceLines([]);
    setNewInvoiceOpen(false);
    // Refresh invoice list
    refetch();
    alert(`Invoice ${r.data.invoice_number} created — total €${r.data.total}`);
  } catch(e) {
    alert('Could not finalize invoice.');
  }
}

async function saveDraftAndClose() {
  setNewInvoiceOpen(false);
  refetch();
}

const lineSubtotal = invoiceLines.reduce((s, l) => s + Number(l.line_subtotal ?? l.total_price), 0);
const lineTax      = invoiceLines.reduce((s, l) => s + Number(l.line_tax ?? 0), 0);
const lineTotal    = lineSubtotal + lineTax;
```

- [ ] **Step 2: Wire the "New Invoice" button**

Find the existing `<button className="btn btn-primary"><Ic n="plus" s={12} />New Invoice</button>` and add `onClick={openNewInvoice}` to it.

- [ ] **Step 3: Add the modal JSX before the closing `</div>` of the component**

Add at the end of the return, before the final `</div>`:

```jsx
{/* ── NEW INVOICE MODAL ──────────────────────────────────────── */}
{newInvoiceOpen && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={e => e.target === e.currentTarget && setNewInvoiceOpen(false)}>
    <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>New Invoice</div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>Step {invoiceStep} of 2</span>
      </div>

      {invoiceStep === 1 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>MEMBER / CUSTOMER</div>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <input
              style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '7px 10px', fontSize: 13 }}
              placeholder="Search by name or email…"
              value={selectedMember ? selectedMember.name : memberSearch}
              onChange={e => { setSelectedMember(null); searchMembers(e.target.value); }}
            />
            {memberResults.length > 0 && !selectedMember && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: 'var(--border)', borderRadius: 6, boxShadow: 'var(--shadow2)', zIndex: 10 }}>
                {memberResults.map(m => (
                  <div key={m.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12 }}
                    onMouseDown={() => { setSelectedMember(m); setMemberResults([]); }}>
                    <div style={{ fontWeight: 500 }}>{m.name}</div>
                    <div style={{ color: 'rgba(0,0,0,0.4)' }}>{m.email}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>DUE DATE (OPTIONAL)</div>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '7px 10px', fontSize: 13, marginBottom: 20 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setNewInvoiceOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={invoiceCreating} onClick={createDraftAndProceed}>
              {invoiceCreating ? 'Creating…' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {invoiceStep === 2 && (
        <div>
          {/* Member summary */}
          {selectedMember && (
            <div style={{ background: 'var(--bg)', borderRadius: 7, padding: '8px 12px', marginBottom: 16, fontSize: 12 }}>
              <span style={{ color: 'rgba(0,0,0,0.45)' }}>Billing to: </span>
              <span style={{ fontWeight: 600 }}>{selectedMember.name}</span>
            </div>
          )}

          {/* Add line item row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={selectedItem} onChange={e => setSelectedItem(e.target.value)}
              style={{ flex: 1, border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}>
              <option value="">Select service…</option>
              {catalogItems.map(i => (
                <option key={i.id} value={i.id}>
                  {i.name} — €{Number(i.unit_price).toFixed(2)} ({i.pricing_model_display})
                </option>
              ))}
            </select>
            <input type="number" step="0.01" min="0.01" value={itemQty} onChange={e => setItemQty(e.target.value)}
              style={{ width: 70, border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}
              placeholder="Qty" />
            <button className="btn btn-primary btn-sm" onClick={addLineItem}>Add</button>
          </div>

          {/* Line items */}
          {invoiceLines.length > 0 ? (
            <table className="tbl" style={{ marginBottom: 16 }}>
              <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Tax</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {invoiceLines.map(line => (
                  <tr key={line.id}>
                    <td style={{ fontSize: 12 }}>{line.description}</td>
                    <td style={{ fontSize: 12 }}>{line.quantity}</td>
                    <td style={{ fontSize: 12 }}>€{Number(line.unit_price).toFixed(2)}</td>
                    <td style={{ fontSize: 12 }}>{line.tax_rate}%</td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>€{Number(line.line_total ?? line.total_price).toFixed(2)}</td>
                    <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeLineItem(line.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12, marginBottom: 16 }}>
              No line items yet. Add a service above.
            </div>
          )}

          {/* Totals summary */}
          {invoiceLines.length > 0 && (
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              {[['Subtotal', lineSubtotal], ['Tax', lineTax], ['Total', lineTotal]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: l === 'Total' ? 14 : 12, fontWeight: l === 'Total' ? 700 : 400, padding: '3px 0', color: l === 'Total' ? 'var(--navy)' : 'rgba(0,0,0,0.7)' }}>
                  <span>{l}</span><span>€{v.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={saveDraftAndClose}>Save Draft</button>
            <button className="btn btn-primary" disabled={invoiceLines.length === 0} onClick={finalizeInvoice}>
              Finalize Invoice
            </button>
          </div>
        </div>
      )}

    </div>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Billing.jsx
git commit -m "feat(billing): manual invoice creator — member search, catalog line items, per-item tax totals"
```

---

## Execution order

Tasks 1 → 2 → 3 must run sequentially (model → service → views). Tasks 4, 5, 6 can run in parallel after Task 3 completes.
