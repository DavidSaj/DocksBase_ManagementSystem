# Marina Signup Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-app signup screen with a polished 5-step wizard on the public website that collects marina details, owner details, plan selection, and Stripe payment before creating the account — using the "Draft Account" architecture to capture incomplete signups.

**Architecture:** Steps 1–3 are pure local React state on the website. On Step 3 submit, a backend call creates a pending Marina + User + Stripe Customer + Subscription and returns a `client_secret` (SetupIntent). Step 4 renders the Stripe Payment Element. Stripe webhooks activate the account and trigger email verification. Abandoned signups are chased via an hourly cron.

**Tech Stack:** Django (backend), Stripe Python SDK, `django.core.signing.TimestampSigner`, Vite React (website), `react-router-dom`, `@stripe/react-stripe-js`, `react-google-autocomplete`, Django management command (cron)

---

## Scope Note

This plan covers the signup wizard only. The **Billing Settings Panel** (management app tab + `/api/v1/billing/` endpoints) is a separate Plan 2.

---

## File Map

**New backend files:**
- `backend/config/plans.py` — plan key → Stripe Price ID mapping
- `backend/apps/accounts/tests/__init__.py`
- `backend/apps/accounts/tests/test_draft_account.py`
- `backend/apps/accounts/tests/test_resume.py`
- `backend/apps/accounts/tests/test_signup_webhooks.py`
- `backend/apps/accounts/management/__init__.py`
- `backend/apps/accounts/management/commands/__init__.py`
- `backend/apps/accounts/management/commands/chase_pending_signups.py`

**Modified backend files:**
- `backend/apps/accounts/models.py` — add 3 fields + `pending_payment` status
- `backend/apps/accounts/serializers.py` — add `DraftAccountSerializer`
- `backend/apps/accounts/views.py` — add `DraftAccountView`, `ResumeView`
- `backend/apps/accounts/urls.py` — register 2 new paths
- `backend/apps/accounts/emails.py` — add 2 new email functions
- `backend/apps/billing/views.py` — add subscription event handlers before the `invoice_id` early-return

**New website files:**
- `website/src/config/plans.js`
- `website/src/pages/SignupPage.jsx`
- `website/src/pages/SignupPage.module.css`
- `website/src/pages/SignupSuccessPage.jsx`
- `website/src/components/signup/ProgressBar.jsx`
- `website/src/components/signup/ProgressBar.module.css`
- `website/src/components/signup/StepPlan.jsx`
- `website/src/components/signup/StepPlan.module.css`
- `website/src/components/signup/StepMarina.jsx`
- `website/src/components/signup/StepMarina.module.css`
- `website/src/components/signup/StepAccount.jsx`
- `website/src/components/signup/StepAccount.module.css`
- `website/src/components/signup/StepPayment.jsx`
- `website/src/components/signup/StepPayment.module.css`
- `website/src/components/signup/StepConfirmation.jsx`
- `website/src/components/signup/StepConfirmation.module.css`

**Modified website files:**
- `website/src/App.jsx` — add React Router + `/signup` and `/signup/success` routes
- `website/package.json` — new dependencies

**Modified management app files:**
- `frontend/src/screens/Signup.jsx` — replace with redirect

---

## Task 1: Stripe Setup (Manual — do this before any code)

These are manual steps in the Stripe Dashboard and your `.env` files. No code.

