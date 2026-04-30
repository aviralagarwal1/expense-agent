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

    def test_auth_callback_reuses_cached_redirect_for_duplicate_code(self):
        fake_session = SimpleNamespace(access_token="access-token", refresh_token="refresh-token")
        fake_response = SimpleNamespace(session=fake_session)
        app.auth_code_redirect_cache.clear()
        verifier = "verifier-1"
        cookie_value = app.auth_serializer.dumps({"code_verifier": verifier})
        self.client.set_cookie(app.AUTH_PKCE_COOKIE, cookie_value, path="/auth")

        with patch.object(app.supabase_admin.auth, "exchange_code_for_session", return_value=fake_response) as exchange:
            first = self.client.get("/auth/callback?code=code-1")
            self.client.set_cookie(app.AUTH_PKCE_COOKIE, cookie_value, path="/auth")
            second = self.client.get("/auth/callback?code=code-1")

        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)
        self.assertEqual(exchange.call_count, 1)
        exchange.assert_called_once_with({
            "auth_code": "code-1",
            "code_verifier": verifier,
            "redirect_to": "http://localhost/auth/callback",
        })
        self.assertIn("/app#access_token=access-token", first.headers["Location"])
        self.assertEqual(first.headers["Location"], second.headers["Location"])

    def test_local_oauth_ignores_production_app_url(self):
        fake_oauth_response = SimpleNamespace(url="https://supabase.example/auth/v1/authorize?redirect_to=http%3A%2F%2Flocalhost%3A5000%2Fauth%2Fcallback")
        with patch.object(app, "APP_URL", "https://expenseagent.aviralagarwal.com"), \
             patch.object(app.supabase_admin.auth, "sign_in_with_oauth", return_value=fake_oauth_response), \
             patch.object(app, "get_supabase_pkce_verifier", return_value="verifier-1"):
            response = self.client.get("/auth/google", base_url="http://localhost:5000")

        self.assertEqual(response.status_code, 302)
        self.assertIn("redirect_to=http%3A%2F%2Flocalhost%3A5000%2Fauth%2Fcallback", response.headers["Location"])
        self.assertNotIn("state=", response.headers["Location"])
        self.assertIn("expense_oauth_pkce=", response.headers.get("Set-Cookie", ""))
        self.assertNotIn("Secure", response.headers.get("Set-Cookie", ""))

    def test_ipv6_localhost_is_treated_as_local(self):
        with app.app.test_request_context(base_url="http://[::1]:5000"):
            self.assertEqual(app.get_external_app_url("/auth/callback"), "http://[::1]:5000/auth/callback")

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
                "memo": "Lunch with client",
            }
        ]
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_list_transactions_for_user", return_value=rows):
            response = self.client.get("/api/transactions")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["transactions"][0]["vendor"], "Cava")
        self.assertTrue(payload["transactions"][0]["card"])
        self.assertEqual(payload["transactions"][0]["memo"], "Lunch with client")

    def test_transaction_patch_accepts_memo(self):
        updated = {
            "id": "tx-1",
            "vendor": "Cava",
            "card": "visa 1234",
            "date": "2026-04-20",
            "amount": 15.8,
            "status": "settled",
            "created_at": "2026-04-20T10:00:00Z",
            "batch_id": "batch-1",
            "memo": "Reimbursable lunch",
        }
        fake_result = SimpleNamespace(data=[updated])

        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_update_transaction_for_user", return_value=fake_result) as update:
            response = self.client.patch("/api/transactions/tx-1", json={"memo": " Reimbursable lunch \r\n"})

        self.assertEqual(response.status_code, 200)
        update.assert_called_once_with(app.supabase_admin, "user-1", "tx-1", {"memo": "Reimbursable lunch"})
        payload = response.get_json()
        self.assertEqual(payload["transaction"]["memo"], "Reimbursable lunch")

    def test_transaction_patch_clears_memo(self):
        updated = {
            "id": "tx-1",
            "vendor": "Cava",
            "card": "visa 1234",
            "date": "2026-04-20",
            "amount": 15.8,
            "status": "settled",
            "created_at": "2026-04-20T10:00:00Z",
            "batch_id": "batch-1",
            "memo": None,
        }
        fake_result = SimpleNamespace(data=[updated])

        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_update_transaction_for_user", return_value=fake_result) as update:
            response = self.client.patch("/api/transactions/tx-1", json={"memo": ""})

        self.assertEqual(response.status_code, 200)
        update.assert_called_once_with(app.supabase_admin, "user-1", "tx-1", {"memo": None})
