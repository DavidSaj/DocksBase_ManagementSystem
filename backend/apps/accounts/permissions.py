from rest_framework.permissions import BasePermission

# Maps URL path segments to the module key used in User.module_permissions.
# Only paths whose first segment (after /api/v1/) appears here are gated.
# Paths not listed are always allowed.
_PATH_TO_MODULE = {
    'bookings':          'reservations',
    'booking-requests':  'reservations',
    'reservations':      'reservations',
    'berths':            'map',
    'piers':             'map',
    'logical-piers':     'map',
    'map':               'map',
    'ota-connections':   'map',
    'amenities':         'map',
    'vessels':           'vessels',
    'members':           'members',
    'billing':           'billing',
    'maintenance':       'maintenance',
    'boatyard':          'boatyard',
    'documents':         'documents',
    'reports':           'reports',
    'sales':             'sales',
    'staff':             'staff',
    'fuel-dock':         'sales',
}


def _module_for_path(path: str) -> str | None:
    """Return the module key for a request path, or None if unrestricted."""
    # Strip /api/v1/ prefix and grab the first path segment
    stripped = path.lstrip('/')
    for prefix in ('api/v1/', 'api/'):
        if stripped.startswith(prefix):
            stripped = stripped[len(prefix):]
            break
    segment = stripped.split('/')[0]
    return _PATH_TO_MODULE.get(segment)


class ModulePermission(BasePermission):
    """
    Enforces User.module_permissions for staff-role users.

    - Owners, managers, platform admins: always allowed.
    - Staff: allowed unless module_permissions[module] is explicitly False.
    - Empty module_permissions dict → all modules allowed (default).
    - Paths not mapped to any module → allowed (safe default).
    - Boaters are not marina staff and should be blocked by IsMarinaStaff
      on staff-only endpoints; this class doesn't concern itself with them.
    """
    message = 'You do not have permission to access this module.'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return True  # let IsAuthenticated handle unauthenticated requests

        # Platform admins and non-staff roles bypass module gating
        if user.is_platform_admin or user.role in ('owner', 'manager'):
            return True

        if user.role != 'staff':
            return True  # boaters and unknown roles fall through to other checks

        module = _module_for_path(request.path)
        if module is None:
            return True  # unmapped path — not gated

        perms = user.module_permissions or {}
        # Explicit False blocks; anything else (True, absent) allows
        return perms.get(module, True) is not False
