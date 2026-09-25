from datetime import datetime
from unittest import TestCase

from compline.transactions import classify_transactions


def saved(vendor, date, amount, card="Capital One"):
    return {"vendor": vendor.lower(), "card": card, "date": datetime.strptime(date, "%Y-%m-%d"), "amount": amount}


def incoming(vendor, date, amount, card="Capital One"):
    return {"vendor": vendor, "card": card, "date": date, "amount": str(amount)}


class DuplicateClassificationTests(TestCase):
    def classify(self, tx, history):
        new, dup, possible = classify_transactions([tx], history)
        return "new" if new else "duplicate" if dup else "possible"

    def test_exact_repeat_is_skipped(self):
        self.assertEqual(self.classify(incoming("Chipotle", "2026-03-01", 14.85), [saved("Chipotle", "2026-03-01", 14.85)]), "duplicate")

    def test_a_cent_apart_same_day_is_reviewed(self):
        tx = incoming("Blue Bottle Coffee", "2026-03-09", 6.51)
        self.assertEqual(self.classify(tx, [saved("Blue Bottle Coffee", "2026-03-09", 6.50)]), "possible")
        self.assertEqual(tx["possible_match"], {"date": "2026-03-09", "amount": 6.50})

    def test_a_day_apart_same_amount_is_reviewed(self):
        self.assertEqual(self.classify(incoming("Uber", "2026-03-10", 9.10), [saved("Uber", "2026-03-09", 9.10)]), "possible")

    def test_a_few_cents_and_a_day_apart_is_reviewed(self):
        self.assertEqual(self.classify(incoming("Shell", "2026-03-06", 52.23), [saved("Shell", "2026-03-05", 52.18)]), "possible")

    def test_beyond_the_thresholds_is_new(self):
        self.assertEqual(self.classify(incoming("Shell", "2026-03-06", 52.24), [saved("Shell", "2026-03-06", 52.18)]), "new")
        self.assertEqual(self.classify(incoming("Shell", "2026-03-08", 52.18), [saved("Shell", "2026-03-06", 52.18)]), "new")

    def test_other_card_or_merchant_is_new(self):
        self.assertEqual(self.classify(incoming("Shell", "2026-03-06", 52.18, card="Discover"), [saved("Shell", "2026-03-06", 52.18)]), "new")
        self.assertEqual(self.classify(incoming("Chevron", "2026-03-06", 52.18), [saved("Shell", "2026-03-06", 52.18)]), "new")

    def test_exact_repeat_wins_over_a_nearby_close_match(self):
        history = [saved("Uber", "2026-03-09", 9.10), saved("Uber", "2026-03-10", 9.10)]
        self.assertEqual(self.classify(incoming("Uber", "2026-03-10", 9.10), history), "duplicate")

    def test_repeat_within_one_upload_is_skipped(self):
        tx = incoming("Cava", "2026-04-20", 15.80)
        new, dup, possible = classify_transactions([tx, dict(tx)], [])
        self.assertEqual((len(new), len(dup), len(possible)), (1, 1, 0))
