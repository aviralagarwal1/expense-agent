import os
import json
import base64
import re
from uuid import uuid4
import anthropic
from urllib.parse import urlencode
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client, Client
from flask import Flask, request, jsonify, render_template, redirect, url_for
from datetime import datetime
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config["TEMPLATES_AUTO_RELOAD"] = True

# ── Config ──────────────────────────────────────────────────────────────────
SUPABASE_URL         = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
APP_URL              = (os.environ.get("APP_URL") or "").rstrip("/")

supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

CARD_HINT_POSITIONS = {"ending", "starting"}

# Payment-network synonyms only (spacing, punctuation, shorthand). We do not map
# issuer or product names (e.g. Capital One, Savor) to a network — those banks
# issue both Visa and Mastercard cards, so collapsing them would be wrong.
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


def get_external_app_url(path: str = "/"):
    base_url = APP_URL or request.url_root.rstrip("/")
    return f"{base_url}{path}"


def redirect_to_app_with_error(error_code: str):
    return redirect(url_for("index", auth_error=error_code))


def get_user_from_request():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        response = supabase_admin.auth.get_user(token)
        return response.user
    except Exception:
        return None


# ── Auth helper ──────────────────────────────────────────────────────────────
def get_user_id_from_request():
    user = get_user_from_request()
    return user.id if user else None


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


