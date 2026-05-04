import json
from uuid import uuid4

from .ai_providers import AI_PROVIDER_META, normalize_ai_provider
from .cards import normalize_card_brand, normalize_reference_digits, serialize_user_card


def build_empty_user_settings():
    return {
        "anthropic_api_key": None,
        "openai_api_key": None,
        "gemini_api_key": None,
        "active_ai_provider": "anthropic",
        "profile": {"first_name": None, "last_name": None},
        "cards": [],
        "hosted_usage": {"date": None, "screenshots": 0},
    }


def normalize_stored_profile(profile: dict | None):
    profile = profile or {}
    return {
        "first_name": (profile.get("first_name") or "").strip() or None,
        "last_name": (profile.get("last_name") or "").strip() or None,
    }


def normalize_hosted_usage(usage: dict | None):
    usage = usage if isinstance(usage, dict) else {}
    raw_date = (str(usage.get("date") or "")).strip() or None
    try:
        screenshots = int(usage.get("screenshots") or 0)
    except (TypeError, ValueError):
        screenshots = 0
    return {"date": raw_date, "screenshots": max(0, screenshots)}


def parse_user_settings_blob(raw_value: str | None):
    settings = build_empty_user_settings()
    raw_text = (raw_value or "").strip()
    if not raw_text:
        return settings

    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError:
        return settings

    if not isinstance(payload, dict):
        return settings

    for meta in AI_PROVIDER_META.values():
        key_field = meta["key_field"]
        settings[key_field] = (payload.get(key_field) or "").strip() or None
    settings["active_ai_provider"] = normalize_ai_provider(payload.get("active_ai_provider"))
    settings["profile"] = normalize_stored_profile(payload.get("profile"))
    settings["cards"] = [
        serialize_user_card(card)
        for card in (payload.get("cards") or [])
        if isinstance(card, dict)
    ]
    settings["hosted_usage"] = normalize_hosted_usage(payload.get("hosted_usage"))
    return settings


def serialize_user_settings_blob(settings: dict):
    payload = {
        "active_ai_provider": normalize_ai_provider(settings.get("active_ai_provider")),
        "profile": normalize_stored_profile(settings.get("profile")),
        "cards": [
            {
                "id": str(card.get("id") or uuid4()),
                "brand": normalize_card_brand(card.get("brand")) or (card.get("brand") or "Card").strip(),
                "digit_hint": normalize_reference_digits(card.get("digit_hint")),
                "hint_position": (card.get("hint_position") or "ending").strip().lower(),
            }
            for card in (settings.get("cards") or [])
            if isinstance(card, dict)
        ],
        "hosted_usage": normalize_hosted_usage(settings.get("hosted_usage")),
    }
    for meta in AI_PROVIDER_META.values():
        key_field = meta["key_field"]
        payload[key_field] = (settings.get(key_field) or "").strip() or None
    return json.dumps(payload, separators=(",", ":"))