- [ ] **Step 1: Create Stripe products and prices**

  Log into [dashboard.stripe.com](https://dashboard.stripe.com). Go to **Products** → **Add product**.

  Create three products:
  | Product name | Price | Billing period | Metadata key |
  |---|---|---|---|
  | DocksBase Starter | €149.00 | Monthly | — |
  | DocksBase Professional | €349.00 | Monthly | — |
  | DocksBase Enterprise | €899.00 | Monthly | — |

  For each product, copy the **Price ID** (format: `price_xxxxxxxxxxxxx`).

- [ ] **Step 2: Register your webhook endpoint in Stripe**

  Go to **Developers → Webhooks → Add endpoint**.

  - Endpoint URL: `https://your-backend-domain/api/v1/billing/stripe/webhook/`
  - Events to listen for: `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
  - Also add to the existing endpoint if one already exists for `checkout.session.completed`.

  Copy the **Webhook Signing Secret** (`whsec_...`).

- [ ] **Step 3: Add env vars to backend `.env`**

  ```
  STRIPE_SECRET_KEY=sk_live_...        # or sk_test_... for development
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRICE_STARTER=price_...
  STRIPE_PRICE_PROFESSIONAL=price_...
  STRIPE_PRICE_ENTERPRISE=price_...
  ```

- [ ] **Step 4: Add env vars to website `.env`**

  ```
  VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...   # or pk_test_...
  VITE_STRIPE_PRICE_STARTER=price_...
  VITE_STRIPE_PRICE_PROFESSIONAL=price_...
  VITE_STRIPE_PRICE_ENTERPRISE=price_...
  VITE_API_URL=https://your-backend-domain
  VITE_GOOGLE_MAPS_API_KEY=AIza...
  ```

- [ ] **Step 5: Add env var to management frontend `.env`**

  ```
  VITE_WEBSITE_URL=https://your-website-domain
  ```

---

## Task 2: Backend — Marina Model Changes

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: migration via `makemigrations`

- [ ] **Step 1: Update the Marina model**

  Open `backend/apps/accounts/models.py`. Find the `MARINA_STATUS_CHOICES` list and the fields section. Make these two edits:

  Replace:
  ```python
  MARINA_STATUS_CHOICES = [
      ('active', 'Active'),
      ('trial', 'Trial'),
      ('suspended', 'Suspended'),
  ]
  ```
  With:
  ```python
  MARINA_STATUS_CHOICES = [
      ('pending_payment', 'Pending Payment'),
      ('trial',           'Trial'),
      ('active',          'Active'),
      ('suspended',       'Suspended'),
  ]
  ```

  Then add three new fields after the `stripe_account_id` line:
  ```python
  stripe_customer_id     = models.CharField(max_length=64, blank=True, null=True)
  stripe_subscription_id = models.CharField(max_length=64, blank=True, null=True)
  abandon_email_sent     = models.BooleanField(default=False)
  ```

- [ ] **Step 2: Generate migration**

  ```bash
  cd backend
  python manage.py makemigrations accounts --name marina_stripe_signup_fields
  ```

  Expected output: `Migrations for 'accounts': apps/accounts/migrations/0015_marina_stripe_signup_fields.py`

- [ ] **Step 3: Run migration**

  ```bash
  python manage.py migrate
  ```

  Expected: `Applying accounts.0015_marina_stripe_signup_fields... OK`

- [ ] **Step 4: Commit**

  ```bash
  git add backend/apps/accounts/models.py backend/apps/accounts/migrations/0015_marina_stripe_signup_fields.py
  git commit -m "feat(accounts): add stripe signup fields and pending_payment status to Marina"
  ```

---

## Task 3: Backend — Plan Config

**Files:**
- Create: `backend/config/plans.py`

- [ ] **Step 1: Create the plan config file**

  Create `backend/config/plans.py`:
  ```python
  import os

  PLAN_PRICE_IDS = {
      'starter':      os.environ.get('STRIPE_PRICE_STARTER', ''),
      'professional': os.environ.get('STRIPE_PRICE_PROFESSIONAL', ''),
      'enterprise':   os.environ.get('STRIPE_PRICE_ENTERPRISE', ''),
  }

  # Reverse lookup: price_id → plan key
  PRICE_ID_TO_PLAN = {v: k for k, v in PLAN_PRICE_IDS.items() if v}
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add backend/config/plans.py
  git commit -m "feat(accounts): add plan price ID config"
  ```

---

## Task 4: Backend — Draft Account Endpoint (TDD)

**Files:**
- Create: `backend/apps/accounts/tests/__init__.py`
- Create: `backend/apps/accounts/tests/test_draft_account.py`
- Modify: `backend/apps/accounts/serializers.py`
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`

- [ ] **Step 1: Create the tests directory**

  ```bash
  mkdir -p backend/apps/accounts/tests
  touch backend/apps/accounts/tests/__init__.py
  ```

- [ ] **Step 2: Write the failing tests**

  Create `backend/apps/accounts/tests/test_draft_account.py`:
  ```python
  import json
  from unittest.mock import patch, MagicMock
  from django.test import TestCase
  from rest_framework.test import APIClient
  from apps.accounts.models import Marina, User


  VALID_PAYLOAD = {
      'plan_price_id':  'price_starter_test',
      'marina_name':    'Harbour View Marina',
      'address':        '1 Dock Street, Falmouth',
      'lat':            50.152,
      'lng':            -5.065,
      'phone':          '+44 1234 567890',
      'contact_email':  'harbour@example.com',
      'vat_number':     'GB123456789',
      'currency':       'GBP',
      'first_name':     'David',
      'last_name':      'Smith',
      'email':          'david@example.com',
      'password':       'securepass1',
  }


  def _mock_stripe(price_id='price_starter_test'):
      """Return a mock that patches stripe calls in the DraftAccountView."""
      customer = MagicMock()
      customer.id = 'cus_test123'

      setup_intent = MagicMock()
      setup_intent.client_secret = 'seti_test_secret'

      subscription = MagicMock()
      subscription.id = 'sub_test123'
      subscription.pending_setup_intent = setup_intent

      mock = MagicMock()
      mock.Customer.create.return_value = customer
      mock.Subscription.create.return_value = subscription
      return mock


  class DraftAccountViewTest(TestCase):
      def setUp(self):
          self.client = APIClient()

      @patch('apps.accounts.views.stripe')
      @patch('config.plans.PLAN_PRICE_IDS', {'starter': 'price_starter_test', 'professional': 'price_pro_test', 'enterprise': 'price_ent_test'})
      def test_creates_pending_marina_and_returns_client_secret(self, mock_stripe):
          mock_stripe.Customer.create.return_value = MagicMock(id='cus_test123')
          si = MagicMock(client_secret='seti_test_secret')
          sub = MagicMock(id='sub_test123', pending_setup_intent=si)
          mock_stripe.Subscription.create.return_value = sub

          resp = self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')

          self.assertEqual(resp.status_code, 201)
          self.assertEqual(resp.data['client_secret'], 'seti_test_secret')

          marina = Marina.objects.get(name='Harbour View Marina')
          self.assertEqual(marina.status, 'pending_payment')
          self.assertEqual(marina.stripe_customer_id, 'cus_test123')
          self.assertEqual(marina.stripe_subscription_id, 'sub_test123')

          user = User.objects.get(email='david@example.com')
          self.assertFalse(user.is_active)
          self.assertEqual(user.role, 'owner')
          self.assertEqual(user.marina, marina)

      @patch('apps.accounts.views.stripe')
      @patch('config.plans.PLAN_PRICE_IDS', {'starter': 'price_starter_test'})
      def test_idempotent_for_pending_payment_email(self, mock_stripe):
          """Second call with same email returns existing client_secret without creating duplicates."""
          si = MagicMock(client_secret='seti_existing_secret')
          existing_sub = MagicMock(id='sub_existing', pending_setup_intent=si)
          mock_stripe.Customer.create.return_value = MagicMock(id='cus_test123')
          mock_stripe.Subscription.create.return_value = MagicMock(id='sub_existing', pending_setup_intent=si)
          mock_stripe.Subscription.retrieve.return_value = existing_sub

          # First call
          self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')
          marina_count = Marina.objects.count()

          # Second call — same email
          resp = self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')

          self.assertEqual(resp.status_code, 201)
          self.assertEqual(resp.data['client_secret'], 'seti_existing_secret')
          self.assertEqual(Marina.objects.count(), marina_count)  # no new marina

      def test_returns_400_for_already_active_email(self):
          marina = Marina.objects.create(name='Old Marina', status='active')
          User.objects.create_user(email='david@example.com', password='x', marina=marina, role='owner', is_active=True)

          resp = self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')

          self.assertEqual(resp.status_code, 400)
          self.assertIn('email', resp.data)

      @patch('apps.accounts.views.stripe')
      def test_returns_400_for_unknown_price_id(self, mock_stripe):
          payload = {**VALID_PAYLOAD, 'plan_price_id': 'price_unknown'}
          resp = self.client.post('/api/v1/auth/onboarding/draft/', payload, format='json')
          self.assertEqual(resp.status_code, 400)
          self.assertIn('plan_price_id', resp.data)
  ```

- [ ] **Step 3: Run tests to confirm they fail**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests.test_draft_account -v 2
  ```

  Expected: 4 failures with `ImportError` or `404 Not Found` (endpoint doesn't exist yet).

- [ ] **Step 4: Add `DraftAccountSerializer` to serializers**

  Open `backend/apps/accounts/serializers.py`. Add this class at the bottom:

  ```python
  from config.plans import PLAN_PRICE_IDS, PRICE_ID_TO_PLAN


  class DraftAccountSerializer(serializers.Serializer):
      plan_price_id  = serializers.CharField()
      marina_name    = serializers.CharField(max_length=200)
      address        = serializers.CharField()
      lat            = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
      lng            = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
      phone          = serializers.CharField(max_length=30)
      contact_email  = serializers.EmailField()
      vat_number     = serializers.CharField(max_length=50, required=False, allow_blank=True)
      currency       = serializers.ChoiceField(choices=['EUR', 'GBP', 'USD', 'DKK', 'SEK', 'NOK'])
      first_name     = serializers.CharField(max_length=150)
      last_name      = serializers.CharField(max_length=150)
      email          = serializers.EmailField()
      password       = serializers.CharField(min_length=8, write_only=True)

      def validate_plan_price_id(self, value):
          if value not in PLAN_PRICE_IDS.values():
              raise serializers.ValidationError('Invalid plan.')
          return value

      def validate_email(self, value):
          user = User.objects.filter(email=value).select_related('marina').first()
          if user and user.marina and user.marina.status in ('trial', 'active'):
              raise serializers.ValidationError(
                  'An account with this email already exists. Please log in.'
              )
          return value
  ```

  Note: `serializers` and `User` are already imported at the top of this file.

- [ ] **Step 5: Add `DraftAccountView` to views**

  Open `backend/apps/accounts/views.py`. Add these imports at the top (after existing imports):

  ```python
  import stripe
  from config.plans import PRICE_ID_TO_PLAN
  from django.conf import settings
  stripe.api_key = settings.STRIPE_SECRET_KEY
  ```

  Then add the view class (before the last class or at the bottom):

  ```python
  class DraftAccountView(APIView):
      permission_classes = [AllowAny]

      def post(self, request):
          from .serializers import DraftAccountSerializer
          ser = DraftAccountSerializer(data=request.data)
          if not ser.is_valid():
              return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

          d = ser.validated_data
          email = d['email']

          # Idempotency: return existing client_secret for pending_payment accounts
          existing_user = User.objects.filter(email=email).select_related('marina').first()
          if existing_user and existing_user.marina and existing_user.marina.status == 'pending_payment':
              sub = stripe.Subscription.retrieve(
                  existing_user.marina.stripe_subscription_id,
                  expand=['pending_setup_intent'],
              )
              return Response(
                  {'client_secret': sub.pending_setup_intent.client_secret},
                  status=status.HTTP_201_CREATED,
              )

          marina = Marina.objects.create(
              name=d['marina_name'],
              address=d['address'],
              lat=d.get('lat'),
              lng=d.get('lng'),
              phone=d['phone'],
              contact_email=d['contact_email'],
              vat_number=d.get('vat_number', ''),
              currency=d['currency'],
              status='pending_payment',
          )

          user = User.objects.create_user(
              email=email,
              password=d['password'],
              first_name=d['first_name'],
              last_name=d['last_name'],
              role='owner',
              marina=marina,
              is_active=False,
          )

          customer = stripe.Customer.create(
              email=email,
              name=d['marina_name'],
              metadata={'marina_id': str(marina.id)},
          )
          marina.stripe_customer_id = customer.id

          subscription = stripe.Subscription.create(
              customer=customer.id,
              items=[{'price': d['plan_price_id']}],
              payment_behavior='default_incomplete',
              trial_period_days=30,
              expand=['pending_setup_intent'],
              metadata={'marina_id': str(marina.id)},
          )
          marina.stripe_subscription_id = subscription.id
          marina.plan = PRICE_ID_TO_PLAN.get(d['plan_price_id'], 'professional')
          marina.save(update_fields=['stripe_customer_id', 'stripe_subscription_id', 'plan'])

          return Response(
              {'client_secret': subscription.pending_setup_intent.client_secret},
              status=status.HTTP_201_CREATED,
          )
  ```

  Make sure `AllowAny`, `Response`, `status`, `Marina`, `User`, `APIView` are already imported (they are in this file).

- [ ] **Step 6: Register the URL**

  Open `backend/apps/accounts/urls.py`. Add the import and path:

  ```python
  from .views import (
      LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView,
      SignupView, VerifyEmailView, ResendVerificationView,
      OnboardingView, ChannelSettingsView,
      DraftAccountView,                         # ← add
  )

  urlpatterns = [
      # ... existing paths ...
      path('onboarding/draft/', DraftAccountView.as_view(), name='onboarding_draft'),
  ]
  ```

- [ ] **Step 7: Run tests — confirm they pass**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests.test_draft_account -v 2
  ```

  Expected: 4 tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add backend/apps/accounts/serializers.py backend/apps/accounts/views.py \
          backend/apps/accounts/urls.py backend/apps/accounts/tests/
  git commit -m "feat(accounts): add DraftAccountView — pending marina + Stripe subscription creation"
  ```

---

## Task 5: Backend — Resume Endpoint (TDD)

**Files:**
- Create: `backend/apps/accounts/tests/test_resume.py`
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`

- [ ] **Step 1: Write failing tests**

  Create `backend/apps/accounts/tests/test_resume.py`:
  ```python
  import time
  from unittest.mock import patch, MagicMock
  from django.test import TestCase
  from django.core.signing import TimestampSigner
  from rest_framework.test import APIClient
  from apps.accounts.models import Marina, User


  def _pending_marina(email='owner@example.com'):
      marina = Marina.objects.create(
          name='Test Marina',
          status='pending_payment',
          stripe_subscription_id='sub_test_resume',
      )
      User.objects.create_user(email=email, password='x', marina=marina, role='owner', is_active=False)
      return marina


  class ResumeViewTest(TestCase):
      def setUp(self):
          self.client = APIClient()
          self.signer = TimestampSigner()

      @patch('apps.accounts.views.stripe')
      def test_valid_token_returns_client_secret(self, mock_stripe):
          marina = _pending_marina()
          si = MagicMock(client_secret='seti_resume_secret')
          mock_stripe.Subscription.retrieve.return_value = MagicMock(pending_setup_intent=si)

          token = self.signer.sign(str(marina.id))
          resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': token}, format='json')

          self.assertEqual(resp.status_code, 200)
          self.assertEqual(resp.data['client_secret'], 'seti_resume_secret')
          self.assertEqual(resp.data['marina_name'], 'Test Marina')

      def test_invalid_token_returns_400(self):
          resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': 'garbage'}, format='json')
          self.assertEqual(resp.status_code, 400)

      def test_expired_token_returns_400(self):
          marina = _pending_marina(email='exp@example.com')
          token = self.signer.sign(str(marina.id))

          with patch('apps.accounts.views.TimestampSigner') as MockSigner:
              instance = MockSigner.return_value
              from django.core.signing import SignatureExpired
              instance.unsign.side_effect = SignatureExpired('expired')
              resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': token}, format='json')

          self.assertEqual(resp.status_code, 400)

      def test_token_for_active_marina_returns_400(self):
          marina = Marina.objects.create(name='Active Marina', status='active', stripe_subscription_id='sub_x')
          User.objects.create_user(email='active@example.com', password='x', marina=marina, role='owner')
          token = self.signer.sign(str(marina.id))
          resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': token}, format='json')
          self.assertEqual(resp.status_code, 400)
  ```

- [ ] **Step 2: Run tests to confirm failure**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests.test_resume -v 2
  ```

  Expected: 4 failures (404 — endpoint not yet registered).

- [ ] **Step 3: Add `ResumeView` to views**

  Open `backend/apps/accounts/views.py`. Add import at top:
  ```python
  from django.core.signing import TimestampSigner, SignatureExpired, BadSignature
  ```

  Add the view class:
  ```python
  class ResumeView(APIView):
      permission_classes = [AllowAny]

      def post(self, request):
          token = request.data.get('token', '')
          signer = TimestampSigner()
          try:
              marina_id = signer.unsign(token, max_age=172800)  # 48 hours
          except (SignatureExpired, BadSignature):
              return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

          try:
              marina = Marina.objects.get(pk=marina_id, status='pending_payment')
          except Marina.DoesNotExist:
              return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

          sub = stripe.Subscription.retrieve(
              marina.stripe_subscription_id,
              expand=['pending_setup_intent'],
          )
          return Response({
              'client_secret': sub.pending_setup_intent.client_secret,
              'marina_name':   marina.name,
              'plan':          marina.plan,
          })
  ```

- [ ] **Step 4: Register the URL**

  Open `backend/apps/accounts/urls.py`. Add to the import and urlpatterns:
  ```python
  from .views import (
      ..., DraftAccountView, ResumeView,   # ← add ResumeView
  )

  urlpatterns = [
      # ... existing ...
      path('onboarding/draft/',  DraftAccountView.as_view(), name='onboarding_draft'),
      path('onboarding/resume/', ResumeView.as_view(),       name='onboarding_resume'),
  ]
  ```

- [ ] **Step 5: Run tests — confirm they pass**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests.test_resume -v 2
  ```

  Expected: 4 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add backend/apps/accounts/views.py backend/apps/accounts/urls.py \
          backend/apps/accounts/tests/test_resume.py
  git commit -m "feat(accounts): add ResumeView with TimestampSigner token for abandoned-cart recovery"
  ```

---

## Task 6: Backend — Stripe Subscription Webhook Handlers (TDD)

**Files:**
- Create: `backend/apps/accounts/tests/test_signup_webhooks.py`
- Modify: `backend/apps/billing/views.py`

**Critical note:** The existing `StripeWebhookView.post()` returns `HTTP 200` at line 55 if no `invoice_id` is found in the event metadata — subscription events have no `invoice_id`, so they'd be silently swallowed. We add our handlers BEFORE that early return.

- [ ] **Step 1: Write failing tests**

  Create `backend/apps/accounts/tests/test_signup_webhooks.py`:
  ```python
  import json
  from unittest.mock import patch
  from django.test import TestCase
  from rest_framework.test import APIClient
  from apps.accounts.models import Marina, User, EmailVerification


  def _make_webhook_payload(event_type, subscription_obj):
      return json.dumps({
          'type': event_type,
          'data': {'object': subscription_obj},
      }).encode()


  def _marina_with_owner(stripe_customer_id='cus_test', status='pending_payment'):
      marina = Marina.objects.create(
          name='Test Marina',
          status=status,
          stripe_customer_id=stripe_customer_id,
          stripe_subscription_id='sub_test',
      )
      User.objects.create_user(
          email='owner@example.com',
          password='x',
          marina=marina,
          role='owner',
          is_active=False,
      )
      return marina


  class SignupWebhookTest(TestCase):
      def setUp(self):
          self.client = APIClient()

      @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
      @patch('apps.accounts.emails.send_verification_email')
      def test_subscription_updated_active_activates_marina(self, mock_email, mock_construct):
          marina = _marina_with_owner()
          mock_construct.return_value = {
              'type': 'customer.subscription.updated',
              'data': {'object': {
                  'customer':   'cus_test',
                  'status':     'active',
                  'trial_end':  1893456000,  # 2030-01-01 as unix timestamp
              }},
          }

          resp = self.client.post(
              '/api/v1/billing/stripe/webhook/',
              data=b'payload',
              content_type='application/json',
              HTTP_STRIPE_SIGNATURE='sig_test',
          )

          self.assertEqual(resp.status_code, 200)
          marina.refresh_from_db()
          self.assertEqual(marina.status, 'trial')
          self.assertIsNotNone(marina.trial_ends)
          mock_email.assert_called_once()

      @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
      def test_subscription_deleted_suspends_marina(self, mock_construct):
          marina = _marina_with_owner(status='trial')
          mock_construct.return_value = {
              'type': 'customer.subscription.deleted',
              'data': {'object': {'customer': 'cus_test'}},
          }

          resp = self.client.post(
              '/api/v1/billing/stripe/webhook/',
              data=b'payload',
              content_type='application/json',
              HTTP_STRIPE_SIGNATURE='sig_test',
          )

          self.assertEqual(resp.status_code, 200)
          marina.refresh_from_db()
          self.assertEqual(marina.status, 'suspended')

      @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
      @patch('apps.accounts.emails.send_payment_failed_email')
      def test_invoice_payment_failed_emails_owner(self, mock_email, mock_construct):
          marina = _marina_with_owner(status='trial')
          mock_construct.return_value = {
              'type': 'invoice.payment_failed',
              'data': {'object': {'customer': 'cus_test'}},
          }

          resp = self.client.post(
              '/api/v1/billing/stripe/webhook/',
              data=b'payload',
              content_type='application/json',
              HTTP_STRIPE_SIGNATURE='sig_test',
          )

          self.assertEqual(resp.status_code, 200)
          mock_email.assert_called_once()
  ```

- [ ] **Step 2: Run tests to confirm failure**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests.test_signup_webhooks -v 2
  ```

  Expected: 3 failures — handlers don't exist yet.

- [ ] **Step 3: Add subscription event emails**

  Open `backend/apps/accounts/emails.py`. Add:
  ```python
  def send_payment_failed_email(user):
      send_mail(
          subject='Your DocksBase payment failed',
          message=(
              f'Hi {user.first_name or user.email},\n\n'
              'We were unable to charge your card for your DocksBase subscription.\n\n'
              f'Please update your payment details here: {settings.FRONTEND_URL}/settings/billing\n\n'
              '— The DocksBase Team'
          ),
          from_email=None,
          recipient_list=[user.email],
      )
  ```

- [ ] **Step 4: Add subscription handlers to the billing webhook view**

  Open `backend/apps/billing/views.py`. Add these imports near the top (after existing imports):
  ```python
  import datetime
  from django.utils import timezone as _tz
  from apps.accounts.models import Marina as _Marina, EmailVerification as _EmailVerification
  from apps.accounts.emails import send_verification_email as _send_verification_email
  from apps.accounts.emails import send_payment_failed_email as _send_payment_failed_email
  ```

  Then add two helper functions before `StripeWebhookView`:
  ```python
  def _handle_marina_subscription_event(event_type, obj):
      customer_id = obj.get('customer')
      try:
          marina = _Marina.objects.select_related().get(stripe_customer_id=customer_id)
      except _Marina.DoesNotExist:
          return

      if event_type == 'customer.subscription.updated' and obj.get('status') == 'active':
          trial_end_ts = obj.get('trial_end')
          trial_ends = (
              datetime.date.fromtimestamp(trial_end_ts)
              if trial_end_ts else
              (_tz.now() + datetime.timedelta(days=30)).date()
          )
          marina.status = 'trial'
          marina.trial_ends = trial_ends
          marina.save(update_fields=['status', 'trial_ends'])

          user = marina.user_set.filter(role='owner').first()
          if user and not user.is_active:
              token, _ = _EmailVerification.objects.get_or_create(user=user)
              _send_verification_email(user, str(token.token))

      elif event_type == 'customer.subscription.deleted':
          marina.status = 'suspended'
          marina.save(update_fields=['status'])


  def _handle_marina_payment_failed(obj):
      customer_id = obj.get('customer')
      try:
          marina = _Marina.objects.get(stripe_customer_id=customer_id)
      except _Marina.DoesNotExist:
          return
      user = marina.user_set.filter(role='owner').first()
      if user:
          _send_payment_failed_email(user)
  ```

  Now modify `StripeWebhookView.post()`. Find the section that starts:
  ```python
  event_type = event['type']
  obj = event['data']['object']
  invoice_id = obj.get('metadata', {}).get('invoice_id')
  if not invoice_id:
      return HttpResponse(status=200)
  ```

  Replace it with:
  ```python
  event_type = event['type']
  obj = event['data']['object']

  # Handle marina subscription lifecycle events BEFORE the invoice_id check
  if event_type in ('customer.subscription.updated', 'customer.subscription.deleted'):
      _handle_marina_subscription_event(event_type, obj)
      return HttpResponse(status=200)
  if event_type == 'invoice.payment_failed':
      _handle_marina_payment_failed(obj)
      return HttpResponse(status=200)

  invoice_id = obj.get('metadata', {}).get('invoice_id')
  if not invoice_id:
      return HttpResponse(status=200)
  ```

- [ ] **Step 5: Run tests — confirm they pass**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests.test_signup_webhooks -v 2
  ```

  Expected: 3 tests pass.

- [ ] **Step 6: Run all billing webhook tests to confirm nothing broken**

  ```bash
  cd backend
  python manage.py test apps.billing.tests.test_stripe_webhook -v 2
  ```

  Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

  ```bash
  git add backend/apps/accounts/emails.py backend/apps/billing/views.py \
          backend/apps/accounts/tests/test_signup_webhooks.py
  git commit -m "feat(billing): handle marina subscription webhooks — activate trial, suspend, payment failed"
  ```

---

## Task 7: Backend — Abandoned-Cart Cron + Emails

**Files:**
- Create: `backend/apps/accounts/management/__init__.py`
- Create: `backend/apps/accounts/management/commands/__init__.py`
- Create: `backend/apps/accounts/management/commands/chase_pending_signups.py`

- [ ] **Step 1: Add abandoned-cart email function**

  Open `backend/apps/accounts/emails.py`. Add:
  ```python
  def send_abandoned_cart_email(user, marina_name, resume_url):
      send_mail(
          subject=f'Finish setting up {marina_name} on DocksBase',
          message=(
              f'Hi {user.first_name or user.email},\n\n'
              f"Looks like you didn't finish setting up {marina_name}.\n\n"
              f'Click here to pick up where you left off:\n{resume_url}\n\n'
              'This link expires in 48 hours.\n\n'
              '— The DocksBase Team'
          ),
          from_email=None,
          recipient_list=[user.email],
      )
  ```

- [ ] **Step 2: Create management command directories**

  ```bash
  touch backend/apps/accounts/management/__init__.py
  touch backend/apps/accounts/management/commands/__init__.py
  ```

- [ ] **Step 3: Create the cron command**

  Create `backend/apps/accounts/management/commands/chase_pending_signups.py`:
  ```python
  from django.core.management.base import BaseCommand
  from django.core.signing import TimestampSigner
  from django.conf import settings
  from django.utils import timezone
  from datetime import timedelta
  from apps.accounts.models import Marina
  from apps.accounts.emails import send_abandoned_cart_email


  class Command(BaseCommand):
      help = 'Email marina owners who abandoned signup more than 2 hours ago.'

      def handle(self, *args, **options):
          cutoff = timezone.now() - timedelta(hours=2)
          pending = Marina.objects.filter(
              status='pending_payment',
              created_at__lt=cutoff,
              abandon_email_sent=False,
          ).select_related()

          signer = TimestampSigner()
          sent = 0

          for marina in pending:
              owner = marina.user_set.filter(role='owner').first()
              if not owner:
                  continue

              token = signer.sign(str(marina.id))
              website_url = getattr(settings, 'WEBSITE_URL', '')
              resume_url = f'{website_url}/signup/resume?token={token}'

              send_abandoned_cart_email(owner, marina.name, resume_url)
              marina.abandon_email_sent = True
              marina.save(update_fields=['abandon_email_sent'])
              sent += 1

          self.stdout.write(self.style.SUCCESS(f'Sent {sent} abandoned-cart email(s).'))
  ```

- [ ] **Step 4: Add `WEBSITE_URL` to settings**

  Open `backend/config/settings/base.py`. Add after `FRONTEND_URL`:
  ```python
  WEBSITE_URL = os.environ.get('WEBSITE_URL', '')
  ```

- [ ] **Step 5: Test the command manually**

  Create one pending marina in Django shell, then run:
  ```bash
  cd backend
  python manage.py chase_pending_signups
  ```
  Expected output: `Sent 1 abandoned-cart email(s).`

  Run again — expected: `Sent 0 abandoned-cart email(s).` (idempotent).

- [ ] **Step 6: Schedule the command**

  Add to your crontab (server setup, not in code):
  ```
  0 * * * * /path/to/venv/bin/python /path/to/manage.py chase_pending_signups
  ```
  (Runs every hour on the hour.)

- [ ] **Step 7: Commit**

  ```bash
  git add backend/apps/accounts/emails.py \
          backend/apps/accounts/management/ \
          backend/config/settings/base.py
  git commit -m "feat(accounts): add abandoned-cart cron command and email"
  ```

---

## Task 8: Website — Install Dependencies + Routing

**Files:**
- Modify: `website/package.json` (via npm install)
- Modify: `website/src/App.jsx`

- [ ] **Step 1: Install dependencies**

  ```bash
  cd website
  npm install react-router-dom @stripe/react-stripe-js @stripe/stripe-js react-google-autocomplete
  ```

  Expected: packages added to `node_modules`, `package.json` updated.

- [ ] **Step 2: Update `website/src/App.jsx` to add routing**

  Replace the current `App.jsx` content with:
  ```jsx
  import './index.css'
  import { useRef, useEffect } from 'react'
  import { BrowserRouter, Routes, Route } from 'react-router-dom'
  import { LanguageProvider } from './context/LanguageContext'
  import Nav from './components/Nav'
  import Hero from './components/Hero'
  import Features from './components/Features'
  import Stats from './components/Stats'
  import ProductSection from './components/ProductSection'
  import SplitSection from './components/SplitSection'
  import WhiteLabel from './components/WhiteLabel'
  import MobileApp from './components/MobileApp'
  import Pricing from './components/Pricing'
  import Faq from './components/Faq'
  import FeatureRequest from './components/FeatureRequest'
  import CTA from './components/CTA'
  import Footer from './components/Footer'
  import SignupPage from './pages/SignupPage'
  import SignupSuccessPage from './pages/SignupSuccessPage'

  function ScrollReveal({ children, delay = 0 }) {
    const ref = useRef(null)
    useEffect(() => {
      const el = ref.current
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) { el.classList.add('sr-in'); obs.unobserve(el) } },
        { threshold: 0.08 }
      )
      obs.observe(el)
      return () => obs.disconnect()
    }, [])
    return (
      <div ref={ref} className="sr" style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
        {children}
      </div>
    )
  }

  function LandingPage() {
    return (
      <>
        <Nav />
        <Hero />
        <Features />
        <Stats />
        <ProductSection />
        <SplitSection
            eyebrow="Built to Integrate"
            title="Fits your marina. Works with what you have."
            body="DocksBase is designed to slot into your existing operation — not replace it. Keep the tools your team already relies on and add DocksBase alongside them. Or run it fully standalone. Either way, you're up and running without disrupting a single season."
            checklist={[
              'No rip-and-replace — works alongside existing systems',
              'Connects with booking platforms and third-party apps',
              'Import your existing berth, vessel, and customer data',
              'Gradual rollout by department or pier at your pace',
              'Full standalone capability when you need it',
            ]}
            cta="See how it fits"
            image="/images/marina-aerial-close.jpg"
            alt="Aerial view of marina piers with boats"
          />
        <SplitSection
            eyebrow="Your Rules. Your Workflow."
            title="Manual control or smart algorithms — you decide."
            body="Some harbourmasters want full control over every berth assignment. Others want the system to handle it automatically. DocksBase supports both — switch between manual allocation and algorithmic optimisation at any time, for any pier."
            checklist={[
              'Manual mode: assign every berth yourself with full visibility',
              'Algorithmic mode: auto-assign by vessel size, draft, and stay length',
              'Sync incoming bookings from other booking platforms automatically',
              'Override algorithmic suggestions at any time',
              'Set rules per pier, per season, or per vessel type',
            ]}
            cta="Explore allocation modes"
            image="/images/marina-sailboats.jpg"
            alt="Sailboats moored in calm harbor"
            reverse
            cream
          />
        <SplitSection
            eyebrow="Complete Marina Platform"
            title="From arrival to invoice — every operation covered."
            body="DocksBase covers your full operation: live berth occupancy across all piers, a coordinated boatyard with crane schedules and work orders, and automated billing from berth fee to aged debtor. One system, one login, one source of truth."
            checklist={[
              'Real-time berth grid with walk-in and online bookings',
              'Haul-out queue, dry storage map, and work orders',
              'Automated invoices, utility billing, and fuel dock POS',
              'Aged debtor tracking with one-click chase workflow',
              'Export to CSV, PDF, XLSX or push to your accounts system',
            ]}
            cta="See the full platform"
            image="/images/marina-dock-boats.jpg"
            alt="Classic wooden boats at a dock"
          />
        <ScrollReveal><WhiteLabel /></ScrollReveal>
        <MobileApp />
        <ScrollReveal><Pricing /></ScrollReveal>
        <ScrollReveal><Faq /></ScrollReveal>
        <ScrollReveal><FeatureRequest /></ScrollReveal>
        <ScrollReveal><CTA /></ScrollReveal>
        <Footer />
      </>
    )
  }

  export default function App() {
    return (
      <BrowserRouter>
        <LanguageProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/signup/resume" element={<SignupPage resume />} />
            <Route path="/signup/success" element={<SignupSuccessPage />} />
          </Routes>
        </LanguageProvider>
      </BrowserRouter>
    )
  }
  ```

- [ ] **Step 3: Create placeholder pages so the app compiles**

  Create `website/src/pages/SignupPage.jsx`:
  ```jsx
  export default function SignupPage() {
    return <div>Signup coming soon</div>
  }
  ```

  Create `website/src/pages/SignupSuccessPage.jsx`:
  ```jsx
  export default function SignupSuccessPage() {
    return <div>Success coming soon</div>
  }
  ```

- [ ] **Step 4: Verify the app still compiles**

  ```bash
  cd website
  npm run dev
  ```

  Open `http://localhost:5173` — landing page loads. Open `http://localhost:5173/signup` — shows "Signup coming soon".

