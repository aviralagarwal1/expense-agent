let sessionToken = sessionStorage.getItem("expense_token") || "";
let hasApiKey = false;
let savedCards = [];
let savedProviders = [];
let selectedCardId = "";
let selectedProvider = "";
let profileFirstName = "";
let isNewAccount = false;
let shouldFlashLoginSuccess = false;
let hostedAiEnabled = false;
let hostedDailyLimit = 0;
let hostedScreenshotsUploadedToday = 0;
let hostedScreenshotsRemaining = 0;
let selectedUserKeyProvider = "";
const PROCESSING_HOSTED = "hosted";
const PROCESSING_USER_KEY = "user_key";
const MANAGE_KEY_URL = "/connect-key?return_to=%2Fapp";
let hostedQuotaResetLabel = "12:00 AM UTC";
const authError = new URLSearchParams(window.location.search).get("auth_error");
const authPublicPath = window.location.pathname === "/register" ? "/register" : "/app";
const loadingView = document.getElementById("loadingView");
const welcomeView = document.getElementById("welcomeView");
const setupView = document.getElementById("setupView");
const workspaceView = document.getElementById("workspaceView");
const mainApp = document.getElementById("mainApp");
const authScreen = document.getElementById("authScreen");
const uploadMarkEl = document.getElementById("uploadMark");
const uploadPanel = document.getElementById("uploadPanel");
const uploadCardSelect = document.getElementById("uploadCardSelect");
const uploadProviderSelect = document.getElementById("uploadProviderSelect");
const uploadCardPickerEl = document.getElementById("uploadCardPicker");
const uploadProviderPickerEl = document.getElementById("uploadProviderPicker");
const uploadKeyPickerEl = document.getElementById("uploadKeyPicker");
const uploadKeySelect = document.getElementById("uploadKeySelect");
const uploadKeyManageLink = document.getElementById("uploadKeyManageLink");
const uploadConfigRowEl = document.getElementById("uploadConfigRow");
const uploadStatusLineEl = document.getElementById("uploadStatusLine");
const uploadSelectionEl = document.getElementById("uploadSelection");
const uploadSelectionCountEl = document.getElementById("uploadSelectionCount");
const cardEmptyStateEl = document.getElementById("cardEmptyState");
const loadingSpinnerEl = document.querySelector("#loadingView .spinner");
const loadingSuccessMarkEl = document.getElementById("loadingSuccessMark");
const loadingTitleEl = document.getElementById("loadingTitle");
const loadingCopyEl = document.getElementById("loadingCopy");
const welcomeHeadlineEl = document.getElementById("welcomeHeadline");
const welcomeContinueBtn = document.getElementById("welcomeContinueBtn");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const previewGrid = document.getElementById("previewGrid");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultsBox = document.getElementById("resultsBox");
const confirmBtn = document.getElementById("confirmBtn");
const viewHistoryBtn = document.getElementById("viewHistoryBtn");
const resetBtn = document.getElementById("resetBtn");
const toast = document.getElementById("toast");

let files = [];
let newTransactions = [];
let possibleTransactions = [];
let txStatuses = [];
let possibleStatuses = [];
let currentBatchId = "";
/** True when we already kicked off bootstrap from the OAuth hash (avoid double /api/settings). */
let authBootstrapFromHash = false;

(async function handleAuthRedirect() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token");
  if (accessToken) {
    sessionToken = accessToken;
    shouldFlashLoginSuccess = true;
    sessionStorage.setItem("expense_token", sessionToken);
    window.history.replaceState(null, "", "/app");
    profileFirstName = getFirstNameFromToken(sessionToken);
    authBootstrapFromHash = true;
    showAuthenticatedShell();
    checkApiKeyAndEnter();
    return;
  }
})();

if (sessionToken && !authBootstrapFromHash) {
  if (window.location.pathname === "/register") {
    window.history.replaceState(null, "", "/app");
  }
  profileFirstName = getFirstNameFromToken(sessionToken);
  showAuthenticatedShell();
  checkApiKeyAndEnter();
}

function getFirstNameFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const metadata = payload.user_metadata || {};
    const firstName = (metadata.first_name || metadata.firstName || "").trim();
    if (firstName) return firstName;

    const displayName = (metadata.display_name || metadata.full_name || metadata.name || "").trim();
    return displayName.split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

function clearStoredSession() {
  sessionToken = "";
  hasApiKey = false;
  savedCards = [];
  savedProviders = [];
  selectedCardId = "";
  selectedProvider = "";
  profileFirstName = "";
  isNewAccount = false;
  sessionStorage.removeItem("expense_token");
  sessionStorage.removeItem("expense_refresh_token");
}

function getUserIdFromToken(token) {
  try {
    return JSON.parse(atob(token.split(".")[1])).sub || "";
  } catch {
    return "";
  }
}

function getWelcomeSeenKey() {
  const userId = getUserIdFromToken(sessionToken);
  return userId ? `expense_welcome_seen_${userId}` : "";
}

function markWelcomeSeenLocally() {
  const key = getWelcomeSeenKey();
  if (key) localStorage.setItem(key, "1");
}

function hasSeenWelcomeLocally() {
  const key = getWelcomeSeenKey();
  return key ? localStorage.getItem(key) === "1" : false;
}

function getSavedCardKey() {
  const userId = getUserIdFromToken(sessionToken);
  return userId ? `expense_saved_card_${userId}` : "";
}

