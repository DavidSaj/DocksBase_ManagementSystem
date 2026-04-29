from django.contrib import admin
from .models import DocTemplate, Envelope, MemberDocument

admin.site.register(DocTemplate)
admin.site.register(Envelope)
admin.site.register(MemberDocument)
