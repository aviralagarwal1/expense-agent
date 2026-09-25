from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from compline import extraction


class AnthropicExtractionBehaviorTests(TestCase):
    def test_anthropic_extraction_uses_configured_model_and_timeout(self):
        captured = {}

        class FakeMessages:
            def create(self, **kwargs):
                captured["request"] = kwargs
                return SimpleNamespace(content=[SimpleNamespace(text="[]")])

        class FakeAnthropic:
            def __init__(self, **kwargs):
                captured["client"] = kwargs
                self.messages = FakeMessages()

        with patch.object(extraction.anthropic, "Anthropic", FakeAnthropic):
            result = extraction.extract_transactions_from_images(
                [("base64-image", "image/jpeg")],
                "server-secret",
                "2026-09-19",
            )

        self.assertEqual(result, [])
        self.assertEqual(captured["client"]["api_key"], "server-secret")
        self.assertEqual(captured["client"]["timeout"], 90.0)
        self.assertEqual(captured["request"]["model"], "claude-opus-4-6")
