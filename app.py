import os
import json
import base64
import anthropic
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client, Client
from flask import Flask, request, jsonify, render_template
from datetime import datetime

app = Flask(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
SUPABASE_URL         = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Auth helper ──────────────────────────────────────────────────────────────
def get_user_id_from_request():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        user = supabase_admin.auth.get_user(token)
        return user.user.id
    except Exception:
        return None


def make_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── User settings (BYOA) ─────────────────────────────────────────────────────
def get_user_api_key(user_id: str):
    result = (
        supabase_admin.table("user_settings")
        .select("anthropic_api_key")
        .eq("user_id", user_id)
        .execute()
    )
    if result.data:
        return result.data[0].get("anthropic_api_key") or None
    return None


# ── Vendor normalization ──────────────────────────────────────────────────────
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


# ── Supabase storage ─────────────────────────────────────────────────────────
def get_existing_transactions_for_user(user_id: str) -> list:
    result = (
        supabase_admin.table("transactions")
        .select("vendor,amount,date")
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
        transactions.append({"vendor": vendor, "amount": amount, "date": dt})
    return transactions


def append_transactions_for_user(user_id: str, transactions: list):
    rows = []
    for t in transactions:
        rows.append({
            "user_id": user_id,
            "vendor":  t["vendor"],
            "card":    t.get("card"),
            "date":    t.get("date"),
            "amount":  float(str(t["amount"]).replace("$", "").replace(",", "")),
            "status":  t.get("status"),
        })
    supabase_admin.table("transactions").insert(rows).execute()


# ── Claude Vision ────────────────────────────────────────────────────────────
def extract_transactions_from_images(image_data_list: list, api_key: str) -> list:
    client = anthropic.Anthropic(api_key=api_key, timeout=90.0)

    content = []
    for b64, mime_type in image_data_list:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        })

    content.append({
        "type": "text",
        "text": """Extract ALL transactions from these credit card app screenshots.
Include both pending and settled transactions.

Return ONLY a JSON array, no other text, like this:
[
  {
    "vendor": "Cava",
    "card": "Savor",
    "date": "2026-02-09",
    "amount": "15.80",
    "status": "settled"
  }
]

Rules:
- vendor: clean merchant name 
- card: exactly as shown in the app
- date: YYYY-MM-DD format. If only month/day shown, assume 2026.
- amount: numeric string only, no $ sign (e.g. "15.80")
- status: "pending" or "settled"
- IGNORE any transactions with a negative amount (credits, autopayments, refunds) — expenses only
- IGNORE any transaction labeled as "autopay", "payment", "credit", or "refund"
- Include ALL expense transactions you can see across all screenshots""",
    })

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


# ── Deduplication ────────────────────────────────────────────────────────────
def classify_transactions(new_txs: list, existing_txs: list):
    definite_new = []
    definite_dup = []
    possible_dup = []
    seen_keys = set()

    for t in new_txs:
        vendor = normalize_vendor(t["vendor"])
        try:
            amount = float(str(t["amount"]).replace("$", "").replace(",", ""))
        except ValueError:
            definite_new.append(t)
            continue

        try:
            t_date = datetime.strptime(t["date"], "%Y-%m-%d")
        except Exception:
            t_date = None

        upload_key = f"{vendor}|{amount}|{t.get('date','')}"
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
            if abs(ex["amount"] - amount) > 0.01:
                continue

            if t_date and ex["date"]:
                delta = abs((t_date - ex["date"]).days)
                if delta == 0:
                    exact_match = True
                    break
                elif delta <= 1:
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


# ── Routes ───────────────────────────────────────────────────────────────────
@app.route("/")
def landing():
    return render_template("landing.html")


@app.route("/app")
def index():
    return render_template("index.html")


@app.route("/settings")
def settings_page():
    return render_template("settings.html")


@app.route("/register", methods=["POST"])
def register():
    data = request.json or {}
    first_name = data.get("first_name", "").strip()
    last_name = data.get("last_name", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "")
    if not first_name or not last_name or not email or not password:
        return jsonify({"error": "First name, last name, email, and password are required"}), 400
    try:
        supabase_admin.auth.sign_up({
            "email": email,
            "password": password,
            "options": {
                "data": {
                    "first_name": first_name,
                    "last_name": last_name,
                }
            },
        })
        return jsonify({"verify": True})
    except Exception as e:
        message = str(e)
        lowered = message.lower()
        if (
            ("already" in lowered and "registered" in lowered)
            or ("already" in lowered and "exists" in lowered)
            or ("user already registered" in lowered)
            or ("email exists" in lowered)
        ):
            return jsonify({"error": "account_exists"}), 409
        return jsonify({"error": message}), 400