function getSavedProviderKey() {
  const userId = getUserIdFromToken(sessionToken);
  return userId ? `expense_saved_provider_${userId}` : "";
}

function persistSelectedCard(cardId) {
  const key = getSavedCardKey();
  if (!key) return;
  if (cardId) {
    localStorage.setItem(key, cardId);
  } else {
    localStorage.removeItem(key);
  }
}

function getPersistedSelectedCard() {
  const key = getSavedCardKey();
  return key ? localStorage.getItem(key) || "" : "";
}

function persistSelectedProvider(providerId) {
  const key = getSavedProviderKey();
  if (!key) return;
  if (providerId) {
    localStorage.setItem(key, providerId);
  } else {
    localStorage.removeItem(key);
  }
}

function getPersistedSelectedProvider() {
  const key = getSavedProviderKey();
  return key ? localStorage.getItem(key) || "" : "";
}

function getSavedUserKeyProviderKey() {
  const userId = getUserIdFromToken(sessionToken);
  return userId ? `expense_user_key_provider_${userId}` : "";
}

function persistSelectedUserKeyProvider(providerId) {
  const key = getSavedUserKeyProviderKey();
  if (!key) return;
  if (providerId) {
    localStorage.setItem(key, providerId);
  } else {
    localStorage.removeItem(key);
  }
}

function getPersistedSelectedUserKeyProvider() {
  const key = getSavedUserKeyProviderKey();
  return key ? localStorage.getItem(key) || "" : "";
}

function findSavedCard(cardId) {
  return savedCards.find(card => card.id === cardId) || null;
}

function findSavedProvider(providerId) {
  return savedProviders.find(provider => provider.id === providerId) || null;
}

function isHostedSelection() {
  return selectedProvider === PROCESSING_HOSTED;
}

function isUserKeySelection() {
  return selectedProvider === PROCESSING_USER_KEY;
}

function listSavedUserKeyProviders() {
  return savedProviders.filter(p => !p.hosted && p.has_key);
}

function hasSavedUserKey() {
  return listSavedUserKeyProviders().length > 0;
}

function findSavedUserKeyProvider() {
  const list = listSavedUserKeyProviders();
  if (!list.length) return null;
  if (selectedUserKeyProvider) {
    const match = list.find(p => p.id === selectedUserKeyProvider);
    if (match) return match;
  }
  const persisted = getPersistedSelectedUserKeyProvider();
  if (persisted) {
    const match = list.find(p => p.id === persisted);
    if (match) return match;
  }
  return list[0];
}

function hostedHasNoCreditsLeft() {
  return isHostedSelection() && hostedAiEnabled && hostedScreenshotsRemaining <= 0;
}

function setStatusLineText(text) {
  uploadStatusLineEl.textContent = text;
}

function setStatusLineWithLink(prefix, linkText, href) {
  uploadStatusLineEl.textContent = "";
  uploadStatusLineEl.appendChild(document.createTextNode(prefix));
  const a = document.createElement("a");
  a.className = "upload-status-link";
  a.href = href;
  a.textContent = linkText;
  uploadStatusLineEl.appendChild(a);
}

function syncHostedQuotaState(data) {
  if (!data) return;
  if (data.hosted_daily_screenshot_limit !== undefined) {
    hostedDailyLimit = Number(data.hosted_daily_screenshot_limit) || 0;
  }
  if (data.hosted_screenshots_uploaded_today !== undefined) {
    hostedScreenshotsUploadedToday = Math.max(0, Number(data.hosted_screenshots_uploaded_today) || 0);
  }
  if (data.hosted_screenshots_remaining !== undefined) {
    hostedScreenshotsRemaining = Math.max(0, Number(data.hosted_screenshots_remaining) || 0);
  } else {
    hostedScreenshotsRemaining = Math.max(0, hostedDailyLimit - hostedScreenshotsUploadedToday);
  }
  if (data.hosted_quota_reset_label) {
    hostedQuotaResetLabel = data.hosted_quota_reset_label;
  }
}

function setHostedQuotaStatusLine() {
  const remaining = Math.max(0, Number(hostedScreenshotsRemaining) || 0);
  const resetCopy = hostedQuotaResetLabel || "12:00 AM UTC";
  if (remaining <= 0) {
    setStatusLineText(`You've reached your free tier limit for today. Limits reset at ${resetCopy}.`);
    return;
  }
  const noun = remaining === 1 ? "screenshot" : "screenshots";
  uploadStatusLineEl.textContent = "";
  uploadStatusLineEl.appendChild(document.createTextNode("Free hosted tier: "));
  const quotaCount = document.createElement("strong");
  quotaCount.className = "upload-status-emphasis";
  quotaCount.textContent = `${remaining} ${noun}`;
  uploadStatusLineEl.appendChild(quotaCount);
  uploadStatusLineEl.appendChild(
    document.createTextNode(` remaining today. Resets at ${resetCopy}. For unlimited usage, switch to your own API key.`)
  );
}

