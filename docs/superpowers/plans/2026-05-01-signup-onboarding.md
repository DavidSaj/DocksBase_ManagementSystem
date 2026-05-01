# Sign-Up & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow marina operators to self-register at `/signup`, verify their email, and be guided through initial setup via a backend-enforced checklist card on the dashboard.

**Architecture:** New Django endpoints (signup, verify-email, resend, onboarding GET/PATCH) + post_save signal for invite_staff auto-complete + four new React screens/components wired through existing AuthContext and api.js patterns.

**Tech Stack:** Django DRF, SimpleJWT, Django cache framework (LocMemCache, no config needed for dev), React + Vite, existing design system CSS classes.

---

## File Map

**Backend — create:**
- `backend/apps/accounts/emails.py` — SMTP stub functions
- `backend/apps/accounts/signals.py` — post_save signal for invite_staff auto-complete

**Backend — modify:**
- `backend/apps/accounts/models.py` — add `EmailVerification` model, `onboarding` JSONField on Marina
- `backend/apps/accounts/serializers.py` — add `SignupSerializer`; update `DocksBaseTokenSerializer.validate()` for `email_not_verified`
- `backend/apps/accounts/views.py` — add `SignupView`, `VerifyEmailView`, `ResendVerificationView`, `OnboardingView`
- `backend/apps/accounts/urls.py` — add 4 new URL patterns
- `backend/apps/accounts/apps.py` — register signals in `ready()`
- `backend/apps/accounts/tests.py` — all backend tests
- `backend/config/settings/base.py` — verify `FRONTEND_URL` present

**Frontend — create:**
- `frontend/src/screens/Signup.jsx`
- `frontend/src/screens/VerifyEmail.jsx`
- `frontend/src/hooks/useOnboarding.js`
- `frontend/src/components/onboarding/SetupGuide.jsx`
- `frontend/src/components/onboarding/StripeGateModal.jsx`

**Frontend — modify:**
- `frontend/src/api.js` — add `signup`, `verifyEmail`, `resendVerification`, `getOnboarding`, `patchOnboarding`
- `frontend/src/App.jsx` — add `/signup` and `/verify-email` routes
- `frontend/src/screens/Login.jsx` — signup link + `email_not_verified` error message
- `frontend/src/screens/Overview.jsx` — mount `<SetupGuide>`
- `frontend/src/screens/Operations.jsx` — gate booking-mode toggle behind `StripeGateModal`

---

### Task 1: EmailVerification model + Marina.onboarding field

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Modify: `backend/apps/accounts/tests.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/apps/accounts/tests.py` and add at the top (after existing imports):

```python
import uuid
from apps.accounts.models import EmailVerification
```

Add this test class after `OperationsPausedTest`:

```python
class EmailVerificationModelTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='owner@test.com', password='pass',
            marina=self.marina, is_active=False
        )

    def test_email_verification_created(self):
        ev = EmailVerification.objects.create(user=self.user)
        self.assertIsNotNone(ev.token)
        self.assertIsInstance(ev.token, uuid.UUID)

    def test_email_verification_one_to_one(self):
        EmailVerification.objects.create(user=self.user)
        with self.assertRaises(Exception):
            EmailVerification.objects.create(user=self.user)

    def test_marina_onboarding_default(self):
        marina = Marina.objects.create(name='New Marina')
        self.assertEqual(marina.onboarding, {
            'draw_map': False,
            'set_pricing': False,
            'connect_bank': False,
            'invite_staff': False,
        })
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd backend
python manage.py test apps.accounts.tests.EmailVerificationModelTest --verbosity=2
```

Expected: `ImportError: cannot import name 'EmailVerification'`

- [ ] **Step 3: Add EmailVerification model and onboarding field**

Open `backend/apps/accounts/models.py`. Add `import uuid as _uuid` is already there. Add after the `MagicToken` class:

```python
class EmailVerification(models.Model):
    user       = models.OneToOneField(User, on_delete=models.CASCADE, related_name='email_verification')
    token      = models.UUIDField(default=_uuid.uuid4, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"EmailVerification({self.user.email})"
```

In the `Marina` model, add this field after the `features` field (around line 41):

```python
    onboarding = models.JSONField(default=dict)
```

Also add this function above the `Marina` class (before line 7):

```python
def _default_onboarding():
    return {
        'draw_map': False,
        'set_pricing': False,
        'connect_bank': False,
        'invite_staff': False,
    }
```

Then change the `onboarding` field to:

```python
    onboarding = models.JSONField(default=_default_onboarding)
```

- [ ] **Step 4: Create and run migration**

```bash
cd backend
python manage.py makemigrations accounts
python manage.py migrate
```

Expected: migration created and applied with no errors.

- [ ] **Step 5: Run tests to confirm pass**

```bash
python manage.py test apps.accounts.tests.EmailVerificationModelTest --verbosity=2
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/ backend/apps/accounts/tests.py
git commit -m "feat(accounts): add EmailVerification model and Marina.onboarding field"
```

---

### Task 2: emails.py stub + verify FRONTEND_URL

**Files:**
- Create: `backend/apps/accounts/emails.py`
- Verify: `backend/config/settings/base.py`

- [ ] **Step 1: Verify FRONTEND_URL is in settings**

```bash
grep "FRONTEND_URL" backend/config/settings/base.py
```

Expected: `FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')`

If that line is missing, open `backend/config/settings/base.py` and add it after the `DEBUG` line:

```python
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
```

- [ ] **Step 2: Write the failing test**

Add to `backend/apps/accounts/tests.py`:

