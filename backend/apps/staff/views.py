from rest_framework.response import Response
from rest_framework.views import APIView


class StaffPlaceholderView(APIView):
    def get(self, request):
        return Response({'detail': 'Staff module — Phase 2'})
