# DocksBase Pricing Strategy

## Principles

- **Feature-gating, not berth-count.** Tiers are differentiated by what the software does, not how many berths the marina declares. Berth-count is self-reported and creates a permanent financial incentive to lie. Feature access is self-enforcing — you either use the feature or you don't.
- **Flat monthly price.** Predictable bills for customers, no seasonal overage disputes.
- **B2B positioning.** Marinas run businesses with significant annual revenue. Price at a level that signals a serious, maintained product.

---

## Tiers

### Starter — €149 / month
Single marina. Core operations covered.

**Includes:**
- Berth management (map, availability, assignments)
- Customer & boat registry
- Manual invoicing & basic payments
- Email support

**Does not include:** Online booking, document generation, advanced reporting, multi-location.

---

### Professional — €349 / month *(most popular)*
Single marina. Full feature set.

**Everything in Starter, plus:**
- Online booking portal (guests book and pay directly)
- Contract & document generation (PDF)
- Advanced reporting (revenue, occupancy, aging)
- Priority support

---

### Enterprise — €899 / month (first marina) + €250 per additional marina
Multi-location operators. Full feature set across all marinas.

**Everything in Professional, plus:**
- Multiple marinas under one account
- Unified billing & consolidated reporting across locations
- Dedicated onboarding & account manager

**Pricing structure:** €899 covers the first marina. Each additional marina is €250/mo. A group with 3 marinas pays €899 + 2×€250 = €1,399/mo. Selected at checkout — no self-reporting.

---

## How Multi-Marina Pricing Works in Stripe

Enterprise uses **two Stripe subscription items** on the same subscription:

| Item | Stripe Price type | Amount |
|---|---|---|
| Enterprise base | Flat fee | €899/mo |
| Additional marina add-on | Per-unit | €250/mo × quantity |

At checkout, the customer selects how many total marinas they want. The signup wizard creates a subscription with both items:

```python
stripe.Subscription.create(
    customer=customer_id,
    items=[
        {'price': STRIPE_PRICE_ENTERPRISE_BASE},
        {'price': STRIPE_PRICE_ENTERPRISE_ADDON_MARINA, 'quantity': extra_marina_count},
    ],
    trial_period_days=30,
    payment_behavior='default_incomplete',
    expand=['pending_setup_intent'],
)
```

`extra_marina_count = total_marinas - 1` (the base covers one).

To add marinas later, DocksBase updates the subscription item quantity via `stripe.SubscriptionItem.modify()`. The customer cannot change this themselves — it goes through DocksBase's backend, so the count is always authoritative.

---

## Upgrade / Downgrade

| Action | Mechanism |
|---|---|
| Starter → Professional | `stripe.Subscription.modify` — swap price ID, prorated immediately |
| Professional → Enterprise | Swap to Enterprise base + add addon item, DocksBase provisions extra marina slots |
| Add marina (Enterprise) | `stripe.SubscriptionItem.modify` — increment addon quantity |
| Remove marina | Same — decrement quantity, effective next billing period |
| Cancel | `cancel_at_period_end=True` — access continues to period end |

---

## Trial

All tiers: **30-day free trial**. Card collected upfront via Stripe SetupIntent (no charge until trial ends). Stripe sends an automatic reminder before the trial ends.

---

## Future Considerations (out of scope for now)

- Annual billing discount (~15%)
- Coupon / promo code support
- Invoice history download
