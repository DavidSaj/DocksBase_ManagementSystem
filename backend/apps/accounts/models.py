from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin


class Marina(models.Model):
    name = models.CharField(max_length=200)
    address = models.TextField(blank=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    timezone = models.CharField(max_length=50, default='UTC')
    plan = models.CharField(max_length=50, default='professional')
    contact_email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    vat_number = models.CharField(max_length=50, blank=True)
    currency = models.CharField(max_length=3, default='EUR')
    payment_terms = models.IntegerField(default=7)
    total_berths = models.IntegerField(default=0)
    dry_storage_slots = models.IntegerField(default=0)
    max_loa = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    operations_paused = models.BooleanField(default=False)
    BOOKING_MODE_CHOICES = [
        ('manual_approval', 'Manual Approval'),
        ('auto_tetris', 'Auto-Tetris'),
    ]
    booking_mode = models.CharField(max_length=20, choices=BOOKING_MODE_CHOICES, default='manual_approval')

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError('Email required')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault('role', 'owner')
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    ROLE_CHOICES = [
        ('owner', 'Owner'),
        ('manager', 'Manager'),
        ('staff', 'Staff'),
    ]

    marina = models.ForeignKey(Marina, on_delete=models.CASCADE, null=True, blank=True, related_name='users')
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='staff')
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email
