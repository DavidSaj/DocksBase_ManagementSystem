from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from .models import Marina, User


class MarinaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Marina
        fields = '__all__'


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'role', 'is_platform_admin', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']


class UserInviteSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ['email', 'first_name', 'last_name', 'role', 'password']

    def create(self, validated_data):
        marina = self.context['request'].user.marina
        return User.objects.create_user(marina=marina, **validated_data)


class DocksBaseTokenSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['is_platform_admin'] = user.is_platform_admin
        token['role'] = user.role
        return token

    def validate(self, attrs):
        email = attrs.get('email', '')
        try:
            user = User.objects.get(email=email)
            if not user.is_active:
                raise AuthenticationFailed({
                    'code': 'email_not_verified',
                    'detail': 'Please verify your email before logging in.',
                })
        except User.DoesNotExist:
            pass
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data


class SendMagicLinkSerializer(serializers.Serializer):
    member_id = serializers.IntegerField(min_value=1)


class ExchangeMagicTokenSerializer(serializers.Serializer):
    token = serializers.UUIDField()


class SignupSerializer(serializers.Serializer):
    first_name  = serializers.CharField(max_length=100)
    last_name   = serializers.CharField(max_length=100)
    email       = serializers.EmailField()
    password    = serializers.CharField(min_length=8, write_only=True)
    marina_name = serializers.CharField(max_length=200)

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(['A user with this email already exists.'])
        return value