@app.route("/login", methods=["POST"])
def login():
    data = request.json or {}
    email    = data.get("email", "").strip()
    password = data.get("password", "")
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    try:
        session = supabase_admin.auth.sign_in_with_password({"email": email, "password": password})
        return jsonify({"token": session.session.access_token})
    except Exception as e:
        return jsonify({"error": str(e)}), 401


@app.route("/forgot-password", methods=["POST"])
def forgot_password():
    data = request.json or {}
    email = data.get("email", "").strip()
    if not email:
        return jsonify({"error": "Email is required"}), 400

    redirect_to = request.url_root.rstrip("/") + "/app?reset=1"

    try:
        supabase_admin.auth.reset_password_for_email(
            email,
            {"redirect_to": redirect_to},
        )
    except Exception:
        # Return a generic success response to avoid leaking account existence.
        pass

    return jsonify({
        "success": True,
        "message": "If that email has an account, a reset link has been sent.",
    })


@app.route("/api/settings", methods=["GET"])
def api_settings_get():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    key = get_user_api_key(user_id)
    return jsonify({"has_key": bool(key)})


@app.route("/api/settings", methods=["POST"])
def api_settings_save():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    api_key = data.get("anthropic_api_key", "").strip()
    if not api_key:
        return jsonify({"error": "API key is required"}), 400
    supabase_admin.table("user_settings").upsert({
        "user_id": user_id,
        "anthropic_api_key": api_key,
    }).execute()
    return jsonify({"success": True})


@app.route("/upload", methods=["POST"])
def upload():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    api_key = get_user_api_key(user_id)
    if not api_key:
        return jsonify({"error": "no_api_key"}), 400

    files = request.files.getlist("screenshots")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    image_data_list = []
    for f in files:
        data = f.read()
        mime_type = f.content_type or "image/jpeg"
        if "heic" in mime_type.lower() or "heif" in mime_type.lower():
            mime_type = "image/jpeg"
        b64 = base64.standard_b64encode(data).decode("utf-8")
        image_data_list.append((b64, mime_type))

    try:
        all_transactions = extract_transactions_from_images(image_data_list, api_key)
    except Exception as e:
        return jsonify({"error": f"Claude extraction failed: {type(e).__name__}: {str(e)}"}), 500

    try:
        existing_txs = get_existing_transactions_for_user(user_id)
    except Exception as e:
        return jsonify({"error": f"Database query failed: {str(e)}"}), 500

    definite_new, definite_dup, possible_dup = classify_transactions(all_transactions, existing_txs)

    return jsonify({
        "new":             definite_new,
        "skipped":         definite_dup,
        "possible":        possible_dup,
        "total_extracted": len(all_transactions),
    })


@app.route("/history")
def history_page():
    return render_template("history.html")


@app.route("/api/transactions", methods=["GET"])
def api_transactions():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    result = (
        supabase_admin.table("transactions")
        .select("id,vendor,card,date,amount,status,created_at")
        .eq("user_id", user_id)
        .order("date", desc=True)
        .execute()
    )
    return jsonify({"transactions": result.data})


@app.route("/confirm", methods=["POST"])
def confirm():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    transactions = data.get("transactions", [])

    if not transactions:
        return jsonify({"error": "No transactions to add"}), 400

    try:
        append_transactions_for_user(user_id, transactions)
    except Exception as e:
        return jsonify({"error": f"Failed to write to database: {str(e)}"}), 500

    return jsonify({"success": True, "added": len(transactions)})


@app.route("/reset-password", methods=["POST"])
def reset_password():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": "Unauthorized"}), 401

    access_token = auth_header[7:]
    data = request.json or {}
    refresh_token = data.get("refresh_token", "")
    password = data.get("password", "")

    if not password:
        return jsonify({"error": "Password is required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    try:
        user_client = make_supabase_client()
        user_client.auth.set_session(access_token, refresh_token)
        user_client.auth.update_user({"password": password})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    return jsonify({"success": True})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

