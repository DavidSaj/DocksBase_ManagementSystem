"""
apps/accounting/integrations/__init__.py

Adapter dispatcher — maps platform codes to their adapter classes.
"""

from apps.accounting.integrations.xero import XeroAdapter
from apps.accounting.integrations.qbo import QuickBooksOnlineAdapter
from apps.accounting.integrations.sage_business_cloud import SageBusinessCloudAdapter
from apps.accounting.integrations.netsuite import NetSuiteAdapter
from apps.accounting.integrations.dynamics365 import Dynamics365Adapter
from apps.accounting.integrations.sage_intacct import SageIntacctAdapter
from apps.accounting.integrations.myob import MYOBAdapter

ADAPTER_MAP = {
    'xero':                XeroAdapter,
    'qbo':                 QuickBooksOnlineAdapter,
    'sage_business_cloud': SageBusinessCloudAdapter,
    'netsuite':            NetSuiteAdapter,
    'dynamics365':         Dynamics365Adapter,
    'sage_intacct':        SageIntacctAdapter,
    'myob':                MYOBAdapter,
}


def _get_adapter(config):
    """
    Instantiate the accounting adapter for the given AccountingIntegrationConfig.
    Raises ValueError for unknown platforms.
    """
    cls = ADAPTER_MAP.get(config.platform)
    if not cls:
        raise ValueError(f'Unknown accounting platform: {config.platform}')
    return cls(config)
