from django.db import models


class HousekeepingTask(models.Model):
    class SourceType(models.TextChoices):
        CHARTER_CHECKOUT       = 'charter_checkout',       'Charter Checkout'
        ACCOMMODATION_CHECKOUT = 'accommodation_checkout', 'Accommodation Checkout'
        MID_STAY_RECURRING     = 'mid_stay_recurring',     'Mid-Stay Recurring'
        ON_DEMAND              = 'on_demand',              'On-Demand'
        MANUAL                 = 'manual',                 'Manual'
        LAUNDRY                = 'laundry',                'Laundry Run'

    class UnitType(models.TextChoices):
        VESSEL        = 'vessel',        'Charter Vessel'
        ACCOMMODATION = 'accommodation', 'Accommodation Unit'
        FACILITY      = 'facility',      'Facility / Common Area'

    class Status(models.TextChoices):
        DIRTY            = 'dirty',            'Dirty'
        IN_PROGRESS      = 'in_progress',      'In Progress'
        READY_INSPECTION = 'ready_inspection', 'Ready for Inspection'
        CLEAN            = 'clean',            'Inspected & Clean'
        READY_GUEST      = 'ready_guest',      'Ready for Guest'

    class Priority(models.TextChoices):
        NORMAL = 'normal', 'Normal'
        HIGH   = 'high',   'High'
        URGENT = 'urgent', 'Urgent'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='housekeeping_tasks')
    source_type  = models.CharField(max_length=30, choices=SourceType.choices)
    source_id    = models.CharField(max_length=255, blank=True)

    unit_type    = models.CharField(max_length=20, choices=UnitType.choices)
    unit_id      = models.CharField(max_length=255)
    unit_label   = models.CharField(max_length=200)

    status       = models.CharField(max_length=25, choices=Status.choices, default=Status.DIRTY)
    priority     = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)

    triggered_at     = models.DateTimeField(auto_now_add=True)
    target_ready_by  = models.DateTimeField(null=True, blank=True)
    started_at       = models.DateTimeField(null=True, blank=True)
    completed_at     = models.DateTimeField(null=True, blank=True)

    assigned_to  = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='housekeeping_tasks'
    )
    supervisor   = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='supervised_housekeeping_tasks'
    )

    notes        = models.TextField(blank=True)

    # Mid-stay recurring config — null for one-off tasks
    recurrence_interval_days = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['target_ready_by', '-priority']

    def __str__(self):
        return f'{self.unit_label} [{self.get_status_display()}]'


class ChecklistItem(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='checklist_items')
    unit_type  = models.CharField(max_length=20, choices=HousekeepingTask.UnitType.choices)
    order      = models.PositiveIntegerField(default=0)
    text       = models.CharField(max_length=500)
    is_active  = models.BooleanField(default=True)

    class Meta:
        ordering = ['unit_type', 'order']

    def __str__(self):
        return self.text[:80]


class TaskChecklistCompletion(models.Model):
    task           = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE,
                                        related_name='checklist')
    checklist_item = models.ForeignKey(ChecklistItem, on_delete=models.PROTECT,
                                        related_name='completions')
    is_done        = models.BooleanField(default=False)
    completed_at   = models.DateTimeField(null=True, blank=True)
    note           = models.CharField(max_length=500, blank=True)

    def __str__(self):
        return f'{self.checklist_item.text[:40]} — {"done" if self.is_done else "pending"}'


class TaskPhoto(models.Model):
    class PhotoType(models.TextChoices):
        BEFORE = 'before', 'Before'
        AFTER  = 'after',  'After'
        DEFECT = 'defect', 'Defect'

    task       = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE, related_name='photos')
    photo_type = models.CharField(max_length=10, choices=PhotoType.choices)
    image      = models.ImageField(upload_to='housekeeping/photos/%Y/%m/')
    caption    = models.CharField(max_length=300, blank=True)
    taken_at   = models.DateTimeField(auto_now_add=True)
    taken_by   = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f'{self.get_photo_type_display()} photo for Task #{self.task_id}'


class LinenSet(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                     related_name='linen_sets')
    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class LinenInventory(models.Model):
    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                            related_name='linen_inventory')
    linen_set          = models.ForeignKey(LinenSet, on_delete=models.CASCADE, related_name='inventory')
    qty_clean          = models.PositiveIntegerField(default=0)
    qty_dirty          = models.PositiveIntegerField(default=0)
    qty_total          = models.PositiveIntegerField(default=0)
    laundry_threshold  = models.PositiveIntegerField(default=10)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'linen_set')]

    def __str__(self):
        return f'{self.linen_set.name} — clean: {self.qty_clean}, dirty: {self.qty_dirty}'


class ConsumableStock(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                         related_name='consumable_stock')
    name            = models.CharField(max_length=200)
    unit            = models.CharField(max_length=50, blank=True)
    qty_on_hand     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    low_stock_alert = models.DecimalField(max_digits=10, decimal_places=2, default=5)
    is_active       = models.BooleanField(default=True)

    def __str__(self):
        return f'{self.name} ({self.qty_on_hand} {self.unit})'


class ConsumableUsage(models.Model):
    task        = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE,
                                     related_name='consumable_usage')
    consumable  = models.ForeignKey(ConsumableStock, on_delete=models.PROTECT, related_name='usage')
    qty_used    = models.DecimalField(max_digits=10, decimal_places=2)
    recorded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.consumable.name} × {self.qty_used} on Task #{self.task_id}'


class CleaningSchedule(models.Model):
    """
    Recurring cleaning schedule for a unit (vessel, accommodation, or facility).
    Drives automatic task creation every `interval_days` days.
    """
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                          related_name='cleaning_schedules')
    unit_type        = models.CharField(max_length=20, choices=HousekeepingTask.UnitType.choices)
    unit_label       = models.CharField(max_length=200)
    interval_days    = models.PositiveIntegerField(default=1)
    next_run_date    = models.DateField(null=True, blank=True)
    is_active        = models.BooleanField(default=True)
    notes            = models.TextField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['unit_label']

    def __str__(self):
        return f'{self.unit_label} every {self.interval_days}d'
