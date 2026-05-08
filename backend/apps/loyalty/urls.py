from django.urls import path
from apps.loyalty import views

urlpatterns = [
    # ── Canonical prefixed routes ──────────────────────────────────────────────
    # Tiers
    path('loyalty/tiers/',                                       views.LoyaltyTierListCreateView.as_view(),    name='loyalty-tier-list'),
    path('loyalty/tiers/<int:pk>/',                              views.LoyaltyTierDetailView.as_view(),        name='loyalty-tier-detail'),

    # Memberships
    path('loyalty/memberships/',                                 views.LoyaltyMembershipListView.as_view(),    name='loyalty-membership-list'),
    path('loyalty/memberships/<int:pk>/',                        views.LoyaltyMembershipDetailView.as_view(),  name='loyalty-membership-detail'),
    path('loyalty/memberships/<int:pk>/earn-points/',            views.EarnPointsView.as_view(),               name='loyalty-earn-points'),
    path('loyalty/memberships/<int:pk>/adjust-points/',          views.AdjustPointsView.as_view(),             name='loyalty-adjust-points'),

    # Points ledger (per-member)
    path('loyalty/members/<int:member_id>/points/',              views.MemberPointsLedgerView.as_view(),       name='loyalty-points-ledger'),

    # Redeem (invoice-level, not membership-level)
    path('loyalty/redeem-points/',                               views.RedeemPointsView.as_view(),             name='loyalty-redeem-points'),

    # Credit wallet
    path('loyalty/members/<int:member_id>/credit/',              views.MemberCreditAccountView.as_view(),      name='loyalty-credit-account'),
    path('loyalty/members/<int:member_id>/credit/transactions/', views.MemberCreditTransactionsView.as_view(), name='loyalty-credit-transactions'),
    path('loyalty/top-up-credit/',                               views.TopUpCreditView.as_view(),              name='loyalty-top-up-credit'),

    # Referral codes & uses
    path('loyalty/referral-codes/',                              views.ReferralCodeListCreateView.as_view(),   name='loyalty-referral-list'),
    path('loyalty/referral-codes/<int:pk>/',                     views.ReferralCodeDetailView.as_view(),       name='loyalty-referral-detail'),
    path('loyalty/referral-uses/',                               views.ReferralUseListView.as_view(),          name='loyalty-referral-use-list'),

    # Coupons
    path('loyalty/coupons/',                                     views.CouponCodeListCreateView.as_view(),     name='loyalty-coupon-list'),
    path('loyalty/coupons/<int:pk>/',                            views.CouponCodeDetailView.as_view(),         name='loyalty-coupon-detail'),
    path('loyalty/apply-coupon/',                                views.ApplyCouponView.as_view(),              name='loyalty-apply-coupon'),

    # ── Frontend alias routes (no prefix) ─────────────────────────────────────
    # The frontend calls these unprefixed paths; these aliases keep the backend
    # canonical routes intact while serving both URL shapes.
    path('loyalty-tiers/',                                        views.LoyaltyTierListCreateView.as_view(),   name='loyalty-tier-list-alias'),
    path('loyalty-tiers/<int:pk>/',                               views.LoyaltyTierDetailView.as_view(),       name='loyalty-tier-detail-alias'),

    path('loyalty-memberships/',                                  views.LoyaltyMembershipListView.as_view(),   name='loyalty-membership-list-alias'),
    path('loyalty-memberships/<int:pk>/',                         views.LoyaltyMembershipDetailView.as_view(), name='loyalty-membership-detail-alias'),
    # Frontend calls /loyalty-memberships/<pk>/adjust/ (no "points" suffix)
    path('loyalty-memberships/<int:pk>/adjust/',                  views.AdjustPointsView.as_view(),            name='loyalty-adjust-points-alias'),

    # Frontend calls /points-ledger/ for the full marina-wide ledger list
    path('points-ledger/',                                        views.PointsLedgerListView.as_view(),        name='loyalty-points-ledger-list'),

    # Frontend calls /referral-uses/ (no loyalty/ prefix)
    path('referral-uses/',                                        views.ReferralUseListView.as_view(),         name='loyalty-referral-use-list-alias'),
]
