from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0026_marina_smtp_config'),
    ]

    operations = [
        migrations.CreateModel(
            name='DataExport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('running', 'Running'), ('ready', 'Ready'), ('failed', 'Failed')], default='pending', max_length=20)),
                ('file_path', models.CharField(blank=True, max_length=500)),
                ('size_bytes', models.BigIntegerField(blank=True, null=True)),
                ('entity_counts', models.JSONField(blank=True, default=dict)),
                ('error_message', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('ready_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='data_exports', to='accounts.marina')),
                ('requested_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='data_exports_requested', to='accounts.user')),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