function updateUploadStatusLine() {
  if (!uploadStatusLineEl) return;
  uploadStatusLineEl.classList.remove("is-warning", "is-blocked");
  if (!selectedProvider) {
    uploadStatusLineEl.textContent = "";
    uploadStatusLineEl.classList.remove("is-visible");
    return;
  }
  uploadStatusLineEl.classList.add("is-visible");
  if (isHostedSelection()) {
    setHostedQuotaStatusLine();
    if (hostedHasNoCreditsLeft()) {
      uploadStatusLineEl.classList.add("is-blocked");
    } else if (hostedScreenshotsRemaining <= 3) {
      uploadStatusLineEl.classList.add("is-warning");
    }
    return;
  }
  if (isUserKeySelection()) {
    const list = listSavedUserKeyProviders();
    if (list.length === 0) {
      uploadStatusLineEl.textContent = "";
      uploadStatusLineEl.classList.remove("is-visible");
      return;
    }
    uploadStatusLineEl.textContent = "";
    uploadStatusLineEl.classList.remove("is-visible");
    return;
  }
  uploadStatusLineEl.textContent = "";
  uploadStatusLineEl.classList.remove("is-visible");
}

function isProcessingMethodReady() {
  if (isHostedSelection()) {
    return hostedAiEnabled && hostedScreenshotsRemaining > 0;
  }
  if (isUserKeySelection()) {
    return hasSavedUserKey();
  }
  return false;
}

function renderUserKeyOptions() {
  if (!uploadKeySelect) return;
  const list = listSavedUserKeyProviders();
  uploadKeySelect.innerHTML = "";
  uploadKeySelect.disabled = list.length === 0;
  if (uploadKeyManageLink) {
    uploadKeyManageLink.textContent = list.length === 0 ? "Add Key" : "Manage Keys";
  }
  list.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    uploadKeySelect.appendChild(opt);
  });
  if (list.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No saved API keys";
    uploadKeySelect.appendChild(emptyOption);
    selectedUserKeyProvider = "";
    uploadKeySelect.value = "";
    return;
  }
  const chosen = findSavedUserKeyProvider();
  selectedUserKeyProvider = chosen ? chosen.id : list[0].id;
  uploadKeySelect.value = selectedUserKeyProvider;
}

function updateKeyPickerVisibility() {
  if (!uploadKeyPickerEl || !uploadConfigRowEl) return;
  const showKeyPicker = isUserKeySelection();
  uploadKeyPickerEl.hidden = !showKeyPicker;
  uploadConfigRowEl.classList.toggle("with-key-selector", showKeyPicker);
}

function updateAnalyzeAvailability() {
  analyzeBtn.disabled =
    files.length === 0 ||
    !selectedCardId ||
    !selectedProvider ||
    !isProcessingMethodReady();
  updateUploadStatusLine();
  updatePickerAttentionState();
  updateSelectionPreview();
  updateKeyPickerVisibility();
}

function updatePickerAttentionState() {
  if (uploadCardPickerEl) {
    const needsCard = files.length > 0 && !selectedCardId && savedCards.length > 0;
    uploadCardPickerEl.classList.toggle("needs-attention", needsCard);
  }
  if (uploadProviderPickerEl) {
    const needsProvider = files.length > 0 && !selectedProvider && savedProviders.length > 0;
    uploadProviderPickerEl.classList.toggle("needs-attention", needsProvider);
  }
}

function updateSelectionPreview() {
  if (!uploadSelectionEl || !uploadSelectionCountEl) return;
  if (files.length === 0) {
    uploadSelectionEl.hidden = true;
    uploadSelectionCountEl.textContent = "";
    return;
  }
  const noun = files.length === 1 ? "screenshot" : "screenshots";
  uploadSelectionEl.hidden = false;
  uploadSelectionCountEl.textContent = `${files.length} ${noun} selected`;
}

function syncSelectedCard() {
  const persistedCardId = getPersistedSelectedCard();
  if (selectedCardId && findSavedCard(selectedCardId)) {
  } else if (persistedCardId && findSavedCard(persistedCardId)) {
    selectedCardId = persistedCardId;
  } else if (savedCards.length === 1) {
    selectedCardId = savedCards[0].id;
  } else {
    selectedCardId = "";
  }

  if (selectedCardId) {
    persistSelectedCard(selectedCardId);
  } else {
    persistSelectedCard("");
  }

  uploadCardSelect.value = selectedCardId;
  updateAnalyzeAvailability();
}

function getProcessingMethodOptions() {
  const options = [];
  if (hostedAiEnabled) {
    options.push({ value: PROCESSING_HOSTED, label: "Hosted (Recommended)" });
  }
  if (hostedAiEnabled || hasSavedUserKey()) {
    options.push({ value: PROCESSING_USER_KEY, label: "Your API Key" });
  }
  return options;
}

function isProcessingMethodValid(value) {
  return getProcessingMethodOptions().some(opt => opt.value === value);
}

function normalizeProcessingMethod(value) {
  if (value === PROCESSING_HOSTED) return PROCESSING_HOSTED;
  if (value === PROCESSING_USER_KEY) return PROCESSING_USER_KEY;
  if (typeof value === "string" && value && value !== PROCESSING_HOSTED) {
    // Legacy persisted real-provider id (anthropic/openai/gemini) maps to "user_key".
    return PROCESSING_USER_KEY;
  }
  return "";
}

function syncSelectedProvider(activeProvider = "") {
  void activeProvider;
  const options = getProcessingMethodOptions();
  const persistedNormalized = normalizeProcessingMethod(getPersistedSelectedProvider());

  if (selectedProvider && isProcessingMethodValid(selectedProvider)) {
    // keep current selection
  } else if (persistedNormalized && isProcessingMethodValid(persistedNormalized)) {
    selectedProvider = persistedNormalized;
  } else if (hostedAiEnabled && isProcessingMethodValid(PROCESSING_HOSTED)) {
    selectedProvider = PROCESSING_HOSTED;
  } else if (options.length === 1) {
    selectedProvider = options[0].value;
  } else {
    selectedProvider = "";
  }

  persistSelectedProvider(selectedProvider);
  if (uploadProviderSelect) uploadProviderSelect.value = selectedProvider;
  updateAnalyzeAvailability();
}

