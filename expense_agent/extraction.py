import json

import anthropic


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
            "We couldn't accept one of your files. Please make sure each is a PNG, JPG, GIF, or WEBP image.",
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


def extract_transactions_from_images(image_data_list: list, api_key: str, today_str: str = "") -> list:
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
- date: YYYY-MM-DD format. If only month/day shown, assume the year {today_str[:4] if today_str else "2026"}.
- If the date is shown as a relative expression ("3 minutes ago", "2 hours ago", "just now", etc.) or the transaction is pending with no visible date, return "" for date — do not guess.
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
