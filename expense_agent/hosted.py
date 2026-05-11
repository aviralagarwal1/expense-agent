"""Hosted-credits provider.

A synthetic ``hosted`` provider id resolved server-side from environment
config. Never persisted to Supabase and never sent to the browser as a
user-owned key. Enabled when ``HOSTED_AI_API_KEY`` (or the legacy
``HOSTED_API_KEY`` alias) is set.

Env vars are read at call time so tests can patch ``os.environ`` and the
hosted state flips without requiring a re-import of this module.
"""
import os

from .ai_providers import (
    active_or_first_configured_provider,
    get_provider_key_field,
    get_provider_meta,
    list_provider_states,
    normalize_ai_provider,
)


HOSTED_PROVIDER_ID = "hosted"
HOSTED_PROVIDER_LABEL = "Compline Credits"
DEFAULT_HOSTED_DAILY_LIMIT = 20


def _read_hosted_api_key() -> str:
    return (
        os.environ.get("HOSTED_AI_API_KEY")
        or os.environ.get("HOSTED_API_KEY")
        or ""
    ).strip()


def _read_hosted_underlying_provider() -> str:
    return normalize_ai_provider(os.environ.get("HOSTED_AI_PROVIDER"))


def _read_hosted_daily_limit() -> int:
    raw = (os.environ.get("HOSTED_DAILY_SCREENSHOT_LIMIT") or "").strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_HOSTED_DAILY_LIMIT
    return max(0, value)


def hosted_ai_enabled() -> bool:
    return bool(_read_hosted_api_key())


def hosted_daily_screenshot_limit() -> int:
    return _read_hosted_daily_limit()


def hosted_provider_state() -> dict:
    meta = get_provider_meta(_read_hosted_underlying_provider())
    return {
        "id": HOSTED_PROVIDER_ID,
        "label": HOSTED_PROVIDER_LABEL,
        "model": meta["model"],
        "has_key": True,
        "hosted": True,
        "daily_limit": _read_hosted_daily_limit(),
        "underlying_provider": meta["id"],
    }


def list_extraction_provider_states(settings: dict) -> list[dict]:
    providers: list[dict] = []
    if hosted_ai_enabled():
        providers.append(hosted_provider_state())
    providers.extend(list_provider_states(settings))
    return providers


def active_extraction_provider(settings: dict) -> str:
    user_provider = active_or_first_configured_provider(settings)
    if (settings.get(get_provider_key_field(user_provider)) or "").strip():
        return user_provider
    if hosted_ai_enabled():
        return HOSTED_PROVIDER_ID
    return user_provider


def resolve_extraction_credentials(client, user_id: str, requested_provider: str | None):
    """Return ``(underlying_provider, api_key, is_hosted)``.

    For ``requested_provider == "hosted"``: returns the env-configured
    underlying provider + hosted key. For real provider ids: returns the
    user's stored key. Never returns ``"hosted"`` as the first tuple item;
    callers should always pass a real provider id to the extractor.
    """
    from .user_data import get_user_api_key  # local to avoid import cycle

    raw = (requested_provider or "").strip().lower()
    if raw == HOSTED_PROVIDER_ID:
        if not hosted_ai_enabled():
            return None, None, False
        return _read_hosted_underlying_provider(), _read_hosted_api_key(), True
    normalized = normalize_ai_provider(raw)
    api_key = get_user_api_key(client, user_id, normalized)
    return normalized, api_key, False
