import os
import base64
import re
from uuid import uuid4
from urllib.parse import urlencode
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client, Client
from flask import Flask, request, jsonify, render_template, redirect, url_for, send_from_directory
from datetime import datetime
from werkzeug.middleware.proxy_fix import ProxyFix
from expense_agent.cards import canonicalize_card_label
from expense_agent.profile import get_profile_seed_from_user
from expense_agent.extraction import (
    extract_transactions_from_images as domain_extract_transactions_from_images,
    user_facing_extraction_error as domain_user_facing_extraction_error,
)
from expense_agent.transaction_store import (
    append_transactions_for_user as store_append_transactions_for_user,
    delete_batch_for_user as store_delete_batch_for_user,
    delete_transaction_for_user as store_delete_transaction_for_user,
    get_existing_transactions_for_user as store_get_existing_transactions_for_user,
    list_transactions_for_user as store_list_transactions_for_user,
    update_transaction_for_user as store_update_transaction_for_user,
)
from expense_agent.transactions import (
    attach_selected_card_to_transactions as domain_attach_selected_card_to_transactions,
    classify_transactions as domain_classify_transactions,
    filter_out_non_expenses as domain_filter_out_non_expenses,
)
from expense_agent.user_data import (
    create_user_card_for_user as store_create_user_card_for_user,
    delete_user_card_for_user as store_delete_user_card_for_user,
    ensure_profile_for_user as store_ensure_profile_for_user,
    get_user_api_key as store_get_user_api_key,
    get_user_card_for_user as store_get_user_card_for_user,
    get_user_settings_state_for_user as store_get_user_settings_state_for_user,
    is_new_user_account as store_is_new_user_account,
    list_user_cards_for_user as store_list_user_cards_for_user,
    save_user_settings_state_for_user as store_save_user_settings_state_for_user,
    upsert_profile_for_user as store_upsert_profile_for_user,
)

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config["TEMPLATES_AUTO_RELOAD"] = True

# ── Config ──────────────────────────────────────────────────────────────────
SUPABASE_URL         = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
APP_URL              = (os.environ.get("APP_URL") or "").rstrip("/")

supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
def get_external_app_url(path: str = "/"):
    request_root = request.url_root.rstrip("/")
    request_host = (request.host or "").split(":", 1)[0].strip().lower()

    # Local development should always round-trip back to localhost, even if a
    # production APP_URL is present in the environment.
    if request_host in {"localhost", "127.0.0.1"}:
        base_url = request_root
    else:
        base_url = APP_URL or request_root
    return f"{base_url}{path}"


def redirect_to_app_with_error(error_code: str):
    return redirect(url_for("index", auth_error=error_code))


def get_user_from_request():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        response = supabase_admin.auth.get_user(token)
        return response.user
    except Exception:
        return None


# ── Auth helper ──────────────────────────────────────────────────────────────
def get_user_id_from_request():
    user = get_user_from_request()
    return user.id if user else None


# ── User settings (BYOA) ─────────────────────────────────────────────────────

# ── Supabase storage ─────────────────────────────────────────────────────────


# ── Claude Vision ────────────────────────────────────────────────────────────
@app.route("/")
def landing():
    return render_template("landing.html")


@app.route("/favicon.png")
def favicon_png():
    return send_from_directory("branding", "favicon.png")


@app.route("/favicon.ico")
def favicon_ico():
    return send_from_directory("branding", "favicon.png")


@app.route("/about")
def about_page():
    return render_template("about.html")


@app.route("/sitemap.xml")
def sitemap():
    return send_from_directory("static", "sitemap.xml", mimetype="application/xml")


@app.route("/app")
def index():
    return render_template("index.html", auth_mode="signin")


@app.route("/register")
def register():
    """Same workspace shell as /app, with onboarding-oriented auth copy for new visitors."""
    return render_template("index.html", auth_mode="register")


@app.route("/connect-key")
def connect_key_page():
    return render_template("settings.html")


@app.route("/settings")
def settings_page():
    return render_template("profile_settings.html")


@app.route("/auth/google")
def auth_google():
    redirect_to = get_external_app_url("/auth/callback")
    try:
        response = supabase_admin.auth.sign_in_with_oauth({
            "provider": "google",
            "options": {
                "redirect_to": redirect_to,
                "scopes": "email profile",
                "query_params": {
                    "prompt": "select_account",
                },
            },
        })
        auth_url = getattr(response, "url", "")
        if not auth_url:
            raise RuntimeError("Supabase did not return an OAuth URL")
        return redirect(auth_url)
    except Exception:
        app.logger.exception("Failed to start Google OAuth")
        return redirect_to_app_with_error("google_sign_in_unavailable")


