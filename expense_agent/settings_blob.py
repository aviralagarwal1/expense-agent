import json
from uuid import uuid4

from .cards import normalize_card_brand, normalize_reference_digits, serialize_user_card


def build_empty_user_settings():
    return {
        "anthropic_api_key": None,
        "profile": {"first_name": None, "last_name": None},
        "cards": [],
    }


def normalize_stored_profile(profile: dict | None):
    profile = profile or {}
    return {
        "first_name": (profile.get("first_name") or "").strip() or None,
        "last_name": (profile.get("last_name") or "").strip() or None,
    }


def parse_user_settings_blob(raw_value: str | None):
    settings = build_empty_user_settings()
    raw_text = (raw_value or "").strip()
    if not raw_text:
        return settings

    payload = None
    if raw_text.startswith("{"):
        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError:
            payload = None

    if isinstance(payload, dict):
        settings["anthropic_api_key"] = (payload.get("anthropic_api_key") or "").strip() or None
        settings["profile"] = normalize_stored_profile(payload.get("profile"))
        settings["cards"] = [
            serialize_user_card(card)
            for card in (payload.get("cards") or [])
            if isinstance(card, dict)
        ]
        return settings

    settings["anthropic_api_key"] = raw_text
    return settings


def serialize_user_settings_blob(settings: dict):
    payload = {
        "anthropic_api_key": (settings.get("anthropic_api_key") or "").strip() or None,
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
    }
    return json.dumps(payload, separators=(",", ":"))
