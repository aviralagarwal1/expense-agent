SUPPORTED_AI_PROVIDERS = ("anthropic", "openai", "gemini")


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