- [ ] **Step 5: Commit**

  ```bash
  git add website/package.json website/package-lock.json website/src/App.jsx \
          website/src/pages/
  git commit -m "feat(website): add react-router + Stripe + Google Places deps, wire up /signup route"
  ```

---

## Task 9: Website — Plan Config

**Files:**
- Create: `website/src/config/plans.js`

- [ ] **Step 1: Create plan config**

  Create `website/src/config/plans.js`:
  ```js
  export const PLANS = [
    {
      key:          'starter',
      name:         'Starter',
      monthlyPrice: 149,
      currency:     'EUR',
      stripePriceId: import.meta.env.VITE_STRIPE_PRICE_STARTER,
      tagline:      'For small marinas getting started',
      features: [
        'Up to 100 berths',
        'Reservations & berth map',
        'Invoicing & billing',
        'Boater portal',
      ],
    },
    {
      key:          'professional',
      name:         'Professional',
      monthlyPrice: 349,
      currency:     'EUR',
      stripePriceId: import.meta.env.VITE_STRIPE_PRICE_PROFESSIONAL,
      tagline:      'For growing marinas',
      badge:        'Most popular',
      features: [
        'Unlimited berths',
        'Everything in Starter',
        'Boatyard & work orders',
        'Staff rota & mobile app',
        'Reports & analytics',
      ],
    },
    {
      key:          'enterprise',
      name:         'Enterprise',
      monthlyPrice: 899,
      currency:     'EUR',
      stripePriceId: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE,
      tagline:      'For large marinas & groups',
      features: [
        'Everything in Professional',
        'Multi-marina management',
        'White-label mobile app',
        'Priority support & SLA',
        'Custom integrations',
      ],
    },
  ]
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add website/src/config/plans.js
  git commit -m "feat(website): add plan config"
  ```

