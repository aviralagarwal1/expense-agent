  const token = sessionStorage.getItem("expense_token");
  if (!token) {
    window.location.href = "/app";
  }

  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("return_to") || "/app";
  const workspaceReturn = "/app";
  const returnLink = document.getElementById("returnLink");
  const statusReturnLink = document.getElementById("statusReturnLink");
  const profileLink = document.getElementById("profileLink");
  const workspaceLink = document.getElementById("workspaceLink");
  const keyStatus = document.getElementById("keyStatus");
  const keyStatusTitle = document.getElementById("keyStatusTitle");
  const keyStatusCopy = document.getElementById("keyStatusCopy");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const saveBtn = document.getElementById("saveBtn");
  const toggleKeyBtn = document.getElementById("toggleKeyBtn");

  let serverHasKey = false;

  returnLink.href = workspaceReturn;
  statusReturnLink.href = workspaceReturn;
  workspaceLink.href = workspaceReturn;
  profileLink.href = `/settings?return_to=${encodeURIComponent(returnTo)}`;

  function showReturnLink() {
    returnLink.style.display = "inline-flex";
  }

  function refreshSaveButton() {
    saveBtn.textContent = serverHasKey ? "Clear Key" : "Save Key";
  }

  function clearStatus() {
    const el = document.getElementById("statusMsg");
    el.textContent = "";
    el.className = "status-msg";
    el.style.display = "none";
  }

  function syncWorkspaceNav() {
    if (serverHasKey) {
      workspaceLink.classList.remove("is-disabled");
      workspaceLink.removeAttribute("aria-disabled");
      workspaceLink.removeAttribute("tabindex");
      workspaceLink.href = returnTo;
    } else {
      workspaceLink.classList.add("is-disabled");
      workspaceLink.setAttribute("aria-disabled", "true");
      workspaceLink.setAttribute("tabindex", "-1");
      workspaceLink.removeAttribute("href");
    }
  }

  function syncKeyBanner() {
    if (!serverHasKey) return;
    keyStatus.className = "key-status set";
    keyStatusTitle.textContent = "API Key Connected";
    keyStatusCopy.textContent = "Your key is saved and screenshot uploads are unlocked.";
    apiKeyInput.placeholder = "sk-ant-...";
    showReturnLink();
  }

  function updateKeyUi(hasKey) {
    serverHasKey = hasKey;
    keyStatus.style.display = "flex";
    syncWorkspaceNav();
    if (hasKey) {
      syncKeyBanner();
      refreshSaveButton();
      return;
    }

    keyStatus.className = "key-status unset";
    keyStatusTitle.textContent = "No API Key Saved";
    keyStatusCopy.textContent = "Screenshot uploads are locked until you save an Anthropic key below.";
    apiKeyInput.placeholder = "sk-ant-...";
    returnLink.style.display = "none";
    refreshSaveButton();
    requestAnimationFrame(() => apiKeyInput.focus());
  }

  function onPrimaryKeyAction() {
    if (serverHasKey) {
      clearApiKey();
      return;
    }
    saveKey();
  }

  async function clearApiKey() {
    saveBtn.disabled = true;
    saveBtn.textContent = "Clearing key…";
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ clear_api_key: true }),
      });
      const data = await res.json();
      if (data.error) {
        showStatus(data.error, false);
        return;
      }
      apiKeyInput.value = "";
      apiKeyInput.type = "password";
      toggleKeyBtn.textContent = "Show";
      clearStatus();
      updateKeyUi(false);
    } catch (e) {
      showStatus("Network error - please try again.", false);
    } finally {
      saveBtn.disabled = false;
      refreshSaveButton();
    }
  }

  async function loadKeyStatus() {
    try {
      const res = await fetch("/api/settings", { headers: { "Authorization": `Bearer ${token}` } });
      if (res.status === 401) {
        window.location.href = "/app";
        return;
      }
      const data = await res.json();
      updateKeyUi(Boolean(data.has_key));
    } catch (e) {
    }
  }

  loadKeyStatus();

  function toggleKeyVisibility() {
    const showing = apiKeyInput.type === "text";
    apiKeyInput.type = showing ? "password" : "text";
    toggleKeyBtn.textContent = showing ? "Show" : "Hide";
  }

  async function saveKey() {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus("Please add your API Key.", false);
      return;
    }
    if (!key.startsWith("sk-ant-")) {
      showStatus("That does not look like an Anthropic key. It should start with sk-ant-", false);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner"></span>Saving`;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ anthropic_api_key: key }),
      });
      const data = await res.json();
      if (data.error) {
        showStatus(data.error, false);
        return;
      }
      apiKeyInput.value = "";
      apiKeyInput.type = "password";
      toggleKeyBtn.textContent = "Show";
      clearStatus();
      updateKeyUi(true);
    } catch (e) {
      showStatus("Network error - please try again.", false);
    } finally {
      saveBtn.disabled = false;
      refreshSaveButton();
    }
  }

  function showStatus(msg, ok) {
    const el = document.getElementById("statusMsg");
    el.textContent = msg;
    el.className = "status-msg " + (ok ? "success" : "error");
    el.style.display = "block";
  }

  apiKeyInput.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (serverHasKey) {
      const k = apiKeyInput.value.trim();
      if (k.startsWith("sk-ant-")) {
        saveKey();
      }
      return;
    }
    saveKey();
  });

