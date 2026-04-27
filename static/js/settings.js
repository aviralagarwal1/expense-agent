  const token = sessionStorage.getItem("expense_token");
  if (!token) {
    window.location.href = "/app";
  }

  const PROVIDERS = {
    anthropic: {
      label: "Anthropic",
      keyName: "anthropic_api_key",
      placeholder: "sk-ant-...",
      consoleUrl: "https://console.anthropic.com/settings/keys",
      consoleName: "Anthropic Console",
      prefix: "sk-ant-",
    },
    openai: {
      label: "OpenAI",
      keyName: "openai_api_key",
      placeholder: "sk-...",
      consoleUrl: "https://platform.openai.com/api-keys",
      consoleName: "OpenAI API Keys",
      prefix: "sk-",
    },
    gemini: {
      label: "Gemini",
      keyName: "gemini_api_key",
      placeholder: "AIza...",
      consoleUrl: "https://aistudio.google.com/app/apikey",
      consoleName: "Google AI Studio",
      prefix: "",
    },
  };

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
  const providerFieldLabel = document.getElementById("providerFieldLabel");
  const providerFieldCopy = document.getElementById("providerFieldCopy");
  const providerConsoleLink = document.getElementById("providerConsoleLink");
  const providerTabs = Array.from(document.querySelectorAll(".provider-tab"));

  let providerState = {};
  let activeProvider = "anthropic";
  let serverHasAnyKey = false;

  returnLink.href = workspaceReturn;
  statusReturnLink.href = workspaceReturn;
  workspaceLink.href = workspaceReturn;
  profileLink.href = `/settings?return_to=${encodeURIComponent(returnTo)}`;

  function getProvider(provider = activeProvider) {
    return PROVIDERS[provider] || PROVIDERS.anthropic;
  }

  function providerHasKey(provider = activeProvider) {
    return Boolean(providerState[provider]?.has_key);
  }

  function showReturnLink() {
    returnLink.style.display = "inline-flex";
  }

  function refreshSaveButton() {
    saveBtn.textContent = providerHasKey() ? "Clear Key" : "Save Key";
  }

  function clearStatus() {
    const el = document.getElementById("statusMsg");
    el.textContent = "";
    el.className = "status-msg";
    el.style.display = "none";
  }

  function syncWorkspaceNav() {
    if (serverHasAnyKey) {
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

  function syncProviderFields() {
    const provider = getProvider();
    providerTabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.provider === activeProvider);
    });
    providerFieldLabel.textContent = `${provider.label} API key`;
    providerFieldCopy.innerHTML = `Create one in the <a href="${provider.consoleUrl}" target="_blank" rel="noopener">${provider.consoleName}</a>, paste it here, and save it to your account.`;
    providerConsoleLink.href = provider.consoleUrl;
    providerConsoleLink.textContent = "Open Console";
    apiKeyInput.placeholder = provider.placeholder;
    apiKeyInput.value = "";
    apiKeyInput.type = "password";
    toggleKeyBtn.textContent = "Show";
  }

  function syncKeyBanner() {
    keyStatus.style.display = "flex";
    syncWorkspaceNav();
    syncProviderFields();
    const provider = getProvider();
    if (providerHasKey()) {
      keyStatus.className = "key-status set";
      keyStatusTitle.textContent = `${provider.label} Key Connected`;
      keyStatusCopy.textContent = "This provider is ready for screenshot analysis.";
      showReturnLink();
    } else {
      keyStatus.className = "key-status unset";
      keyStatusTitle.textContent = `No ${provider.label} Key Saved`;
      keyStatusCopy.textContent = "Save a key for this provider to use it in the workspace.";
      returnLink.style.display = serverHasAnyKey ? "inline-flex" : "none";
    }
    refreshSaveButton();
  }

  function updateProviderState(providers = [], selectedProvider = activeProvider) {
    providerState = {};
    providers.forEach(provider => {
      providerState[provider.id] = provider;
    });
    serverHasAnyKey = providers.some(provider => provider.has_key);
    activeProvider = PROVIDERS[selectedProvider] ? selectedProvider : "anthropic";
    syncKeyBanner();
  }

  function onPrimaryKeyAction() {
    if (providerHasKey()) {
      clearApiKey();
      return;
    }
    saveKey();
  }

  async function clearApiKey() {
    saveBtn.disabled = true;
    saveBtn.textContent = "Clearing key...";
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ clear_api_key: true, provider: activeProvider }),
      });
      const data = await res.json();
      if (data.error) {
        showStatus(data.error, false);
        return;
      }
      clearStatus();
      updateProviderState(data.providers || [], activeProvider);
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
      updateProviderState(data.providers || [], data.active_provider || "anthropic");
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
    const provider = getProvider();
    if (!key) {
      showStatus("Please add your API key.", false);
      return;
    }
    if (provider.prefix && !key.startsWith(provider.prefix)) {
      showStatus(`That does not look like a ${provider.label} key.`, false);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner"></span>Saving`;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          provider: activeProvider,
          api_key: key,
        }),
      });
      const data = await res.json();
      if (data.error) {
        showStatus(data.error, false);
        return;
      }
      clearStatus();
      updateProviderState(data.providers || [], data.active_provider || activeProvider);
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

  providerTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      activeProvider = tab.dataset.provider || "anthropic";
      clearStatus();
      syncKeyBanner();
    });
  });

  apiKeyInput.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (providerHasKey()) {
      const k = apiKeyInput.value.trim();
      const provider = getProvider();
      if (!provider.prefix || k.startsWith(provider.prefix)) {
        saveKey();
      }
      return;
    }
    saveKey();
  });
