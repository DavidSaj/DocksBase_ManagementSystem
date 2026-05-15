import hashlib

from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .docs import API_DOCS_MARKDOWN
from .models import APIKey, generate_key
from .permissions import IsMarinaOwner
from .serializers import APIKeyCreatedSerializer, APIKeyCreateSerializer, APIKeyReadSerializer


class APIKeyViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    API key management viewset. Owner-only.

    list:   GET  /api-keys/
    create: POST /api-keys/
    revoke: POST /api-keys/<id>/revoke/
    destroy: DELETE /api-keys/<id>/
    docs:   GET  /api-keys/docs/
    """
    permission_classes = [IsAuthenticated, IsMarinaOwner]

    def get_queryset(self):
        return APIKey.objects.filter(marina=self.request.user.marina)

    def get_serializer_class(self):
        if self.action == 'create':
            return APIKeyCreateSerializer
        return APIKeyReadSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Generate the raw key
        full_key, prefix, last_four = generate_key()
        key_hash = hashlib.sha256(full_key.encode()).hexdigest()

        key = APIKey.objects.create(
            marina=request.user.marina,
            created_by=request.user,
            name=serializer.validated_data['name'],
            expires_at=serializer.validated_data.get('expires_at'),
            key_prefix=prefix,
            key_hash=key_hash,
            last_four=last_four,
        )

        # Inject the raw key as a transient attribute — never persisted
        key._raw_key = full_key

        response_serializer = APIKeyCreatedSerializer(key)
        return Response(response_serializer.data, status=201)

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        """Revoke an API key. Idempotent."""
        key = self.get_object()
        if key.revoked_at is None:
            APIKey.objects.filter(pk=key.pk).update(revoked_at=timezone.now())
            key.refresh_from_db()
        return Response({'status': key.status})

    @action(detail=False, methods=['get'])
    def docs(self, request):
        """Return the curated API documentation as a markdown string."""
        return Response({'markdown': API_DOCS_MARKDOWN})