---

## Task 10: Website — SignupPage + ProgressBar

**Files:**
- Modify: `website/src/pages/SignupPage.jsx`
- Create: `website/src/pages/SignupPage.module.css`
- Create: `website/src/components/signup/ProgressBar.jsx`
- Create: `website/src/components/signup/ProgressBar.module.css`

- [ ] **Step 1: Create ProgressBar component**

  Create `website/src/components/signup/ProgressBar.jsx`:
  ```jsx
  import styles from './ProgressBar.module.css'

  const STEP_LABELS = ['Plan', 'Marina', 'Account', 'Payment']

  export default function ProgressBar({ step }) {
    return (
      <div className={styles.bar}>
        {STEP_LABELS.map((label, i) => {
          const num = i + 1
          const done = step > num
          const active = step === num
          return (
            <div key={label} className={styles.item}>
              <div className={`${styles.circle} ${done ? styles.done : ''} ${active ? styles.active : ''}`}>
                {done
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : num}
              </div>
              <span className={`${styles.label} ${active ? styles.labelActive : ''}`}>{label}</span>
              {i < STEP_LABELS.length - 1 && <div className={`${styles.line} ${done ? styles.lineDone : ''}`} />}
            </div>
          )
        })}
      </div>
    )
  }
  ```

  Create `website/src/components/signup/ProgressBar.module.css`:
  ```css
  .bar {
    display: flex; align-items: flex-start; justify-content: center;
    gap: 0; margin-bottom: 48px;
  }
  .item { display: flex; flex-direction: column; align-items: center; position: relative; }
  .circle {
    width: 32px; height: 32px; border-radius: 50%;
    background: rgba(12,31,61,0.08); color: var(--text-muted);
    font-family: var(--font-sans); font-size: 13px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.3s, color 0.3s;
  }
  .active { background: var(--navy); color: #fff; }
  .done   { background: var(--teal); color: #fff; }
  .label  { font-size: 11px; font-weight: 500; color: var(--text-muted); margin-top: 6px; white-space: nowrap; }
  .labelActive { color: var(--navy); font-weight: 600; }
  .line {
    position: absolute; top: 16px; left: 32px;
    width: 64px; height: 2px;
    background: rgba(12,31,61,0.1);
    transition: background 0.3s;
  }
  .lineDone { background: var(--teal); }
  ```