function renderSavedCardOptions() {
  uploadCardSelect.innerHTML = "";

  if (savedCards.length > 1) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a card";
    uploadCardSelect.appendChild(placeholder);
  }

  if (!savedCards.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No saved cards";
    uploadCardSelect.appendChild(emptyOption);
    cardEmptyStateEl.style.display = "grid";
    uploadCardSelect.disabled = true;
    selectedCardId = "";
    updateAnalyzeAvailability();
    return;
  }

  savedCards.forEach(card => {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.label;
    uploadCardSelect.appendChild(option);
  });

  cardEmptyStateEl.style.display = "none";
  uploadCardSelect.disabled = false;
  syncSelectedCard();
}

function renderSavedProviderOptions(activeProvider = "") {
  if (!uploadProviderSelect) return;
  uploadProviderSelect.innerHTML = "";
  const options = getProcessingMethodOptions();

  if (!options.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No processing method available";
    uploadProviderSelect.appendChild(emptyOption);
    uploadProviderSelect.disabled = true;
    selectedProvider = "";
    updateAnalyzeAvailability();
    return;
  }

  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    uploadProviderSelect.appendChild(option);
  });

  uploadProviderSelect.disabled = false;
  renderUserKeyOptions();
  syncSelectedProvider(activeProvider);
}

function syncSavedCards(cards) {
  savedCards = Array.isArray(cards) ? cards : [];
  renderSavedCardOptions();
}

function syncSavedProviders(providers, activeProvider = "") {
  savedProviders = Array.isArray(providers) ? providers.filter(provider => provider.has_key) : [];
  renderSavedProviderOptions(activeProvider);
}

function renderTopBarIdentity() {
  const firstName = profileFirstName || getFirstNameFromToken(sessionToken);
  uploadMarkEl.textContent = firstName ? firstName + "\u2019s Expenses" : "EA";
}

function showAuthenticatedShell() {
  authScreen.style.display = "none";
  mainApp.style.display = "block";
  renderTopBarIdentity();
  loadingSpinnerEl.style.display = "inline-block";
  loadingSuccessMarkEl.style.display = "none";
  loadingTitleEl.textContent = "Opening your workspace.";
  loadingCopyEl.textContent = "Checking your account and loading your saved setup.";
  loadingView.classList.add("visible");
  welcomeView.classList.remove("visible");
  setupView.classList.remove("visible");
  workspaceView.classList.remove("visible");
}

async function checkApiKeyAndEnter() {
  try {
    const res = await fetch("/api/settings", { headers: { "Authorization": `Bearer ${sessionToken}` } });
    if (res.status === 401) {
      clearStoredSession();
      authScreen.style.display = "block";
      mainApp.style.display = "none";
      return;
    }
    const data = await res.json();
    hasApiKey = data.has_key;
    hostedAiEnabled = Boolean(data.hosted_ai_enabled);
    syncHostedQuotaState(data);
    syncSavedProviders(data.providers || [], data.active_provider || "");
    syncSavedCards(data.cards || []);
    profileFirstName = (data.profile && data.profile.first_name) || getFirstNameFromToken(sessionToken);
    isNewAccount = Boolean(data.is_new_user) && !hasSeenWelcomeLocally();
    await flashLoginSuccessIfNeeded();
    showMainApp();
  } catch (e) {
    loadingTitleEl.textContent = "Could not load the workspace.";
    loadingCopyEl.textContent = "Refresh and try again. If it keeps happening, check the Supabase connection.";
  }
}

async function flashLoginSuccessIfNeeded() {
  if (!shouldFlashLoginSuccess) return;
  shouldFlashLoginSuccess = false;
  loadingSpinnerEl.style.display = "none";
  loadingSuccessMarkEl.style.display = "inline-flex";
  loadingTitleEl.textContent = "Signed in.";
  loadingCopyEl.textContent = "Your workspace is ready.";
  await new Promise(resolve => setTimeout(resolve, 550));
}

function showMainApp() {
  authScreen.style.display = "none";
  mainApp.style.display = "block";
  renderTopBarIdentity();
  const firstName = profileFirstName || getFirstNameFromToken(sessionToken);
  loadingView.classList.remove("visible");
  if (isNewAccount) {
    const welcomeName = firstName ? `Welcome to Compline, ${firstName}.` : "Welcome to Compline.";
    welcomeHeadlineEl.textContent = welcomeName;
    welcomeView.classList.add("visible");
    setupView.classList.remove("visible");
    workspaceView.classList.remove("visible");
    return;
  }
  welcomeView.classList.remove("visible");

  const needsKey = !hasApiKey;
  const needsCard = hasApiKey && !savedCards.length;
  const setupStep = needsKey ? "key" : (needsCard ? "card" : null);

  setupView.classList.toggle("visible", setupStep !== null);
  workspaceView.classList.toggle("visible", setupStep === null);

  document.getElementById("keySetupGrid").style.display = setupStep === "key" ? "grid" : "none";
  document.getElementById("cardSetupGrid").style.display = setupStep === "card" ? "grid" : "none";
}

