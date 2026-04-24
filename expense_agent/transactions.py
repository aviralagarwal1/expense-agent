from datetime import datetime

from .cards import canonicalize_card_label


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
            "status": (tx.get("status") or "").strip().lower(),
        })
    return stamped


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

        exact_match = False
        fuzzy_match = False
        fuzzy_existing = None

        for ex in existing_txs:
            if ex["vendor"] != vendor:
                continue
            if ex.get("card", "") != card:
                continue
            if abs(ex["amount"] - amount) > 0.01:
                continue

            if t_date and ex["date"]:
                delta = abs((t_date - ex["date"]).days)
                if delta == 0:
                    exact_match = True
                    break
                if delta <= 1:
                    fuzzy_match = True
                    fuzzy_existing = ex
            else:
                exact_match = True
                break

        if exact_match:
            definite_dup.append(t)
        elif fuzzy_match:
            t["possible_match"] = {
                "date": fuzzy_existing["date"].strftime("%Y-%m-%d") if fuzzy_existing["date"] else "?",
                "amount": fuzzy_existing["amount"],
            }
            possible_dup.append(t)
        else:
            definite_new.append(t)

    return definite_new, definite_dup, possible_dup
