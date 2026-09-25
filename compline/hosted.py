"""Hosted screenshot processing: one server-side Anthropic key and a daily
per-user screenshot allowance.

The key is read from the environment at request time. It is never persisted
to Supabase or sent to the browser. Reading at call time also lets tests
patch ``os.environ`` without re-importing this module.
"""
import os


DEFAULT_DAILY_SCREENSHOT_LIMIT = 10


def hosted_api_key() -> str:
    return (os.environ.get("HOSTED_AI_API_KEY") or "").strip()


def hosted_ai_enabled() -> bool:
    return bool(hosted_api_key())


def hosted_daily_screenshot_limit() -> int:
    """Screenshots per user per UTC day. Invalid values fall back to the default; 0 means no limit."""
    raw = (os.environ.get("HOSTED_DAILY_SCREENSHOT_LIMIT") or "").strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_DAILY_SCREENSHOT_LIMIT
    return max(0, value)
