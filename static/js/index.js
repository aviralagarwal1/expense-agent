let sessionToken = sessionStorage.getItem("expense_token") || "";
let savedCards = [];
let selectedCardId = "";
let profileFirstName = "";
let isNewAccount = false;
let shouldFlashLoginSuccess = false;
let hostedAiEnabled = false;
let hostedDailyLimit = 0;
let hostedScreenshotsUploadedToday = 0;
let hostedScreenshotsRemaining = 0;
let hostedQuotaResetLabel = "12:00 AM UTC";
const authError = new URLSearchParams(window.location.search).get("auth_error");
const loadingView = document.getElementById("loadingView");
const welcomeView = document.getElementById("welcomeView");
const setupView = document.getElementById("setupView");
const workspaceView = document.getElementById("workspaceView");
const mainApp = document.getElementById("mainApp");
const uploadPanel = document.getElementById("uploadPanel");
const uploadCardSelect = document.getElementById("uploadCardSelect");
const uploadCardPickerEl = document.getElementById("uploadCardPicker");
const uploadStatusLineEl = document.getElementById("uploadStatusLine");
const appTitleEl = document.querySelector("#workspaceView .app-title");
const reviewCardEl = document.getElementById("reviewCard");
const reviewCountEl = document.getElementById("reviewCount");
const cardEmptyStateEl = document.getElementById("cardEmptyState");
const loadingSpinnerEl = document.querySelector("#loadingView .spinner");
const loadingSuccessMarkEl = document.getElementById("loadingSuccessMark");
const loadingTitleEl = document.getElementById("loadingTitle");
const loadingCopyEl = document.getElementById("loadingCopy");
const retryWorkspaceBtn = document.getElementById("retryWorkspaceBtn");
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

/** No workspace to render without a session - send them to the public page. */
function returnToSignIn() {
  window.location.replace("/");
}