async function completeWelcome(targetUrl = "") {
  welcomeContinueBtn.disabled = true;
  welcomeContinueBtn.innerHTML = `<span class="spinner"></span>Continuing`;
  try {
    await fetch("/api/welcome-seen", {
      method: "POST",
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });
  } catch (e) {
  } finally {
    markWelcomeSeenLocally();
    isNewAccount = false;
    welcomeContinueBtn.disabled = false;
    welcomeContinueBtn.textContent = "Continue Setup";
    if (targetUrl) {
      window.location.href = targetUrl;
      return;
    }
    showMainApp();
  }
}

function doLogout() {
  clearStoredSession();
  window.location.href = "/app";
}

(function () {
  var bar = document.getElementById("appTopBar");
  var btn = document.getElementById("appMenuBtn");
  var panel = document.getElementById("appMenuPanel");
  if (!bar || !btn || !panel) return;
  function setOpen(open) {
    bar.classList.toggle("top-bar--open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  btn.addEventListener("click", function () {
    setOpen(!bar.classList.contains("top-bar--open"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });
  panel.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { setOpen(false); });
  });
})();

function updateConfirmBtn() {
  const remaining = newTransactions.filter((_, i) => !txStatuses[i] || txStatuses[i].state === null);
  if (remaining.length === 0) {
    confirmBtn.style.display = "none";
  } else {
    confirmBtn.textContent = `Add Remaining (${remaining.length}) to Log`;
    confirmBtn.style.display = "inline-flex";
  }
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => handleFiles(e.target.files));
uploadCardSelect.addEventListener("change", event => {
  selectedCardId = event.target.value;
  persistSelectedCard(selectedCardId);
  updateAnalyzeAvailability();
});
if (uploadProviderSelect) {
  uploadProviderSelect.addEventListener("change", event => {
    selectedProvider = event.target.value;
    persistSelectedProvider(selectedProvider);
    updateAnalyzeAvailability();
  });
}
if (uploadKeySelect) {
  uploadKeySelect.addEventListener("change", event => {
    selectedUserKeyProvider = event.target.value;
    persistSelectedUserKeyProvider(selectedUserKeyProvider);
    updateAnalyzeAvailability();
  });
}
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});

function handleFiles(incoming) {
  files = [...files, ...incoming];
  renderPreviews();
  updateAnalyzeAvailability();
}

function renderPreviews() {
  previewGrid.innerHTML = "";
  files.forEach((f, i) => {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-item";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    const del = document.createElement("button");
    del.className = "preview-delete";
    del.textContent = "x";
    del.onclick = () => {
      files.splice(i, 1);
      renderPreviews();
      updateAnalyzeAvailability();
    };
    wrapper.appendChild(img);
    wrapper.appendChild(del);
    previewGrid.appendChild(wrapper);
  });
}

function redirectToSettingsForKey() {
  window.location.href = "/connect-key?return_to=%2Fapp";
}

function redirectToSettingsForCards() {
  window.location.href = "/settings?return_to=%2Fapp";
}

function resetWorkspace() {
  files = [];
  newTransactions = [];
  possibleTransactions = [];
  txStatuses = [];
  possibleStatuses = [];
  currentBatchId = "";
  previewGrid.innerHTML = "";
  resultsBox.classList.remove("visible");
  document.getElementById("possibleBox").classList.remove("visible");
  document.getElementById("possibleList").innerHTML = "";
  confirmBtn.style.display = "none";
  viewHistoryBtn.style.display = "none";
  resetBtn.style.display = "none";
  analyzeBtn.style.display = "inline-flex";
  dropZone.style.display = "block";
  previewGrid.style.display = "grid";
  uploadPanel.classList.remove("hidden");
  workspaceView.classList.remove("results-first");
  fileInput.value = "";
  updateAnalyzeAvailability();
}

