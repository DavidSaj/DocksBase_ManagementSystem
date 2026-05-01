from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Certification, Shift, StaffMember
from .serializers import CertificationSerializer, ShiftSerializer, StaffMemberSerializer

User = get_user_model()


class StaffInviteView(APIView):
    def post(self, request):
        name = request.data.get('name', '').strip()
        email = request.data.get('email', '').strip()
        role = request.data.get('role', 'staff').strip()

        if not name or not email:
            return Response({'detail': 'name and email are required.'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(email=email).exists():
            return Response({'detail': 'A user with this email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(
            email=email, password=None, is_active=False,
            marina=request.user.marina, role=role,
        )
        staff = StaffMember.objects.create(
            user=user, name=name, email=email, role=role, marina=request.user.marina,
        )

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        setup_link = f"https://app.docksbase.com/setup/{uid}/{token}/"

        send_mail(
            subject="You've been invited to DocksBase",
            message=(
                f"Hello {name},\n\n"
                f"You have been invited to DocksBase. Set up your account here:\n{setup_link}"
            ),
            from_email=None,
            recipient_list=[email],
            fail_silently=False,
        )

        serializer = StaffMemberSerializer(staff, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class StaffList(generics.ListAPIView):
    serializer_class = StaffMemberSerializer
    search_fields = ['name', 'role', 'department']

    def get_queryset(self):
        return StaffMember.objects.filter(marina=self.request.user.marina)


class StaffDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = StaffMemberSerializer

    def get_queryset(self):
        return StaffMember.objects.filter(marina=self.request.user.marina)

    def perform_update(self, serializer):
        instance = serializer.save()
        if not instance.is_active and instance.user:
            instance.user.is_active = False
            instance.user.save(update_fields=['is_active'])


class ShiftList(generics.ListCreateAPIView):
    serializer_class = ShiftSerializer

    def get_queryset(self):
        qs = Shift.objects.filter(marina=self.request.user.marina).select_related('staff_member')
        week_start = self.request.query_params.get('week_start')
        if week_start:
            qs = qs.filter(week_start=week_start)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ShiftDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ShiftSerializer

    def get_queryset(self):
        return Shift.objects.filter(marina=self.request.user.marina)


class CertificationList(generics.ListCreateAPIView):
    serializer_class = CertificationSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = Certification.objects.filter(marina=self.request.user.marina).select_related('staff_member')
        staff_id = self.request.query_params.get('staff_member')
        if staff_id:
            qs = qs.filter(staff_member_id=staff_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CertificationDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CertificationSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        return Certification.objects.filter(marina=self.request.user.marina)
