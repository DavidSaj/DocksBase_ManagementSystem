from apps.channels.ota.adapters.dockwa import DockwaAdapter

ADAPTER_MAP = {
    'dockwa': DockwaAdapter,
}


def get_adapter(channel):
    cls = ADAPTER_MAP.get(channel.provider)
    if not cls:
        raise ValueError(f'No adapter for provider: {channel.provider}')
    return cls(channel)
