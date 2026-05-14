from django.urls import reverse


def test_activity_bookings_route_registered():
    assert reverse('activity-booking-list') == '/api/v1/activity-bookings/'


def test_activity_catalogue_route_registered():
    assert reverse('activity-list') == '/api/v1/activity-catalogue/'


def test_activity_cancellation_policies_route_registered():
    assert reverse('activity-cancellation-policy-list') == '/api/v1/activity-cancellation-policies/'


def test_activity_resource_requirements_route_registered():
    assert reverse('activity-resource-requirement-list') == '/api/v1/activity-resource-requirements/'