```python
from apps.accounts.emails import send_verification_email, send_welcome_email

class EmailStubTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='stub@test.com', password='pass', marina=self.marina
        )

    def test_send_verification_email_does_not_raise(self):
        import uuid
        token = uuid.uuid4()
        # Should print to stdout but not raise
        send_verification_email(self.user, token)

    def test_send_welcome_email_does_not_raise(self):
        send_welcome_email(self.user)
```

Run:
```bash
python manage.py test apps.accounts.tests.EmailStubTest --verbosity=2
```
Expected: `ImportError: cannot import name 'send_verification_email'`

- [ ] **Step 3: Create emails.py**

Create `backend/apps/accounts/emails.py`:

```python
from django.conf import settings


def send_verification_email(user, token):
    """
    FUTURE: Implement with SendGrid or django-ses.
    Send to:   user.email
    Subject:   "Confirm your DocksBase account"
    Body:      Absolute link to /verify-email?token={token}

    SMTP checklist (when ready):
    - Add EMAIL_BACKEND, EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD to Railway env
    - Set DEFAULT_FROM_EMAIL = "noreply@docksbase.com" in settings
    - Replace print() below with django.core.mail.send_mail() or provider SDK
    - Call send_welcome_email(user) from VerifyEmailView on successful verification
    """
    url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    print(f"[EMAIL STUB] Verification link for {user.email}: {url}")


def send_welcome_email(user):
    """
    FUTURE: Send after email is verified.
    Subject: "Welcome to DocksBase"
    Body:    Getting-started tips, link to the setup guide.
    """
    print(f"[EMAIL STUB] Welcome email for {user.email}")
```

- [ ] **Step 4: Run tests**

```bash
python manage.py test apps.accounts.tests.EmailStubTest --verbosity=2
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounts/emails.py backend/config/settings/base.py backend/apps/accounts/tests.py
git commit -m "feat(accounts): add email stub functions with absolute FRONTEND_URL"
```

---

### Task 3: SignupSerializer + SignupView + URL

**Files:**
- Modify: `backend/apps/accounts/serializers.py`
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`
- Modify: `backend/apps/accounts/tests.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/apps/accounts/tests.py`:

```python
import datetime

class SignupViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_signup_creates_marina_and_user(self):
        resp = self.client.post('/api/v1/auth/signup/', {
            'first_name': 'Anna', 'last_name': 'Schmidt',
            'email': 'anna@marina.com', 'password': 'securepass123',
            'marina_name': 'Port de Vidy',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIn('detail', resp.data)

        user = User.objects.get(email='anna@marina.com')
        self.assertFalse(user.is_active)
        self.assertEqual(user.role, 'owner')
        self.assertEqual(user.first_name, 'Anna')

        marina = user.marina
        self.assertEqual(marina.name, 'Port de Vidy')
        self.assertEqual(marina.status, 'trial')
        self.assertEqual(marina.plan, 'professional')
        self.assertIsNotNone(marina.trial_ends)
        self.assertEqual(marina.trial_ends, datetime.date.today() + datetime.timedelta(days=30))

    def test_signup_creates_email_verification_token(self):
        self.client.post('/api/v1/auth/signup/', {
            'first_name': 'Anna', 'last_name': 'Schmidt',
            'email': 'anna2@marina.com', 'password': 'securepass123',
            'marina_name': 'Test Port',
        }, format='json')
        user = User.objects.get(email='anna2@marina.com')
        self.assertTrue(hasattr(user, 'email_verification'))

    def test_signup_duplicate_email_returns_400(self):
        Marina.objects.create(name='Existing')
        User.objects.create_user(email='taken@marina.com', password='pass')
        resp = self.client.post('/api/v1/auth/signup/', {
            'first_name': 'Bob', 'last_name': 'Jones',
            'email': 'taken@marina.com', 'password': 'pass2',
            'marina_name': 'Another Port',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.data)

    def test_signup_requires_all_fields(self):
        resp = self.client.post('/api/v1/auth/signup/', {
            'email': 'incomplete@marina.com',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
```

Run:
```bash
python manage.py test apps.accounts.tests.SignupViewTest --verbosity=2
```
Expected: all fail with 404 (URL not found yet).

- [ ] **Step 2: Add SignupSerializer**

Open `backend/apps/accounts/serializers.py`. Add after the `ExchangeMagicTokenSerializer` class:

```python
class SignupSerializer(serializers.Serializer):
    first_name  = serializers.CharField(max_length=100)
    last_name   = serializers.CharField(max_length=100)
    email       = serializers.EmailField()
    password    = serializers.CharField(min_length=8, write_only=True)
    marina_name = serializers.CharField(max_length=200)

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value
```

- [ ] **Step 3: Add SignupView**

Open `backend/apps/accounts/views.py`. Add these imports at the top with the existing imports:

```python
import datetime
import uuid
from django.db import transaction
from django.core.cache import cache
from .emails import send_verification_email, send_welcome_email
from .serializers import (
    MarinaSerializer, UserSerializer, UserInviteSerializer,
    DocksBaseTokenSerializer, SendMagicLinkSerializer,
    ExchangeMagicTokenSerializer, SignupSerializer,
)
from .models import Marina, User, MagicToken, EmailVerification
```

Then add this view (before `LoginView`):

```python
class SignupView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = SignupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        with transaction.atomic():
            marina = Marina.objects.create(
                name=d['marina_name'],
                status='trial',
                plan='professional',
                trial_ends=datetime.date.today() + datetime.timedelta(days=30),
            )
            user = User.objects.create_user(
                email=d['email'],
                password=d['password'],
                first_name=d['first_name'],
                last_name=d['last_name'],
                role='owner',
                is_active=False,
                marina=marina,
            )
            token = uuid.uuid4()
            EmailVerification.objects.create(user=user, token=token)

        send_verification_email(user, token)
        return Response(
            {'detail': 'Check your email to confirm your account.'},
            status=status.HTTP_201_CREATED,
        )
```

- [ ] **Step 4: Add URL**

Open `backend/apps/accounts/urls.py`. Add the import and URL:

```python
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from .views import (
    LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView,
    SignupView,
)

urlpatterns = [
    path('token/',             LoginView.as_view(),           name='token_obtain'),
    path('token/refresh/',     TokenRefreshView.as_view(),    name='token_refresh'),
    path('token/verify/',      TokenVerifyView.as_view(),     name='token_verify'),
    path('me/',                MeView.as_view(),              name='me'),
    path('magic/send/',        SendMagicLinkView.as_view(),   name='magic_send'),
    path('magic/exchange/',    ExchangeMagicTokenView.as_view(), name='magic_exchange'),
    path('signup/',            SignupView.as_view(),          name='signup'),
]
```

- [ ] **Step 5: Run tests**

```bash
python manage.py test apps.accounts.tests.SignupViewTest --verbosity=2
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounts/serializers.py backend/apps/accounts/views.py backend/apps/accounts/urls.py backend/apps/accounts/tests.py
git commit -m "feat(accounts): add SignupView — creates marina + inactive user + email verification token"
```

---

### Task 4: VerifyEmailView

**Files:**
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`
- Modify: `backend/apps/accounts/tests.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/apps/accounts/tests.py`:

```python
from django.utils import timezone as tz

class VerifyEmailViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='verify@test.com', password='pass',
            marina=self.marina, is_active=False
        )
        self.ev = EmailVerification.objects.create(user=self.user)

    def test_verify_activates_user_and_returns_jwt(self):
        resp = self.client.get(f'/api/v1/auth/verify-email/?token={self.ev.token}')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.data)
        self.assertIn('refresh', resp.data)
        self.assertIn('user', resp.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_verify_deletes_token_after_use(self):
        self.client.get(f'/api/v1/auth/verify-email/?token={self.ev.token}')
        self.assertFalse(EmailVerification.objects.filter(pk=self.ev.pk).exists())

    def test_verify_invalid_token_returns_400(self):
        resp = self.client.get('/api/v1/auth/verify-email/?token=00000000-0000-0000-0000-000000000000')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Invalid or expired link.')

    def test_verify_expired_token_returns_400(self):
        self.ev.created_at = tz.now() - datetime.timedelta(hours=25)
        self.ev.save()
        resp = self.client.get(f'/api/v1/auth/verify-email/?token={self.ev.token}')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Invalid or expired link.')
```

Run:
```bash
python manage.py test apps.accounts.tests.VerifyEmailViewTest --verbosity=2
```
Expected: all fail with 404.

- [ ] **Step 2: Add VerifyEmailView**

Open `backend/apps/accounts/views.py`. Add after `SignupView`:

```python
class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        token = request.query_params.get('token')
        if not token:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ev = EmailVerification.objects.select_related('user').get(token=token)
        except (EmailVerification.DoesNotExist, ValueError):
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        if timezone.now() - ev.created_at > timedelta(hours=24):
            ev.delete()
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        user = ev.user
        user.is_active = True
        user.save(update_fields=['is_active'])
        ev.delete()

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        })
```

- [ ] **Step 3: Add URL**

Open `backend/apps/accounts/urls.py`. Add `VerifyEmailView` to imports and urlpatterns:

```python
from .views import (
    LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView,
    SignupView, VerifyEmailView,
)

urlpatterns = [
    path('token/',             LoginView.as_view(),              name='token_obtain'),
    path('token/refresh/',     TokenRefreshView.as_view(),       name='token_refresh'),
    path('token/verify/',      TokenVerifyView.as_view(),        name='token_verify'),
    path('me/',                MeView.as_view(),                 name='me'),
    path('magic/send/',        SendMagicLinkView.as_view(),      name='magic_send'),
    path('magic/exchange/',    ExchangeMagicTokenView.as_view(), name='magic_exchange'),
    path('signup/',            SignupView.as_view(),              name='signup'),
    path('verify-email/',      VerifyEmailView.as_view(),        name='verify_email'),
]
```

- [ ] **Step 4: Run tests**

```bash
python manage.py test apps.accounts.tests.VerifyEmailViewTest --verbosity=2
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounts/views.py backend/apps/accounts/urls.py backend/apps/accounts/tests.py
git commit -m "feat(accounts): add VerifyEmailView — activates user and issues JWT on token exchange"
```

---

### Task 5: ResendVerificationView + 60s rate limit

**Files:**
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`
- Modify: `backend/apps/accounts/tests.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/apps/accounts/tests.py`:

```python
from django.core.cache import cache

class ResendVerificationViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='resend@test.com', password='pass',
            marina=self.marina, is_active=False
        )
        EmailVerification.objects.create(user=self.user)
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_resend_creates_new_token(self):
        old_token = self.user.email_verification.token
        resp = self.client.post('/api/v1/auth/resend-verification/', {
            'email': 'resend@test.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        new_ev = EmailVerification.objects.get(user=self.user)
        self.assertNotEqual(new_ev.token, old_token)

    def test_resend_rate_limit_60s(self):
        self.client.post('/api/v1/auth/resend-verification/', {'email': 'resend@test.com'}, format='json')
        resp = self.client.post('/api/v1/auth/resend-verification/', {'email': 'resend@test.com'}, format='json')
        self.assertEqual(resp.status_code, 429)

    def test_resend_unknown_email_returns_200(self):
        resp = self.client.post('/api/v1/auth/resend-verification/', {
            'email': 'nobody@nowhere.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_resend_already_active_returns_200(self):
        self.user.is_active = True
        self.user.save()
        resp = self.client.post('/api/v1/auth/resend-verification/', {
            'email': 'resend@test.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
```

Run:
```bash
python manage.py test apps.accounts.tests.ResendVerificationViewTest --verbosity=2
```
Expected: all fail with 404.

- [ ] **Step 2: Add ResendVerificationView**

Open `backend/apps/accounts/views.py`. Add after `VerifyEmailView`:

```python
class ResendVerificationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = request.data.get('email', '')

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response({'detail': 'Verification email resent.'})

        if user.is_active:
            return Response({'detail': 'Verification email resent.'})

        cache_key = f'resend_verification:{email}'
        if cache.get(cache_key):
            return Response(
                {'detail': 'Please wait 60 seconds before requesting another email.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        EmailVerification.objects.filter(user=user).delete()
        token = uuid.uuid4()
        EmailVerification.objects.create(user=user, token=token)
        send_verification_email(user, token)
        cache.set(cache_key, True, timeout=60)

        return Response({'detail': 'Verification email resent.'})
```

- [ ] **Step 3: Add URL**

Open `backend/apps/accounts/urls.py`. Add `ResendVerificationView` to imports and urlpatterns:

```python
from .views import (
    LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView,
    SignupView, VerifyEmailView, ResendVerificationView,
)

urlpatterns = [
    path('token/',                  LoginView.as_view(),                  name='token_obtain'),
    path('token/refresh/',          TokenRefreshView.as_view(),           name='token_refresh'),
    path('token/verify/',           TokenVerifyView.as_view(),            name='token_verify'),
    path('me/',                     MeView.as_view(),                     name='me'),
    path('magic/send/',             SendMagicLinkView.as_view(),          name='magic_send'),
    path('magic/exchange/',         ExchangeMagicTokenView.as_view(),     name='magic_exchange'),
    path('signup/',                 SignupView.as_view(),                  name='signup'),
    path('verify-email/',           VerifyEmailView.as_view(),            name='verify_email'),
    path('resend-verification/',    ResendVerificationView.as_view(),     name='resend_verification'),
]
```

- [ ] **Step 4: Run tests**

```bash
python manage.py test apps.accounts.tests.ResendVerificationViewTest --verbosity=2
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounts/views.py backend/apps/accounts/urls.py backend/apps/accounts/tests.py
git commit -m "feat(accounts): add ResendVerificationView with 60s rate limit"
```

---

### Task 6: email_not_verified error in DocksBaseTokenSerializer

**Files:**
- Modify: `backend/apps/accounts/serializers.py`
- Modify: `backend/apps/accounts/tests.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/apps/accounts/tests.py`:

```python
class LoginUnverifiedTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='unverified@test.com', password='rightpass',
            marina=self.marina, is_active=False
        )

    def test_unverified_login_returns_email_not_verified_code(self):
        resp = self.client.post('/api/v1/auth/token/', {
            'email': 'unverified@test.com',
            'password': 'rightpass',
        }, format='json')
        # Should be 401 with custom code, not the generic credentials error
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data.get('code'), 'email_not_verified')

    def test_wrong_password_does_not_return_email_not_verified(self):
        # Active user with wrong password should NOT get email_not_verified
        active_user = User.objects.create_user(
            email='active@test.com', password='correct',
            marina=self.marina, is_active=True
        )
        resp = self.client.post('/api/v1/auth/token/', {
            'email': 'active@test.com',
            'password': 'wrong',
        }, format='json')
        self.assertEqual(resp.status_code, 401)
        self.assertNotEqual(resp.data.get('code'), 'email_not_verified')
```

Run:
```bash
python manage.py test apps.accounts.tests.LoginUnverifiedTest --verbosity=2
```
Expected: `test_unverified_login_returns_email_not_verified_code` fails (no `code` key in response).

- [ ] **Step 2: Update DocksBaseTokenSerializer**

Open `backend/apps/accounts/serializers.py`. Add this import at the top:

```python
from rest_framework_simplejwt.exceptions import AuthenticationFailed
```

Replace the existing `DocksBaseTokenSerializer` class entirely:

```python
class DocksBaseTokenSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['is_platform_admin'] = user.is_platform_admin
        token['role'] = user.role
        return token

    def validate(self, attrs):
        email = attrs.get('email', '')
        try:
            user = User.objects.get(email=email)
            if not user.is_active:
                raise AuthenticationFailed({
                    'code': 'email_not_verified',
                    'detail': 'Please verify your email before logging in.',
                })
        except User.DoesNotExist:
            pass
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data
```

- [ ] **Step 3: Run tests**

```bash
python manage.py test apps.accounts.tests.LoginUnverifiedTest --verbosity=2
```

Expected: 2 tests pass.

- [ ] **Step 4: Run all accounts tests to confirm nothing regressed**

```bash
python manage.py test apps.accounts --verbosity=2
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounts/serializers.py backend/apps/accounts/tests.py
git commit -m "feat(accounts): surface email_not_verified code on login for unactivated accounts"
```

---

### Task 7: OnboardingView + invite_staff signal

**Files:**
- Create: `backend/apps/accounts/signals.py`
- Modify: `backend/apps/accounts/apps.py`
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`
- Modify: `backend/apps/accounts/tests.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/apps/accounts/tests.py`:

```python
class OnboardingViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='owner@test.com', password='pass',
            marina=self.marina, role='owner'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_get_onboarding_returns_dict(self):
        resp = self.client.get('/api/v1/auth/marina/onboarding/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('draw_map', resp.data)
        self.assertIn('set_pricing', resp.data)
        self.assertIn('connect_bank', resp.data)
        self.assertIn('invite_staff', resp.data)

    def test_patch_draw_map_and_set_pricing(self):
        resp = self.client.patch('/api/v1/auth/marina/onboarding/', {
            'draw_map': True,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['draw_map'])

    def test_patch_connect_bank_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/onboarding/', {
            'connect_bank': True,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_invite_staff_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/onboarding/', {
            'invite_staff': True,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_invite_staff_signal_fires_when_second_user_added(self):
        User.objects.create_user(
            email='staff@test.com', password='pass',
            marina=self.marina, role='staff', is_active=True
        )
        self.marina.refresh_from_db()
        self.assertTrue(self.marina.onboarding.get('invite_staff'))

    def test_invite_staff_signal_does_not_fire_for_boater(self):
        User.objects.create_user(
            email='boater@test.com', password='pass',
            marina=self.marina, role='boater', is_active=True
        )
        self.marina.refresh_from_db()
        self.assertFalse(self.marina.onboarding.get('invite_staff'))
```

Run:
```bash
python manage.py test apps.accounts.tests.OnboardingViewTest --verbosity=2
```
Expected: all fail with 404 or signal-related errors.

- [ ] **Step 2: Create signals.py**

Create `backend/apps/accounts/signals.py`:

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import User


@receiver(post_save, sender=User)
def auto_complete_invite_staff(sender, instance, **kwargs):
    if not instance.marina_id:
        return
    if instance.role == 'boater':
        return
    if not instance.is_active:
        return

    marina = instance.marina
    if marina.onboarding.get('invite_staff'):
        return  # already done, no-op

    count = User.objects.filter(
        marina=marina,
        is_active=True,
    ).exclude(role='boater').count()

    if count >= 2:
        marina.onboarding = {**marina.onboarding, 'invite_staff': True}
        marina.save(update_fields=['onboarding'])
```

- [ ] **Step 3: Register signal in apps.py**

Open `backend/apps/accounts/apps.py`. If it doesn't exist, create it. The file should be:

```python
from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.accounts'

    def ready(self):
        import apps.accounts.signals  # noqa
```

Check `backend/apps/accounts/__init__.py`. It should contain (or be empty — if empty, add):

```python
default_app_config = 'apps.accounts.apps.AccountsConfig'
```

- [ ] **Step 4: Add OnboardingView**

Open `backend/apps/accounts/views.py`. Add after `ResendVerificationView`:

```python
class OnboardingView(APIView):
    permission_classes = [IsMarinaStaff]
    PROTECTED_KEYS = {'connect_bank', 'invite_staff'}
    ALLOWED_KEYS   = {'draw_map', 'set_pricing'}

    def _get_onboarding(self, marina):
        defaults = {
            'draw_map': False, 'set_pricing': False,
            'connect_bank': False, 'invite_staff': False,
        }
        return {**defaults, **marina.onboarding}

    def get(self, request):
        return Response(self._get_onboarding(request.user.marina))

    def patch(self, request):
        invalid = set(request.data.keys()) & self.PROTECTED_KEYS
        if invalid:
            return Response(
                {'detail': 'connect_bank and invite_staff are controlled by backend signals only.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        marina = request.user.marina
        current = self._get_onboarding(marina)
        for key in self.ALLOWED_KEYS:
            if key in request.data:
                current[key] = bool(request.data[key])
        marina.onboarding = current
        marina.save(update_fields=['onboarding'])
        return Response(current)
```

- [ ] **Step 5: Add URL**

Open `backend/apps/accounts/urls.py`. Add `OnboardingView` to imports and urlpatterns:

```python
from .views import (
    LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView,
    SignupView, VerifyEmailView, ResendVerificationView, OnboardingView,
)

urlpatterns = [
    path('token/',                  LoginView.as_view(),                  name='token_obtain'),
    path('token/refresh/',          TokenRefreshView.as_view(),           name='token_refresh'),
    path('token/verify/',           TokenVerifyView.as_view(),            name='token_verify'),
    path('me/',                     MeView.as_view(),                     name='me'),
    path('magic/send/',             SendMagicLinkView.as_view(),          name='magic_send'),
    path('magic/exchange/',         ExchangeMagicTokenView.as_view(),     name='magic_exchange'),
    path('signup/',                 SignupView.as_view(),                  name='signup'),
    path('verify-email/',           VerifyEmailView.as_view(),            name='verify_email'),
    path('resend-verification/',    ResendVerificationView.as_view(),     name='resend_verification'),
    path('marina/onboarding/',      OnboardingView.as_view(),             name='onboarding'),
]
```

- [ ] **Step 6: Run all onboarding tests**

```bash
python manage.py test apps.accounts.tests.OnboardingViewTest --verbosity=2
```

Expected: 6 tests pass.

- [ ] **Step 7: Run the full accounts test suite**

```bash
python manage.py test apps.accounts --verbosity=2
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/accounts/signals.py backend/apps/accounts/apps.py backend/apps/accounts/views.py backend/apps/accounts/urls.py backend/apps/accounts/tests.py
git commit -m "feat(accounts): add OnboardingView with PATCH lock + invite_staff post_save signal"
```

---

### Task 8: Frontend api.js — new auth + onboarding functions

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add the five new functions**

Open `frontend/src/api.js`. After the `sendMagicLink` function (around line 88) and before `export default api;`, add:

```js
export async function signup(firstName, lastName, email, password, marinaName) {
  const { data } = await api.post('/auth/signup/', {
    first_name: firstName,
    last_name: lastName,
    email,
    password,
    marina_name: marinaName,
  });
  return data;
}

export async function verifyEmail(token) {
  const { data } = await api.get(`/auth/verify-email/?token=${token}`);
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data.user;
}

export async function resendVerification(email) {
  const { data } = await api.post('/auth/resend-verification/', { email });
  return data;
}

export async function getOnboarding() {
  const { data } = await api.get('/auth/marina/onboarding/');
  return data;
}

export async function patchOnboarding(updates) {
  const { data } = await api.patch('/auth/marina/onboarding/', updates);
  return data;
}
```

- [ ] **Step 2: Verify the file is still valid JS**

```bash
cd frontend
npm run build 2>&1 | head -20
```

Expected: build completes (or only fails on unrelated things — not api.js syntax errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(frontend): add signup, verifyEmail, resendVerification, getOnboarding, patchOnboarding to api.js"
```

---

### Task 9: Signup.jsx screen

**Files:**
- Create: `frontend/src/screens/Signup.jsx`

- [ ] **Step 1: Create the file**

Create `frontend/src/screens/Signup.jsx`:

```jsx
import { useState } from 'react';
import { signup, resendVerification } from '../api.js';

export default function Signup() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', marinaName: '',
  });
  const [errors, setErrors]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Resend state
  const [resendLoading, setResendLoading]   = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setLoading(true);
    try {
      await signup(form.firstName, form.lastName, form.email, form.password, form.marinaName);
      setConfirmed(true);
    } catch (err) {
      const data = err.response?.data || {};
      if (typeof data === 'object') {
        setErrors(data);
      } else {
        setErrors({ non_field_errors: ['Something went wrong. Please try again.'] });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendLoading(true);
    try {
      await resendVerification(form.email);
    } catch { /* ignore */ } finally {
      setResendLoading(false);
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown(c => {
          if (c <= 1) { clearInterval(interval); return 0; }
          return c - 1;
        });
      }, 1000);
    }
  }

  if (confirmed) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="22"/>
              <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
            </svg>
            <span className="login-brand">DockBase</span>
          </div>
          <h2 className="login-title">Check your inbox</h2>
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20, lineHeight: 1.5 }}>
            We sent a confirmation link to <strong>{form.email}</strong>. Click it to activate your account.
          </p>
          <button
            type="button"
            className="abtn abtn-primary login-submit"
            onClick={handleResend}
            disabled={resendLoading || resendCooldown > 0}
          >
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : resendLoading ? 'Sending…' : 'Resend email'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DockBase</span>
        </div>

        <h2 className="login-title">Create your marina</h2>

        <form onSubmit={handleSubmit} className="login-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="login-field">
              <label className="login-label">First name</label>
              <input type="text" className="login-input" value={form.firstName} onChange={set('firstName')} required />
              {errors.first_name && <p className="login-error">{errors.first_name[0]}</p>}
            </div>
            <div className="login-field">
              <label className="login-label">Last name</label>
              <input type="text" className="login-input" value={form.lastName} onChange={set('lastName')} required />
              {errors.last_name && <p className="login-error">{errors.last_name[0]}</p>}
            </div>
          </div>

          <div className="login-field">
            <label className="login-label">Marina name</label>
            <input type="text" className="login-input" value={form.marinaName} onChange={set('marinaName')} placeholder="e.g. Port de Vidy" required />
            {errors.marina_name && <p className="login-error">{errors.marina_name[0]}</p>}
          </div>

          <div className="login-field">
            <label className="login-label">Email</label>
            <input type="email" className="login-input" value={form.email} onChange={set('email')} placeholder="you@example.com" required />
            {errors.email && <p className="login-error">{errors.email[0]}</p>}
          </div>

          <div className="login-field">
            <label className="login-label">Password</label>
            <input type="password" className="login-input" value={form.password} onChange={set('password')} placeholder="At least 8 characters" required minLength={8} />
            {errors.password && <p className="login-error">{errors.password[0]}</p>}
          </div>

          {errors.non_field_errors && (
            <p className="login-error">{errors.non_field_errors[0]}</p>
          )}

          <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 16 }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--navy)', textDecoration: 'none', fontWeight: 600 }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/Signup.jsx
git commit -m "feat(frontend): add Signup.jsx screen with confirmation state and resend countdown"
```

---

### Task 10: VerifyEmail.jsx screen

**Files:**
- Create: `frontend/src/screens/VerifyEmail.jsx`

- [ ] **Step 1: Create the file**

Create `frontend/src/screens/VerifyEmail.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyEmail } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmail() {
  const [searchParams]    = useSearchParams();
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  const navigate          = useNavigate();
  const { signIn }        = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      return;
    }
    verifyEmail(token)
      .then(user => {
        signIn(user);
        navigate('/', { replace: true });
      })
      .catch(() => setStatus('error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DockBase</span>
        </div>

        {status === 'loading' && (
          <>
            <h2 className="login-title">Verifying your email…</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', textAlign: 'center' }}>Just a moment.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="login-title">Link expired</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20, lineHeight: 1.5, textAlign: 'center' }}>
              This verification link has expired or is invalid.
            </p>
            <a href="/signup" className="abtn abtn-primary login-submit" style={{ textAlign: 'center', display: 'block' }}>
              Back to sign up
            </a>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/VerifyEmail.jsx
git commit -m "feat(frontend): add VerifyEmail.jsx — exchanges token, signs user in, redirects to app"
```

---

### Task 11: App.jsx routes + Login.jsx signup link & unverified error

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/screens/Login.jsx`

- [ ] **Step 1: Add routes to App.jsx**

Open `frontend/src/App.jsx`. Add imports for the two new screens after the existing screen imports:

```jsx
import Signup      from './screens/Signup.jsx';
import VerifyEmail from './screens/VerifyEmail.jsx';
```

In the `<Routes>` block, add these two routes **before** the `/login` route:

```jsx
<Route path="/signup"       element={<Signup />} />
<Route path="/verify-email" element={<VerifyEmail />} />
```

The full Routes block becomes:

```jsx
<Routes>
  <Route path="/signup"       element={<Signup />} />
  <Route path="/verify-email" element={<VerifyEmail />} />
  <Route path="/login"        element={<Login />} />
  <Route path="/magic"        element={<MagicLink />} />
  <Route path="/portal"       element={<ProtectedRoute element={<BoaterPortal />} allowedRoles={['boater']} />} />
  <Route path="/field"        element={<ProtectedRoute element={<Field />}        allowedRoles={['staff', 'owner', 'manager']} />} />
  <Route path="/*"            element={<ProtectedRoute element={<DesktopApp />}   allowedRoles={['owner', 'manager']} />} />
</Routes>
```

- [ ] **Step 2: Update Login.jsx**

Open `frontend/src/screens/Login.jsx`. Replace the entire file with:

```jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login, resendVerification } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const ROLE_HOME = { boater: '/portal', staff: '/field', owner: '/', manager: '/' };

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setLoading(true);
    try {
      const user = await login(email, password);
      signIn(user);
      navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'email_not_verified') {
        setUnverified(true);
      } else {
        setError('Incorrect email or password.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    try {
      await resendVerification(email);
      setResendSent(true);
    } catch { /* ignore */ }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DockBase</span>
        </div>

        <h2 className="login-title">Sign in</h2>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">Email</label>
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div className="login-field">
            <label className="login-label">Password</label>
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          {unverified && (
            <div style={{ background: '#fff8e7', border: '1px solid #f0c040', borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5 }}>
              Please verify your email before logging in.{' '}
              {resendSent
                ? <span style={{ color: '#38a860', fontWeight: 600 }}>Verification email sent!</span>
                : <button type="button" onClick={handleResend} style={{ background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12 }}>Resend verification email</button>
              }
            </div>
          )}

          <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 16 }}>
          Don't have an account?{' '}
          <Link to="/signup" style={{ color: 'var(--navy)', textDecoration: 'none', fontWeight: 600 }}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and manually verify**

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173/signup` — form should render.
Open `http://localhost:5173/login` — "Don't have an account? Sign up" link should appear at the bottom.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/screens/Login.jsx
git commit -m "feat(frontend): add /signup and /verify-email routes; Login shows email_not_verified message"
```

---

### Task 12: useOnboarding.js hook

**Files:**
- Create: `frontend/src/hooks/useOnboarding.js`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useOnboarding.js`:

```js
import { useState, useEffect } from 'react';
import { getOnboarding, patchOnboarding } from '../api.js';

export default function useOnboarding() {
  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    getOnboarding()
      .then(data => setOnboarding(data))
      .catch(() => setOnboarding(null))
      .finally(() => setLoading(false));
  }, []);

  async function markStep(key) {
    // Optimistic update
    setOnboarding(prev => prev ? { ...prev, [key]: true } : prev);
    try {
      const updated = await patchOnboarding({ [key]: true });
      setOnboarding(updated);
    } catch {
      // Revert on failure
      setOnboarding(prev => prev ? { ...prev, [key]: false } : prev);
    }
  }

  const allDone = onboarding
    ? Object.values(onboarding).every(Boolean)
    : false;

  return { onboarding, loading, markStep, allDone };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useOnboarding.js
git commit -m "feat(frontend): add useOnboarding hook"
```

---

### Task 13: StripeGateModal.jsx

**Files:**
- Create: `frontend/src/components/onboarding/StripeGateModal.jsx`

StripeGateModal has no internal dependencies — create it first so Task 14 (SetupGuide) can import it without a broken-module error.

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p frontend/src/components/onboarding
```

Create `frontend/src/components/onboarding/StripeGateModal.jsx`:

```jsx
export default function StripeGateModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 10, padding: 28,
          width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0c1f3d', marginBottom: 8 }}>
          Connect your bank account
        </div>
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6, marginBottom: 20 }}>
          To accept online payments, DocksBase needs to know where to send your money.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Stripe Connect coming soon"
            style={{ flex: 1, opacity: 0.5, cursor: 'not-allowed' }}
          >
            Connect via Stripe
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/onboarding/StripeGateModal.jsx
git commit -m "feat(frontend): add StripeGateModal — disabled Stripe Connect gate stub"
```

---

### Task 14: SetupGuide.jsx component + wire Operations.jsx Stripe gate

**Files:**
- Create: `frontend/src/components/onboarding/SetupGuide.jsx`
- Modify: `frontend/src/screens/Operations.jsx`

- [ ] **Step 1: Create SetupGuide.jsx**

Create `frontend/src/components/onboarding/SetupGuide.jsx`:

```jsx
import useOnboarding from '../../hooks/useOnboarding.js';
import StripeGateModal from './StripeGateModal.jsx';
import { useState } from 'react';

const CheckFilled = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="8" fill="#38a860"/>
    <polyline points="4,8 7,11 12,5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const CheckEmpty = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5"/>
  </svg>
);

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

export default function SetupGuide({ setScreen }) {
  const { onboarding, loading, markStep, allDone } = useOnboarding();
  const [stripeModalOpen, setStripeModalOpen] = useState(false);

  if (loading || !onboarding || allDone) return null;

  const steps = [
    {
      key: 'draw_map',
      label: 'Draw your marina map',
      action: () => { markStep('draw_map'); setScreen('map'); },
      manual: true,
    },
    {
      key: 'set_pricing',
      label: 'Set your pricing',
      action: () => { markStep('set_pricing'); setScreen('billing'); },
      manual: true,
    },
    {
      key: 'connect_bank',
      label: 'Connect bank account',
      action: () => setStripeModalOpen(true),
      manual: false,
    },
    {
      key: 'invite_staff',
      label: 'Invite your first team member',
      action: () => setScreen('staff'),
      manual: false,
    },
  ];

  const completed = steps.filter(s => onboarding[s.key]).length;

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header" style={{ alignItems: 'center' }}>
          <div>
            <div className="card-header-title">Get started with DocksBase</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{completed} of 4 complete</div>
          </div>
          <div style={{ flex: 1, marginLeft: 16, height: 4, background: 'rgba(0,0,0,0.08)', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              borderRadius: 2,
              background: 'var(--navy)',
              width: `${(completed / 4) * 100}%`,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
        <div className="card-body" style={{ padding: '4px 0' }}>
          {steps.map(step => {
            const done = !!onboarding[step.key];
            return (
              <button
                key={step.key}
                type="button"
                onClick={done ? undefined : step.action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: 'var(--border)',
                  cursor: done ? 'default' : 'pointer',
                  textAlign: 'left',
                  opacity: done ? 0.45 : 1,
                }}
              >
                {done ? <CheckFilled /> : <CheckEmpty />}
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: done ? 'line-through' : 'none',
                  color: 'rgba(0,0,0,0.75)',
                }}>
                  {step.label}
                </span>
                {!done && <Chevron />}
              </button>
            );
          })}
        </div>
      </div>

      <StripeGateModal open={stripeModalOpen} onClose={() => setStripeModalOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Commit SetupGuide**

```bash
git add frontend/src/components/onboarding/SetupGuide.jsx
git commit -m "feat(frontend): add SetupGuide onboarding card component"
```

- [ ] **Step 3: Wire StripeGateModal into Operations.jsx**

Open `frontend/src/screens/Operations.jsx`. Search for where `booking_mode` is set:

```bash
grep -n "booking_mode\|auto_tetris\|autoBooking\|online.book" frontend/src/screens/Operations.jsx
```

The result will show you the exact line. The toggle/button handler that enables auto-bookings needs to be gated. Add this import at the top of Operations.jsx (after existing imports):

```jsx
import StripeGateModal from '../components/onboarding/StripeGateModal.jsx';
```

Add modal state inside the component function, near the top:

```jsx
const [stripeModalOpen, setStripeModalOpen] = useState(false);
```

Locate the handler that switches `booking_mode` to `'auto_tetris'`. It will look something like `onChange`, `onClick`, or `handleToggle`. Wrap it so it intercepts when `stripe_account_id` is missing. The marina object in this file is fetched from the API — look for a `useMarina`, `marina`, or `profile` variable near the top of the component. The gate wrapper pattern is:

```jsx
// Before the existing handler fires, add:
if (!marina?.stripe_account_id) {
  setStripeModalOpen(true);
  return;  // don't proceed to the real booking_mode update
}
```

Add the modal in the JSX return, as the last child before the closing `</div>` of the component root:

```jsx
<StripeGateModal open={stripeModalOpen} onClose={() => setStripeModalOpen(false)} />
```

- [ ] **Step 4: Start dev server and verify**

```bash
cd frontend && npm run dev
```

Navigate to Operations screen. Click the auto-bookings toggle/button. The StripeGateModal should appear with a disabled "Connect via Stripe" button and a working Cancel button that dismisses it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/SetupGuide.jsx frontend/src/screens/Operations.jsx
git commit -m "feat(frontend): wire Stripe gate into Operations booking toggle"
```

---

### Task 15: Wire SetupGuide into Overview.jsx

**Files:**
- Modify: `frontend/src/screens/Overview.jsx`

- [ ] **Step 1: Add import**

Open `frontend/src/screens/Overview.jsx`. Add at the top with the other imports:

```jsx
import SetupGuide from '../components/onboarding/SetupGuide.jsx';
```

- [ ] **Step 2: Mount the component**

In the `return` block of `Overview`, add `<SetupGuide setScreen={setScreen} />` as the first child inside the outermost `<div>`, before the `<div className="stat-row">`:

```jsx
return (
  <div>
    <SetupGuide setScreen={setScreen} />

    <div className="stat-row">
      {/* ... existing stat cards ... */}
    </div>
    {/* ... rest of Overview ... */}
  </div>
);
```

- [ ] **Step 3: Verify in browser**

With dev server running, log in as a new marina owner (or force the onboarding field to have some `false` values via Django admin). Confirm the SetupGuide card appears above the stat row with the correct steps and progress bar. Confirm it disappears when all four steps are `true`.

- [ ] **Step 4: Run the full backend test suite one final time**

```bash
cd backend && python manage.py test --verbosity=0
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/Overview.jsx
git commit -m "feat(frontend): mount SetupGuide onboarding card in Overview dashboard"
```
