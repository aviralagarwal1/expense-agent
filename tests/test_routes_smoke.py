from io import BytesIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import app


class RouteSmokeTests(TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_settings_get_smoke(self):
        fake_user = SimpleNamespace(id="user-1")
        with patch.object(app, "get_user_from_request", return_value=fake_user), \
             patch.object(app, "store_get_user_settings_state_for_user", return_value={"anthropic_api_key": "sk-ant-test", "active_ai_provider": "anthropic"}), \
             patch.object(app, "store_ensure_profile_for_user", return_value={"first_name": "Aviral", "last_name": "Agarwal"}), \
             patch.object(app, "store_is_new_user_account", return_value=False), \
             patch.object(app, "store_list_user_cards_for_user", return_value=[]):
            response = self.client.get("/api/settings")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["has_key"])
        self.assertEqual(payload["active_provider"], "anthropic")
        self.assertEqual(payload["profile"]["first_name"], "Aviral")

    def test_upload_smoke(self):
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_get_user_api_key", return_value="sk-ant-test"), \
             patch.object(app, "store_get_user_card_for_user", return_value={"id": "card-1", "label": "Visa •1234"}), \
             patch.object(
                 app,
                 "domain_extract_transactions_from_images",
                 return_value=[{"vendor": "Cava", "date": "2026-04-20", "amount": "15.80", "status": "settled"}],
             ), \
             patch.object(app, "store_get_existing_transactions_for_user", return_value=[]):
            response = self.client.post(
                "/upload",
                data={
                    "selected_card_id": "card-1",
                    "selected_provider": "anthropic",
                    "screenshots": (BytesIO(b"test-image"), "shot.jpg"),
                },
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["batch_id"])
        self.assertEqual(len(payload["new"]), 1)

    def test_confirm_smoke(self):
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_append_transactions_for_user", return_value=["tx-1"]):
            response = self.client.post(
                "/confirm",
                json={
                    "batch_id": "batch-1",
                    "transactions": [
                        {
                            "vendor": "Cava",
                            "card": "Visa •1234",
                            "date": "2026-04-20",
                            "amount": "15.80",
                            "status": "settled",
                        }
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["ids"], ["tx-1"])

    def test_transactions_get_smoke(self):
        rows = [
            {
                "id": "tx-1",
                "vendor": "Cava",
                "card": "visa 1234",
                "date": "2026-04-20",
                "amount": 15.8,
                "status": "settled",
                "created_at": "2026-04-20T10:00:00Z",
                "batch_id": "batch-1",
            }
        ]
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_list_transactions_for_user", return_value=rows):
            response = self.client.get("/api/transactions")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["transactions"][0]["vendor"], "Cava")
        self.assertTrue(payload["transactions"][0]["card"])
