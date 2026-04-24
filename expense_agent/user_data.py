import re
from uuid import uuid4

from .cards import (
    CARD_HINT_POSITIONS,
    clean_card_brand,
    format_saved_card_label,
    normalize_reference_digits,
    serialize_user_card,
)
from .profile import get_profile_seed_from_user
from .settings_blob import (
    build_empty_user_settings,
    normalize_stored_profile,
    parse_user_settings_blob,
    serialize_user_settings_blob,
)


def get_user_settings_state_for_user(client, user_id: str):
    result = (
        client.table("user_settings")
        .select("anthropic_api_key")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return parse_user_settings_blob(result.data[0].get("anthropic_api_key"))
    return build_empty_user_settings()


def save_user_settings_state_for_user(client, user_id: str, settings: dict):
    serialized = serialize_user_settings_blob(settings)
    client.table("user_settings").upsert({
        "user_id": user_id,
        "anthropic_api_key": serialized,
    }).execute()
    return parse_user_settings_blob(serialized)


def get_user_api_key(client, user_id: str):
    return get_user_settings_state_for_user(client, user_id).get("anthropic_api_key")


def list_user_cards_for_user(client, user_id: str) -> list:
    settings = get_user_settings_state_for_user(client, user_id)
    return [serialize_user_card(row) for row in (settings.get("cards") or [])]


def get_user_card_for_user(client, user_id: str, card_id: str):
    for card in list_user_cards_for_user(client, user_id):
        if card["id"] == card_id:
            return card
    return None


def create_user_card_for_user(client, user_id: str, brand: str, digit_hint: str | None, hint_position: str) -> dict:
    cleaned_brand = clean_card_brand(brand)
    if not cleaned_brand:
        raise ValueError("Select or enter a card brand.")

    raw_digits = re.sub(r"\D", "", digit_hint or "")
    if digit_hint and not raw_digits:
        raise ValueError("Reference digits must be numeric.")
    if len(raw_digits) > 2:
        raise ValueError("Use one or two reference digits only.")

    normalized_position = (hint_position or "").strip().lower()
    if raw_digits and normalized_position not in CARD_HINT_POSITIONS:
        raise ValueError("Choose whether the digits are at the start or end.")
    if normalized_position not in CARD_HINT_POSITIONS:
        normalized_position = "ending"

    normalized_digit_hint = normalize_reference_digits(raw_digits)
    label = format_saved_card_label(cleaned_brand, normalized_digit_hint, normalized_position)
    settings = get_user_settings_state_for_user(client, user_id)
    existing_cards = [serialize_user_card(card) for card in (settings.get("cards") or [])]
    if not normalized_digit_hint and any(card["brand"].lower() == cleaned_brand.lower() for card in existing_cards):
        raise ValueError(
            f"You already have a {cleaned_brand} registered. Remove the existing one or add unique reference digits."
        )
    if any(card["label"] == label for card in existing_cards):
        raise ValueError("That card is already saved.")

    card = serialize_user_card({
        "id": str(uuid4()),
        "brand": cleaned_brand,
        "digit_hint": normalized_digit_hint,
        "hint_position": normalized_position,
    })
    settings["cards"] = existing_cards + [card]
    save_user_settings_state_for_user(client, user_id, settings)
    return card


def delete_user_card_for_user(client, user_id: str, card_id: str) -> bool:
    settings = get_user_settings_state_for_user(client, user_id)
    existing_cards = [serialize_user_card(card) for card in (settings.get("cards") or [])]
    remaining_cards = [card for card in existing_cards if card["id"] != card_id]
    if len(remaining_cards) == len(existing_cards):
        return False
    settings["cards"] = remaining_cards
    save_user_settings_state_for_user(client, user_id, settings)
    return True


def get_profile_for_user(client, user_id: str):
    profile = get_user_settings_state_for_user(client, user_id).get("profile") or {}
    normalized = normalize_stored_profile(profile)
    if normalized.get("first_name") or normalized.get("last_name"):
        return normalized
    return None


def upsert_profile_for_user(client, user_id: str, first_name: str | None, last_name: str | None):
    profile = {
        "first_name": first_name or None,
        "last_name": last_name or None,
    }
    settings = get_user_settings_state_for_user(client, user_id)
    settings["profile"] = normalize_stored_profile(profile)
    save_user_settings_state_for_user(client, user_id, settings)
    return settings["profile"]


def user_has_transactions(client, user_id: str) -> bool:
    result = (
        client.table("transactions")
        .select("id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(result.data)


def ensure_profile_for_user(client, user):
    user_id = user.id
    seed = get_profile_seed_from_user(user)
    profile = get_profile_for_user(client, user_id)

    if not profile:
        return seed

    return {
        "first_name": profile.get("first_name") or seed.get("first_name"),
        "last_name": profile.get("last_name") or seed.get("last_name"),
    }


def is_new_user_account(client, user_id: str, has_key: bool, profile: dict | None):
    if has_key:
        return False
    if profile and (profile.get("first_name") or profile.get("last_name")):
        return False
    return not user_has_transactions(client, user_id)
