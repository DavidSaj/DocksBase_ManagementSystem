from django.db import models


class RestTable(models.Model):
    STATUS = [('free', 'Free'), ('seated', 'Seated'), ('reserved', 'Reserved'), ('cleaning', 'Cleaning')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rest_tables')
    number = models.IntegerField()
    section = models.CharField(max_length=100, blank=True)
    capacity = models.IntegerField(default=4)
    status = models.CharField(max_length=20, choices=STATUS, default='free')
    server = models.CharField(max_length=200, blank=True)

    class Meta:
        unique_together = ('marina', 'number')


class MenuItem(models.Model):
    SECTION = [('starters', 'Starters'), ('mains', 'Mains'), ('desserts', 'Desserts'), ('drinks', 'Drinks')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='menu_items')
    section = models.CharField(max_length=20, choices=SECTION)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=7, decimal_places=2)
    cost = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    allergens = models.JSONField(default=list, blank=True)
    tags = models.JSONField(default=list, blank=True)
    prep_time = models.IntegerField(default=15, help_text='minutes')
    is_active = models.BooleanField(default=True)


class Order(models.Model):
    STATUS = [('waiting', 'Waiting'), ('in_prep', 'In Prep'), ('ready', 'Ready'), ('served', 'Served')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='orders')
    table = models.ForeignKey(RestTable, on_delete=models.PROTECT)
    covers = models.IntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS, default='waiting')
    placed_at = models.DateTimeField(auto_now_add=True)


class OrderItem(models.Model):
    STATUS = [('waiting', 'Waiting'), ('in_prep', 'In Prep'), ('ready', 'Ready'), ('served', 'Served')]

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    menu_item = models.ForeignKey(MenuItem, on_delete=models.PROTECT)
    quantity = models.IntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS, default='waiting')
    notes = models.CharField(max_length=300, blank=True)