@app.route("/auth/callback")
def auth_callback():
    auth_code = request.args.get("code")
    if not auth_code:
        app.logger.error("Missing OAuth code on callback: %s", dict(request.args))
        return redirect_to_app_with_error("google_callback_missing_code")

    try:
        response = supabase_admin.auth.exchange_code_for_session({
            "auth_code": auth_code,
        })
        session = getattr(response, "session", None)
        access_token = getattr(session, "access_token", "") if session else ""
        refresh_token = getattr(session, "refresh_token", "") if session else ""
        if not access_token:
            raise RuntimeError("Supabase did not return an access token")
        fragment = urlencode({
            "access_token": access_token,
            "refresh_token": refresh_token or "",
        })
        return redirect(f"{get_external_app_url('/app')}#{fragment}")
    except Exception:
        app.logger.exception("Failed to exchange Google OAuth code for session")
        return redirect_to_app_with_error("google_callback_exchange_failed")


@app.route("/api/settings", methods=["GET"])
def api_settings_get():
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    key = store_get_user_api_key(supabase_admin, user.id)
    try:
        profile = store_ensure_profile_for_user(supabase_admin, user)
    except Exception:
        profile = get_profile_seed_from_user(user)
    try:
        is_new_user = store_is_new_user_account(supabase_admin, user.id, bool(key), profile)
    except Exception:
        is_new_user = False
    try:
        cards = store_list_user_cards_for_user(supabase_admin, user.id)
    except Exception:
        cards = []
    return jsonify({"has_key": bool(key), "profile": profile, "is_new_user": is_new_user, "cards": cards})


@app.route("/api/settings", methods=["POST"])
def api_settings_save():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    if data.get("clear_api_key") is True:
        settings = store_get_user_settings_state_for_user(supabase_admin, user_id)
        settings["anthropic_api_key"] = None
        store_save_user_settings_state_for_user(supabase_admin, user_id, settings)
        return jsonify({"success": True, "has_key": False})
    api_key = data.get("anthropic_api_key", "").strip()
    if not api_key:
        return jsonify({"error": "API key is required"}), 400
    settings = store_get_user_settings_state_for_user(supabase_admin, user_id)
    settings["anthropic_api_key"] = api_key
    store_save_user_settings_state_for_user(supabase_admin, user_id, settings)
    return jsonify({"success": True, "has_key": True})


@app.route("/api/profile", methods=["POST"])
def api_profile_save():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()

    if not first_name:
        return jsonify({"error": "First name is required"}), 400

    try:
        profile = store_upsert_profile_for_user(supabase_admin, user_id, first_name, last_name)
    except Exception as e:
        return jsonify({"error": f"Failed to save profile: {str(e)}"}), 500
    return jsonify({"success": True, "profile": profile})


