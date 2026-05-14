"""
apps/accounting/integrations/sage_intacct.py

Sage Intacct adapter using the XML Gateway / Web Services API.

Sage Intacct does NOT support OAuth — authentication is a layered scheme:
  sender_id + sender_password   → identifies the marketplace partner ("DocksBase")
  user_id   + user_password     → identifies the marina's Intacct user
  company_id                    → the marina's Intacct company code

config.company_id stores the company_id.
config.credentials stores: sender_id, sender_password (env-derived but
saved for clarity), user_id, user_password, location_id (optional).

API: https://developer.intacct.com/web-services/
Endpoint: https://api.intacct.com/ia/xml/xmlgw.phtml
"""

import logging
import uuid
import xml.etree.ElementTree as ET

import requests
from django.conf import settings

from apps.accounting.integrations.base import (
    AccountingAdapter,
    AdapterError,
    AdapterRetryableError,
)

logger = logging.getLogger(__name__)

INTACCT_ENDPOINT = 'https://api.intacct.com/ia/xml/xmlgw.phtml'


def _xml_escape(value: str) -> str:
    return (
        (value or '')
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
    )


class SageIntacctAdapter(AccountingAdapter):
    """Sage Intacct XML SOAP adapter."""

    def _credentials(self) -> dict:
        return self.config.credentials or {}

    def _sender_id(self) -> str:
        return self._credentials().get('sender_id') or settings.INTACCT_SENDER_ID

    def _sender_password(self) -> str:
        return self._credentials().get('sender_password') or settings.INTACCT_SENDER_PASSWORD

    def _envelope(self, function_xml: str) -> str:
        """Wrap the function payload in a Sage Intacct XML envelope."""
        creds = self._credentials()
        ctrl_id = uuid.uuid4().hex[:20]
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>{_xml_escape(self._sender_id())}</senderid>
    <password>{_xml_escape(self._sender_password())}</password>
    <controlid>{ctrl_id}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>
      <login>
        <userid>{_xml_escape(creds.get('user_id', ''))}</userid>
        <companyid>{_xml_escape(self.config.company_id)}</companyid>
        <password>{_xml_escape(creds.get('user_password', ''))}</password>
      </login>
    </authentication>
    <content>
      <function controlid="{ctrl_id}">
        {function_xml}
      </function>
    </content>
  </operation>
