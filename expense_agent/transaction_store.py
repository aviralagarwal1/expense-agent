from datetime import datetime

from .cards import canonicalize_card_label
from .transactions import normalize_vendor


def get_existing_transactions_for_user(client, user_id: str) -> list:
    result = (
        client.table("transactions")
        .select("vendor,amount,date,card")
        .eq("user_id", user_id)
        .execute()
    )
    transactions = []
    for row in result.data:
        vendor = normalize_vendor(row["vendor"])
        try:
            amount = float(row["amount"])
        except (TypeError, ValueError):
            continue
        dt = None
        if row.get("date"):
            try:
                dt = datetime.strptime(row["date"], "%Y-%m-%d")
            except ValueError:
                pass
        transactions.append({
            "vendor": vendor,
            "card": canonicalize_card_label(row.get("card")) or "",
            "amount": amount,
            "date": dt,
        })
    return transactions


def append_transactions_for_user(client, user_id: str, transactions: list, batch_id: str | None = None) -> list:
    rows = []
    for t in transactions:
        rows.append({
            "user_id": user_id,
            "vendor": t["vendor"],
            "card": canonicalize_card_label(t.get("card")),
            "date": t.get("date"),
            "amount": float(str(t["amount"]).replace("$", "").replace(",", "")),
            "status": t.get("status"),
            "batch_id": batch_id,
            "memo": (t.get("memo") or None),
        })
    result = client.table("transactions").insert(rows).execute()
    return [row.get("id") for row in (result.data or []) if row.get("id")]


def list_transactions_for_user(client, user_id: str):
    result = (
        client.table("transactions")
        .select("id,vendor,card,date,amount,status,created_at,batch_id,memo")
        .eq("user_id", user_id)
        .order("date", desc=True)
        .execute()
    )
    return result.data or []


def update_transaction_for_user(client, user_id: str, tx_id: str, updates: dict[str, object]):
    return (
        client.table("transactions")
        .update(updates)
        .eq("id", tx_id)
        .eq("user_id", user_id)
        .execute()
    )


def delete_transaction_for_user(client, user_id: str, tx_id: str):
    return (
        client.table("transactions")
        .delete()
        .eq("id", tx_id)
        .eq("user_id", user_id)
        .execute()
    )


def delete_batch_for_user(client, user_id: str, batch_id: str):
    return (
        client.table("transactions")
        .delete()
        .eq("user_id", user_id)
        .eq("batch_id", batch_id)
        .execute()
    )
