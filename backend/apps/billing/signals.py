import django.dispatch

invoice_paid = django.dispatch.Signal()
# Sends kwargs: invoice (Invoice instance)
