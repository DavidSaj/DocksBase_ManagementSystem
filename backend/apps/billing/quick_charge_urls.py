from django.urls import path

from .quick_charge_views import (
    QuickChargeActiveBoatsView,
    QuickChargeCreateView,
    QuickChargeItemsView,
    QuickChargeUndoView,
)

urlpatterns = [
    path('items/',        QuickChargeItemsView.as_view(),       name='quick_charge_items'),
    path('active-boats/', QuickChargeActiveBoatsView.as_view(), name='quick_charge_active_boats'),
    path('',              QuickChargeCreateView.as_view(),      name='quick_charge_create'),
    path('<int:line_id>/undo/', QuickChargeUndoView.as_view(),  name='quick_charge_undo'),
]