if (sessionToken && !authBootstrapFromHash) {
  profileFirstName = getFirstNameFromToken(sessionToken);
  showAuthenticatedShell();
  checkApiKeyAndEnter();
} else if (!sessionToken && !authBootstrapFromHash) {
  returnToSignIn();
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
  savedCards = [];
  selectedCardId = "";
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

function findSavedCard(cardId) {
  return savedCards.find(card => card.id === cardId) || null;
}

function hostedHasNoCreditsLeft() {
  return hostedAiEnabled && hostedDailyLimit > 0 && hostedScreenshotsRemaining <= 0;
}

function setStatusLineText(text) {
  uploadStatusLineEl.textContent = text;
}

function syncHostedQuotaState(data) {
  if (!data) return;
  if (data.hosted_daily_screenshot_limit !== undefined) {
    hostedDailyLimit = Number(data.hosted_daily_screenshot_limit) || 0;
  }
  if (data.hosted_screenshots_uploaded_today !== undefined) {
    hostedScreenshotsUploadedToday = Math.max(0, Number(data.hosted_screenshots_uploaded_today) || 0);
  }
  if (hostedDailyLimit === 0) {
    // A zero configured limit means unlimited hosted processing.
    hostedScreenshotsRemaining = Number.POSITIVE_INFINITY;
  } else if (data.hosted_screenshots_remaining !== undefined) {
    hostedScreenshotsRemaining = Math.max(0, Number(data.hosted_screenshots_remaining) || 0);
  } else {
    hostedScreenshotsRemaining = Math.max(0, hostedDailyLimit - hostedScreenshotsUploadedToday);
  }
  if (data.hosted_quota_reset_label) {
    hostedQuotaResetLabel = data.hosted_quota_reset_label;
  }
}

function setHostedQuotaStatusLine() {
  if (hostedDailyLimit === 0) {
    setStatusLineText("");
    return;
  }
  const remaining = Math.max(0, Number(hostedScreenshotsRemaining) || 0);
  const resetCopy = hostedQuotaResetLabel || "12:00 AM UTC";
  if (remaining <= 0) {
    setStatusLineText(`Processing limit reached for today. Resets at ${resetCopy}.`);
    return;
  }
  const noun = remaining === 1 ? "screenshot" : "screenshots";
  uploadStatusLineEl.textContent = "";
  const quotaCount = document.createElement("strong");
  quotaCount.className = "upload-status-emphasis";
  quotaCount.textContent = `${remaining} ${noun}`;
  uploadStatusLineEl.appendChild(quotaCount);
  uploadStatusLineEl.appendChild(
    document.createTextNode(` left today \u00b7 Resets at ${resetCopy}`)
  );
}

function updateUploadStatusLine() {
  if (!uploadStatusLineEl) return;
  uploadStatusLineEl.classList.remove("is-warning", "is-blocked");
  uploadStatusLineEl.classList.add("is-visible");
  if (!hostedAiEnabled) {
    setStatusLineText("Screenshot processing is temporarily unavailable.");
    uploadStatusLineEl.classList.add("is-blocked");
    return;
  }
  setHostedQuotaStatusLine();
  if (hostedHasNoCreditsLeft()) {
    uploadStatusLineEl.classList.add("is-blocked");
  } else if (hostedDailyLimit > 0 && hostedScreenshotsRemaining <= 3) {
    uploadStatusLineEl.classList.add("is-warning");
  }
}

function isProcessingMethodReady() {
  return hostedAiEnabled && (hostedDailyLimit === 0 || hostedScreenshotsRemaining > 0);
}

function updateAnalyzeAvailability() {
  analyzeBtn.disabled =
    files.length === 0 ||
    !selectedCardId ||
    !isProcessingMethodReady();
  updateUploadStatusLine();
  updatePickerAttentionState();
  updateSelectionPreview();
}

function updatePickerAttentionState() {
  if (uploadCardPickerEl) {
    const needsCard = files.length > 0 && !selectedCardId && savedCards.length > 0;
    uploadCardPickerEl.classList.toggle("needs-attention", needsCard);
  }
}

function updateSelectionPreview() {
  uploadPanel.classList.toggle("has-files", files.length > 0);
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
    cardEmptyStateEl.hidden = false;
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

  cardEmptyStateEl.hidden = true;
  uploadCardSelect.disabled = false;
  syncSelectedCard();
}

function syncSavedCards(cards) {
  savedCards = Array.isArray(cards) ? cards : [];
  renderSavedCardOptions();
}

function showAuthenticatedShell() {
  mainApp.style.display = "block";
  loadingSpinnerEl.style.display = "inline-block";
  loadingSuccessMarkEl.style.display = "none";
  loadingTitleEl.textContent = "Opening your workspace";
  loadingCopyEl.textContent = "Checking your account and loading your saved setup.";
  if (retryWorkspaceBtn) retryWorkspaceBtn.hidden = true;
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
      returnToSignIn();
      return;
    }
    const data = await res.json();
    hostedAiEnabled = Boolean(data.hosted_ai_enabled);
    syncHostedQuotaState(data);
    syncSavedCards(data.cards || []);
    profileFirstName = (data.profile && data.profile.first_name) || getFirstNameFromToken(sessionToken);
    isNewAccount = Boolean(data.is_new_user) && !hasSeenWelcomeLocally();
    await flashLoginSuccessIfNeeded();
    showMainApp();
  } catch (e) {
    loadingTitleEl.textContent = "Could not load the workspace";
    loadingCopyEl.textContent = "Please try again in a moment.";
    if (retryWorkspaceBtn) retryWorkspaceBtn.hidden = false;
  }
}

if (retryWorkspaceBtn) {
  retryWorkspaceBtn.addEventListener("click", () => {
    showAuthenticatedShell();
    checkApiKeyAndEnter();
  });
}

async function flashLoginSuccessIfNeeded() {
  if (!shouldFlashLoginSuccess) return;
  shouldFlashLoginSuccess = false;
  loadingSpinnerEl.style.display = "none";
  loadingSuccessMarkEl.style.display = "inline-flex";
  loadingTitleEl.textContent = "Signed in";
  loadingCopyEl.textContent = "Your workspace is ready.";
  await new Promise(resolve => setTimeout(resolve, 550));
}

function showMainApp() {
  mainApp.style.display = "block";
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

  const setupStep = !savedCards.length ? "card" : null;

  setupView.classList.toggle("visible", setupStep !== null);
  workspaceView.classList.toggle("visible", setupStep === null);

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
    welcomeContinueBtn.textContent = "Continue";
    if (targetUrl) {
      window.location.href = targetUrl;
      return;
    }
    showMainApp();
  }
}

