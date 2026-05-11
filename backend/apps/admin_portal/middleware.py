import base64
import json
import logging
import threading

logger = logging.getLogger(__name__)

_local = threading.local()


def get_impersonation_context():
    return getattr(_local, 'ctx', None)


def _parse_jwt_payload(request):
    auth = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth.startswith('Bearer '):
        return {}
    parts = auth[7:].split('.')
    if len(parts) != 3:
        return {}
    padded = parts[1] + '=' * (4 - len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return {}


class ImpersonationAuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        payload = _parse_jwt_payload(request)
        is_impersonation = payload.get('is_safe_mode', False)

        if is_impersonation:
            _local.ctx = {
                'impersonator_user_id': payload.get('impersonator_user_id'),
                'impersonation_session_id': payload.get('impersonation_session_id'),
                'marina_id': payload.get('impersonated_marina_id'),
            }
        else:
            _local.ctx = None

        response = self.get_response(request)

        if is_impersonation and request.method in ('POST', 'PATCH', 'PUT', 'DELETE'):
            if 200 <= response.status_code < 300:
                try:
                    from apps.admin_portal.models import AuditLog
                    AuditLog.objects.create(
                        admin_user_id=payload.get('impersonator_user_id'),
                        action=f'impersonation:{request.method.lower()}:{request.path}',
                        target_marina_id=payload.get('impersonated_marina_id'),
                        impersonation_session_id=payload.get('impersonation_session_id'),
                        impersonator_user_id=payload.get('impersonator_user_id'),
                        detail={'status': response.status_code, 'path': request.path},
                    )
                except Exception:
                    logger.exception('ImpersonationAuditMiddleware failed to create AuditLog')

        _local.ctx = None
        return response
