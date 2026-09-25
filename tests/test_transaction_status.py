from unittest import TestCase

from compline.transactions import attach_selected_card_to_transactions, normalize_status


class TransactionStatusTests(TestCase):
    def test_pending_is_kept(self):
        self.assertEqual(normalize_status("pending"), "pending")
        self.assertEqual(normalize_status(" Pending "), "pending")

    def test_missing_or_unknown_status_defaults_to_settled(self):
        for value in (None, "", "settled", "posted", "cleared", 0):
            self.assertEqual(normalize_status(value), "settled")

    def test_extracted_rows_default_to_settled(self):
        rows = attach_selected_card_to_transactions(
            [
                {"vendor": "Cava", "date": "2026-04-20", "amount": "15.80"},
                {"vendor": "Uber", "date": "2026-04-21", "amount": "9.10", "status": "PENDING"},
            ],
            "Capital One",
        )
        self.assertEqual([r["status"] for r in rows], ["settled", "pending"])