// One primary action at a time: add the rows still included, then go to history.
function updateConfirmBtn() {
  const remaining = newTransactions.filter((_, i) => txStatuses[i] && txStatuses[i].state === null).length;
  const anyAdded = txStatuses.concat(possibleStatuses).some(st => st && st.state === "added");
  if (remaining > 0) {
    confirmBtn.textContent = `Add ${remaining} to history`;
    confirmBtn.style.display = "inline-flex";
    viewHistoryBtn.style.display = "none";
  } else {
    confirmBtn.style.display = "none";
    viewHistoryBtn.style.display = anyAdded ? "inline-flex" : "none";
  }
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => handleFiles(e.target.files));
uploadCardSelect.addEventListener("change", event => {
  selectedCardId = event.target.value;
  persistSelectedCard(selectedCardId);
  updateAnalyzeAvailability();
});
dropZone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
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
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const accepted = Array.from(incoming).filter(file => {
    if (!allowedTypes.has(file.type)) {
      showToast(`${file.name || "That file"} is not a supported image.`);
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name || "That file"} is larger than 10 MB.`);
      return false;
    }
    return true;
  });
  const combined = [...files, ...accepted];
  files = combined.slice(0, 10);
  if (combined.length > 10) {
    showToast("Choose up to 10 screenshots at a time.");
  }
  renderPreviews();
  updateAnalyzeAvailability();
}

// Selected screenshots as small phone-shaped previews; the corner button drops one.
function renderPreviews() {
  previewGrid.innerHTML = "";
  files.forEach((f, i) => {
    const thumb = document.createElement("div");
    thumb.className = "preview-thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    img.alt = "";
    const del = document.createElement("button");
    del.className = "preview-remove";
    del.type = "button";
    del.innerHTML = ICON_X;
    del.setAttribute("aria-label", `Remove ${f.name || `screenshot ${i + 1}`}`);
    del.onclick = () => {
      files.splice(i, 1);
      renderPreviews();
      updateAnalyzeAvailability();
    };
    thumb.appendChild(img);
    thumb.appendChild(del);
    previewGrid.appendChild(thumb);
  });
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
  document.getElementById("txList").innerHTML = "";
  document.getElementById("possibleList").innerHTML = "";
  resultsBox.classList.remove("visible");
  confirmBtn.style.display = "none";
  viewHistoryBtn.style.display = "none";
  resetBtn.style.display = "none";
  uploadPanel.hidden = false;
  if (appTitleEl) appTitleEl.textContent = "Upload screenshots";
  uploadStatusLineEl.hidden = false;
  fileInput.value = "";
  updateAnalyzeAvailability();
}

analyzeBtn.addEventListener("click", async () => {
  if (!savedCards.length) {
    showToast("Add a saved card in Profile before analyzing screenshots.");
    setTimeout(redirectToSettingsForCards, 500);
    return;
  }
  if (!selectedCardId) {
    showToast("Choose a saved card for this batch before analyzing.");
    uploadCardSelect.focus();
    return;
  }
  if (!hostedAiEnabled) {
    showToast("Screenshot processing is temporarily unavailable.");
    return;
  }
  if (hostedHasNoCreditsLeft()) {
    showToast(`You've reached today's limit. It resets at ${hostedQuotaResetLabel}.`);
    return;
  }
  analyzeBtn.innerHTML = `<span class="spinner"></span>Analyzing`;
  analyzeBtn.disabled = true;
  const filesAtSubmit = files.length;
  const formData = new FormData();
  formData.append("selected_card_id", selectedCardId);
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
      returnToSignIn();
      return;
    }
    if (data.error === "processing_unavailable") {
      showToast(data.message || "Screenshot processing is temporarily unavailable.");
      return;
    }
    if (data.error === "hosted_limit_exceeded") {
      syncHostedQuotaState(data);
      updateAnalyzeAvailability();
      if (hostedScreenshotsRemaining > 0) {
        const noun = hostedScreenshotsRemaining === 1 ? "screenshot" : "screenshots";
        showToast(`Only ${hostedScreenshotsRemaining} hosted ${noun} remaining today.`);
      } else {
        showToast("Processing limit reached for today.");
      }
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
      showToast(data.error);
      return;
    }
    syncHostedQuotaState(data);
    if (data.hosted_screenshots_remaining === undefined) {
      hostedScreenshotsUploadedToday = Math.max(0, hostedScreenshotsUploadedToday + filesAtSubmit);
      hostedScreenshotsRemaining = hostedDailyLimit === 0
        ? Number.POSITIVE_INFINITY
        : Math.max(0, hostedDailyLimit - hostedScreenshotsUploadedToday);
    }
    currentBatchId = data.batch_id || "";
    newTransactions = data.new;
    possibleTransactions = data.possible || [];
    txStatuses = newTransactions.map(() => ({ state: null, id: null }));
    possibleStatuses = possibleTransactions.map(() => ({ state: null, id: null }));
    const card = findSavedCard(selectedCardId);
    reviewCardEl.textContent = card ? card.label : "";
    reviewCountEl.textContent = `${filesAtSubmit} screenshot${filesAtSubmit === 1 ? "" : "s"}`;
    renderPossibleSafe(possibleTransactions);
    renderTransactions(data.new, data.skipped);
    resultsBox.classList.add("visible");
    uploadPanel.hidden = true;
    uploadStatusLineEl.hidden = true;
    if (appTitleEl) appTitleEl.textContent = "Review charges";
    resetBtn.style.display = "inline-flex";
    updateConfirmBtn();
    resultsBox.focus();
  } catch (err) {
    showToast("Network error - is the server running?");
  } finally {
    analyzeBtn.innerHTML = "Analyze screenshots";
    updateAnalyzeAvailability();
  }
});

const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>';
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatAmount(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

// "2026-03-09" -> "Mar 9"; the year is added only when it is not this year.
function formatDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  const label = `${MONTHS_SHORT[+m[2] - 1]} ${+m[3]}`;
  return +m[1] === new Date().getFullYear() ? label : `${label}, ${m[1]}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// One row, the same shape everywhere: merchant, date, amount, outcome.
// `mark` highlights what differs from the paired row: "date", or { amount: otherAmount }.
function makeRow(t, { className = "", mark = "" } = {}) {
  const row = el("div", "review-row" + (className ? " " + className : ""));
  row.setAttribute("role", "listitem");
  const name = el("span", "review-name", t.vendor || "");
  // Settled is the default and goes unmarked; only a pending charge says so.
  if (t.status === "pending") name.appendChild(el("small", "pending-mark", "Pending"));
  row.appendChild(name);
  const date = el("time", "review-date");
  const amount = el("b", "review-amount");
  const dateText = formatDay(t.date);
  const amountText = `$${formatAmount(t.amount)}`;
  if (mark === "date") date.appendChild(el("mark", "", dateText)); else date.textContent = dateText;
  if (mark && mark.amount) appendMarkedDigits(amount, amountText, mark.amount); else amount.textContent = amountText;
  row.appendChild(date);
  row.appendChild(amount);
  row.appendChild(el("span", "review-outcome"));
  return row;
}

// Marks only the characters that differ from `other` ($6.51 vs $6.50 marks the 1),
// falling back to the whole value when the lengths differ.
function appendMarkedDigits(node, text, other) {
  if (text.length !== other.length) {
    node.appendChild(el("mark", "", text));
    return;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === other[i]) node.appendChild(document.createTextNode(text[i]));
    else node.appendChild(el("mark", "", text[i]));
  }
}

function setOutcome(row, label, tagClass, button) {
  const slot = row.querySelector(".review-outcome");
  slot.replaceChildren(el("em", "tag" + (tagClass ? " " + tagClass : ""), label));
  if (button) slot.appendChild(button);
}

function iconButton(label, onClick) {
  const btn = el("button", "row-icon-btn");
  btn.type = "button";
  btn.innerHTML = ICON_X;
  btn.setAttribute("aria-label", label);
  btn.onclick = onClick;
  return btn;
}

function textButton(label, onClick, className = "row-text-btn") {
  const btn = el("button", className, label);
  btn.type = "button";
  btn.onclick = onClick;
  return btn;
}

// Possible duplicates: the incoming row sits over the saved row it resembles.
function renderPossibleSafe(txs) {
  const list = document.getElementById("possibleList");
  list.innerHTML = "";
  txs.forEach((t, i) => {
    const saved = {
      vendor: t.vendor,
      date: (t.possible_match && t.possible_match.date) || t.date,
      amount: t.possible_match && t.possible_match.amount !== undefined ? t.possible_match.amount : t.amount,
    };
    const incomingAmount = `$${formatAmount(t.amount)}`;
    const savedAmount = `$${formatAmount(saved.amount)}`;
    const differ = saved.date !== t.date ? "date" : "";
    const group = el("div", "review-match");
    group.id = `possible-${i}`;
    group.appendChild(makeRow(t, { mark: differ || (incomingAmount !== savedAmount ? { amount: savedAmount } : "") }));
    const savedRow = makeRow(saved, { className: "is-saved", mark: differ || (incomingAmount !== savedAmount ? { amount: incomingAmount } : "") });
    setOutcome(savedRow, "Saved", "is-saved");
    group.appendChild(savedRow);
    const actions = el("div", "review-match-actions");
    actions.id = `possible-actions-${i}`;
    group.appendChild(actions);
    list.appendChild(group);
    renderPossibleActions(i);
  });
}

function renderPossibleActions(i) {
  const group = document.getElementById(`possible-${i}`);
  const slot = document.getElementById(`possible-actions-${i}`);
  if (!group || !slot) return;
  const status = possibleStatuses[i] || { state: null, id: null };
  const incoming = group.firstElementChild;
  group.classList.toggle("is-resolved", status.state !== null);
  if (status.state === null) {
    setOutcome(incoming, "Review", "is-review");
    slot.replaceChildren(
      textButton("Add", () => approvePossible(i), "pill-btn"),
      textButton("Skip", () => skipPossible(i), "pill-btn is-primary"),
    );
    return;
  }
  const added = status.state === "added";
  setOutcome(incoming, added ? "Added" : "Skipped", added ? "is-added" : "", textButton("Undo", () => undoPossible(i)));
  slot.replaceChildren();
}

async function approvePossible(i) {
  if (!possibleStatuses[i] || possibleStatuses[i].state !== null) return;
  const slot = document.getElementById(`possible-actions-${i}`);
  slot.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    const res = await fetch("/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionToken}` },
      body: JSON.stringify({ transactions: [possibleTransactions[i]], batch_id: currentBatchId }),
    });
    const data = await res.json();
    if (data.error) {
      showToast("Error: " + data.error);
      renderPossibleActions(i);
      return;
    }
    possibleStatuses[i] = { state: "added", id: (data.ids || [])[0] || null };
    renderPossibleActions(i);
    updateConfirmBtn();
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
  if (status.state === "added" && status.id) {
    try {
      const res = await fetch(`/api/transactions/${status.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.error) {
        showToast("Could not undo: " + data.error);
        return;
      }
    } catch (err) {
      showToast("Network error");
      return;
    }
  }
  possibleStatuses[i] = { state: null, id: null };
  renderPossibleActions(i);
  updateConfirmBtn();
}

// New rows are included by default; x leaves one out. Exact repeats close the list.
function renderTransactions(newTx, skipped) {
  const list = document.getElementById("txList");
  list.innerHTML = "";
  newTx.forEach((t, i) => {
    const row = makeRow(t);
    row.id = `tx-${i}`;
    list.appendChild(row);
    renderTxActions(i);
  });
  skipped.forEach(t => {
    const row = makeRow(t, { className: "is-dup" });
    setOutcome(row, "Duplicate", "");
    list.appendChild(row);
  });
  if (!newTx.length && !skipped.length && !possibleTransactions.length) {
    list.appendChild(el("p", "review-empty", "No charges found in these screenshots."));
  }
}

function renderTxActions(i) {
  const row = document.getElementById(`tx-${i}`);
  if (!row) return;
  const status = txStatuses[i] || { state: null, id: null };
  row.classList.toggle("is-left-out", status.state === "removed");
  if (status.state === null) {
    setOutcome(row, "New", "is-new", iconButton(`Leave out ${newTransactions[i].vendor || "this charge"}`, () => removeOne(i)));
  } else if (status.state === "removed") {
    setOutcome(row, "Left out", "", textButton("Undo", () => undoOne(i)));
  } else {
    setOutcome(row, "Added", "is-added");
  }
}

function removeOne(i) {
  if (!txStatuses[i] || txStatuses[i].state !== null) return;
  txStatuses[i] = { state: "removed", id: null };
  renderTxActions(i);
  updateConfirmBtn();
}

function undoOne(i) {
  if (!txStatuses[i] || txStatuses[i].state !== "removed") return;
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
    updateConfirmBtn();
  } catch (err) {
    showToast("Network error");
  } finally {
    confirmBtn.disabled = false;
    updateConfirmBtn();
  }
});

resetBtn.addEventListener("click", resetWorkspace);

let toastHideTimer = null;

function showToast(msg) {
  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }
  toast.textContent = msg;
  toast.classList.add("show");
  toastHideTimer = setTimeout(() => {
    toast.classList.remove("show");
    toastHideTimer = null;
  }, 4000);
}

if (authError) {
  // Visitor-facing copy only. Diagnostic detail belongs in the server logs.
  const authErrorMessages = {
    google_sign_in_unavailable: "Google sign-in is unavailable right now. Please try again in a moment.",
    google_callback_provider_error: "Sign-in was cancelled before returning to Compline. Try again when you're ready.",
    google_callback_missing_code: "Google sign-in did not complete. Please try again.",
    google_callback_exchange_failed: "We could not finish signing you in. Please try again in a moment.",
  };
  showToast(authErrorMessages[authError] || "Google sign-in failed.");
  window.history.replaceState(null, "", "/app");
}
