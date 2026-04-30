from rest_framework.response import Response
from rest_framework.views import APIView


class RestaurantPlaceholderView(APIView):
    def get(self, request):
        return Response({'detail': 'Restaurant module — Phase 2'})
