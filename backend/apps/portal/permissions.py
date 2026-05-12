from rest_framework.exceptions import PermissionDenied

FEATURE_DISABLED_MSG = 'This feature is not enabled for this marina.'


def require_feature(member, feature_key: str, default: bool = False) -> None:
    """
    Raise PermissionDenied (HTTP 403) if the marina's app_config has
    the given feature_key set to False (or absent when default=False).

    Call this at the top of any view guarded by a feature toggle.

    Args:
        member: Member ORM instance with member.marina.app_config dict.
        feature_key: e.g. 'enable_boatyard', 'enable_utilities', 'enable_documents'.
        default: Value to use when key is absent from app_config. Default False.
    """
    config = getattr(member.marina, 'app_config', {}) or {}
    enabled = config.get(feature_key, default)
    if not enabled:
        raise PermissionDenied(FEATURE_DISABLED_MSG)
