"""Production guest reports behind a single, explicitly trusted HTTPS ingress."""
import os
import re
from dataclasses import dataclass, field
from ipaddress import ip_address

import requests

TURNSTILE_ACTION = "blueplate_guest_report"
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


@dataclass(frozen=True)
class ProductionGuest:
    origin: str
    hostname: str
    peer: str
    site_key: str
    secret_key: str = field(repr=False)


def production_guest(request):
    """Return settings only for an unambiguous request from the configured ingress."""
    if (os.getenv("ENABLE_PRODUCTION_GUEST_REPORTS") != "true"
            or os.getenv("BLUEPLATE_TRUSTED_PROXY_HOPS") != "1"):
        return None
    origin = os.getenv("BLUEPLATE_PUBLIC_ORIGIN", "")
    hostname = origin.removeprefix("https://")
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if (len(hostname) > 253 or origin != f"https://{hostname}"
            or not re.fullmatch(rf"(?:{label}\.)+[a-z](?:[a-z0-9-]{{0,61}}[a-z0-9])?", hostname)):
        return None

    # Read the original WSGI peer. No forwarded values are applied to Flask.
    trusted = os.getenv("BLUEPLATE_TRUSTED_PROXY_IP")
    if (trusted not in {"127.0.0.1", "::1"} or request.remote_addr != trusted
            or request.environ.get("HTTP_HOST") != hostname
            or request.headers.get("X-Forwarded-Proto") != "https"):
        return None
    try:
        peer = ip_address(request.headers.get("X-Forwarded-For"))
    except ValueError:
        return None
    peer = getattr(peer, "ipv4_mapped", None) or peer
    if peer.is_loopback or peer.is_unspecified or peer.is_multicast or "%" in str(peer):
        return None

    site_key = os.getenv("BLUEPLATE_TURNSTILE_SITE_KEY", "")
    secret_key = os.getenv("BLUEPLATE_TURNSTILE_SECRET_KEY", "")
    if (not all(re.fullmatch(r"[A-Za-z0-9_-]{10,200}", key) for key in (site_key, secret_key))
            or site_key == secret_key):
        return None
    return ProductionGuest(origin, hostname, str(peer), site_key, secret_key)


def verify_turnstile(settings, token):
    """Retain only the verification verdict. Never log tokens or provider bodies."""
    if not isinstance(token, str) or not token.strip() or len(token) > 2048:
        return False
    response = requests.post(
        TURNSTILE_VERIFY_URL,
        data={"secret": settings.secret_key, "response": token, "remoteip": settings.peer},
        timeout=(2, 4),
        allow_redirects=False,
    )
    if response.status_code != 200:
        raise requests.RequestException("Challenge provider unavailable")
    verdict = response.json()
    if not isinstance(verdict, dict):
        raise ValueError("Invalid challenge provider response")
    return (verdict.get("success") is True
            and verdict.get("hostname") == settings.hostname
            and verdict.get("action") == TURNSTILE_ACTION)