analyzeBtn.addEventListener("click", async () => {
  if (!savedCards.length) {
    showToast("Add a saved card in Settings before analyzing screenshots.");
    setTimeout(redirectToSettingsForCards, 500);
    return;
  }
  if (!selectedCardId) {
    showToast("Choose a saved card for this batch before analyzing.");
    uploadCardSelect.focus();
    return;
  }
  if (!selectedProvider) {
    showToast("Choose a processing method for this batch before analyzing.");
    uploadProviderSelect.focus();
    return;
  }
  if (hostedHasNoCreditsLeft()) {
    showToast("You've reached your free tier limit for today. Switch to your API key for unlimited usage.");
    uploadProviderSelect.focus();
    return;
  }
  if (isUserKeySelection() && !hasSavedUserKey()) {
    showToast("Add an API key before analyzing screenshots.");
    setTimeout(redirectToSettingsForKey, 500);
    return;
  }
  const submitProvider = isUserKeySelection()
    ? (findSavedUserKeyProvider() || {}).id
    : selectedProvider;
  if (!submitProvider) {
    showToast("Choose a processing method for this batch before analyzing.");
    uploadProviderSelect.focus();
    return;
  }
  analyzeBtn.innerHTML = `<span class="spinner"></span>Analyzing`;
  analyzeBtn.disabled = true;
  const usedHostedThisRun = isHostedSelection();
  const filesAtSubmit = files.length;
  const formData = new FormData();
  formData.append("selected_card_id", selectedCardId);
  formData.append("selected_provider", submitProvider);
  files.forEach(f => formData.append("screenshots", f));
  try {
    const res = await fetch("/upload", {
      method: "POST",
      headers: { "Authorization": `Bearer ${sessionToken}` },
      body: formData,
    });
    const data = await res.json();
    if (res.status === 401 || data.error === "Unauthorized") {
      clearStoredSession();
      authScreen.style.display = "block";
      mainApp.style.display = "none";
      showToast("Session expired. Please sign in again.");
      return;
    }
    if (data.error === "no_api_key") {
      showToast("Add an API key before analyzing screenshots.");
      setTimeout(redirectToSettingsForKey, 500);
      return;
    }
    if (data.error === "hosted_limit_exceeded") {
      syncHostedQuotaState(data);
      updateAnalyzeAvailability();
      if (hostedScreenshotsRemaining > 0) {
        const noun = hostedScreenshotsRemaining === 1 ? "screenshot" : "screenshots";
        showToast(`Only ${hostedScreenshotsRemaining} hosted ${noun} remaining today.`);
      } else {
        showToast("You've reached your free tier limit for today.");
      }
      return;
    }
    if (data.error === "no_provider_selected") {
      showToast("Choose an API key for this batch before analyzing.");
      uploadProviderSelect.focus();
      return;
    }
    if (data.error === "no_card_selected") {
      showToast("Choose a saved card for this batch before analyzing.");
      uploadCardSelect.focus();
      return;
    }
    if (data.error === "invalid_card") {
      showToast("That saved card is no longer available. Refreshing your settings.");
      await checkApiKeyAndEnter();
      setTimeout(redirectToSettingsForCards, 500);
      return;
    }
    if (data.error) {
      if (data.help_url) {
        showToast(data.error, data.help_url);
      } else {
        showToast("Error: " + data.error);
      }
      return;
    }
    if (usedHostedThisRun) {
      syncHostedQuotaState(data);
      if (data.hosted_screenshots_remaining === undefined) {
        hostedScreenshotsUploadedToday = Math.max(0, hostedScreenshotsUploadedToday + filesAtSubmit);
        hostedScreenshotsRemaining = Math.max(0, hostedDailyLimit - hostedScreenshotsUploadedToday);
      }
    }
    currentBatchId = data.batch_id || "";
    newTransactions = data.new;
    possibleTransactions = data.possible || [];
    txStatuses = newTransactions.map(() => ({ state: null, id: null }));
    possibleStatuses = possibleTransactions.map(() => ({ state: null, id: null }));
    document.getElementById("newCount").textContent = data.new.length;
    document.getElementById("possibleCount").textContent = possibleTransactions.length;
    document.getElementById("skipCount").textContent = data.skipped.length;
    document.getElementById("totalCount").textContent = data.total_extracted;
    const subtitleEl = document.getElementById("resultsSubtitle");
    if (subtitleEl) {
      subtitleEl.textContent = possibleTransactions.length > 0
        ? "New items are ready to log. We flag possible duplicates for a second look. We leave the final call to you."
        : "New items are ready to log. We leave the final call to you.";
    }
    renderTransactions(data.new, data.skipped);
    renderPossibleSafe(possibleTransactions);
    resultsBox.classList.add("visible");
    if (possibleTransactions.length > 0) {
      document.getElementById("possibleBox").classList.add("visible");
    }
    updateConfirmBtn();
    resetBtn.style.display = "inline-flex";
    viewHistoryBtn.style.display = "inline-flex";
    analyzeBtn.style.display = "none";
    dropZone.style.display = "none";
    previewGrid.style.display = "none";
    if (uploadSelectionEl) uploadSelectionEl.hidden = true;
    uploadPanel.classList.add("hidden");
    workspaceView.classList.add("results-first");
  } catch (err) {
    showToast("Network error - is the server running?");
  } finally {
    analyzeBtn.innerHTML = "Analyze Screenshots";
    updateAnalyzeAvailability();
  }
});

function renderPossibleActions(i) {
  const slot = document.getElementById(`possible-actions-${i}`);
  if (!slot) return;
  const status = possibleStatuses[i] || { state: null, id: null };
  const rowEl = document.getElementById(`possible-${i}`);

  if (status.state === null) {
    if (rowEl) rowEl.classList.remove("resolved");
    slot.innerHTML = `
      <button class="btn-add" onclick="approvePossible(${i})">Add It</button>
      <button class="btn-skip" onclick="skipPossible(${i})">Skip</button>`;
    return;
  }

  if (rowEl) rowEl.classList.add("resolved");
  const label = status.state === "added" ? "Added" : "Skipped";
  const pillClass = status.state === "added" ? "added" : "skipped";
  slot.innerHTML = `
    <span class="tx-status-pill ${pillClass}">${label}</span>
    <button class="btn-undo" id="possible-undobtn-${i}" onclick="undoPossible(${i})" title="Undo">${ICON_UNDO}<span>Undo</span></button>`;
}

async function approvePossible(i) {
  if (!possibleStatuses[i] || possibleStatuses[i].state !== null) return;
  const slot = document.getElementById(`possible-actions-${i}`);
  if (slot) {
    slot.innerHTML = `<span class="tx-status-pill added" style="opacity:0.75;">Adding<span class="spinner"></span></span>`;
  }
  try {
    const res = await fetch("/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ transactions: [possibleTransactions[i]], batch_id: currentBatchId }),
    });
    const data = await res.json();
    if (data.error) {
      showToast("Error: " + data.error);
      renderPossibleActions(i);
      return;
    }
    const insertedIds = data.ids || [];
    possibleStatuses[i] = { state: "added", id: insertedIds[0] || null };
    renderPossibleActions(i);
    markHistoryAvailable();
    showToast(`${possibleTransactions[i].vendor} added.`);
  } catch (err) {
    showToast("Network error");
    renderPossibleActions(i);
  }
}

