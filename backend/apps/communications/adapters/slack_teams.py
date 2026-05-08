import requests


def send_webhook(webhook_url, body) -> None:
    requests.post(webhook_url, json={'text': body}, timeout=5)
