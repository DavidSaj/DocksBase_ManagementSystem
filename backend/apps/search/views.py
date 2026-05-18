from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.conf import settings
from django.db import connection
from .models import GlobalSearchIndex


# Postgres trigram similarity threshold for inclusion. Tuned up from the old
# 0.1 which produced noisy results. Override via settings.SEARCH_TRIGRAM_THRESHOLD.
DEFAULT_TRIGRAM_THRESHOLD = 0.2


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response([])

        marina = request.user.marina
        if not marina:
            return Response([])

        threshold = getattr(settings, 'SEARCH_TRIGRAM_THRESHOLD', DEFAULT_TRIGRAM_THRESHOLD)

        if connection.vendor == 'postgresql':
            from django.contrib.postgres.search import TrigramSimilarity
            qs = (
                GlobalSearchIndex.objects
                .filter(marina=marina)
                .annotate(sim=TrigramSimilarity('search_text', q))
                .filter(sim__gte=threshold)
                .order_by('-sim')[:20]
            )
        else:
            qs = (
                GlobalSearchIndex.objects
                .filter(marina=marina, search_text__icontains=q)
                .order_by('display_label')[:20]
            )

        results = [
            {
                'type': obj.target_model,
                'id': obj.target_id,
                'label': obj.display_label,
                'sub': obj.display_sub,
                'screen': obj.screen,
                'link_id': obj.link_id,
            }
            for obj in qs
        ]
        return Response(results)
