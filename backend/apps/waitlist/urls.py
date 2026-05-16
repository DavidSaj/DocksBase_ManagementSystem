from django.urls import path

from . import views

urlpatterns = [
    path('waitlist/', views.WaitlistListCreateView.as_view(), name='waitlist-list'),
    path('waitlist/<int:pk>/', views.WaitlistDetailView.as_view(), name='waitlist-detail'),
    path('waitlist/<int:pk>/pay-deposit/', views.WaitlistPayDepositView.as_view(), name='waitlist-pay-deposit'),
    path('waitlist/<int:pk>/offer/', views.WaitlistManagerOfferView.as_view(), name='waitlist-offer-create'),
    path('waitlist/<int:pk>/withdraw/', views.WaitlistWithdrawView.as_view(), name='waitlist-withdraw'),
    path('waitlist/<int:pk>/refund-actions/<int:action_id>/complete/',
         views.RefundActionCompleteView.as_view(), name='waitlist-refund-complete'),
    path('waitlist/offers/<uuid:token>/', views.WaitlistOfferTokenView.as_view(), name='waitlist-offer-view'),
    path('waitlist/offers/<uuid:token>/respond/', views.WaitlistOfferRespondView.as_view(),
         name='waitlist-offer-respond'),
]
