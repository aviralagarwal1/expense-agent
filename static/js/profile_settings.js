  const token = sessionStorage.getItem("compline_token");
  if (!token) {
    window.location.href = "/app";
  }

  let savedCards = [];

  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("return_to") || "/app";
  document.getElementById("returnToWorkspaceBtn").href = returnTo;

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings", { headers: { "Authorization": `Bearer ${token}` } });
      if (res.status === 401) {
        window.location.href = "/app";
        return;
      }
      const data = await res.json();
      document.getElementById("firstNameInput").value = data.profile?.first_name || "";
      document.getElementById("lastNameInput").value = data.profile?.last_name || "";
      savedCards = data.cards || [];
      renderSavedCards();
    } catch (e) {
      showCardStatus("Could not load settings.", false);
    }
  }

  function renderSavedCards() {
    const list = document.getElementById("savedCardsList");
    const returnBtn = document.getElementById("returnToWorkspaceBtn");

    if (!savedCards.length) {
      list.innerHTML = `<p class="card-list-empty">No cards yet.</p>`;
      returnBtn.style.display = "none";
      return;
    }

    returnBtn.style.display = "inline-flex";
    list.innerHTML = savedCards.map(card => `
      <div class="saved-card" role="listitem">
        <span class="saved-card-mark" aria-hidden="true">${escapeHtml((card.brand || "?").trim().charAt(0).toUpperCase())}</span>
        <span class="saved-card-label">${escapeHtml(card.label)}</span>
        <button class="row-text-btn" type="button" onclick="deleteCard('${card.id}')" aria-label="Remove ${escapeHtml(card.label)}">Remove</button>
      </div>
    `).join("");
  }

  function showCardError(message) {
    const el = document.getElementById("cardsEmptyState");
    el.textContent = message;
    el.hidden = !message;
  }

  async function saveProfile() {
    const firstName = document.getElementById("firstNameInput").value.trim();
    const lastName = document.getElementById("lastNameInput").value.trim();
    if (!firstName) {
      showProfileStatus("First name is required.", false);
      return;
    }

    const btn = document.getElementById("saveProfileBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Saving`;

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ first_name: firstName, last_name: lastName }),
      });
      const data = await res.json();
      if (data.error) {
        showProfileStatus(data.error, false);
        return;
      }
      document.getElementById("firstNameInput").value = data.profile?.first_name || firstName;
      document.getElementById("lastNameInput").value = data.profile?.last_name || lastName;
      showProfileStatus("Saved", true);
    } catch (e) {
      showProfileStatus("Network error - please try again.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  }

  function getCardBrandValue() {
    const select = document.getElementById("cardBrandSelect");
    const customRow = document.getElementById("cardBrandCustomRow");
    const customInput = document.getElementById("cardBrandCustomInput");
    if (customRow.classList.contains("is-visible")) {
      return customInput.value.trim();
    }
    return (select.value || "").trim();
  }

  function resetCardBrandFields() {
    const select = document.getElementById("cardBrandSelect");
    const customRow = document.getElementById("cardBrandCustomRow");
    const customInput = document.getElementById("cardBrandCustomInput");
    select.value = "";
    select.style.display = "";
    customInput.value = "";
    customRow.classList.remove("is-visible");
  }

  function showCardBrandCustomMode() {
    const select = document.getElementById("cardBrandSelect");
    const customRow = document.getElementById("cardBrandCustomRow");
    const customInput = document.getElementById("cardBrandCustomInput");
    select.style.display = "none";
    customRow.classList.add("is-visible");
    customInput.focus();
  }

  function showCardBrandSelectMode() {
    const select = document.getElementById("cardBrandSelect");
    const customRow = document.getElementById("cardBrandCustomRow");
    const customInput = document.getElementById("cardBrandCustomInput");
    select.style.display = "";
    select.value = "";
    customInput.value = "";
    customRow.classList.remove("is-visible");
  }

  async function addCard() {
    const brand = getCardBrandValue();
    const digitHint = document.getElementById("cardDigitHintInput").value.trim();

    if (!brand) {
      showCardStatus("Select or enter a card brand.", false);
      return;
    }
    const btn = document.getElementById("saveCardBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Saving`;
    showCardError("");

    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          brand,
          hint_position: digitHint ? "ending" : "",
          digit_hint: digitHint,
        }),
      });
      const data = await res.json();
      if (data.error) {
        renderSavedCards();
        showCardStatus(data.error, false);
        return;
      }

      savedCards = [...savedCards, data.card];
      savedCards.sort((a, b) => a.label.localeCompare(b.label));
      resetCardBrandFields();
      document.getElementById("cardDigitHintInput").value = "";
      renderSavedCards();
    } catch (e) {
      renderSavedCards();
      showCardStatus("Network error - please try again.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Add card";
    }
  }

  async function deleteCard(cardId) {
    try {
      const res = await fetch(`/api/cards/${cardId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.error) {
        showCardStatus(data.error, false);
        return;
      }
      savedCards = savedCards.filter(card => card.id !== cardId);
      renderSavedCards();
    } catch (e) {
      showCardStatus("Network error - please try again.", false);
    }
  }

  function showProfileStatus(msg, ok) {
    const el = document.getElementById("profileStatusMsg");
    el.textContent = msg;
    el.className = "settings-msg" + (ok ? "" : " is-error");
  }

  function showCardStatus(msg) {
    showCardError(msg);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  document.getElementById("firstNameInput").addEventListener("keydown", event => {
    if (event.key === "Enter") saveProfile();
  });

  document.getElementById("lastNameInput").addEventListener("keydown", event => {
    if (event.key === "Enter") saveProfile();
  });

  document.getElementById("cardDigitHintInput").addEventListener("keydown", event => {
    if (event.key === "Enter") addCard();
  });

  document.getElementById("cardBrandSelect").addEventListener("change", event => {
    if (event.target.value === "__custom__") {
      showCardBrandCustomMode();
    }
  });

  document.getElementById("cardBrandBackToListBtn").addEventListener("click", () => {
    showCardBrandSelectMode();
  });

  document.getElementById("cardBrandCustomInput").addEventListener("keydown", event => {
    if (event.key === "Enter") addCard();
  });

  // Delete account: unlocked by typing "delete", then everything goes and the
  // browser forgets the session and this user's local preferences.
  const deleteInput = document.getElementById("deleteConfirmInput");
  const deleteBtn = document.getElementById("deleteAccountBtn");
  const deleteMsg = document.getElementById("deleteMsg");
  deleteInput.addEventListener("input", () => {
    deleteBtn.disabled = deleteInput.value.trim().toLowerCase() !== "delete";
  });
  deleteBtn.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = `<span class="spinner"></span>Deleting`;
    deleteMsg.textContent = "";
    try {
      const res = await fetch("/api/account", { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "failed");
      window.clearExpenseSessionStorage();
      Object.keys(localStorage).filter(key => key.startsWith("compline_")).forEach(key => localStorage.removeItem(key));
      window.location.replace("/?account_deleted=1");
    } catch (e) {
      deleteMsg.textContent = "Could not delete your account. Try again.";
      deleteBtn.textContent = "Delete account";
      deleteBtn.disabled = deleteInput.value.trim().toLowerCase() !== "delete";
    }
  });

  loadSettings();

