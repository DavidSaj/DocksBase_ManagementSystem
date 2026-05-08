from django.urls import path
from apps.marketplace import views

urlpatterns = [
    path('marketplace/listings/', views.BerthListingListCreateView.as_view(), name='marketplace-listing-list'),
    path('marketplace/listings/<int:pk>/', views.BerthListingDetailView.as_view(), name='marketplace-listing-detail'),
    path('marketplace/listings/<int:pk>/publish/', views.BerthListingPublishView.as_view(), name='marketplace-listing-publish'),
    path('marketplace/listings/<int:pk>/mark-sold/', views.BerthListingMarkSoldView.as_view(), name='marketplace-listing-mark-sold'),
    path('marketplace/listings/<int:pk>/photos/', views.BerthListingPhotoListCreateView.as_view(), name='marketplace-listing-photos'),
    path('marketplace/listings/<int:pk>/enquiries/', views.BerthEnquiryListCreateView.as_view(), name='marketplace-listing-enquiries'),
    path('marketplace/enquiries/', views.BerthEnquiryGlobalListView.as_view(), name='marketplace-enquiry-global-list'),
    path('marketplace/enquiries/<int:pk>/', views.BerthEnquiryDetailView.as_view(), name='marketplace-enquiry-detail'),
    path('marketplace/exchange/', views.ExchangeListingListCreateView.as_view(), name='marketplace-exchange-list'),
    path('marketplace/exchange/<int:pk>/', views.ExchangeListingDetailView.as_view(), name='marketplace-exchange-detail'),
    path('marketplace/exchange/<int:pk>/agreements/', views.ExchangeAgreementListCreateView.as_view(), name='marketplace-exchange-agreements'),
    path('marketplace/exchange/agreements/<int:pk>/confirm/', views.ExchangeAgreementConfirmView.as_view(), name='marketplace-exchange-confirm'),
    path('marketplace/exchange/agreements/', views.ExchangeAgreementGlobalListView.as_view(), name='marketplace-exchange-agreements-global'),
    path('marketplace/public/', views.PublicBerthListingView.as_view(), name='marketplace-public-listings'),
]