function skipPossible(i) {
  if (!possibleStatuses[i] || possibleStatuses[i].state !== null) return;
  possibleStatuses[i] = { state: "skipped", id: null };
  renderPossibleActions(i);
}

async function undoPossible(i) {
  const status = possibleStatuses[i];
  if (!status || status.state === null) return;

  const undoBtn = document.getElementById(`possible-undobtn-${i}`);
  if (undoBtn) {
    undoBtn.disabled = true;
    undoBtn.innerHTML = `<span class="spinner"></span><span>Undoing</span>`;
  }

  if (status.state === "added" && status.id) {
    try {
      const res = await fetch(`/api/transactions/${status.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.error) {
        showToast("Couldn't undo: " + data.error);
        renderPossibleActions(i);
        return;
      }
    } catch (err) {
      showToast("Network error");
      renderPossibleActions(i);
      return;
    }
  }

  possibleStatuses[i] = { state: null, id: null };
  renderPossibleActions(i);
}

function renderTransactions(newTx, skipped) {
  const list = document.getElementById("txList");
  list.innerHTML = "";
  if (newTx.length > 0) {
    const heading = document.createElement("div");
    heading.className = "section-kicker";
    heading.textContent = "Ready to add";
    list.appendChild(heading);
    newTx.forEach((t, i) => list.appendChild(makeSafeTxEl(t, false, i)));
    newTx.forEach((_, i) => renderTxActions(i));
  }
  if (skipped.length > 0) {
    const heading = document.createElement("div");
    heading.className = "section-kicker";
    heading.style.marginTop = "6px";
    heading.textContent = "Skipped as already logged";
    list.appendChild(heading);
    skipped.forEach(t => list.appendChild(makeSafeTxEl(t, true)));
  }
}

function formatAmount(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function renderPossibleSafe(txs) {
  const list = document.getElementById("possibleList");
  list.innerHTML = "";
  txs.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "possible-tx";
    div.id = `possible-${i}`;

    const state = document.createElement("div");
    state.className = "possible-state";
    state.textContent = "Possible duplicate";

    const vendor = document.createElement("div");
    vendor.className = "tx-vendor";
    vendor.textContent = t.vendor || "";

    const meta = document.createElement("div");
    meta.className = "tx-meta";
    meta.textContent = `Screenshot date ${t.date || ""} · $${formatAmount(t.amount)} · ${t.card || ""}`;

    const nearby = document.createElement("div");
    nearby.className = "tx-meta";
    nearby.style.marginTop = "6px";
    nearby.textContent = `Similar entry already logged on ${t.possible_match?.date || "a nearby date"}.`;

    const actions = document.createElement("div");
    actions.className = "possible-actions";
    actions.id = `possible-actions-${i}`;

    div.appendChild(state);
    div.appendChild(vendor);
    div.appendChild(meta);
    div.appendChild(nearby);
    div.appendChild(actions);
    list.appendChild(div);
  });
  txs.forEach((_, i) => renderPossibleActions(i));
}

function makeSafeTxEl(t, muted = false, idx = null) {
  const div = document.createElement("div");
  div.className = "tx" + (muted ? " muted" : "");
  if (idx !== null) div.id = `tx-${idx}`;
  const isPending = t.status === "pending";

  const main = document.createElement("div");
  main.className = "tx-main";

  const vendor = document.createElement("div");
  vendor.className = "tx-vendor";
  vendor.textContent = t.vendor || "";
  main.appendChild(vendor);

  const meta = document.createElement("div");
  meta.className = "tx-meta";
  if (isPending) {
    const pending = document.createElement("span");
    pending.className = "pending-inline";
    const dot = document.createElement("span");
    dot.className = "pending-dot";
    pending.appendChild(dot);
    pending.appendChild(document.createTextNode("Pending · "));
    meta.appendChild(pending);
  }
  meta.appendChild(document.createTextNode(`${t.card || ""} · ${t.date || ""}`));
  main.appendChild(meta);

  const amount = document.createElement("div");
  amount.className = "tx-amount";
  amount.textContent = `$${formatAmount(t.amount)}`;

  div.appendChild(main);
  div.appendChild(amount);

  if (idx !== null) {
    const actions = document.createElement("div");
    actions.className = "tx-actions";
    actions.id = `tx-actions-${idx}`;
    div.appendChild(actions);
  }

  return div;
}

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 L9.2 16.7 L19 7"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>';
const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 L4 9 L9 4"/><path d="M4 9 h10 a6 6 0 0 1 0 12 h-3"/></svg>';

function renderTxActions(i) {
  const slot = document.getElementById(`tx-actions-${i}`);
  if (!slot) return;
  const status = txStatuses[i] || { state: null, id: null };
  const rowEl = document.getElementById(`tx-${i}`);

  if (status.state === null) {
    if (rowEl) rowEl.classList.remove("resolved");
    slot.innerHTML = `
      <button class="btn-action btn-remove-one" id="removebtn-${i}" onclick="removeOne(${i})" title="Dismiss this transaction" aria-label="Dismiss">${ICON_X}</button>
      <button class="btn-action btn-add-one" id="sendbtn-${i}" onclick="sendOne(${i})" title="Add this transaction" aria-label="Add">${ICON_CHECK}</button>`;
    return;
  }

  if (rowEl) rowEl.classList.add("resolved");
  const label = status.state === "added" ? "Added" : "Dismissed";
  const pillClass = status.state === "added" ? "added" : "removed";
  slot.innerHTML = `
    <span class="tx-status-pill ${pillClass}">${label}</span>
    <button class="btn-undo" id="undobtn-${i}" onclick="undoOne(${i})" title="Undo">${ICON_UNDO}<span>Undo</span></button>`;
}

async function sendOne(i) {
  if (!txStatuses[i] || txStatuses[i].state !== null) return;
  const slot = document.getElementById(`tx-actions-${i}`);
  if (slot) {
    slot.innerHTML = `<span class="tx-status-pill added" style="opacity:0.75;">Adding<span class="spinner"></span></span>`;
  }
  try {
    const res = await fetch("/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ transactions: [newTransactions[i]], batch_id: currentBatchId }),
    });
    const data = await res.json();
    if (data.error) {
      showToast("Error: " + data.error);
      renderTxActions(i);
      return;
    }
    const insertedIds = data.ids || [];
    txStatuses[i] = { state: "added", id: insertedIds[0] || null };
    renderTxActions(i);
    updateConfirmBtn();
    markHistoryAvailable();
    showToast(`${newTransactions[i].vendor} added.`);
  } catch (err) {
    showToast("Network error");
    renderTxActions(i);
  }
}

function removeOne(i) {
  if (!txStatuses[i] || txStatuses[i].state !== null) return;
  txStatuses[i] = { state: "removed", id: null };
  renderTxActions(i);
  updateConfirmBtn();
}

async function undoOne(i) {
  const status = txStatuses[i];
  if (!status || status.state === null) return;

  const undoBtn = document.getElementById(`undobtn-${i}`);
  if (undoBtn) {
    undoBtn.disabled = true;
    undoBtn.innerHTML = `<span class="spinner"></span><span>Undoing</span>`;
  }

  if (status.state === "added" && status.id) {
    try {
      const res = await fetch(`/api/transactions/${status.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.error) {
        showToast("Couldn't undo: " + data.error);
        renderTxActions(i);
        return;
      }
    } catch (err) {
      showToast("Network error");
      renderTxActions(i);
      return;
    }
  }

  txStatuses[i] = { state: null, id: null };
  renderTxActions(i);
  updateConfirmBtn();
}

confirmBtn.addEventListener("click", async () => {
  const pendingIdx = newTransactions
    .map((_, i) => i)
    .filter(i => !txStatuses[i] || txStatuses[i].state === null);
  if (pendingIdx.length === 0) return;
  const payload = pendingIdx.map(i => newTransactions[i]);
  confirmBtn.innerHTML = `<span class="spinner"></span>Saving`;
  confirmBtn.disabled = true;
  try {
    const res = await fetch("/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ transactions: payload, batch_id: currentBatchId }),
    });
    const data = await res.json();
    if (data.error) {
      showToast("Error: " + data.error);
      return;
    }
    const insertedIds = data.ids || [];
    pendingIdx.forEach((i, j) => {
      txStatuses[i] = { state: "added", id: insertedIds[j] || null };
      renderTxActions(i);
    });
    const addedCount = typeof data.added === "number" ? data.added : payload.length;
    markHistoryAvailable();
    showToast(`${addedCount} transaction${addedCount === 1 ? "" : "s"} logged.`);
    updateConfirmBtn();
  } catch (err) {
    showToast("Network error");
  } finally {
    confirmBtn.innerHTML = "Add to Log";
    confirmBtn.disabled = false;
  }
});

