import re


_API_KEY_PATTERNS = {
    "anthropic": re.compile(r"^sk-ant-api\d{2}-[A-Za-z0-9_-]{32,}$"),
    "openai": re.compile(r"^(sk-(proj|svcacct)-[A-Za-z0-9_-]{32,}|sk-[A-Za-z0-9]{32,})$"),
    "gemini": re.compile(r"^(AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{40,})$"),
}


AI_PROVIDER_META = {
    "anthropic": {
        "id": "anthropic",
        "label": "Anthropic",
        "model": "claude-opus-4-6",
        "key_field": "anthropic_api_key",
        "console_url": "https://console.anthropic.com/settings/keys",
    },
    "openai": {
        "id": "openai",
        "label": "OpenAI",
        "model": "gpt-5.4",
        "key_field": "openai_api_key",
        "console_url": "https://platform.openai.com/api-keys",
    },
    "gemini": {
        "id": "gemini",
        "label": "Gemini",
        "model": "gemini-2.5-pro",
        "key_field": "gemini_api_key",
        "console_url": "https://aistudio.google.com/app/apikey",
    },
}


def normalize_ai_provider(value: str | None) -> str:
    provider = (value or "").strip().lower()
    if provider in AI_PROVIDER_META:
        return provider
    return "anthropic"


def get_provider_meta(provider: str | None) -> dict:
    return AI_PROVIDER_META[normalize_ai_provider(provider)]


def get_provider_key_field(provider: str | None) -> str:
    return get_provider_meta(provider)["key_field"]


def validate_provider_api_key(provider: str | None, api_key: str | None) -> tuple[bool, str]:
    provider = normalize_ai_provider(provider)
    label = get_provider_meta(provider)["label"]
    key = (api_key or "").strip()
    if not key:
        return False, "API key is required"
    if re.search(r"\s", key):
        return False, "API keys cannot include spaces or line breaks."
    if not _API_KEY_PATTERNS[provider].match(key):
        return False, f"This key is not valid for {label}."
    return True, ""


def list_provider_states(settings: dict) -> list[dict]:
    return [
        {
            "id": provider,
            "label": meta["label"],
            "model": meta["model"],
            "has_key": bool((settings.get(meta["key_field"]) or "").strip()),
        }
        for provider, meta in AI_PROVIDER_META.items()
    ]


def first_configured_provider(settings: dict) -> str | None:
    for provider, meta in AI_PROVIDER_META.items():
        if (settings.get(meta["key_field"]) or "").strip():
            return provider
    return None


def active_or_first_configured_provider(settings: dict) -> str:
    active = normalize_ai_provider(settings.get("active_ai_provider"))
    active_field = get_provider_key_field(active)
    if (settings.get(active_field) or "").strip():
        return active
    return first_configured_provider(settings) or active
