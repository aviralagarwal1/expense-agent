from unittest import TestCase
from unittest.mock import patch

import app
from expense_agent.ai_providers import validate_provider_api_key


class AIProviderValidationTests(TestCase):
    def test_rejects_short_anthropic_key(self):
        valid, message = validate_provider_api_key("anthropic", "sk-ant-abc")

        self.assertFalse(valid)
        self.assertEqual(message, "This key is not valid for Anthropic.")

    def test_accepts_plausible_anthropic_key(self):
        valid, message = validate_provider_api_key("anthropic", "sk-ant-api03-" + "A" * 32)

        self.assertTrue(valid)
        self.assertEqual(message, "")

    def test_rejects_key_with_whitespace(self):
        valid, message = validate_provider_api_key("openai", "sk-proj-" + "A" * 16 + " " + "B" * 16)

        self.assertFalse(valid)
        self.assertEqual(message, "API keys cannot include spaces or line breaks.")

    def test_accepts_plausible_openai_project_key(self):
        valid, message = validate_provider_api_key("openai", "sk-proj-" + "A" * 32)

        self.assertTrue(valid)
        self.assertEqual(message, "")

    def test_accepts_plausible_gemini_key(self):
        valid, message = validate_provider_api_key("gemini", "AIza" + "A" * 30)

        self.assertTrue(valid)
        self.assertEqual(message, "")

    def test_accepts_google_cloud_gemini_key(self):
        valid, message = validate_provider_api_key(
            "gemini",
            "AQ." + "A" * 40,
        )

        self.assertTrue(valid)
        self.assertEqual(message, "")

    def test_rejects_short_google_cloud_gemini_key(self):
        valid, message = validate_provider_api_key("gemini", "AQ.short")

        self.assertFalse(valid)
        self.assertEqual(message, "This key is not valid for Gemini.")


class APISettingsValidationTests(TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_settings_save_rejects_invalid_provider_key_before_storage(self):
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_get_user_settings_state_for_user") as get_settings:
            response = self.client.post(
                "/api/settings",
                json={"provider": "anthropic", "api_key": "sk-ant-abc"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "This key is not valid for Anthropic.")
        get_settings.assert_not_called()

    def test_settings_save_accepts_plausible_provider_key(self):
        settings = {"anthropic_api_key": None, "active_ai_provider": "anthropic"}
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_get_user_settings_state_for_user", return_value=settings), \
             patch.object(app, "store_save_user_settings_state_for_user", return_value=settings):
            response = self.client.post(
                "/api/settings",
                json={"provider": "anthropic", "api_key": "sk-ant-api03-" + "A" * 32},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
