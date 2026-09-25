import re
from uuid import uuid4


CARD_HINT_POSITIONS = {"ending", "starting"}

# Payment-network synonyms only (spacing, punctuation, shorthand). We do not map
# issuer or product names (for example Capital One or Savor) to a network.
_NETWORK_BRAND_ALIASES: dict[str, str] = {
    "american express": "American Express",
    "americanexpress": "American Express",
    "amex": "American Express",
    "visa": "Visa",
    "visa card": "Visa",
    "visacard": "Visa",
    "mastercard": "Mastercard",
    "master card": "Mastercard",
    "mc": "Mastercard",
    "discover": "Discover",
    "discover card": "Discover",
    "discovercard": "Discover",
}


def normalize_reference_digits(value: str | None, *, max_length: int = 2, align: str = "left") -> str | None:
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return None
    if len(digits) <= max_length:
        return digits
    if align == "right":
        return digits[-max_length:]
    return digits[:max_length]


def _network_brand_lookup_keys(value: str | None) -> list[str]:
    text = (value or "").strip()
    if not text:
        return []
    spaced = " ".join(text.split()).lower()
    compact = re.sub(r"[^a-z0-9]", "", spaced)
    keys = [spaced]
    if compact and compact not in keys:
        keys.append(compact)
    return keys


def normalize_card_brand(value: str | None) -> str | None:
    for key in _network_brand_lookup_keys(value):
        canonical = _NETWORK_BRAND_ALIASES.get(key)
        if canonical:
            return canonical
    return None


def _title_case_token(token: str) -> str:
    if not token:
        return token
    return token[0].upper() + token[1:].lower()


def present_custom_card_brand(name: str) -> str:
    """Title-case issuer or custom labels. Networks use normalize_card_brand instead."""
    text = " ".join(name.strip().split())
    if not text:
        return text
    parts = []
    for word in text.split():
        if "-" in word:
            parts.append("-".join(_title_case_token(p) for p in word.split("-") if p))
        else:
            parts.append(_title_case_token(word))
    return " ".join(parts)


def clean_card_brand(value: str | None) -> str | None:
    canonical = normalize_card_brand(value)
    if canonical:
        return canonical

    cleaned = " ".join((value or "").strip().split())
    if not cleaned:
        return None

    if len(cleaned) > 40:
        cleaned = cleaned[:40].rstrip()
    return present_custom_card_brand(cleaned)


def format_saved_card_label(brand: str, digit_hint: str | None = None, hint_position: str = "ending") -> str:
    if digit_hint:
        return f"{brand} {hint_position} in {digit_hint}"
    return brand


def canonicalize_card_label(value: str | None) -> str | None:
    raw = " ".join((value or "").strip().split())
    if not raw:
        return None

    standard_match = re.match(
        r"^(American Express|Visa|Mastercard|Discover)(?:\s+(ending|starting)\s+in\s+(\d{1,4}))?$",
        raw,
        re.IGNORECASE,
    )
    if standard_match:
        brand = normalize_card_brand(standard_match.group(1))
        position = (standard_match.group(2) or "ending").lower()
        digits = normalize_reference_digits(
            standard_match.group(3),
            align="right" if position == "ending" else "left",
        )
        return format_saved_card_label(brand, digits, position)

    legacy_match = re.match(r"^(.*?)(?:\s*\((\d{1,4})\))?$", raw)
    if legacy_match:
        brand = normalize_card_brand(legacy_match.group(1))
        if brand:
            digits = normalize_reference_digits(legacy_match.group(2), align="right")
            return format_saved_card_label(brand, digits, "ending")

    return raw


def serialize_user_card(row: dict) -> dict:
    raw_brand = (row.get("brand") or "Card").strip()
    net = normalize_card_brand(raw_brand)
    brand = net if net else present_custom_card_brand(raw_brand) or "Card"
    hint_position = (row.get("hint_position") or "ending").strip().lower()
    if hint_position not in CARD_HINT_POSITIONS:
        hint_position = "ending"
    digit_hint = normalize_reference_digits(row.get("digit_hint"))
    return {
        "id": str(row.get("id") or uuid4()),
        "brand": brand,
        "digit_hint": digit_hint,
        "hint_position": hint_position,
        "label": format_saved_card_label(brand, digit_hint, hint_position),
    }
