from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsPlatformAdmin(BasePermission):
    """Allows access only to users with is_platform_admin=True."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_platform_admin
        )


class IsSafeModeReadOnly(BasePermission):
    """
    When a JWT contains is_safe_mode=True, only GET/HEAD/OPTIONS are permitted.
    Blocks POST/PATCH/PUT/DELETE and returns 403 with a clear message.
    Added to DRF DEFAULT_PERMISSION_CLASSES so it applies to every view.
    """
    message = 'Action blocked: Safe Mode is active.'

    def has_permission(self, request, view):
        token = request.auth
        # Only JWT tokens (dicts / AccessToken objects) carry is_safe_mode.
        # API keys and other non-JWT auth tokens lack .get() — skip the check.
        if token and callable(getattr(token, 'get', None)):
            if token.get('is_safe_mode'):
                return request.method in SAFE_METHODS
        return True