resetBtn.addEventListener("click", resetWorkspace);

const ALLOWED_TOAST_HELP_URLS = new Set([
  "https://console.anthropic.com/settings/keys",
  "https://platform.openai.com/api-keys",
  "https://aistudio.google.com/app/apikey",
]);

let toastHideTimer = null;

function showToast(msg, helpUrl) {
  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }
  toast.classList.remove("toast--rich");
  const safeHelp = helpUrl && ALLOWED_TOAST_HELP_URLS.has(helpUrl) ? helpUrl : "";
  if (safeHelp) {
    toast.classList.add("toast--rich");
    toast.textContent = "";
    const line = document.createElement("span");
    line.textContent = msg + " ";
    const a = document.createElement("a");
    a.href = safeHelp;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open provider console";
    toast.appendChild(line);
    toast.appendChild(a);
    toast.appendChild(document.createTextNode("."));
  } else {
    toast.textContent = msg;
  }
  toast.classList.add("show");
  const ms = safeHelp ? 11000 : 3000;
  toastHideTimer = setTimeout(() => {
    toast.classList.remove("show");
    toastHideTimer = null;
  }, ms);
}

function markHistoryAvailable() {
  if (viewHistoryBtn) viewHistoryBtn.style.display = "inline-flex";
}

if (authError) {
  const authErrorMessages = {
    google_sign_in_unavailable: "Google sign-in could not start. Check APP_URL and the Supabase Google redirect URLs.",
    google_callback_provider_error: "Google sign-in was cancelled or rejected before returning to the app.",
    google_callback_missing_code: "Google returned without an auth code. Recheck the Supabase redirect URL for Google OAuth.",
    google_callback_exchange_failed: "Google sign-in returned, but Supabase could not finish the session exchange.",
  };
  showToast(authErrorMessages[authError] || "Google sign-in failed.");
  window.history.replaceState(null, "", authPublicPath);
}
