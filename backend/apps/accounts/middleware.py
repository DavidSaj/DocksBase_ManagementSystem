from django.conf import settings
from django.http import JsonResponse
from apps.accounts.models import Marina


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug   = request.META.get('HTTP_X_MARINA_SLUG',   '').strip()
        domain = request.META.get('HTTP_X_MARINA_DOMAIN', '').strip()

        if slug:
            try:
                request.tenant = Marina.objects.get(slug=slug)
            except Marina.DoesNotExist:
                return JsonResponse({'error': 'Marina not found.'}, status=404)
        elif domain:
            try:
                request.tenant = Marina.objects.get(custom_domain=domain)
            except Marina.DoesNotExist:
                return JsonResponse({'error': 'Marina not found.'}, status=404)
        else:
            request.tenant = None

        return self.get_response(request)


# ── Billing-gate middleware ──────────────────────────────────────────────────
# Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md §A.5

# Path prefixes that are ALWAYS allowed regardless of billing state.
# These are critical to keep open even when marina is in `cancelled`:
#   - boater portal (Trap 3 — never block inbound payments)
#   - subscription self-service (needed to fix the billing situation)
#   - admin portal (platform admins must still be able to override)
#   - auth endpoints (login refusal handled separately by the login view)
#   - Stripe webhooks themselves
_ALWAYS_ALLOWED_PREFIXES = (
    '/api/v1/billing/stripe/webhook/',
    '/api/v1/billing/stripe/connect-webhook/',
    '/api/v1/billing/subscription/',
    '/api/v1/billing/invoices/',           # boater Stripe Connect invoice payment
    '/api/v1/billing/refunds/',
    '/api/v1/auth/',
    '/api/v1/accounts/',
    '/api/v1/portal/',                     # boater portal — Trap 3
    '/api/v1/public/',                     # boater public — Trap 3
    '/api/v1/admin/',                      # platform admin portal
)

# Path prefixes that mutate marina state — these are blocked from `restricted`
# upwards. Implementation-level defence in depth; serializer guards remain
# the authoritative line for known mutation endpoints.
_MUTATION_PREFIXES = (
    '/api/v1/reservations/',
    '/api/v1/bookings/',
    '/api/v1/berths/',
    '/api/v1/communications/',
    '/api/v1/marketplace/',
    '/api/v1/charter/',
)

# Billing states in which staff make-NEW-stuff endpoints are blocked.
_BLOCKED_STATES_MUTATION = {'restricted', 'suspended', 'cancelled'}
# Billing states in which login is refused / all marina-app access denied.
_BLOCKED_STATES_FULL = {'suspended', 'cancelled'}


def _billing_block_response(marina):
    return JsonResponse(
        {
            'error': 'marina_billing_blocked',
            'billing_state': marina.billing_state,
            'grace_until': (
                marina.billing_grace_until.isoformat()
                if marina.billing_grace_until else None
            ),
            'contact': 'billing@docksbase.com',
        },
        status=402,
    )


class BillingGateMiddleware:
    """
    Enforces marina.billing_state at the request layer.

    Bypasses (in order):
      1. Master kill-switch: settings.BILLING_GATE_ENABLED == False.
      2. Path on the always-allowed list (boater payments, admin portal,
         subscription self-service, auth, Stripe webhook).
      3. Marina is on a manual contract.
      4. Active admin override.

    Otherwise inspects `marina.billing_state` and `marina.status` (legacy
    backwards-compat: existing `status='suspended'` still blocks). Mutation
    endpoints are blocked from `restricted` upwards; everything else only at
    `suspended` / `cancelled`.

    TRAP 3: Boater portal & subscription self-service routes are in the
    always-allowed list, so they remain accessible at every state.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = getattr(settings, 'BILLING_GATE_ENABLED', True)

    def __call__(self, request):
        if not self.enabled:
            return self.get_response(request)

        path = request.path or ''
        if any(path.startswith(p) for p in _ALWAYS_ALLOWED_PREFIXES):
            return self.get_response(request)

        marina = (
            getattr(getattr(request, 'user', None), 'marina', None)
            or getattr(request, 'tenant', None)
        )
        if marina is None:
            return self.get_response(request)

        # Bypass: manual contract.
        if getattr(marina, 'manual_contract', False):
            return self.get_response(request)
        # Bypass: active admin override.
        if getattr(marina, 'billing_admin_override_active', False):
            return self.get_response(request)

        # Backwards-compat — legacy Marina.status='suspended' still blocks.
        legacy_suspended = (getattr(marina, 'status', '') == 'suspended')

        state = getattr(marina, 'billing_state', 'current') or 'current'

        if state in _BLOCKED_STATES_FULL or legacy_suspended:
            return _billing_block_response(marina)

        # Mutation paths blocked from `restricted` upwards.
        if state in _BLOCKED_STATES_MUTATION and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if any(path.startswith(p) for p in _MUTATION_PREFIXES):
                return _billing_block_response(marina)

        return self.get_response(request)
