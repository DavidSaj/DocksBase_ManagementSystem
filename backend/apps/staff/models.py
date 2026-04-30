from django.conf import settings
from django.db import models


class StaffMember(models.Model):
    CONTRACT = [('full_time', 'Full Time'), ('part_time', 'Part Time'), ('seasonal', 'Seasonal'), ('contractor', 'Contractor')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='staff_members')
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='staff_profile')
    name = models.CharField(max_length=200)
    initials = models.CharField(max_length=5, blank=True)
    role = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    contract = models.CharField(max_length=20, choices=CONTRACT, default='full_time')
    start_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Shift(models.Model):
    DAYS = [('mon','Mon'),('tue','Tue'),('wed','Wed'),('thu','Thu'),('fri','Fri'),('sat','Sat'),('sun','Sun')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='shifts')
    staff_member = models.ForeignKey(StaffMember, on_delete=models.CASCADE, related_name='shifts')
    week_start = models.DateField()
    day = models.CharField(max_length=3, choices=DAYS)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    department = models.CharField(max_length=100, blank=True)
    is_off = models.BooleanField(default=False)


def cert_upload_path(instance, filename):
    return f"marinas/{instance.staff_member.marina_id}/certs/{filename}"


class Certification(models.Model):
    STATUS = [('valid', 'Valid'), ('due_soon', 'Due Soon'), ('expired', 'Expired')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='certifications')
    staff_member = models.ForeignKey(StaffMember, on_delete=models.CASCADE, related_name='certifications')
    name = models.CharField(max_length=200)
    issuing_body = models.CharField(max_length=200, blank=True)
    issued = models.DateField(null=True, blank=True)
    expires = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='valid')
    pdf_file = models.FileField(upload_to=cert_upload_path, null=True, blank=True)
