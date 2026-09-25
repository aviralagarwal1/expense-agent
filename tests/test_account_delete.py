from unittest import TestCase
from unittest.mock import MagicMock, call, patch

import app


class AccountDeleteTests(TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_requires_sign_in(self):
        with patch.object(app, "get_user_id_from_request", return_value=None), \
             patch.object(app, "store_delete_all_transactions_for_user") as delete_tx:
            response = self.client.delete("/api/account")
        self.assertEqual(response.status_code, 401)
        delete_tx.assert_not_called()

    def test_deletes_data_then_login_for_the_caller_only(self):
        order = MagicMock()
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_delete_all_transactions_for_user", order.transactions), \
             patch.object(app, "store_delete_user_settings_for_user", order.settings), \
             patch.object(app.supabase_admin.auth, "admin", MagicMock(delete_user=order.login)):
            response = self.client.delete("/api/account")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"success": True, "login_removed": True})
        self.assertEqual(order.mock_calls, [
            call.transactions(app.supabase_admin, "user-1"),
            call.settings(app.supabase_admin, "user-1"),
            call.login("user-1"),
        ])

    def test_data_failure_leaves_the_login_alone(self):
        login = MagicMock()
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_delete_all_transactions_for_user", side_effect=RuntimeError("down")), \
             patch.object(app, "store_delete_user_settings_for_user") as settings, \
             patch.object(app.supabase_admin.auth, "admin", MagicMock(delete_user=login)), \
             patch.object(app.app.logger, "exception"):
            response = self.client.delete("/api/account")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["error"], "account_delete_failed")
        settings.assert_not_called()
        login.assert_not_called()

    def test_login_failure_after_data_is_gone_still_succeeds(self):
        with patch.object(app, "get_user_id_from_request", return_value="user-1"), \
             patch.object(app, "store_delete_all_transactions_for_user"), \
             patch.object(app, "store_delete_user_settings_for_user"), \
             patch.object(app.supabase_admin.auth, "admin", MagicMock(delete_user=MagicMock(side_effect=RuntimeError("auth down")))), \
             patch.object(app.app.logger, "exception"):
            response = self.client.delete("/api/account")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"success": True, "login_removed": False})
