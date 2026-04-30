from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0002_marina_operations_paused'),
        ('maintenance', '0003_incident_notes'),
    ]

    operations = [
        migrations.CreateModel(
            name='MaintenanceTask',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('assigned_to', models.CharField(blank=True, max_length=200)),
                ('priority', models.CharField(
                    choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('urgent', 'Urgent')],
                    default='medium', max_length=20,
                )),
                ('status', models.CharField(
                    choices=[('pending', 'Pending'), ('in_progress', 'In Progress'), ('blocked', 'Blocked'), ('completed', 'Completed')],
                    default='pending', max_length=20,
                )),
                ('due_date', models.DateField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('completion_notes', models.TextField(blank=True)),
                ('completion_photo', models.FileField(blank=True, null=True, upload_to='maintenance_tasks/')),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='maintenance_tasks',
                    to='accounts.marina',
                )),
                ('asset', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='maintenance.asset',
                )),
                ('defect', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='maintenance.defect',
                )),
            ],
            options={
                'ordering': ['-id'],
            },
        ),
    ]
