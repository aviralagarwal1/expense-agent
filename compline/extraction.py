import json

import anthropic


MODEL = "claude-opus-4-6"


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


def user_facing_extraction_error(exc: Exception) -> str:
    """Map an extraction failure to a safe message. Never expose raw exception text to clients."""
    if isinstance(exc, json.JSONDecodeError):
        return "We could not read the analysis result. Try again with clear card-app screenshots."
    if isinstance(exc, anthropic.RateLimitError):
        return "Screenshot processing is busy. Wait a minute and try again."
    if isinstance(exc, anthropic.BadRequestError):
        return "We couldn't accept one of your files. Make sure each is a PNG, JPG, GIF, or WEBP image."
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return "Screenshot processing could not be reached. Check your connection and try again."
    if isinstance(exc, anthropic.APIStatusError):
        code = getattr(exc, "status_code", None)
        if code == 413:
            return "The upload was too large. Try fewer screenshots or smaller files."
        if code is not None and code >= 500:
            return "Screenshot processing had a temporary problem. Try again in a moment."
    if isinstance(exc, (anthropic.AuthenticationError, anthropic.APIStatusError)):
        return "Screenshot processing is temporarily unavailable. Please try again later."
    return "Screenshot analysis could not finish. Try again in a moment."


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
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )

    return _json_array_from_text(response.content[0].text)


def extract_transactions_from_images(image_data_list: list, api_key: str, today_str: str = "") -> list:
    return _extract_with_anthropic(image_data_list, api_key, today_str)
