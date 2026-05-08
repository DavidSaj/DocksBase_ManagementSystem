from django.urls import path
from apps.revenue import views

urlpatterns = [
    path('revenue/tiers/',                    views.BookingTierListCreateView.as_view(),   name='revenue-tier-list'),
    path('revenue/tiers/<int:pk>/',           views.BookingTierDetailView.as_view(),       name='revenue-tier-detail'),
    path('revenue/rules/',                    views.YieldRuleListCreateView.as_view(),     name='revenue-rule-list'),
    path('revenue/rules/<int:pk>/',           views.YieldRuleDetailView.as_view(),         name='revenue-rule-detail'),
    path('revenue/applications/',             views.YieldApplicationListView.as_view(),    name='revenue-application-list'),
    path('revenue/waitlist/',                 views.WaitlistEntryListCreateView.as_view(), name='revenue-waitlist-list'),
    path('revenue/waitlist/<int:pk>/',        views.WaitlistEntryDetailView.as_view(),     name='revenue-waitlist-detail'),
    path('revenue/calculate-price/',          views.PriceCalculatorView.as_view(),         name='revenue-calculate-price'),
    path('revenue/occupancy/',                views.OccupancyView.as_view(),               name='revenue-occupancy'),
]
