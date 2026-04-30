from rest_framework import generics, permissions
from rest_framework_simplejwt.views import TokenObtainPairView
from .models import Marina, User
from .serializers import MarinaSerializer, UserSerializer, UserInviteSerializer, DocksBaseTokenSerializer


class LoginView(TokenObtainPairView):
    serializer_class = DocksBaseTokenSerializer
    permission_classes = [permissions.AllowAny]


class MarinaProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaSerializer

    def get_object(self):
        return self.request.user.marina


class MarinaUsersView(generics.ListAPIView):
    serializer_class = UserSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)


class InviteUserView(generics.CreateAPIView):
    serializer_class = UserInviteSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)


class UserDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user
