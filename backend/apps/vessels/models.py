from django.db import models


class Vessel(models.Model):
    TYPE_CHOICES = [
        ('motor', 'Motor'), ('sail', 'Sail'), ('catamaran', 'Catamaran'),
        ('superyacht', 'Superyacht'), ('commercial', 'Commercial'), ('other', 'Other'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='vessels')
    name = models.CharField(max_length=200)
    reg = models.CharField(max_length=100, blank=True)
    flag = models.CharField(max_length=100, blank=True)
    mmsi = models.CharField(max_length=20, blank=True)
    call_sign = models.CharField(max_length=20, blank=True)
    vessel_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='motor')
    loa = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    beam = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    air_draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    year_built = models.IntegerField(null=True, blank=True)
    builder = models.CharField(max_length=200, blank=True)
    model = models.CharField(max_length=200, blank=True)
    engine = models.CharField(max_length=200, blank=True)
    fuel = models.CharField(max_length=50, blank=True)
    tank_cap = models.IntegerField(null=True, blank=True, help_text='Litres')
    fw_tank = models.IntegerField(null=True, blank=True, help_text='Litres')
    shore_power = models.CharField(max_length=50, blank=True)
    mooring_pref = models.CharField(max_length=100, blank=True)
    ais_active = models.BooleanField(default=False)
    owner = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='vessels')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.name} ({self.reg})'


class InsuranceRecord(models.Model):
    STATUS_CHOICES = [
        ('valid', 'Valid'), ('due_soon', 'Due Soon'), ('expired', 'Expired'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='insurance_records')
    vessel = models.OneToOneField(Vessel, on_delete=models.CASCADE, related_name='insurance')
    insurer = models.CharField(max_length=200, blank=True)
    policy_no = models.CharField(max_length=100, blank=True)
    expires = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='valid')

    def __str__(self):
        return f'Insurance — {self.vessel}'


class SafetyEquipment(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='safety_equipment')
    vessel = models.OneToOneField(Vessel, on_delete=models.CASCADE, related_name='safety')
    flares_exp = models.DateField(null=True, blank=True)
    life_raft_exp = models.DateField(null=True, blank=True)
    epirb_exp = models.DateField(null=True, blank=True)
    extinguisher_exp = models.DateField(null=True, blank=True)

    def __str__(self):
        return f'Safety — {self.vessel}'


class VesselCertificate(models.Model):
    CERT_TYPE_CHOICES = [
        ('registration', 'Registration Certificate'),
        ('ssr', 'Small Ships Register (SSR)'),
        ('part1', 'Part 1 Registry'),
        ('commercial', 'Commercial Certificate'),
        ('competence', 'Competence Certificate'),
        ('vhf', 'VHF / SRC Licence'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('valid', 'Valid'),
        ('due_soon', 'Due Soon'),
        ('expired', 'Expired'),
        ('missing', 'Missing'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='vessel_certificates')
    vessel = models.ForeignKey(Vessel, on_delete=models.CASCADE, related_name='certificates')
    cert_type = models.CharField(max_length=30, choices=CERT_TYPE_CHOICES, default='other')
    name = models.CharField(max_length=200)
    issued = models.DateField(null=True, blank=True)
    expires = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='valid')
    notes = models.TextField(blank=True)

    def __str__(self):
        return f'{self.name} — {self.vessel}'
