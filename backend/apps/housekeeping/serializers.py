from rest_framework import serializers

from .models import (
    ChecklistItem,
    CleaningSchedule,
    ConsumableStock,
    ConsumableUsage,
    HousekeepingTask,
    LinenInventory,
    LinenSet,
    TaskChecklistCompletion,
    TaskPhoto,
)


class TaskChecklistCompletionSerializer(serializers.ModelSerializer):
    checklist_item_text = serializers.CharField(
        source='checklist_item.text', read_only=True
    )

    class Meta:
        model = TaskChecklistCompletion
        fields = ['id', 'checklist_item', 'checklist_item_text', 'is_done', 'completed_at', 'note']
        read_only_fields = ['id']


class TaskPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskPhoto
        fields = ['id', 'photo_type', 'image', 'caption', 'taken_at', 'taken_by']
        read_only_fields = ['id', 'taken_at']


class HousekeepingTaskSerializer(serializers.ModelSerializer):
    """
    On list: lightweight representation.
    On detail (retrieve): includes nested checklist and photos.
    """
    checklist = TaskChecklistCompletionSerializer(many=True, read_only=True)
    photos    = TaskPhotoSerializer(many=True, read_only=True)
    assigned_to_name = serializers.CharField(
        source='assigned_to.name', read_only=True, allow_null=True
    )
    supervisor_name = serializers.CharField(
        source='supervisor.name', read_only=True, allow_null=True
    )
    checklist_total = serializers.SerializerMethodField()
    checklist_done  = serializers.SerializerMethodField()

    class Meta:
        model = HousekeepingTask
        fields = [
            'id', 'marina', 'source_type', 'source_id',
            'unit_type', 'unit_id', 'unit_label',
            'status', 'priority',
            'triggered_at', 'target_ready_by', 'started_at', 'completed_at',
            'assigned_to', 'assigned_to_name',
            'supervisor', 'supervisor_name',
            'notes', 'recurrence_interval_days',
            'checklist', 'photos',
            'checklist_total', 'checklist_done',
        ]
        read_only_fields = ['id', 'marina', 'triggered_at', 'started_at', 'completed_at']

    def get_checklist_total(self, obj):
        # Use prefetched checklist to avoid extra queries
        try:
            return len(obj.checklist.all())
        except Exception:
            return obj.checklist.count()

    def get_checklist_done(self, obj):
        try:
            return sum(1 for item in obj.checklist.all() if item.is_done)
        except Exception:
            return obj.checklist.filter(is_done=True).count()


class ChecklistItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistItem
        fields = ['id', 'unit_type', 'order', 'text', 'is_active']
        read_only_fields = ['id']


class LinenSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = LinenSet
        fields = ['id', 'name', 'description', 'is_active']
        read_only_fields = ['id']


class LinenInventorySerializer(serializers.ModelSerializer):
    linen_set_name = serializers.CharField(source='linen_set.name', read_only=True)
    is_below_threshold = serializers.SerializerMethodField()

    class Meta:
        model = LinenInventory
        fields = [
            'id', 'marina', 'linen_set', 'linen_set_name',
            'qty_clean', 'qty_dirty', 'qty_total', 'laundry_threshold',
            'updated_at', 'is_below_threshold',
        ]
        read_only_fields = ['id', 'marina', 'updated_at']

    def get_is_below_threshold(self, obj):
        return obj.qty_dirty >= obj.laundry_threshold


class ConsumableStockSerializer(serializers.ModelSerializer):
    is_low = serializers.SerializerMethodField()

    class Meta:
        model = ConsumableStock
        fields = ['id', 'name', 'unit', 'qty_on_hand', 'low_stock_alert', 'is_active', 'is_low']
        read_only_fields = ['id']

    def get_is_low(self, obj):
        return obj.qty_on_hand <= obj.low_stock_alert


class ConsumableUsageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsumableUsage
        fields = ['id', 'task', 'consumable', 'qty_used', 'recorded_at']
        read_only_fields = ['id', 'recorded_at']


class CleaningScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = CleaningSchedule
        fields = [
            'id', 'unit_type', 'unit_label', 'interval_days',
            'next_run_date', 'is_active', 'notes', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']
