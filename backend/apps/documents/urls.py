from django.urls import path
from .views import (
    DocTemplateList, DocTemplateDetail, DocTemplatePrepare,
    EnvelopeList, EnvelopeDetail, EnvelopeDownload,
    MemberDocumentList, MemberDocumentDetail,
    DropboxSignWebhook,
)

urlpatterns = [
    path('doc-templates/', DocTemplateList.as_view()),
    path('doc-templates/<int:pk>/', DocTemplateDetail.as_view()),
    path('doc-templates/<int:pk>/prepare/', DocTemplatePrepare.as_view()),
    path('envelopes/', EnvelopeList.as_view()),
    path('envelopes/<int:pk>/', EnvelopeDetail.as_view()),
    path('envelopes/<int:pk>/download/', EnvelopeDownload.as_view()),
    path('member-documents/', MemberDocumentList.as_view()),
    path('member-documents/<int:pk>/', MemberDocumentDetail.as_view()),
    path('documents/webhook/', DropboxSignWebhook.as_view()),
]
