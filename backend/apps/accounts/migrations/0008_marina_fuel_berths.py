from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0007_marina_onboarding_emailverification'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='fuel_berths',
            field=models.JSONField(default=list),
        ),
    ]
