from datetime import datetime

from .cards import canonicalize_card_label


def normalize_status(value) -> str:
    """A charge is pending only when the screenshot says so; anything else is settled."""
    return "pending" if str(value or "").strip().lower() == "pending" else "settled"


def normalize_vendor(name: str) -> str:
    name = name.lower().strip()
    if " & " in name:
        name = name.split(" & ")[0].strip()
    for suffix in [" inc", " llc", " ltd", " co", " corp", " store", " qps"]:
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
    if name.endswith("s") and len(name) > 4:
        name = name[:-1]
    return name.strip()


def filter_out_non_expenses(transactions: list) -> list:
    kept = []
    for tx in transactions:
        try:
            if float(str(tx.get("amount")).replace("$", "").replace(",", "")) <= 0:
                continue
        except (TypeError, ValueError):
            pass
        kept.append(tx)
    return kept


def attach_selected_card_to_transactions(transactions: list, card_label: str) -> list:
    normalized_card = canonicalize_card_label(card_label) or card_label
    stamped = []
    for tx in transactions:
        stamped.append({
            "vendor": (tx.get("vendor") or "").strip(),
            "card": normalized_card,
            "date": (tx.get("date") or "").strip(),
            "amount": tx.get("amount"),
            "status": normalize_status(tx.get("status")),
        })
    return stamped


def apply_date_fallback(transactions: list, today_str: str) -> list:
    result = []
    for tx in transactions:
        if not tx.get("date"):
            tx = {**tx, "date": today_str}
        result.append(tx)
    return result


CLOSE_MATCH_CENTS = 5


def classify_transactions(new_txs: list, existing_txs: list):
    definite_new = []
    definite_dup = []
    possible_dup = []
    seen_keys = set()

    for t in new_txs:
        vendor = normalize_vendor(t["vendor"])
        card = canonicalize_card_label(t.get("card")) or ""
        try:
            amount = float(str(t["amount"]).replace("$", "").replace(",", ""))
        except ValueError:
            definite_new.append(t)
            continue

        try:
            t_date = datetime.strptime(t["date"], "%Y-%m-%d")
        except Exception:
            t_date = None

        upload_key = f"{vendor}|{card}|{amount}|{t.get('date', '')}"
        if upload_key in seen_keys:
            definite_dup.append(t)
            continue
        seen_keys.add(upload_key)

        # Exact repeat: same merchant, card, date, and amount to the cent. Skipped.
        # Close match: same merchant and card, at most a day and CLOSE_MATCH_CENTS
        # apart (a pending charge that settled later, a cent of rounding). Reviewed.
        exact_match = False
        closest = None
        closest_key = None

        for ex in existing_txs:
            if ex["vendor"] != vendor or ex.get("card", "") != card:
                continue
            cents_apart = round(abs(ex["amount"] - amount) * 100)
            if cents_apart > CLOSE_MATCH_CENTS:
                continue
            if t_date and ex["date"]:
                days_apart = abs((t_date - ex["date"]).days)
                if days_apart > 1:
                    continue
            else:
                days_apart = 0
            if cents_apart == 0 and days_apart == 0:
                exact_match = True
                break
            key = (days_apart, cents_apart)
            if closest_key is None or key < closest_key:
                closest, closest_key = ex, key

        if exact_match:
            definite_dup.append(t)
        elif closest is not None:
            t["possible_match"] = {
                "date": closest["date"].strftime("%Y-%m-%d") if closest["date"] else "?",
                "amount": closest["amount"],
            }
            possible_dup.append(t)
        else:
            definite_new.append(t)

    return definite_new, definite_dup, possible_dup
