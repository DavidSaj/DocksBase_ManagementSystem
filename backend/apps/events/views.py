from rest_framework.response import Response
from rest_framework.views import APIView


class EventsPlaceholderView(APIView):
    def get(self, request):
        return Response({'detail': 'Events module — Phase 2'})