</request>"""

    def _call(self, function_xml: str):
        body = self._envelope(function_xml)
        try:
            response = requests.post(
                INTACCT_ENDPOINT,
                data=body.encode('utf-8'),
                headers={'Content-Type': 'application/xml'},
                timeout=20,
            )
        except requests.Timeout:
            raise AdapterRetryableError('Sage Intacct timed out.')
        if not response.ok:
            raise AdapterError(f'Sage Intacct HTTP error: {response.status_code} {response.text[:200]}')
        try:
            root = ET.fromstring(response.content)
        except ET.ParseError as exc:
            raise AdapterError(f'Sage Intacct returned invalid XML: {exc}')

        # Check operation status; Intacct embeds errors deep inside the envelope.
        op_status = root.findtext('./operation/result/status')
        if op_status and op_status.lower() != 'success':
            err = root.find('./operation/result/errormessage/error')
            description = err.findtext('description2') or err.findtext('description') if err is not None else op_status
            raise AdapterError(f'Sage Intacct: {description}')
        return root

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        # readByQuery on a benign object (CURRENCY) — minimal payload that
        # exercises auth + company resolution without side effects.
        self._call(
            '<readByQuery><object>CURRENCY</object><fields>RECORDNO</fields>'
            '<query></query><pagesize>1</pagesize></readByQuery>'
        )
        return True

    def push_invoice(self, invoice) -> str:
        lines = ''.join(
            f"""
            <lineitem>
              <glaccountno></glaccountno>
              <amount>{float(item.total_price):.2f}</amount>
              <memo>{_xml_escape(item.description)}</memo>
            </lineitem>"""
            for item in invoice.items.all()
        )
        func = f"""<create>
          <ARINVOICE>
            <CUSTOMERID>{_xml_escape(invoice.member.email if invoice.member else '')}</CUSTOMERID>
            <DATEPOSTED>{invoice.created_at.strftime('%m/%d/%Y') if invoice.created_at else ''}</DATEPOSTED>
            <DATEDUE>{invoice.due_date.strftime('%m/%d/%Y') if invoice.due_date else ''}</DATEDUE>
            <RECORDID>{_xml_escape(invoice.invoice_number)}</RECORDID>
            <ARINVOICEITEMS>{lines}</ARINVOICEITEMS>
          </ARINVOICE>
        </create>"""
        root = self._call(func)
        key = root.findtext('.//key') or ''
        logger.info('Sage Intacct: pushed invoice %s → %s', invoice.invoice_number, key)
        return key

    def push_payment(self, payment) -> str:
        invoice = payment.invoice
        func = f"""<create>
          <ARPAYMENT>
            <CUSTOMERID>{_xml_escape(invoice.member.email if invoice.member else '')}</CUSTOMERID>
            <PAYMENTDATE>{payment.paid_at.strftime('%m/%d/%Y') if payment.paid_at else ''}</PAYMENTDATE>
            <PAYMENTAMOUNT>{float(payment.amount):.2f}</PAYMENTAMOUNT>
            <RECORDID>PAY-{payment.pk}</RECORDID>
          </ARPAYMENT>
        </create>"""
        root = self._call(func)
        return root.findtext('.//key') or ''

    def push_journal_entry(self, journal_entry) -> str:
        entries = ''
        for line in journal_entry.lines.select_related('account').all():
            amount = float(line.debit) if line.debit > 0 else float(line.credit)
            tr_type = 'debit' if line.debit > 0 else 'credit'
            entries += f"""
            <GLENTRY>
              <ACCOUNTNO>{_xml_escape(line.account.external_code or line.account.code)}</ACCOUNTNO>
              <TRTYPE>{tr_type}</TRTYPE>
              <AMOUNT>{amount:.2f}</AMOUNT>
              <DESCRIPTION>{_xml_escape((line.description or '')[:100])}</DESCRIPTION>
            </GLENTRY>"""
        func = f"""<create>
          <GLBATCH>
            <JOURNAL>GJ</JOURNAL>
            <BATCH_DATE>{journal_entry.entry_date.strftime('%m/%d/%Y') if journal_entry.entry_date else ''}</BATCH_DATE>
            <BATCH_TITLE>{_xml_escape(journal_entry.reference or f'JE-{journal_entry.pk}')}</BATCH_TITLE>
            <ENTRIES>{entries}</ENTRIES>
          </GLBATCH>
        </create>"""
        root = self._call(func)
        return root.findtext('.//key') or ''

    def sync_chart_of_accounts(self) -> list:
        func = """<readByQuery>
          <object>GLACCOUNT</object>
          <fields>RECORDNO,ACCOUNTNO,TITLE,ACCOUNTTYPE</fields>
          <query></query>
          <pagesize>1000</pagesize>
        </readByQuery>"""
        root = self._call(func)
        results = []
        for acct in root.findall('.//data/glaccount'):
            results.append({
                'code':          (acct.findtext('ACCOUNTNO') or '').strip(),
                'name':          (acct.findtext('TITLE') or '').strip(),
                'account_type':  _intacct_type_to_local(acct.findtext('ACCOUNTTYPE') or ''),
                'external_code': (acct.findtext('RECORDNO') or '').strip(),
            })
        return results

    def sync_contacts(self) -> list:
        func = """<readByQuery>
          <object>CUSTOMER</object>
          <fields>CUSTOMERID,NAME,DISPLAYCONTACT.EMAIL1</fields>
          <query></query>
          <pagesize>1000</pagesize>
        </readByQuery>"""
        root = self._call(func)
        results = []
        for cust in root.findall('.//data/customer'):
            results.append({
                'external_id': (cust.findtext('CUSTOMERID') or '').strip(),
                'name':        (cust.findtext('NAME') or '').strip(),
                'email':       (cust.findtext('DISPLAYCONTACT.EMAIL1') or '').strip(),
            })
        return results


def _intacct_type_to_local(account_type: str) -> str:
    t = (account_type or '').lower()
    if 'liab' in t:                    return 'liability'
    if 'equity' in t:                  return 'equity'
    if 'income' in t or 'revenue' in t: return 'revenue'
    if 'expense' in t:                 return 'expense'
    return 'asset'
