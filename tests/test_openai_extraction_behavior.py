import sys
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from expense_agent import extraction


class OpenAIExtractionBehaviorTests(TestCase):
    def test_openai_extraction_disables_sdk_retries(self):
        captured = {}

        class FakeResponses:
            def create(self, **kwargs):
                captured["create_kwargs"] = kwargs
                return SimpleNamespace(output_text='{"transactions":[]}')

        class FakeOpenAI:
            def __init__(self, **kwargs):
                captured["client_kwargs"] = kwargs
                self.responses = FakeResponses()

        fake_openai_module = ModuleType("openai")
        fake_openai_module.APIError = Exception
        fake_openai_module.OpenAI = FakeOpenAI

        with patch.dict(sys.modules, {"openai": fake_openai_module}):
            result = extraction._extract_with_openai(
                [("base64-image", "image/jpeg")],
                "sk-proj-test",
                "2026-05-04",
            )

        self.assertEqual(result, [])
        self.assertEqual(captured["client_kwargs"]["api_key"], "sk-proj-test")
        self.assertEqual(captured["client_kwargs"]["timeout"], 90.0)
        self.assertEqual(captured["client_kwargs"]["max_retries"], 0)
        self.assertEqual(captured["create_kwargs"]["store"], False)
        self.assertEqual(captured["create_kwargs"]["max_output_tokens"], 4096)

    def test_openai_rate_limit_message_points_to_project_limits(self):
        error = extraction.ProviderAPIError(
            "openai",
            429,
            request_id="req_123",
            retry_after="42",
            rate_limit_remaining_tokens="0",
        )

        message, help_url = extraction.user_facing_extraction_error(error, "openai")

        self.assertIn("rate limited this screenshot batch", message)
        self.assertIn("Wait 42 seconds", message)
        self.assertIn("project limits and billing", message)
        self.assertEqual(help_url, "https://platform.openai.com/api-keys")
