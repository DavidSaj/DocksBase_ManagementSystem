from django.db import models
from django.contrib.postgres.indexes import GinIndex


class GlobalSearchIndex(models.Model):
    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='search_index'
    )
    target_model = models.CharField(max_length=50)
    target_id = models.PositiveIntegerField()
    search_text = models.TextField()
    display_label = models.CharField(max_length=300)
    display_sub = models.CharField(max_length=300, blank=True)
    screen = models.CharField(max_length=50)
    link_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = [('target_model', 'target_id')]
        indexes = [
            GinIndex(
                fields=['search_text'],
                name='search_idx_trgm',
                opclasses=['gin_trgm_ops'],
            ),
        ]

    def __str__(self):
        return f'{self.target_model}:{self.target_id} — {self.display_label}'