@app.route("/api/cards", methods=["POST"])
def api_card_create():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    try:
        card = store_create_user_card_for_user(
            supabase_admin,
            user_id,
            data.get("brand"),
            data.get("digit_hint"),
            data.get("hint_position"),
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to save card: {str(e)}"}), 500

    return jsonify({"success": True, "card": card})


@app.route("/api/cards/<card_id>", methods=["DELETE"])
def api_card_delete(card_id: str):
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        deleted = store_delete_user_card_for_user(supabase_admin, user_id, card_id)
    except Exception as e:
        return jsonify({"error": f"Failed to delete card: {str(e)}"}), 500

    if not deleted:
        return jsonify({"error": "Card not found"}), 404
    return jsonify({"success": True})


@app.route("/api/welcome-seen", methods=["POST"])
def api_welcome_seen():
    user = get_user_from_request()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        seed = get_profile_seed_from_user(user)
        profile = store_upsert_profile_for_user(supabase_admin, user.id, seed.get("first_name"), seed.get("last_name"))
        return jsonify({"success": True, "profile": profile})
    except Exception:
        return jsonify({"success": True})


@app.route("/upload", methods=["POST"])
def upload():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    api_key = store_get_user_api_key(supabase_admin, user_id)
    if not api_key:
        return jsonify({"error": "no_api_key"}), 400

    selected_card_id = (request.form.get("selected_card_id") or "").strip()
    if not selected_card_id:
        return jsonify({"error": "no_card_selected"}), 400

    selected_card = store_get_user_card_for_user(supabase_admin, user_id, selected_card_id)
    if not selected_card:
        return jsonify({"error": "invalid_card"}), 400

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
        extracted_transactions = domain_extract_transactions_from_images(image_data_list, api_key)
        extracted_transactions = domain_filter_out_non_expenses(extracted_transactions)
        all_transactions = domain_attach_selected_card_to_transactions(extracted_transactions, selected_card["label"])
    except Exception as e:
        app.logger.exception("Claude extraction failed for user_id=%s", user_id)
        msg, help_url = domain_user_facing_extraction_error(e)
        return jsonify({"error": msg, "help_url": help_url}), 500

    try:
        existing_txs = store_get_existing_transactions_for_user(supabase_admin, user_id)
    except Exception as e:
        return jsonify({"error": f"Database query failed: {str(e)}"}), 500

    definite_new, definite_dup, possible_dup = domain_classify_transactions(all_transactions, existing_txs)

    # Mint a batch id for this analysis session. The client threads it through every
    # /confirm call originating from this analysis so the resulting rows can be
    # grouped and (if the user filed to the wrong card) deleted as a unit.
    batch_id = str(uuid4())

    return jsonify({
        "batch_id":        batch_id,
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
    rows = store_list_transactions_for_user(supabase_admin, user_id)
    for row in rows:
        row["card"] = canonicalize_card_label(row.get("card")) or "Unassigned"
    return jsonify({"transactions": rows})


@app.route("/confirm", methods=["POST"])
def confirm():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    transactions = data.get("transactions", [])
    batch_id = (data.get("batch_id") or "").strip() or None

    if not transactions:
        return jsonify({"error": "No transactions to add"}), 400

    try:
        inserted_ids = store_append_transactions_for_user(supabase_admin, user_id, transactions, batch_id=batch_id)
    except Exception as e:
        return jsonify({"error": f"Failed to write to database: {str(e)}"}), 500

    return jsonify({
        "success": True,
        "added": len(transactions),
        "ids": inserted_ids,
    })


@app.patch("/api/transactions/<tx_id>")
def api_transaction_patch(tx_id: str):
    """Update a row owned by the caller (e.g. pending → settled)."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    updates: dict[str, object] = {}

    if "status" in data:
        status = str(data.get("status") or "").strip().lower()
        if status not in ("pending", "settled"):
            return jsonify({"error": "status must be pending or settled"}), 400
        updates["status"] = status

    if "vendor" in data:
        vendor = re.sub(r"\s+", " ", str(data.get("vendor") or "").strip())
        if not vendor:
            return jsonify({"error": "merchant is required"}), 400
        if len(vendor) > 120:
            return jsonify({"error": "merchant must be 120 characters or fewer"}), 400
        updates["vendor"] = vendor

    if "date" in data:
        raw_date = str(data.get("date") or "").strip()
        if not raw_date:
            return jsonify({"error": "date is required"}), 400
        try:
            parsed = datetime.strptime(raw_date, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "date must be in YYYY-MM-DD format"}), 400
        updates["date"] = parsed.strftime("%Y-%m-%d")

    if "amount" in data:
        raw_amount = data.get("amount")
        if raw_amount is None or str(raw_amount).strip() == "":
            return jsonify({"error": "amount is required"}), 400
        try:
            amount = round(float(str(raw_amount).replace("$", "").replace(",", "").strip()), 2)
        except (TypeError, ValueError):
            return jsonify({"error": "amount must be a number"}), 400
        if amount <= 0:
            return jsonify({"error": "amount must be greater than 0"}), 400
        updates["amount"] = amount

    if not updates:
        return jsonify({"error": "No editable fields were provided"}), 400

    try:
        result = store_update_transaction_for_user(supabase_admin, user_id, tx_id, updates)
    except Exception as e:
        return jsonify({"error": f"Failed to update transaction: {str(e)}"}), 500

    rows = result.data or []
    if not rows:
        return jsonify({"error": "Transaction not found"}), 404

    row = rows[0]
    row["card"] = canonicalize_card_label(row.get("card")) or "Unassigned"
    return jsonify({"success": True, "transaction": row})


@app.route("/api/transactions/<tx_id>", methods=["DELETE"])
def api_transaction_delete(tx_id: str):
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        store_delete_transaction_for_user(supabase_admin, user_id, tx_id)
    except Exception as e:
        return jsonify({"error": f"Failed to delete transaction: {str(e)}"}), 500

    return jsonify({"success": True})


@app.route("/api/batches/<batch_id>", methods=["DELETE"])
def api_batch_delete(batch_id: str):
    """Delete every transaction belonging to one analysis session.

    Scoped to both ``user_id`` and ``batch_id`` so a user can only ever delete
    rows they themselves uploaded. The client computes batch metadata
    (counts, totals, merchants) locally from /api/transactions; this endpoint
    only handles the destructive operation.
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    batch_id = (batch_id or "").strip()
    if not batch_id:
        return jsonify({"error": "Missing batch id"}), 400

    try:
        result = store_delete_batch_for_user(supabase_admin, user_id, batch_id)
    except Exception as e:
        return jsonify({"error": f"Failed to delete batch: {str(e)}"}), 500

    deleted = len(result.data or [])
    if deleted == 0:
        return jsonify({"error": "Batch not found"}), 404

    return jsonify({"success": True, "deleted": deleted})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

