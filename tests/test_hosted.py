import json
import os
from unittest import TestCase
from unittest.mock import patch

from compline.hosted import (
    DEFAULT_DAILY_SCREENSHOT_LIMIT,
    hosted_ai_enabled,
    hosted_api_key,
    hosted_daily_screenshot_limit,
)
from compline.settings_blob import parse_user_settings_blob, serialize_user_settings_blob


class HostedConfigurationTests(TestCase):
    def test_key_is_read_from_the_environment(self):
        with patch.dict(os.environ, {"HOSTED_AI_API_KEY": " server-secret "}, clear=False):
            self.assertEqual(hosted_api_key(), "server-secret")
            self.assertTrue(hosted_ai_enabled())

    def test_missing_key_disables_processing(self):
        with patch.dict(os.environ, {"HOSTED_AI_API_KEY": ""}, clear=False):
            self.assertFalse(hosted_ai_enabled())

    def test_daily_limit_defaults_to_ten(self):
        with patch.dict(os.environ, {"HOSTED_DAILY_SCREENSHOT_LIMIT": ""}, clear=False):
            self.assertEqual(DEFAULT_DAILY_SCREENSHOT_LIMIT, 10)
            self.assertEqual(hosted_daily_screenshot_limit(), 10)

    def test_invalid_daily_limit_falls_back_to_ten(self):
        with patch.dict(os.environ, {"HOSTED_DAILY_SCREENSHOT_LIMIT": "abc"}, clear=False):
            self.assertEqual(hosted_daily_screenshot_limit(), 10)

    def test_negative_daily_limit_normalizes_to_zero(self):
        with patch.dict(os.environ, {"HOSTED_DAILY_SCREENSHOT_LIMIT": "-4"}, clear=False):
            self.assertEqual(hosted_daily_screenshot_limit(), 0)


class SettingsBlobPrivacyTests(TestCase):
    def test_only_known_fields_are_kept(self):
        stored = json.dumps({
            "some_api_key": "secret",
            "profile": {"first_name": "Aviral", "last_name": "Agarwal"},
            "cards": [],
            "hosted_usage": {"date": "2026-09-19", "screenshots": 3},
        })

        payload = json.loads(serialize_user_settings_blob(parse_user_settings_blob(stored)))

        self.assertEqual(set(payload), {"profile", "cards", "hosted_usage"})
        self.assertEqual(payload["profile"]["first_name"], "Aviral")
        self.assertEqual(payload["hosted_usage"]["screenshots"], 3)
