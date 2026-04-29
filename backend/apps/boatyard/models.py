from django.core.exceptions import ValidationError
from django.db import models


class HaulOut(models.Model):
    STATUS = [
        ('scheduled', 'Scheduled'), ('in_progress', 'In Progress'),
        ('completed', 'Completed'), ('cancelled', 'Cancelled'),
    ]
    TYPE = [('haul_out', 'Haul Out'), ('splash', 'Splash')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='haul_outs')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT)
    haul_type = models.CharField(max_length=20, choices=TYPE, default='haul_out')
    scheduled_at = models.DateTimeField()
    equipment = models.CharField(max_length=200, blank=True)
    crew = models.IntegerField(default=2)
    status = models.CharField(max_length=20, choices=STATUS, default='scheduled')
    assigned_to = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    def clean(self):
        if self.vessel_id and self.vessel.marina_id != self.marina_id:
            raise ValidationError('Vessel belongs to a different marina.')

    class Meta:
        ordering = ['-scheduled_at']

    def __str__(self):
        return f'HaulOut #{self.pk} — {self.vessel.name}'


class WorkOrder(models.Model):
    STATUS = [
        ('pending_auth', 'Pending Auth'), ('authorised', 'Authorised'),
        ('in_progress', 'In Progress'), ('completed', 'Completed'),
    ]
    PRIORITY = [('low', 'Low'), ('normal', 'Normal'), ('high', 'High'), ('urgent', 'Urgent')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='work_orders')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=300)
    category = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY, default='normal')
    status = models.CharField(max_length=20, choices=STATUS, default='pending_auth')
    assigned_to = models.CharField(max_length=200, blank=True)
    estimate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    actual = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    due = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'WO-{self.pk} {self.title}'


class Part(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='parts')
    name = models.CharField(max_length=200)
    part_no = models.CharField(max_length=100, blank=True)
    category = models.CharField(max_length=100, blank=True)
    supplier = models.CharField(max_length=200, blank=True)
    unit_cost = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    sell_price = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    stock = models.IntegerField(default=0)
    par = models.IntegerField(default=0, help_text='Minimum stock level')
    location = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Tool(models.Model):
    STATUS = [
        ('available', 'Available'),
        ('checked_out', 'Checked Out'),
        ('service_due', 'Service Due'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tools')
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    serial = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='available')
    checked_out_to = models.CharField(max_length=200, blank=True)
    work_order = models.ForeignKey(
        WorkOrder, on_delete=models.SET_NULL, null=True, blank=True
    )
    calibration_due = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class StorageSlot(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='storage_slots')
    lane = models.CharField(max_length=50)
    col = models.CharField(max_length=10)
    tier = models.IntegerField(default=1)  # 1=Ground, 2=Middle, 3=Top
    vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='storage_slot'
    )

    def clean(self):
        if self.vessel_id and self.vessel.marina_id != self.marina_id:
            raise ValidationError('Vessel belongs to a different marina.')

    class Meta:
        ordering = ['lane', 'col', 'tier']
        unique_together = [('marina', 'lane', 'col', 'tier')]

    def __str__(self):
        return f'{self.lane}-{self.col}-T{self.tier}'


class LaunchRequest(models.Model):
    STATUS = [
        ('pending', 'Pending'), ('scheduled', 'Scheduled'),
        ('launching', 'Launching'), ('retrieved', 'Retrieved'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='launch_requests')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='launch_requests')
    slot = models.ForeignKey(
        StorageSlot, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='launch_requests'
    )
    equipment = models.CharField(max_length=200, blank=True)
    assigned_to = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='pending')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        if self.vessel_id and self.vessel.marina_id != self.marina_id:
            raise ValidationError('Vessel belongs to a different marina.')

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'Launch — {self.vessel.name}'


class Contractor(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='contractors')
    name = models.CharField(max_length=200)
    trade = models.CharField(max_length=200, blank=True)
    working_on = models.CharField(max_length=200, blank=True)
    access_start = models.DateField()
    access_end = models.DateField(null=True, blank=True)
    vessel_owner = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['access_start']

    def __str__(self):
        return self.name
