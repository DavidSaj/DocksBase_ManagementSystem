from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import connection
from .models import GlobalSearchIndex


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response([])

        marina = request.user.marina
        if not marina:
            return Response([])

        if connection.vendor == 'postgresql':
            from django.contrib.postgres.search import TrigramSimilarity
            qs = (
                GlobalSearchIndex.objects
                .filter(marina=marina)
                .annotate(sim=TrigramSimilarity('search_text', q))
                .filter(sim__gte=0.1)
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