- [ ] **Step 2: Build SignupPage skeleton**

  Replace `website/src/pages/SignupPage.jsx`:
  ```jsx
  import { useState, useEffect } from 'react'
  import { useSearchParams } from 'react-router-dom'
  import ProgressBar from '../components/signup/ProgressBar'
  import StepPlan from '../components/signup/StepPlan'
  import StepMarina from '../components/signup/StepMarina'
  import StepAccount from '../components/signup/StepAccount'
  import StepPayment from '../components/signup/StepPayment'
  import StepConfirmation from '../components/signup/StepConfirmation'
  import styles from './SignupPage.module.css'

  const API = import.meta.env.VITE_API_URL || ''

  export default function SignupPage({ resume = false }) {
    const [searchParams] = useSearchParams()
    const [step, setStep] = useState(1)
    const [form, setForm] = useState({
      plan: null,
      marinaName: '', address: '', lat: null, lng: null,
      phone: '', contactEmail: '', vatNumber: '', currency: 'EUR',
      firstName: '', lastName: '', email: '', password: '',
    })
    const [clientSecret, setClientSecret] = useState(null)
    const [apiError, setApiError] = useState(null)

    // Resume flow: token in query string → skip to step 4
    useEffect(() => {
      if (!resume) return
      const token = searchParams.get('token')
      if (!token) return
      fetch(`${API}/api/v1/auth/onboarding/resume/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.client_secret) {
            setClientSecret(data.client_secret)
            setForm(f => ({ ...f, marinaName: data.marina_name || '' }))
            setStep(4)
          }
        })
        .catch(() => {})
    }, [resume, searchParams])

    function patch(fields) { setForm(f => ({ ...f, ...fields })) }

    async function submitDraft() {
      setApiError(null)
      const body = {
        plan_price_id: form.plan.stripePriceId,
        marina_name:   form.marinaName,
        address:       form.address,
        lat:           form.lat,
        lng:           form.lng,
        phone:         form.phone,
        contact_email: form.contactEmail,
        vat_number:    form.vatNumber,
        currency:      form.currency,
        first_name:    form.firstName,
        last_name:     form.lastName,
        email:         form.email,
        password:      form.password,
      }
      const resp = await fetch(`${API}/api/v1/auth/onboarding/draft/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (!resp.ok) return data  // return errors to StepAccount
      setClientSecret(data.client_secret)
      setStep(4)
      return null
    }

    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.header}>
            <div className={styles.logo}>DocksBase</div>
            <p className={styles.sub}>Start your 30-day free trial</p>
          </div>
          {step < 5 && <ProgressBar step={step} />}
          {step === 1 && <StepPlan form={form} patch={patch} onNext={() => setStep(2)} />}
          {step === 2 && <StepMarina form={form} patch={patch} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <StepAccount form={form} patch={patch} onBack={() => setStep(2)} onSubmit={submitDraft} apiError={apiError} />}
          {step === 4 && clientSecret && <StepPayment clientSecret={clientSecret} marinaName={form.marinaName} plan={form.plan} />}
          {step === 5 && <StepConfirmation />}
        </div>
      </div>
    )
  }
  ```

  Create `website/src/pages/SignupPage.module.css`:
  ```css
  .page {
    min-height: 100vh;
    background: var(--cream);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 64px 24px;
  }
  .inner { width: 100%; max-width: 680px; }
  .header { text-align: center; margin-bottom: 48px; }
  .logo {
    font-family: var(--font-serif); font-size: 28px; font-weight: 700;
    color: var(--navy); letter-spacing: -0.5px; margin-bottom: 8px;
  }
  .sub { font-size: 15px; color: var(--text-sec); }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add website/src/pages/ website/src/components/signup/ProgressBar.jsx \
          website/src/components/signup/ProgressBar.module.css
  git commit -m "feat(website): add SignupPage skeleton and ProgressBar"
  ```

---

## Task 11: Website — Step 1: Plan Selection

**Files:**
- Create: `website/src/components/signup/StepPlan.jsx`
- Create: `website/src/components/signup/StepPlan.module.css`

- [ ] **Step 1: Create StepPlan component**

  Create `website/src/components/signup/StepPlan.jsx`:
  ```jsx
  import { PLANS } from '../../config/plans'
  import styles from './StepPlan.module.css'

  export default function StepPlan({ form, patch, onNext }) {
    return (
      <div>
        <h2 className={styles.title}>Choose your plan</h2>
        <p className={styles.sub}>All plans include a 30-day free trial. Cancel anytime.</p>
        <div className={styles.grid}>
          {PLANS.map(plan => (
            <button
              key={plan.key}
              className={`${styles.card} ${form.plan?.key === plan.key ? styles.selected : ''}`}
              onClick={() => patch({ plan })}
              type="button"
            >
              {plan.badge && <span className={styles.badge}>{plan.badge}</span>}
              <div className={styles.planName}>{plan.name}</div>
              <div className={styles.price}>
                <span className={styles.amount}>€{plan.monthlyPrice}</span>
                <span className={styles.period}>/mo</span>
              </div>
              <div className={styles.tagline}>{plan.tagline}</div>
              <ul className={styles.features}>
                {plan.features.map(f => (
                  <li key={f} className={styles.feature}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button
            className={styles.nextBtn}
            onClick={onNext}
            disabled={!form.plan}
            type="button"
          >
            Continue →
          </button>
        </div>
      </div>
    )
  }
  ```

  Create `website/src/components/signup/StepPlan.module.css`:
  ```css
  .title { font-family: var(--font-serif); font-size: clamp(26px,3vw,38px); font-weight:700; color:var(--navy); margin-bottom:8px; }
  .sub   { font-size:15px; color:var(--text-sec); margin-bottom:32px; }

  .grid  { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:32px; }
  .card  {
    position:relative; background:#fff; border:2px solid rgba(12,31,61,0.1);
    border-radius:12px; padding:24px 20px; text-align:left; cursor:pointer;
    transition:border-color 0.15s, box-shadow 0.15s;
  }
  .card:hover { border-color: var(--navy); }
  .selected  { border-color: var(--navy); box-shadow: 0 0 0 3px rgba(12,31,61,0.08); }

  .badge {
    position:absolute; top:-10px; left:50%; transform:translateX(-50%);
    background:var(--gold); color:var(--navy);
    font-family:var(--font-sans); font-size:10px; font-weight:700;
    padding:3px 10px; border-radius:999px; white-space:nowrap;
  }
  .planName { font-family:var(--font-sans); font-size:12px; font-weight:700; color:var(--text-muted); letter-spacing:2px; text-transform:uppercase; margin-bottom:12px; }
  .price    { display:flex; align-items:baseline; gap:2px; margin-bottom:6px; }
  .amount   { font-family:var(--font-serif); font-size:36px; font-weight:700; color:var(--navy); }
  .period   { font-size:13px; color:var(--text-muted); }
  .tagline  { font-size:12px; color:var(--text-sec); margin-bottom:16px; }
  .features { list-style:none; display:flex; flex-direction:column; gap:8px; }
  .feature  { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-sec); }
  .feature svg { flex-shrink:0; color:var(--teal); }

  .actions { display:flex; justify-content:flex-end; }
  .nextBtn {
    font-family:var(--font-sans); font-size:15px; font-weight:600;
    background:var(--navy); color:#fff;
    padding:12px 32px; border:none; border-radius:6px; cursor:pointer;
    transition:background 0.15s;
  }
  .nextBtn:hover:not(:disabled) { background:var(--navy-mid); }
  .nextBtn:disabled { opacity:0.4; cursor:not-allowed; }

  @media(max-width:680px) { .grid { grid-template-columns:1fr; } }
  ```

- [ ] **Step 2: Verify in browser**

  Open `http://localhost:5173/signup` — three plan cards show. Clicking one highlights it. "Continue" is disabled until a plan is selected.

- [ ] **Step 3: Commit**

  ```bash
  git add website/src/components/signup/StepPlan.jsx website/src/components/signup/StepPlan.module.css
  git commit -m "feat(website): add plan selection step"
  ```

---

## Task 12: Website — Step 2: Marina Details

**Files:**
- Create: `website/src/components/signup/StepMarina.jsx`
- Create: `website/src/components/signup/StepMarina.module.css`

- [ ] **Step 1: Create StepMarina component**

  Create `website/src/components/signup/StepMarina.jsx`:
  ```jsx
  import { useRef } from 'react'
  import Autocomplete from 'react-google-autocomplete'
  import styles from './StepMarina.module.css'

  const CURRENCIES = ['EUR', 'GBP', 'USD', 'DKK', 'SEK', 'NOK']

  export default function StepMarina({ form, patch, onBack, onNext }) {
    const valid =
      form.marinaName.trim() &&
      form.address.trim() &&
      form.phone.trim() &&
      form.contactEmail.trim() &&
      form.currency

    function handlePlaceSelected(place) {
      const lat = place.geometry?.location?.lat()
      const lng = place.geometry?.location?.lng()
      patch({
        address: place.formatted_address || '',
        lat: lat ?? null,
        lng: lng ?? null,
      })
    }

    return (
      <div>
        <h2 className={styles.title}>Your marina</h2>
        <p className={styles.sub}>Tell us about the marina you manage.</p>
        <div className={styles.form}>
          <label className={styles.label}>Marina name *</label>
          <input className={styles.input} value={form.marinaName} onChange={e => patch({ marinaName: e.target.value })} placeholder="Harbour View Marina" />

          <label className={styles.label}>Address *</label>
          <Autocomplete
            apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
            className={styles.input}
            defaultValue={form.address}
            onPlaceSelected={handlePlaceSelected}
            options={{ types: ['geocode', 'establishment'] }}
            placeholder="Start typing your marina address…"
          />

          <div className={styles.row}>
            <div>
              <label className={styles.label}>Phone *</label>
              <input className={styles.input} value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+44 1326 312345" />
            </div>
            <div>
              <label className={styles.label}>Contact email *</label>
              <input className={styles.input} type="email" value={form.contactEmail} onChange={e => patch({ contactEmail: e.target.value })} placeholder="info@yourmarina.com" />
            </div>
          </div>

          <div className={styles.row}>
            <div>
              <label className={styles.label}>VAT number</label>
              <input className={styles.input} value={form.vatNumber} onChange={e => patch({ vatNumber: e.target.value })} placeholder="GB123456789" />
            </div>
            <div>
              <label className={styles.label}>Currency *</label>
              <select className={styles.input} value={form.currency} onChange={e => patch({ currency: e.target.value })}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.backBtn} onClick={onBack} type="button">← Back</button>
          <button className={styles.nextBtn} onClick={onNext} disabled={!valid} type="button">Continue →</button>
        </div>
      </div>
    )
  }
  ```

  Create `website/src/components/signup/StepMarina.module.css`:
  ```css
  .title { font-family: var(--font-serif); font-size: clamp(26px,3vw,38px); font-weight:700; color:var(--navy); margin-bottom:8px; }
  .sub   { font-size:15px; color:var(--text-sec); margin-bottom:32px; }
  .form  { display:flex; flex-direction:column; gap:16px; margin-bottom:32px; }
  .label { font-family:var(--font-sans); font-size:12px; font-weight:600; color:var(--navy); letter-spacing:0.5px; text-transform:uppercase; display:block; margin-bottom:4px; }
  .input {
    width:100%; padding:11px 14px; font-family:var(--font-sans); font-size:15px;
    color:var(--navy); background:#fff; border:1.5px solid rgba(12,31,61,0.15);
    border-radius:6px; outline:none; transition:border-color 0.15s;
  }
  .input:focus { border-color: var(--navy); }
  .row   { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .actions { display:flex; justify-content:space-between; }
  .backBtn {
    font-family:var(--font-sans); font-size:14px; font-weight:600;
    color:var(--text-sec); background:transparent; border:none; cursor:pointer; padding:12px 0;
  }
  .nextBtn {
    font-family:var(--font-sans); font-size:15px; font-weight:600;
    background:var(--navy); color:#fff;
    padding:12px 32px; border:none; border-radius:6px; cursor:pointer; transition:background 0.15s;
  }
  .nextBtn:hover:not(:disabled) { background:var(--navy-mid); }
  .nextBtn:disabled { opacity:0.4; cursor:not-allowed; }

  @media(max-width:480px) { .row { grid-template-columns:1fr; } }
  ```

- [ ] **Step 2: Verify in browser**

  On `/signup`, select a plan, click Continue. Marina form shows with Google Places autocomplete on the address field. "Continue" is disabled until required fields are filled.

- [ ] **Step 3: Commit**

  ```bash
  git add website/src/components/signup/StepMarina.jsx website/src/components/signup/StepMarina.module.css
  git commit -m "feat(website): add marina details step with Google Places autocomplete"
  ```

---

## Task 13: Website — Step 3: Account Details + Draft API Call

**Files:**
- Create: `website/src/components/signup/StepAccount.jsx`
- Create: `website/src/components/signup/StepAccount.module.css`

- [ ] **Step 1: Create StepAccount component**

  Create `website/src/components/signup/StepAccount.jsx`:
  ```jsx
  import { useState } from 'react'
  import styles from './StepAccount.module.css'

  function PasswordStrength({ password }) {
    const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
    const colors = ['', '#e05555', '#d4b07a', '#2a9d99', '#38a860']
    if (!password) return null
    return (
      <div className={styles.strength}>
        <div className={styles.strengthBars}>
          {[1,2,3,4].map(i => (
            <div key={i} className={styles.strengthBar} style={{ background: i <= score ? colors[score] : 'rgba(12,31,61,0.1)' }} />
          ))}
        </div>
        <span style={{ color: colors[score], fontSize: 11, fontWeight: 600 }}>{labels[score]}</span>
      </div>
    )
  }

  export default function StepAccount({ form, patch, onBack, onSubmit, apiError }) {
    const [loading, setLoading] = useState(false)
    const [errors, setErrors] = useState({})

    const valid =
      form.firstName.trim() && form.lastName.trim() &&
      form.email.trim() && form.password.length >= 8

    async function handleNext() {
      setLoading(true)
      setErrors({})
      const errs = await onSubmit()
      if (errs) setErrors(errs)
      setLoading(false)
    }

    return (
      <div>
        <h2 className={styles.title}>Your account</h2>
        <p className={styles.sub}>This will be the owner account for your marina.</p>
        <div className={styles.form}>
          <div className={styles.row}>
            <div>
              <label className={styles.label}>First name *</label>
              <input className={styles.input} value={form.firstName} onChange={e => patch({ firstName: e.target.value })} placeholder="David" />
            </div>
            <div>
              <label className={styles.label}>Last name *</label>
              <input className={styles.input} value={form.lastName} onChange={e => patch({ lastName: e.target.value })} placeholder="Smith" />
            </div>
          </div>
          <div>
            <label className={styles.label}>Email address *</label>
            <input className={`${styles.input} ${errors.email ? styles.inputError : ''}`} type="email" value={form.email} onChange={e => patch({ email: e.target.value })} placeholder="you@yourmarina.com" />
            {errors.email && <p className={styles.fieldError}>{Array.isArray(errors.email) ? errors.email[0] : errors.email}</p>}
          </div>
          <div>
            <label className={styles.label}>Password * (min. 8 characters)</label>
            <input className={`${styles.input} ${errors.password ? styles.inputError : ''}`} type="password" value={form.password} onChange={e => patch({ password: e.target.value })} placeholder="••••••••" />
            <PasswordStrength password={form.password} />
            {errors.password && <p className={styles.fieldError}>{Array.isArray(errors.password) ? errors.password[0] : errors.password}</p>}
          </div>
        </div>
        {apiError && <p className={styles.apiError}>{apiError}</p>}
        <div className={styles.actions}>
          <button className={styles.backBtn} onClick={onBack} type="button" disabled={loading}>← Back</button>
          <button className={styles.nextBtn} onClick={handleNext} disabled={!valid || loading} type="button">
            {loading ? 'Setting up…' : 'Continue →'}
          </button>
        </div>
      </div>
    )
  }
  ```

  Create `website/src/components/signup/StepAccount.module.css`:
  ```css
  .title { font-family: var(--font-serif); font-size: clamp(26px,3vw,38px); font-weight:700; color:var(--navy); margin-bottom:8px; }
  .sub   { font-size:15px; color:var(--text-sec); margin-bottom:32px; }
  .form  { display:flex; flex-direction:column; gap:16px; margin-bottom:32px; }
  .row   { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .label { font-family:var(--font-sans); font-size:12px; font-weight:600; color:var(--navy); letter-spacing:0.5px; text-transform:uppercase; display:block; margin-bottom:4px; }
  .input {
    width:100%; padding:11px 14px; font-family:var(--font-sans); font-size:15px;
    color:var(--navy); background:#fff; border:1.5px solid rgba(12,31,61,0.15);
    border-radius:6px; outline:none; transition:border-color 0.15s;
  }
  .input:focus { border-color: var(--navy); }
  .inputError { border-color: #e05555; }
  .fieldError { font-size:12px; color:#e05555; margin-top:4px; }
  .apiError   { font-size:13px; color:#e05555; margin-bottom:16px; }

  .strength { display:flex; align-items:center; gap:8px; margin-top:6px; }
  .strengthBars { display:flex; gap:4px; }
  .strengthBar  { width:36px; height:4px; border-radius:2px; transition:background 0.2s; }

  .actions { display:flex; justify-content:space-between; }
  .backBtn {
    font-family:var(--font-sans); font-size:14px; font-weight:600;
    color:var(--text-sec); background:transparent; border:none; cursor:pointer; padding:12px 0;
  }
  .nextBtn {
    font-family:var(--font-sans); font-size:15px; font-weight:600;
    background:var(--navy); color:#fff;
    padding:12px 32px; border:none; border-radius:6px; cursor:pointer; transition:background 0.15s;
    min-width:140px;
  }
  .nextBtn:hover:not(:disabled) { background:var(--navy-mid); }
  .nextBtn:disabled { opacity:0.4; cursor:not-allowed; }

  @media(max-width:480px) { .row { grid-template-columns:1fr; } }
  ```

- [ ] **Step 2: Verify in browser**

  Fill in steps 1–2, reach step 3. Fill in account details, click "Continue". Button shows "Setting up…" spinner, then (if backend is running) advances to step 4.

- [ ] **Step 3: Commit**

  ```bash
  git add website/src/components/signup/StepAccount.jsx website/src/components/signup/StepAccount.module.css
  git commit -m "feat(website): add account details step with API call and password strength indicator"
  ```

---

## Task 14: Website — Step 4: Stripe Payment Element

**Files:**
- Create: `website/src/components/signup/StepPayment.jsx`
- Create: `website/src/components/signup/StepPayment.module.css`

- [ ] **Step 1: Create StepPayment component**

  Create `website/src/components/signup/StepPayment.jsx`:
  ```jsx
  import { useState, useMemo } from 'react'
  import { loadStripe } from '@stripe/stripe-js'
  import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
  import styles from './StepPayment.module.css'

  const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

  const WEBSITE_URL = import.meta.env.VITE_WEBSITE_URL || window.location.origin

  function PaymentForm({ marinaName, plan }) {
    const stripe = useStripe()
    const elements = useElements()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    async function handleSubmit(e) {
      e.preventDefault()
      if (!stripe || !elements) return
      setLoading(true)
      setError(null)

      const { error: stripeError } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${WEBSITE_URL}/signup/success`,
        },
      })

      if (stripeError) {
        setError(stripeError.message)
        setLoading(false)
      }
      // On success, Stripe redirects to return_url — no further action needed here
    }

    return (
      <form onSubmit={handleSubmit}>
        <div className={styles.summary}>
          <span className={styles.summaryMarina}>{marinaName || 'Your marina'}</span>
          {plan && (
            <span className={styles.summaryPlan}>
              {plan.name} — €{plan.monthlyPrice}/mo after trial
            </span>
          )}
        </div>
        <div className={styles.elementWrap}>
          <PaymentElement />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.submitBtn} type="submit" disabled={loading || !stripe}>
          {loading ? 'Processing…' : 'Start 30-day free trial →'}
        </button>
        <p className={styles.note}>Your card won't be charged during the trial. Cancel anytime.</p>
      </form>
    )
  }

  export default function StepPayment({ clientSecret, marinaName, plan }) {
    const options = useMemo(() => ({
      clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#0c1f3d',
          colorBackground: '#ffffff',
          fontFamily: 'Jost, system-ui, sans-serif',
          borderRadius: '6px',
        },
      },
    }), [clientSecret])

    return (
      <div>
        <h2 className={styles.title}>Payment details</h2>
        <p className={styles.sub}>Your card will not be charged until your 30-day trial ends.</p>
        <Elements stripe={stripePromise} options={options}>
          <PaymentForm marinaName={marinaName} plan={plan} />
        </Elements>
      </div>
    )
  }
  ```

  Create `website/src/components/signup/StepPayment.module.css`:
  ```css
  .title { font-family: var(--font-serif); font-size: clamp(26px,3vw,38px); font-weight:700; color:var(--navy); margin-bottom:8px; }
  .sub   { font-size:15px; color:var(--text-sec); margin-bottom:32px; }

  .summary {
    display:flex; justify-content:space-between; align-items:center;
    background:rgba(12,31,61,0.04); border:1px solid rgba(12,31,61,0.1);
    border-radius:8px; padding:14px 16px; margin-bottom:24px;
  }
  .summaryMarina { font-size:14px; font-weight:600; color:var(--navy); }
  .summaryPlan   { font-size:13px; color:var(--text-sec); }

  .elementWrap { margin-bottom:20px; }

  .submitBtn {
    width:100%; font-family:var(--font-sans); font-size:16px; font-weight:600;
    background:var(--navy); color:#fff;
    padding:14px; border:none; border-radius:6px; cursor:pointer; transition:background 0.15s;
    margin-bottom:12px;
  }
  .submitBtn:hover:not(:disabled) { background:var(--navy-mid); }
  .submitBtn:disabled { opacity:0.4; cursor:not-allowed; }

  .error { font-size:13px; color:#e05555; margin-bottom:12px; }
  .note  { font-size:12px; color:var(--text-muted); text-align:center; }
  ```

  **Note on `confirmSetup` vs `confirmPayment`:** We use `stripe.confirmSetup()` because the subscription uses a SetupIntent (not a PaymentIntent) during the free trial. The `return_url` must be absolute — Stripe will redirect here on success.

- [ ] **Step 2: Verify in browser (Stripe test mode)**

  With `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` set, reach step 4. Stripe's Payment Element renders. Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC. Click "Start 30-day free trial". Stripe redirects to `/signup/success`.

- [ ] **Step 3: Commit**

  ```bash
  git add website/src/components/signup/StepPayment.jsx website/src/components/signup/StepPayment.module.css
  git commit -m "feat(website): add Stripe Payment Element step — SetupIntent for trial subscription"
  ```

---

## Task 15: Website — Step 5: Confirmation + Success Page

**Files:**
- Create: `website/src/components/signup/StepConfirmation.jsx`
- Create: `website/src/components/signup/StepConfirmation.module.css`
- Modify: `website/src/pages/SignupSuccessPage.jsx`

- [ ] **Step 1: Create StepConfirmation component**

  Create `website/src/components/signup/StepConfirmation.jsx`:
  ```jsx
  import styles from './StepConfirmation.module.css'

  export default function StepConfirmation() {
    return (
      <div className={styles.wrap}>
        <div className={styles.icon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <h2 className={styles.title}>Check your inbox</h2>
        <p className={styles.body}>
          We've sent a verification email to your address. Click the link inside to activate your account and access DocksBase.
        </p>
        <p className={styles.note}>Didn't get it? Check your spam folder. It may take a minute or two.</p>
      </div>
    )
  }
  ```

  Create `website/src/components/signup/StepConfirmation.module.css`:
  ```css
  .wrap  { text-align:center; padding: 32px 0; }
  .icon  {
    width:72px; height:72px; border-radius:50%;
    background:rgba(26,107,110,0.1); color:var(--teal);
    display:flex; align-items:center; justify-content:center;
    margin:0 auto 24px;
  }
  .title { font-family:var(--font-serif); font-size:clamp(26px,3vw,38px); font-weight:700; color:var(--navy); margin-bottom:12px; }
  .body  { font-size:16px; color:var(--text-sec); line-height:1.65; max-width:420px; margin:0 auto 16px; }
  .note  { font-size:13px; color:var(--text-muted); }
  ```

- [ ] **Step 2: Build SignupSuccessPage (landing point after Stripe redirect)**

  Replace `website/src/pages/SignupSuccessPage.jsx`:
  ```jsx
  import StepConfirmation from '../components/signup/StepConfirmation'
  import styles from './SignupPage.module.css'

  export default function SignupSuccessPage() {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.header}>
            <div className={styles.logo}>DocksBase</div>
          </div>
          <StepConfirmation />
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 3: Verify end-to-end**

  Complete all 4 steps with test card. Stripe redirects to `/signup/success`. Confirmation screen shows "Check your inbox".

- [ ] **Step 4: Commit**

  ```bash
  git add website/src/components/signup/StepConfirmation.jsx \
          website/src/components/signup/StepConfirmation.module.css \
          website/src/pages/SignupSuccessPage.jsx
  git commit -m "feat(website): add confirmation step and success page"
  ```

---

## Task 16: Management App — Replace Signup with Redirect

**Files:**
- Modify: `frontend/src/screens/Signup.jsx`

- [ ] **Step 1: Replace signup screen with redirect**

  Open `frontend/src/screens/Signup.jsx`. Replace the entire file content with:
  ```jsx
  import { useEffect } from 'react'

  export default function Signup() {
    useEffect(() => {
      window.location.href = `${import.meta.env.VITE_WEBSITE_URL || ''}/signup`
    }, [])
    return null
  }
  ```

- [ ] **Step 2: Verify**

  Start the management frontend dev server. Navigate to `/signup`. Browser should redirect to the website's `/signup` URL.

  ```bash
  cd frontend
  npm run dev
  ```

  Open `http://localhost:5174/signup` (or whatever port) — should redirect immediately to the website signup.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/screens/Signup.jsx
  git commit -m "feat(frontend): redirect /signup to website signup wizard"
  ```

---

## Task 17: Final Integration Test

- [ ] **Step 1: Run all backend tests**

  ```bash
  cd backend
  python manage.py test apps.accounts.tests apps.billing.tests -v 2
  ```

  Expected: all tests pass.

- [ ] **Step 2: End-to-end smoke test**

  With backend + website both running:
  1. Open `http://localhost:5173/signup`
  2. Select Professional plan
  3. Fill in marina details (address autocomplete fills lat/lng)
  4. Fill in account details, click "Continue" — backend creates pending Marina + User + Stripe Customer + Subscription
  5. Stripe Payment Element renders with test key
  6. Enter test card `4242 4242 4242 4242`, exp `12/34`, CVC `123`
  7. Click "Start 30-day free trial"
  8. Stripe redirects to `/signup/success` — confirmation screen shows
  9. In Stripe Dashboard (test mode), trigger `customer.subscription.updated` webhook — Marina status flips to `trial`, verification email fires
  10. Check email — verification link arrives
  11. Click verification link — management app opens, user is logged in

- [ ] **Step 3: Push and create PR**

  ```bash
  git push -u origin feature/marina-signup-wizard
  gh pr create --title "feat: marina signup wizard with Stripe trial subscription" \
    --body "5-step signup wizard on public website. Draft Account architecture — pending Marina created at step 3, Stripe SetupIntent returned, Payment Element in step 4. Webhooks activate trial + send verification email. Abandoned-cart cron chases pending signups hourly."
  ```

---

## Plan 2 (Separate)

The **Billing Settings Panel** (management app settings tab + `GET/POST /api/v1/billing/` endpoints) is not included in this plan. It can be built independently after this plan ships, as the data it needs (`stripe_subscription_id`, `stripe_customer_id`) is now stored on the Marina model.
