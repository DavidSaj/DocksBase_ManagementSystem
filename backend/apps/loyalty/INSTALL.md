# Track 3 — Customer Intelligence & Loyalty: Installation Notes

## 1. Migration Order

Run migrations in this exact order to avoid FK dependency errors across tracks:

```bash
python manage.py makemigrations accounts
python manage.py makemigrations members
python manage.py makemigrations billing
python manage.py makemigrations loyalty
python manage.py migrate
```

### Rationale for ordering
- `accounts` first: Marina gains 7 new fields (points rates, referral config, harbour_master_email).
- `members` second: Member gains `is_archived` + `merged_into`; new models DuplicateFlag,
  SecondaryContact, LeadScore, SurveyResponse all depend on Member.
- `billing` third: new debt-management models (DunningTemplate, DebtNote, DunningLetter,
  DebtEscalation) reference Invoice (already in billing).
- `loyalty` last: LoyaltyTier must exist before LoyaltyMembership references it; PointsLedger
  references billing.Invoice and billing.InvoiceLineItem; ReferralUse references reservations.Booking.

## 2. Data Migration (run after `migrate`)

After applying the schema migrations, run a one-off data migration script:

```python
# Create a default LoyaltyTier for each existing marina
from apps.loyalty.models import LoyaltyTier
from apps.accounts.models import Marina
from decimal import Decimal

for marina in Marina.objects.all():
    LoyaltyTier.objects.get_or_create(
        marina=marina,
        rank=1,
        defaults={
            'name': 'Standard',
            'qualification_basis': LoyaltyTier.QualificationBasis.CUMULATIVE_SPEND,
            'threshold': Decimal('0.00'),
            'berth_discount_pct': Decimal('0.00'),
            'points_multiplier': Decimal('1.00'),
            'requalification_policy': LoyaltyTier.RequalificationPolicy.PERMANENT,
        },
    )
```

Existing `PointTransaction` records from the old schema are preserved but not auto-migrated
to `PointsLedger`. To convert them:

```python
from apps.loyalty.models import PointTransaction, PointsLedger, LoyaltyMembership

REASON_TO_ENTRY_TYPE = {
    'booking_earn':  PointsLedger.EntryType.EARN,
    'referral_earn': PointsLedger.EntryType.REFERRAL,
    'bonus_earn':    PointsLedger.EntryType.EARN,
    'redemption':    PointsLedger.EntryType.REDEEM,
    'expiry':        PointsLedger.EntryType.EXPIRE,
    'admin_adjust':  PointsLedger.EntryType.ADJUST,
    'coupon_earn':   PointsLedger.EntryType.EARN,
}

for tx in PointTransaction.objects.select_related('membership').order_by('created_at'):
    PointsLedger.objects.create(
        membership=tx.membership,
        entry_type=REASON_TO_ENTRY_TYPE.get(tx.reason, PointsLedger.EntryType.ADJUST),
        points=tx.delta,
        balance_after=0,   # Cannot reconstruct running balance; set to 0 as placeholder
        description=tx.reference or tx.get_reason_display(),
        created_at=tx.created_at,
    )
```

## 3. Required `config/settings/base.py` changes

Add the following settings (DO NOT edit settings files yourself — add to base.py manually):

```python
# Track 3 — Lead scoring weights (points per signal)
LEAD_SCORE_WEIGHTS = {
    'portal_login_30d': 30,
    'email_open': 5,
    'email_opens_cap': 50,
    'booking_widget_14d': 20,
    'vessel_loa_match': 15,
}

# Track 3 — Survey token max age in seconds (default 7 days)
SURVEY_TOKEN_MAX_AGE = 60 * 60 * 24 * 7

# Track 3 — Base URL for survey links
SITE_URL = 'https://app.docksbase.com'
```

## 4. URL patterns

`config/urls.py` is not modified. New endpoints are registered inside each app's
`urls.py`. The following new URL patterns need to be added to their respective files:

