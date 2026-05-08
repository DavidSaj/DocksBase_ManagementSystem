import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0002_marina_operations_paused'),
        ('staff', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='HousekeepingTask',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source_type', models.CharField(choices=[('charter_checkout', 'Charter Checkout'), ('accommodation_checkout', 'Accommodation Checkout'), ('mid_stay_recurring', 'Mid-Stay Recurring'), ('on_demand', 'On-Demand'), ('manual', 'Manual'), ('laundry', 'Laundry Run')], max_length=30)),
                ('source_id', models.CharField(blank=True, max_length=255)),
                ('unit_type', models.CharField(choices=[('vessel', 'Charter Vessel'), ('accommodation', 'Accommodation Unit'), ('facility', 'Facility / Common Area')], max_length=20)),
                ('unit_id', models.CharField(max_length=255)),
                ('unit_label', models.CharField(max_length=200)),
                ('status', models.CharField(choices=[('dirty', 'Dirty'), ('in_progress', 'In Progress'), ('ready_inspection', 'Ready for Inspection'), ('clean', 'Inspected & Clean'), ('ready_guest', 'Ready for Guest')], default='dirty', max_length=25)),
                ('priority', models.CharField(choices=[('normal', 'Normal'), ('high', 'High'), ('urgent', 'Urgent')], default='normal', max_length=10)),
                ('triggered_at', models.DateTimeField(auto_now_add=True)),
                ('target_ready_by', models.DateTimeField(blank=True, null=True)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('notes', models.TextField(blank=True)),
                ('recurrence_interval_days', models.PositiveIntegerField(blank=True, null=True)),
                ('assigned_to', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='housekeeping_tasks', to='staff.staffmember')),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='housekeeping_tasks', to='accounts.marina')),
                ('supervisor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='supervised_housekeeping_tasks', to='staff.staffmember')),
            ],
            options={
                'ordering': ['target_ready_by', '-priority'],
            },
        ),
        migrations.CreateModel(
            name='ChecklistItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('unit_type', models.CharField(choices=[('vessel', 'Charter Vessel'), ('accommodation', 'Accommodation Unit'), ('facility', 'Facility / Common Area')], max_length=20)),
                ('order', models.PositiveIntegerField(default=0)),
                ('text', models.CharField(max_length=500)),
                ('is_active', models.BooleanField(default=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='checklist_items', to='accounts.marina')),
            ],
            options={
                'ordering': ['unit_type', 'order'],
            },
        ),
        migrations.CreateModel(
            name='TaskChecklistCompletion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('is_done', models.BooleanField(default=False)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('note', models.CharField(blank=True, max_length=500)),
                ('checklist_item', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='completions', to='housekeeping.checklistitem')),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='checklist', to='housekeeping.housekeepingtask')),
            ],
        ),
        migrations.CreateModel(
            name='TaskPhoto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('photo_type', models.CharField(choices=[('before', 'Before'), ('after', 'After'), ('defect', 'Defect')], max_length=10)),
                ('image', models.ImageField(upload_to='housekeeping/photos/%Y/%m/')),
                ('caption', models.CharField(blank=True, max_length=300)),
                ('taken_at', models.DateTimeField(auto_now_add=True)),
                ('taken_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='staff.staffmember')),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='photos', to='housekeeping.housekeepingtask')),
            ],
        ),
        migrations.CreateModel(
            name='LinenSet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='linen_sets', to='accounts.marina')),
            ],
        ),
        migrations.CreateModel(
            name='LinenInventory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('qty_clean', models.PositiveIntegerField(default=0)),
                ('qty_dirty', models.PositiveIntegerField(default=0)),
                ('qty_total', models.PositiveIntegerField(default=0)),
                ('laundry_threshold', models.PositiveIntegerField(default=10)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('linen_set', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='inventory', to='housekeeping.linenset')),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='linen_inventory', to='accounts.marina')),
            ],
            options={
                'unique_together': {('marina', 'linen_set')},
            },
        ),
        migrations.CreateModel(
            name='ConsumableStock',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('unit', models.CharField(blank=True, max_length=50)),
                ('qty_on_hand', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ('low_stock_alert', models.DecimalField(decimal_places=2, default=5, max_digits=10)),
                ('is_active', models.BooleanField(default=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='consumable_stock', to='accounts.marina')),
            ],
        ),
        migrations.CreateModel(
            name='ConsumableUsage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('qty_used', models.DecimalField(decimal_places=2, max_digits=10)),
                ('recorded_at', models.DateTimeField(auto_now_add=True)),
                ('consumable', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='usage', to='housekeeping.consumablestock')),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='consumable_usage', to='housekeeping.housekeepingtask')),
            ],
        ),
    ]
