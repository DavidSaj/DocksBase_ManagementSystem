"""
apps/boatyard/serializers/tasks_serializers.py
Track 5 — WorkOrderTask, TaskDependency, and Gantt serializers.
"""

import collections

from rest_framework import serializers

from ..models import WorkOrderTask, TaskDependency


class WorkOrderTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkOrderTask
        fields = [
            'id', 'work_order', 'title', 'description', 'assigned_to',
            'planned_start', 'planned_end', 'actual_start', 'actual_end',
            'baseline_start', 'baseline_end', 'status', 'percent_complete',
            'sort_order', 'is_critical', 'created_at',
        ]
        read_only_fields = ['is_critical', 'created_at']

    def validate(self, data):
        start = data.get('planned_start') or (self.instance.planned_start if self.instance else None)
        end   = data.get('planned_end')   or (self.instance.planned_end   if self.instance else None)
        if start and end and end < start:
            raise serializers.ValidationError('planned_end must be on or after planned_start.')
        return data


class TaskDependencySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskDependency
        fields = [
            'id', 'predecessor', 'successor', 'dependency_type', 'lag_days',
        ]

    def validate(self, data):
        predecessor = data.get('predecessor') or (self.instance.predecessor if self.instance else None)
        successor   = data.get('successor')   or (self.instance.successor   if self.instance else None)
        dep_type    = data.get('dependency_type', TaskDependency.DependencyType.FS)

        # Rule: only Finish-to-Start is currently supported
        if dep_type != TaskDependency.DependencyType.FS:
            raise serializers.ValidationError(
                'Only Finish-to-Start (fs) dependencies are currently supported.'
            )

        # Self-dependency check
        if predecessor and successor and predecessor.pk == successor.pk:
            raise serializers.ValidationError(
                'A task cannot depend on itself.'
            )

        # BFS cycle detection: walk forward from successor; if we reach
        # predecessor then adding this edge would create a cycle.
        if predecessor and successor:
            self._check_cycle(predecessor, successor)

        return data

    @staticmethod
    def _check_cycle(predecessor, successor) -> None:
        """
        BFS from successor: if predecessor is reachable through existing
        successor edges, the new edge would create a cycle.
        """
        visited = set()
        queue = collections.deque([successor.pk])

        while queue:
            current_pk = queue.popleft()
            if current_pk in visited:
                continue
            visited.add(current_pk)

            if current_pk == predecessor.pk:
                raise serializers.ValidationError(
                    'Adding this dependency would create a cycle in the task graph.'
                )

            # Follow existing successor edges
            next_pks = TaskDependency.objects.filter(
                predecessor_id=current_pk
            ).values_list('successor_id', flat=True)
            queue.extend(next_pks)


class GanttTaskSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for Gantt chart rendering.
    Returns only the fields needed by the front-end Gantt library.
    """
    dependencies = serializers.SerializerMethodField()

    class Meta:
        model = WorkOrderTask
        fields = [
            'id', 'title', 'planned_start', 'planned_end',
            'actual_start', 'actual_end', 'percent_complete',
            'status', 'is_critical', 'assigned_to', 'sort_order',
            'dependencies',
        ]

    def get_dependencies(self, obj):
        return list(
            obj.predecessors.values_list('predecessor_id', flat=True)
        )