def get_user_settings_state_for_user(user_id: str):
    result = (
        supabase_admin.table("user_settings")
        .select("anthropic_api_key")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return parse_user_settings_blob(result.data[0].get("anthropic_api_key"))
    return build_empty_user_settings()


def save_user_settings_state_for_user(user_id: str, settings: dict):
    serialized = serialize_user_settings_blob(settings)
    supabase_admin.table("user_settings").upsert({
        "user_id": user_id,
        "anthropic_api_key": serialized,
    }).execute()
    return parse_user_settings_blob(serialized)


# ── User settings (BYOA) ─────────────────────────────────────────────────────
def get_user_api_key(user_id: str):
    return get_user_settings_state_for_user(user_id).get("anthropic_api_key")


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
    """Title-case issuer / custom labels. Networks use normalize_card_brand instead."""
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


def list_user_cards_for_user(user_id: str) -> list:
    settings = get_user_settings_state_for_user(user_id)
    return [serialize_user_card(row) for row in (settings.get("cards") or [])]


def get_user_card_for_user(user_id: str, card_id: str):
    for card in list_user_cards_for_user(user_id):
        if card["id"] == card_id:
            return card
    return None


def create_user_card_for_user(user_id: str, brand: str, digit_hint: str | None, hint_position: str) -> dict:
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
    settings = get_user_settings_state_for_user(user_id)
    existing_cards = [serialize_user_card(card) for card in (settings.get("cards") or [])]
    if not normalized_digit_hint and any(card["brand"].lower() == cleaned_brand.lower() for card in existing_cards):
        raise ValueError(
            f"You already have a {cleaned_brand} registered. Remove the existing one or add 1-2 reference digits so we can tell them apart."
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
    save_user_settings_state_for_user(user_id, settings)
    return card


def delete_user_card_for_user(user_id: str, card_id: str) -> bool:
    settings = get_user_settings_state_for_user(user_id)
    existing_cards = [serialize_user_card(card) for card in (settings.get("cards") or [])]
    remaining_cards = [card for card in existing_cards if card["id"] != card_id]
    if len(remaining_cards) == len(existing_cards):
        return False
    settings["cards"] = remaining_cards
    save_user_settings_state_for_user(user_id, settings)
    return True


def split_name_parts(full_name: str):
    parts = [part for part in (full_name or "").strip().split() if part]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def get_profile_seed_from_user(user):
    metadata = getattr(user, "user_metadata", {}) or {}

    first_name = (
        metadata.get("first_name")
        or metadata.get("firstName")
        or metadata.get("given_name")
        or ""
    ).strip()
    last_name = (
        metadata.get("last_name")
        or metadata.get("lastName")
        or metadata.get("family_name")
        or ""
    ).strip()

    if not first_name:
        seed_full_name = (
            metadata.get("full_name")
            or metadata.get("display_name")
            or metadata.get("name")
            or ""
        ).strip()
        seed_first, seed_last = split_name_parts(seed_full_name)
        first_name = first_name or seed_first
        last_name = last_name or seed_last

    return {
        "first_name": first_name or None,
        "last_name": last_name or None,
    }


def get_profile_for_user(user_id: str):
    profile = get_user_settings_state_for_user(user_id).get("profile") or {}
    normalized = normalize_stored_profile(profile)
    if normalized.get("first_name") or normalized.get("last_name"):
        return normalized
    return None


def upsert_profile_for_user(user_id: str, first_name: str | None, last_name: str | None):
    profile = {
        "first_name": first_name or None,
        "last_name": last_name or None,
    }
    settings = get_user_settings_state_for_user(user_id)
    settings["profile"] = normalize_stored_profile(profile)
    save_user_settings_state_for_user(user_id, settings)
    return settings["profile"]


def user_has_transactions(user_id: str) -> bool:
    result = (
        supabase_admin.table("transactions")
        .select("id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(result.data)


def ensure_profile_for_user(user):
    user_id = user.id
    seed = get_profile_seed_from_user(user)
    profile = get_profile_for_user(user_id)

    if not profile:
        return seed

    return {
        "first_name": profile.get("first_name") or seed.get("first_name"),
        "last_name": profile.get("last_name") or seed.get("last_name"),
    }


def is_new_user_account(user_id: str, has_key: bool, profile: dict | None):
    if has_key:
        return False
    if profile and (profile.get("first_name") or profile.get("last_name")):
        return False
    return not user_has_transactions(user_id)


# ── Vendor normalization ──────────────────────────────────────────────────────
def normalize_vendor(name: str) -> str:
    name = name.lower().strip()
    if " & " in name:
        name = name.split(" & ")[0].strip()
    for suffix in [" inc", " llc", " ltd", " co", " corp", " store", " qps"]:
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
    if name.endswith("s") and len(name) > 4:
        name = name[:-1]
    return name.strip()


# ── Supabase storage ─────────────────────────────────────────────────────────
def get_existing_transactions_for_user(user_id: str) -> list:
    result = (
        supabase_admin.table("transactions")
        .select("vendor,amount,date,card")
        .eq("user_id", user_id)
        .execute()
    )
    transactions = []
    for row in result.data:
        vendor = normalize_vendor(row["vendor"])
        try:
            amount = float(row["amount"])
        except (TypeError, ValueError):
            continue
        dt = None
        if row.get("date"):
            try:
                dt = datetime.strptime(row["date"], "%Y-%m-%d")
            except ValueError:
                pass
        transactions.append({
            "vendor": vendor,
            "card": canonicalize_card_label(row.get("card")) or "",
            "amount": amount,
            "date": dt,
        })
    return transactions


def append_transactions_for_user(user_id: str, transactions: list, batch_id: str | None = None) -> list:
    rows = []
    for t in transactions:
        rows.append({
            "user_id":  user_id,
            "vendor":   t["vendor"],
            "card":     canonicalize_card_label(t.get("card")),
            "date":     t.get("date"),
            "amount":   float(str(t["amount"]).replace("$", "").replace(",", "")),
            "status":   t.get("status"),
            "batch_id": batch_id,
        })
    result = supabase_admin.table("transactions").insert(rows).execute()
    return [row.get("id") for row in (result.data or []) if row.get("id")]


# ── Claude Vision ────────────────────────────────────────────────────────────
# Same entry point linked from settings.html and index onboarding copy.
ANTHROPIC_CONSOLE_KEYS_URL = "https://console.anthropic.com/settings/keys"


def user_facing_extraction_error(exc: Exception) -> tuple[str, str]:
    """Map Claude/API failures to a safe message. Never expose raw exception text to clients."""
    url = ANTHROPIC_CONSOLE_KEYS_URL
    if isinstance(exc, json.JSONDecodeError):
        return (
            "We could not read the analysis result. Try again with clear card-app screenshots.",
            url,
        )
    if isinstance(exc, anthropic.AuthenticationError):
        return (
            "Anthropic rejected your API key. Add a valid key from the Anthropic Console under Settings in this app.",
            url,
        )
    if isinstance(exc, anthropic.RateLimitError):
        return (
            "Anthropic is rate limiting requests. Wait a minute and try again, or check usage in the Anthropic Console.",
            url,
        )
    if isinstance(exc, anthropic.BadRequestError):
        return (
            "Anthropic could not process these screenshots. Try fewer or smaller images, then try again.",
            url,
        )
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return (
            "Could not reach Anthropic. Check your connection and try again.",
            url,
        )
    if isinstance(exc, anthropic.APIStatusError):
        code = getattr(exc, "status_code", None)
        if code == 402:
            return (
                "Anthropic could not bill this request. Add credits or a payment method in the Anthropic Console.",
                url,
            )
        if code in (401, 403):
            return (
                "Anthropic rejected this request. Confirm your API key in Settings and in the Anthropic Console.",
                url,
            )
        if code == 413:
            return (
                "The upload was too large for Anthropic. Try fewer screenshots or smaller files.",
                url,
            )
        if code is not None and code >= 500:
            return (
                "Anthropic had a temporary problem. Try again in a moment.",
                url,
            )
    return (
        "Screenshot analysis could not finish. Check your API key, usage, and billing in the Anthropic Console, then try again.",
        url,
    )


def extract_transactions_from_images(image_data_list: list, api_key: str) -> list:
    client = anthropic.Anthropic(api_key=api_key, timeout=90.0)

    content = []
    for b64, mime_type in image_data_list:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        })

    content.append({
        "type": "text",
        "text": """Extract ALL transactions from these credit card app screenshots.
Include both pending and settled transactions.

Return ONLY a JSON array, no other text, like this:
[
  {
    "vendor": "Cava",
    "date": "2026-02-09",
    "amount": "15.80",
    "status": "settled"
  }
]

Rules:
- vendor: clean merchant name
- date: YYYY-MM-DD format. If only month/day shown, assume 2026.
- amount: numeric string only, no $ sign (e.g. "15.80")
- status: "pending" or "settled"
- IGNORE any transactions with a negative amount (credits, autopayments, refunds) — expenses only
- IGNORE any transaction labeled as "autopay", "payment", "credit", or "refund"
- DO NOT infer or return the card name. The selected card is attached separately.
- Include ALL expense transactions you can see across all screenshots""",
    })

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def attach_selected_card_to_transactions(transactions: list, card_label: str) -> list:
    normalized_card = canonicalize_card_label(card_label) or card_label
    stamped = []
    for tx in transactions:
        stamped.append({
            "vendor": (tx.get("vendor") or "").strip(),
            "card": normalized_card,
            "date": (tx.get("date") or "").strip(),
            "amount": tx.get("amount"),
            "status": (tx.get("status") or "").strip().lower(),
        })
    return stamped


# ── Deduplication ────────────────────────────────────────────────────────────
def classify_transactions(new_txs: list, existing_txs: list):
    definite_new = []
    definite_dup = []
    possible_dup = []
    seen_keys = set()

    for t in new_txs:
        vendor = normalize_vendor(t["vendor"])
        card = canonicalize_card_label(t.get("card")) or ""
        try:
            amount = float(str(t["amount"]).replace("$", "").replace(",", ""))
        except ValueError:
            definite_new.append(t)
            continue

        try:
            t_date = datetime.strptime(t["date"], "%Y-%m-%d")
        except Exception:
            t_date = None

        upload_key = f"{vendor}|{card}|{amount}|{t.get('date','')}"
        if upload_key in seen_keys:
            definite_dup.append(t)
            continue
        seen_keys.add(upload_key)

        exact_match = False
        fuzzy_match = False
        fuzzy_existing = None

        for ex in existing_txs:
            if ex["vendor"] != vendor:
                continue
            if ex.get("card", "") != card:
                continue
            if abs(ex["amount"] - amount) > 0.01:
                continue

            if t_date and ex["date"]:
                delta = abs((t_date - ex["date"]).days)
                if delta == 0:
                    exact_match = True
                    break
                elif delta <= 1:
                    fuzzy_match = True
                    fuzzy_existing = ex
            else:
                exact_match = True
                break

        if exact_match:
            definite_dup.append(t)
        elif fuzzy_match:
            t["possible_match"] = {
                "date": fuzzy_existing["date"].strftime("%Y-%m-%d") if fuzzy_existing["date"] else "?",
                "amount": fuzzy_existing["amount"],
            }
            possible_dup.append(t)
        else:
            definite_new.append(t)

    return definite_new, definite_dup, possible_dup


# ── Routes ───────────────────────────────────────────────────────────────────
@app.route("/")
def landing():
    return render_template("landing.html")


@app.route("/app")
def index():
    return render_template("index.html", auth_mode="signin")


@app.route("/register")
def register():
    """Same workspace shell as /app, with onboarding-oriented auth copy for new visitors."""
    return render_template("index.html", auth_mode="register")


@app.route("/connect-key")
def connect_key_page():
    return render_template("settings.html")


@app.route("/settings")
def settings_page():
    return render_template("profile_settings.html")


@app.route("/auth/google")
def auth_google():
    redirect_to = get_external_app_url("/auth/callback")
    try:
        response = supabase_admin.auth.sign_in_with_oauth({
            "provider": "google",
            "options": {
                "redirect_to": redirect_to,
                "scopes": "email profile",
                "query_params": {
                    "prompt": "select_account",
                },
            },
        })
        auth_url = getattr(response, "url", "")
        if not auth_url:
            raise RuntimeError("Supabase did not return an OAuth URL")
        return redirect(auth_url)
    except Exception:
        app.logger.exception("Failed to start Google OAuth")
        return redirect_to_app_with_error("google_sign_in_unavailable")


@app.route("/auth/callback")
def auth_callback():
    auth_code = request.args.get("code")
    if not auth_code:
        app.logger.error("Missing OAuth code on callback: %s", dict(request.args))
        return redirect_to_app_with_error("google_callback_missing_code")

    try:
        response = supabase_admin.auth.exchange_code_for_session({
            "auth_code": auth_code,
        })
        session = getattr(response, "session", None)
        access_token = getattr(session, "access_token", "") if session else ""
        refresh_token = getattr(session, "refresh_token", "") if session else ""
        if not access_token:
            raise RuntimeError("Supabase did not return an access token")
        fragment = urlencode({
            "access_token": access_token,
            "refresh_token": refresh_token or "",
        })
        return redirect(f"{get_external_app_url('/app')}#{fragment}")
    except Exception:
        app.logger.exception("Failed to exchange Google OAuth code for session")
        return redirect_to_app_with_error("google_callback_exchange_failed")


@app.route("/api/settings", methods=["GET"])
def api_settings_get():
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    key = get_user_api_key(user.id)
    try:
        profile = ensure_profile_for_user(user)
    except Exception:
        profile = get_profile_seed_from_user(user)
    try:
        is_new_user = is_new_user_account(user.id, bool(key), profile)
    except Exception:
        is_new_user = False
    try:
        cards = list_user_cards_for_user(user.id)
    except Exception:
        cards = []
    return jsonify({"has_key": bool(key), "profile": profile, "is_new_user": is_new_user, "cards": cards})


@app.route("/api/settings", methods=["POST"])
def api_settings_save():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    api_key = data.get("anthropic_api_key", "").strip()
    if not api_key:
        return jsonify({"error": "API key is required"}), 400
    settings = get_user_settings_state_for_user(user_id)
    settings["anthropic_api_key"] = api_key
    save_user_settings_state_for_user(user_id, settings)
    return jsonify({"success": True})


@app.route("/api/profile", methods=["POST"])
def api_profile_save():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()

    if not first_name:
        return jsonify({"error": "First name is required"}), 400

    try:
        profile = upsert_profile_for_user(user_id, first_name, last_name)
    except Exception as e:
        return jsonify({"error": f"Failed to save profile: {str(e)}"}), 500
    return jsonify({"success": True, "profile": profile})


@app.route("/api/cards", methods=["POST"])
def api_card_create():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    try:
        card = create_user_card_for_user(
            user_id,
            data.get("brand"),
            data.get("digit_hint"),
            data.get("hint_position"),
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to save card: {str(e)}"}), 500

    return jsonify({"success": True, "card": card})


@app.route("/api/cards/<card_id>", methods=["DELETE"])
def api_card_delete(card_id: str):
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        deleted = delete_user_card_for_user(user_id, card_id)
    except Exception as e:
        return jsonify({"error": f"Failed to delete card: {str(e)}"}), 500

    if not deleted:
        return jsonify({"error": "Card not found"}), 404
    return jsonify({"success": True})


@app.route("/api/welcome-seen", methods=["POST"])
def api_welcome_seen():
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        seed = get_profile_seed_from_user(user)
        profile = upsert_profile_for_user(user.id, seed.get("first_name"), seed.get("last_name"))
        return jsonify({"success": True, "profile": profile})
    except Exception:
        return jsonify({"success": True})


@app.route("/upload", methods=["POST"])
def upload():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    api_key = get_user_api_key(user_id)
    if not api_key:
        return jsonify({"error": "no_api_key"}), 400

    selected_card_id = (request.form.get("selected_card_id") or "").strip()
    if not selected_card_id:
        return jsonify({"error": "no_card_selected"}), 400

    selected_card = get_user_card_for_user(user_id, selected_card_id)
    if not selected_card:
        return jsonify({"error": "invalid_card"}), 400

    files = request.files.getlist("screenshots")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    image_data_list = []
    for f in files:
        data = f.read()
        mime_type = f.content_type or "image/jpeg"
        if "heic" in mime_type.lower() or "heif" in mime_type.lower():
            mime_type = "image/jpeg"
        b64 = base64.standard_b64encode(data).decode("utf-8")
        image_data_list.append((b64, mime_type))

    try:
        extracted_transactions = extract_transactions_from_images(image_data_list, api_key)
        all_transactions = attach_selected_card_to_transactions(extracted_transactions, selected_card["label"])
    except Exception as e:
        app.logger.exception("Claude extraction failed for user_id=%s", user_id)
        msg, help_url = user_facing_extraction_error(e)
        return jsonify({"error": msg, "help_url": help_url}), 500

    try:
        existing_txs = get_existing_transactions_for_user(user_id)
    except Exception as e:
        return jsonify({"error": f"Database query failed: {str(e)}"}), 500

    definite_new, definite_dup, possible_dup = classify_transactions(all_transactions, existing_txs)

    # Mint a batch id for this analyze session. The client threads it through every
    # /confirm call originating from this analysis so the resulting rows can be
    # grouped and (if the user filed to the wrong card) deleted as a unit.
    batch_id = str(uuid4())

    return jsonify({
        "batch_id":        batch_id,
        "new":             definite_new,
        "skipped":         definite_dup,
        "possible":        possible_dup,
        "total_extracted": len(all_transactions),
    })


@app.route("/history")
def history_page():
    return render_template("history.html")


@app.route("/api/transactions", methods=["GET"])
def api_transactions():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    result = (
        supabase_admin.table("transactions")
        .select("id,vendor,card,date,amount,status,created_at,batch_id")
        .eq("user_id", user_id)
        .order("date", desc=True)
        .execute()
    )
    rows = result.data or []
    for row in rows:
        row["card"] = canonicalize_card_label(row.get("card")) or "Unassigned"
    return jsonify({"transactions": rows})


@app.route("/confirm", methods=["POST"])
def confirm():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    transactions = data.get("transactions", [])
    batch_id = (data.get("batch_id") or "").strip() or None

    if not transactions:
        return jsonify({"error": "No transactions to add"}), 400

    try:
        inserted_ids = append_transactions_for_user(user_id, transactions, batch_id=batch_id)
    except Exception as e:
        return jsonify({"error": f"Failed to write to database: {str(e)}"}), 500

    return jsonify({
        "success": True,
        "added": len(transactions),
        "ids": inserted_ids,
    })


@app.patch("/api/transactions/<tx_id>")
def api_transaction_patch(tx_id: str):
    """Update a row owned by the caller (e.g. pending → settled)."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    status = (data.get("status") or "").strip().lower()
    if status not in ("pending", "settled"):
        return jsonify({"error": "status must be pending or settled"}), 400

    try:
        result = (
            supabase_admin.table("transactions")
            .update({"status": status})
            .eq("id", tx_id)
            .eq("user_id", user_id)
            .select("id")
            .execute()
        )
    except Exception as e:
        return jsonify({"error": f"Failed to update transaction: {str(e)}"}), 500

    rows = result.data or []
    if not rows:
        return jsonify({"error": "Transaction not found"}), 404

    return jsonify({"success": True, "status": status})


@app.route("/api/transactions/<tx_id>", methods=["DELETE"])
def api_transaction_delete(tx_id: str):
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        (
            supabase_admin.table("transactions")
            .delete()
            .eq("id", tx_id)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        return jsonify({"error": f"Failed to delete transaction: {str(e)}"}), 500

    return jsonify({"success": True})


@app.route("/api/batches/<batch_id>", methods=["DELETE"])
def api_batch_delete(batch_id: str):
    """Delete every transaction belonging to one analyze session.

    Scoped to both ``user_id`` and ``batch_id`` so a user can only ever delete
    rows they themselves uploaded. The client computes batch metadata
    (counts, totals, merchants) locally from /api/transactions; this endpoint
    only handles the destructive operation.
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    batch_id = (batch_id or "").strip()
    if not batch_id:
        return jsonify({"error": "Missing batch id"}), 400

    try:
        result = (
            supabase_admin.table("transactions")
            .delete()
            .eq("user_id", user_id)
            .eq("batch_id", batch_id)
            .execute()
        )
    except Exception as e:
        return jsonify({"error": f"Failed to delete batch: {str(e)}"}), 500

    deleted = len(result.data or [])
    if deleted == 0:
        return jsonify({"error": "Batch not found"}), 404

    return jsonify({"success": True, "deleted": deleted})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

