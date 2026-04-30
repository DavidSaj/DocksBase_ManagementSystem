from django.db import models


class Task(models.Model):
    PRIORITY = [('high', 'High'), ('medium', 'Medium'), ('low', 'Low')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tasks')
    text = models.CharField(max_length=500)
    location = models.CharField(max_length=200, blank=True)
    priority = models.CharField(max_length=10, choices=PRIORITY, default='medium')
    assigned_to = models.CharField(max_length=200, blank=True)
    done = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.text[:60]


class Incident(models.Model):
    SEVERITY = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('critical', 'Critical')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='incidents')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True)
    berth = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True)
    description = models.TextField()
    severity = models.CharField(max_length=20, choices=SEVERITY, default='low')
    reporter = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    resolved = models.BooleanField(default=False)
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'INC-{self.pk}'


class Asset(models.Model):
    STATUS = [('ok', 'OK'), ('due_service', 'Due Service'), ('under_repair', 'Under Repair'), ('decommissioned', 'Decommissioned')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='assets')
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=200, blank=True)
    make = models.CharField(max_length=100, blank=True)
    model = models.CharField(max_length=100, blank=True)
    serial = models.CharField(max_length=100, blank=True)
    purchased = models.DateField(null=True, blank=True)
    cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='ok')
    last_service = models.DateField(null=True, blank=True)
    next_service = models.DateField(null=True, blank=True)
    total_maint_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    notes = models.TextField(blank=True)

    def __str__(self):
        return self.name


class Defect(models.Model):
    SEVERITY = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('critical', 'Critical')]
    STATUS = [('open', 'Open'), ('acknowledged', 'Acknowledged'), ('in_progress', 'In Progress'), ('resolved', 'Resolved')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='defects')
    asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True)
    location = models.CharField(max_length=200, blank=True)
    description = models.TextField()
    severity = models.CharField(max_length=20, choices=SEVERITY, default='low')
    reporter = models.CharField(max_length=200, blank=True)
    assigned_to = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='open')
    reported_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'DEF-{self.pk}'


class MaintenanceTask(models.Model):
    PRIORITY = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('urgent', 'Urgent')]
    STATUS = [
        ('pending', 'Pending'), ('in_progress', 'In Progress'),
        ('blocked', 'Blocked'), ('completed', 'Completed'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='maintenance_tasks')
    asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True)
    defect = models.ForeignKey(Defect, on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assigned_to = models.CharField(max_length=200, blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY, default='medium')
    status = models.CharField(max_length=20, choices=STATUS, default='pending')
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completion_notes = models.TextField(blank=True)
    completion_photo = models.FileField(upload_to='maintenance_tasks/', null=True, blank=True)

    class Meta:
        ordering = ['-id']

    def __str__(self):
        return f'Task: {self.title}'
