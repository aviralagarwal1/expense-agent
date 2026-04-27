import json
import urllib.error
import urllib.request

import anthropic

from .ai_providers import get_provider_meta, normalize_ai_provider


TRANSACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "transactions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "vendor": {"type": "string"},
                    "date": {"type": "string"},
                    "amount": {"type": "string"},
                    "status": {"type": "string", "enum": ["pending", "settled"]},
                },
                "required": ["vendor", "date", "amount", "status"],
            },
        }
    },
    "required": ["transactions"],
}


class ProviderAPIError(Exception):
    def __init__(self, provider: str, status_code: int | None = None):
        super().__init__(provider)
        self.provider = provider
        self.status_code = status_code


def _provider_help_url(provider: str | None) -> str:
    return get_provider_meta(provider)["console_url"]


def _provider_label(provider: str | None) -> str:
    return get_provider_meta(provider)["label"]


def _json_array_from_text(raw: str) -> list:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    parsed = json.loads(raw.strip())
    if isinstance(parsed, dict) and isinstance(parsed.get("transactions"), list):
        return parsed["transactions"]
    if isinstance(parsed, list):
        return parsed
    raise json.JSONDecodeError("Expected a JSON transaction array", raw, 0)


def user_facing_extraction_error(exc: Exception, provider: str | None = "anthropic") -> tuple[str, str]:
    """Map provider/API failures to a safe message. Never expose raw exception text to clients."""
    provider = normalize_ai_provider(getattr(exc, "provider", provider))
    label = _provider_label(provider)
    url = _provider_help_url(provider)
    if isinstance(exc, json.JSONDecodeError):
        return (
            "We could not read the analysis result. Try again with clear card-app screenshots.",
            url,
        )
    if isinstance(exc, anthropic.AuthenticationError) or (
        isinstance(exc, ProviderAPIError) and getattr(exc, "status_code", None) in (401, 403)
    ):
        return (
            f"{label} rejected your API key. Add a valid key under API Key in this app.",
            url,
        )
    if isinstance(exc, anthropic.RateLimitError) or (
        isinstance(exc, ProviderAPIError) and getattr(exc, "status_code", None) == 429
    ):
        return (
            f"{label} is rate limiting requests. Wait a minute and try again, or check your usage.",
            url,
        )
    if isinstance(exc, anthropic.BadRequestError) or (
        isinstance(exc, ProviderAPIError) and getattr(exc, "status_code", None) == 400
    ):
        return (
            "We couldn't accept one of your files. Please make sure each is a PNG, JPG, GIF, or WEBP image.",
            url,
        )
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError)) or (
        isinstance(exc, ProviderAPIError) and getattr(exc, "status_code", None) is None
    ):
        return (
            f"Could not reach {label}. Check your connection and try again.",
            url,
        )
    if isinstance(exc, anthropic.APIStatusError):
        code = getattr(exc, "status_code", None)
        if code == 402:
            return (
                f"{label} could not bill this request. Add credits or a payment method.",
                url,
            )
        if code in (401, 403):
            return (
                f"{label} rejected this request. Confirm your API key under API Key and in the provider console.",
                url,
            )
        if code == 413:
            return (
                f"The upload was too large for {label}. Try fewer screenshots or smaller files.",
                url,
            )
        if code is not None and code >= 500:
            return (
                f"{label} had a temporary problem. Try again in a moment.",
                url,
            )
    if isinstance(exc, ProviderAPIError):
        code = getattr(exc, "status_code", None)
        if code == 413:
            return (f"The upload was too large for {label}. Try fewer screenshots or smaller files.", url)
        if code is not None and code >= 500:
            return (f"{label} had a temporary problem. Try again in a moment.", url)
    return (
        f"Screenshot analysis could not finish. Check your {label} API key, usage, and billing, then try again.",
        url,
    )


def _extraction_prompt(today_str: str = "") -> str:
    return f"""Extract ALL transactions from these credit card app screenshots.
Include both pending and settled transactions.

Return ONLY transaction data matching the requested JSON schema.

Rules:
- vendor: clean merchant name
- date: YYYY-MM-DD format. If only month/day shown, assume the year {today_str[:4] if today_str else "2026"}.
- If the date is shown as a relative expression ("3 minutes ago", "2 hours ago", "just now", etc.) or the transaction is pending with no visible date, return "" for date - do not guess.
- amount: numeric string only, no $ sign (e.g. "15.80")
- status: "pending" or "settled"
- IGNORE any transactions with a negative amount (credits, autopayments, refunds) - expenses only
- IGNORE any transaction labeled as "autopay", "payment", "credit", or "refund"
- DO NOT infer or return the card name. The selected card is attached separately.
- Include ALL expense transactions you can see across all screenshots"""


def _extract_with_anthropic(image_data_list: list, api_key: str, today_str: str = "") -> list:
    client = anthropic.Anthropic(api_key=api_key, timeout=90.0)

    content = []
    for b64, mime_type in image_data_list:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        })

    content.append({
        "type": "text",
        "text": _extraction_prompt(today_str) + """

Return a JSON array, no other text, like this:
[
  {
    "vendor": "Cava",
    "date": "2026-02-09",
    "amount": "15.80",
    "status": "settled"
  }
]""",
    })

    response = client.messages.create(
        model=get_provider_meta("anthropic")["model"],
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )

    return _json_array_from_text(response.content[0].text)


def _extract_with_openai(image_data_list: list, api_key: str, today_str: str = "") -> list:
    try:
        from openai import APIError, OpenAI
    except ImportError as exc:
        raise RuntimeError("OpenAI SDK is not installed") from exc

    client = OpenAI(api_key=api_key, timeout=90.0)
    content = [{"type": "input_text", "text": _extraction_prompt(today_str)}]
    for b64, mime_type in image_data_list:
        content.append({
            "type": "input_image",
            "image_url": f"data:{mime_type};base64,{b64}",
            "detail": "high",
        })

    try:
        response = client.responses.create(
            model=get_provider_meta("openai")["model"],
            input=[{"role": "user", "content": content}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "expense_transactions",
                    "strict": True,
                    "schema": TRANSACTION_SCHEMA,
                }
            },
            store=False,
            max_output_tokens=4096,
        )
    except APIError as exc:
        raise ProviderAPIError("openai", getattr(exc, "status_code", None)) from exc

    return _json_array_from_text(response.output_text)


def _extract_with_gemini(image_data_list: list, api_key: str, today_str: str = "") -> list:
    body = {
        "contents": [{
            "role": "user",
            "parts": [
                *[
                    {"inline_data": {"mime_type": mime_type, "data": b64}}
                    for b64, mime_type in image_data_list
                ],
                {"text": _extraction_prompt(today_str)},
            ],
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": TRANSACTION_SCHEMA,
            "maxOutputTokens": 4096,
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{get_provider_meta('gemini')['model']}:generateContent"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ProviderAPIError("gemini", exc.code) from exc
    except urllib.error.URLError as exc:
        raise ProviderAPIError("gemini", None) from exc

    text = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    return _json_array_from_text(text)


def extract_transactions_from_images(
    image_data_list: list,
    api_key: str,
    today_str: str = "",
    provider: str | None = "anthropic",
) -> list:
    provider = normalize_ai_provider(provider)
    if provider == "openai":
        return _extract_with_openai(image_data_list, api_key, today_str)
    if provider == "gemini":
        return _extract_with_gemini(image_data_list, api_key, today_str)
    return _extract_with_anthropic(image_data_list, api_key, today_str)
