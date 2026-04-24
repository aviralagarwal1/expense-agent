  const token = sessionStorage.getItem("expense_token");
  if (!token) {
    window.location.href = "/app";
  }

  let savedCards = [];

  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("return_to") || "/app";
  document.getElementById("apiKeyLink").href = `/connect-key?return_to=${encodeURIComponent(returnTo)}`;
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
      clearCardStatus();
      list.innerHTML = "";
      showCardsBanner("empty");
      returnBtn.style.display = "none";
      return;
    }

    hideCardsBanner();
    returnBtn.style.display = "inline-flex";
    list.innerHTML = savedCards.map(card => `
      <div class="saved-card">
        <div>
          <div class="saved-card-label">${escapeHtml(card.label)}</div>
          <div class="saved-card-meta">Used as the saved card label during upload.</div>
        </div>
        <button class="btn btn-danger" type="button" onclick="deleteCard('${card.id}')">Delete</button>
      </div>
    `).join("");
  }

  function showCardsBanner(mode, label = "", detail = "") {
    const banner = document.getElementById("cardsEmptyState");
    if (mode === "empty" && !label && !detail) {
      label = "No cards saved yet. Add your first one below.";
    }
    banner.className = "empty-state" + (
      mode === "success" ? " success" :
      (mode === "danger" || mode === "empty") ? " danger" :
      ""
    );
    banner.innerHTML = detail
      ? `<span class="empty-state-label">${escapeHtml(label)}</span><span>${escapeHtml(detail)}</span>`
      : `<span class="empty-state-label">${escapeHtml(label)}</span>`;
    banner.style.display = "flex";
  }

  function hideCardsBanner() {
    const banner = document.getElementById("cardsEmptyState");
    banner.style.display = "none";
    banner.className = "empty-state";
  }

  function clearCardStatus() {
    if (savedCards.length) {
      hideCardsBanner();
      return;
    }
    showCardsBanner("empty");
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
      showProfileStatus("Profile saved.", true);
    } catch (e) {
      showProfileStatus("Network error - please try again.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Name";
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
    const hintPositionSelect = document.getElementById("cardHintPositionInput");
    const brand = getCardBrandValue();
    const hintPosition = hintPositionSelect.value;
    const digitHint = document.getElementById("cardDigitHintInput").value.trim();

    if (!brand) {
      showCardStatus("Select or enter a card brand.", false);
      return;
    }
    const btn = document.getElementById("saveCardBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Saving`;
    clearCardStatus();

    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          brand,
          hint_position: hintPosition || "",
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
      hintPositionSelect.value = "";
      document.getElementById("cardDigitHintInput").value = "";
      renderSavedCards();
      showCardsBanner("success", "Your card saved. You're good to go!");
    } catch (e) {
      renderSavedCards();
      showCardStatus("Network error - please try again.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Add Card";
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
    el.className = "status-msg " + (ok ? "success" : "error");
    el.style.display = ok ? "inline-block" : "block";
  }

  function showCardStatus(msg, ok) {
    showCardsBanner(ok ? "success" : "danger", msg);
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

  loadSettings();