### `apps/loyalty/urls.py` — add:
```python
path('loyalty/tiers/',                               views.LoyaltyTierListCreateView.as_view(),    name='loyalty-tier-list'),
path('loyalty/tiers/<int:pk>/',                      views.LoyaltyTierDetailView.as_view(),         name='loyalty-tier-detail'),
path('loyalty/memberships/<int:pk>/earn-points/',    views.EarnPointsView.as_view(),                name='loyalty-earn-points'),
path('loyalty/memberships/<int:pk>/redeem-points/',  views.RedeemPointsV2View.as_view(),            name='loyalty-redeem-points-v2'),
path('loyalty/memberships/<int:pk>/adjust-points/',  views.AdjustPointsView.as_view(),              name='loyalty-adjust-points'),
path('loyalty/referral-uses/',                       views.ReferralUseListView.as_view(),           name='loyalty-referral-use-list'),
```

### `apps/members/urls.py` — add:
```python
path('members/<int:member_id>/secondary-contacts/',  views.SecondaryContactListCreateView.as_view(), name='member-secondary-contacts'),
path('members/duplicate-flags/',                     views.DuplicateFlagListView.as_view(),          name='member-duplicate-flags'),
path('members/duplicate-flags/<int:pk>/merge/',      views.MergeMembersView.as_view(),               name='member-merge'),
path('members/duplicate-flags/<int:pk>/dismiss/',    views.DismissDuplicateFlagView.as_view(),       name='member-dismiss-flag'),
path('members/<int:member_id>/lead-score/',          views.LeadScoreView.as_view(),                  name='member-lead-score'),
path('members/<int:member_id>/surveys/',             views.SurveyResponseListView.as_view(),         name='member-surveys'),
```

### `apps/billing/urls.py` — add:
```python
path('billing/dunning-templates/',                   views.DunningTemplateListCreateView.as_view(),  name='dunning-template-list'),
path('billing/dunning-templates/<int:pk>/',          views.DunningTemplateDetailView.as_view(),      name='dunning-template-detail'),
path('billing/debt-notes/',                          views.DebtNoteListCreateView.as_view(),         name='debt-note-list'),
path('billing/dunning-letters/',                     views.DunningLetterListCreateView.as_view(),    name='dunning-letter-list'),
path('billing/dunning-letters/<int:pk>/send/',       views.SendDunningLetterView.as_view(),          name='dunning-letter-send'),
path('billing/debt-escalations/',                    views.DebtEscalationListCreateView.as_view(),   name='debt-escalation-list'),
```

## 5. Wire `apply_tier_discount` into reservations

In `apps/reservations/services.py`, after creating the invoice for a booking,
call:

```python
from apps.loyalty.services import apply_tier_discount
apply_tier_discount(booking=booking, invoice=invoice)
```

This must happen inside the same atomic transaction as invoice creation to ensure
the discount line item is consistent with the invoice.

## 6. Signal wiring

- `apps/loyalty/apps.py` already imports `apps.loyalty.signals` in `ready()` — no change needed.
- `apps/members/apps.py` now imports `apps.members.signals` in `ready()` — already updated.

Ensure `apps.members` in `INSTALLED_APPS` uses the AppConfig path:
```python
'apps.members.apps.MembersConfig',
```
or (if using default_app_config) ensure `apps/members/__init__.py` sets:
```python
default_app_config = 'apps.members.apps.MembersConfig'
```

## 7. Celery periodic tasks

Register the following in `config/celery.py` or via `django-celery-beat`:

```python
# Expire points daily at 02:00 UTC
app.conf.beat_schedule['expire-points-daily'] = {
    'task': 'apps.loyalty.tasks.expire_points_task',
    'schedule': crontab(hour=2, minute=0),
}

# Recalculate lead scores nightly at 03:00 UTC
app.conf.beat_schedule['recalculate-lead-scores-nightly'] = {
    'task': 'apps.members.tasks.recalculate_lead_scores_task',
    'schedule': crontab(hour=3, minute=0),
}

# Send checkout surveys hourly
app.conf.beat_schedule['send-checkout-surveys-hourly'] = {
    'task': 'apps.members.tasks.send_checkout_surveys_task',
    'schedule': crontab(minute=0),
}
```

Alternatively, run the management commands via cron:
```
0 2 * * * python manage.py expire_points
0 3 * * * python manage.py recalculate_lead_scores
0 * * * * python manage.py send_checkout_surveys
```
