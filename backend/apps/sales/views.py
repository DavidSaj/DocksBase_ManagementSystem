from rest_framework.response import Response
from rest_framework.views import APIView


class SalesPlaceholderView(APIView):
    def get(self, request):
        return Response({'detail': 'Sales module — Phase 2'})
