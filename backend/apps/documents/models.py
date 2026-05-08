from django.db import models


class DocTemplate(models.Model):
    CATEGORY = [
        ('lease',             'Lease'),
        ('insurance',         'Insurance'),
        ('waiver',            'Waiver'),
        ('charter_agreement', 'Charter Agreement'),
        ('other',             'Other'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='doc_templates')
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=CATEGORY, default='other')
    pages = models.IntegerField(default=1)
    fields_count = models.IntegerField(default=0)
    uses_count = models.IntegerField(default=0)
    last_used = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    file = models.FileField(upload_to='doc_templates/', blank=True)
    dropboxsign_template_id = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class Envelope(models.Model):
    STATUS = [('pending', 'Pending'), ('completed', 'Completed'), ('expired', 'Expired')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='envelopes')
    template = models.ForeignKey(DocTemplate, on_delete=models.PROTECT)
    recipient = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='pending')
    reminders_sent = models.IntegerField(default=0)
    dropboxsign_request_id = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        return f'Envelope #{self.pk} — {self.template.name}'


class MemberDocument(models.Model):
    DOC_TYPE = [('insurance', 'Insurance'), ('registration', 'Registration')]
    STATUS = [
        ('pending_upload', 'Pending Upload'),
        ('uploaded', 'Uploaded'),
        ('verified', 'Verified'),
        ('due_soon', 'Due Soon'),
        ('expired', 'Expired'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='member_documents')
    member = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='documents')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='documents')
    doc_type = models.CharField(max_length=20, choices=DOC_TYPE)
    file = models.FileField(upload_to='member_docs/', blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='pending_upload')
    notes = models.TextField(blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.member.name}'
