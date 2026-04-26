  const token = sessionStorage.getItem("expense_token");
  if (!token) window.location.href = "/app";

  const currencyWhole = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const currencyExact = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const integerFormat = new Intl.NumberFormat("en-US");

  let allTransactions = [];
  let activeBatch = null;
  let activeTxId = "";
  let activeInlineEdit = { txId: "", field: "" };
  let toastTimer = null;
  const ICONS = {
    pencil: `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>`,
    check: `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5"/>
      </svg>`,
    clock: `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 7v5l3 2"/>
      </svg>`,
    x: `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6L6 18"/>
        <path d="M6 6l12 12"/>
      </svg>`,
  };
  const initialParams = new URLSearchParams(window.location.search);
  const VIEWS = ["summary", "transactions", "batches"];
  const requestedView = initialParams.get("view");
  let currentView = VIEWS.includes(requestedView) ? requestedView : "summary";
  // Each tab owns its own filter state. Summary: card/merchant on aggregate
  // rows; Spend Trend months use `trendSelectedMonths` + header popover.
  const summaryState = {
    card: "all",
    merchant: "all",
  };
  /** @type {string[]} Month keys (YYYY-MM) shown in Spend Trend; ≥1 when data exists. */
  let trendSelectedMonths = [];

  /** Max months selectable in Spend Trend / Compare; keeps the two-column row legible. */
  const MAX_TREND_MONTHS_SELECTED = 5;
  const TOP_CARDS_LIMIT = 5;
  const TOP_MERCHANTS_LIMIT = 10;
  /** Bar 1→5 use distinct gradients (capped at 5 months). */
  const COMPARE_BAR_GRADIENTS = [
    "linear-gradient(180deg, #5d8ab3 0%, #2e4f6e 100%)",
    "linear-gradient(180deg, #63a080 0%, #35634a 100%)",
    "linear-gradient(180deg, #c9994a 0%, #8a6220 100%)",
    "linear-gradient(180deg, #8b7bc4 0%, #534a82 100%)",
    "linear-gradient(180deg, #4db0b8 0%, #2d7278 100%)",
  ];
  const COMPARE_Y_STORAGE_KEY = "expense_compare_y_mode";
  /** "totals" | "averages" — averages = month total ÷ 30 for comparable daily pace. */
  let compareYMode = "totals";

  function readStoredCompareYMode() {
    try {
      const v = localStorage.getItem(COMPARE_Y_STORAGE_KEY);
      if (v === "totals" || v === "averages") return v;
      if (v === "per30") return "averages";
      if (v === "total") return "totals";
    } catch (err) { /* ignore */ }
    return "totals";
  }
  compareYMode = readStoredCompareYMode();
  const transactionsState = {
    search: "",
    status: "all",
    card: "all",
    month: "all",
    amountOp: "any",      // "any" | "over" | "under"
    amountValue: 0,
  };
  const batchesState = {
    month: "all",
    totalOp: "any",
    totalValue: 0,
    itemsOp: "any",
    itemsValue: 0,
  };

  function pluralize(count, singular, plural = `${singular}s`) {
    return `${integerFormat.format(count)} ${count === 1 ? singular : plural}`;
  }

  function safeAmount(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseTxDate(tx) {
    const rawDate = (tx.date || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      const [year, month, day] = rawDate.split("-").map(Number);
      return new Date(year, month - 1, day);
    }

    const fallback = (tx.created_at || "").trim();
    if (!fallback) return null;
    const parsed = new Date(fallback);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(key) {
    if (!key || key === "Unknown") return "Unknown";
    const [year, month] = key.split("-").map(Number);
    if (!year || !month) return "Unknown";
    return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  /** e.g. "Apr 26" for categorical chart axis */
  function shortMonthLabel(key) {
    if (!key || key === "Unknown") return "—";
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return "—";
    const d = new Date(y, m - 1, 1);
    const mon = d.toLocaleDateString("en-US", { month: "short" });
    const yy = String(y).slice(-2);
    return `${mon} ${yy}`;
  }

  function daysInMonth(year, monthIndexZeroBased) {
    return new Date(year, monthIndexZeroBased + 1, 0).getDate();
  }

  function getCompareDaysDivisor(key, now = new Date()) {
    if (!key || key === "Unknown") return 30;
    const [year, month] = key.split("-").map(Number);
    if (!year || !month) return 30;

    const monthIndex = month - 1;
    const totalDays = daysInMonth(year, monthIndex);
    const isCurrentMonth = year === now.getFullYear() && monthIndex === now.getMonth();
    if (isCurrentMonth) return Math.max(1, now.getDate());
    return totalDays;
  }

  function niceCeilingAxis(n) {
    if (!Number.isFinite(n) || n <= 0) return 1;
    const exp = Math.floor(Math.log10(n));
    const base = 10 ** exp;
    const m = n / base;
    const ceil = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return ceil * base;
  }

  /** Tighter axis max than niceCeilingAxis so a single ~$107 month doesn’t sit at ~50% of a $200 scale. */
  function niceCeilingAxisTight(n) {
    if (!Number.isFinite(n) || n <= 0) return 1;
    const padded = n * 1.06;
    const exp = Math.floor(Math.log10(padded));
    const base = 10 ** exp;
    const multipliers = [1, 1.2, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
    for (const m of multipliers) {
      const c = m * base;
      if (c >= padded) return c;
    }
    return 10 ** (exp + 1);
  }

  function formatCompareTick(value, mode) {
    if (mode === "averages") {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value < 12 ? 2 : 0,
        minimumFractionDigits: 0,
      }).format(value);
    }
    /* Totals axis: always whole dollars so ticks match (e.g. $120 not mixed with $90.00). */
    return currencyWhole.format(value);
  }

  function formatCompareBarValue(value, mode) {
    if (mode === "averages") {
      return `${new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value < 10 ? 2 : 1,
        minimumFractionDigits: 0,
      }).format(value)}/day`;
    }
    return currencyWhole.format(value);
  }

  function shortDate(date) {
    if (!date) return "Unknown";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function shortDateNumeric(date) {
    if (!date) return "Unknown";
    return date.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "2-digit",
    });
  }

  function mobileVendorLabel(vendor) {
    const raw = String(vendor || "").trim();
    if (!raw) return "Unknown merchant";
    const firstWord = raw.split(/\s+/)[0] || raw;
    return firstWord.replace(/[.,;:!?]+$/, "");
  }

  /** Split stored card label (e.g. "Mastercard ending in 44") into brand + reference line for the detail modal. */
  function parseCardForModal(cardRaw) {
    const raw = (cardRaw || "").trim();
    if (!raw || raw === "Unassigned") {
      return { brand: "—", reference: "N/A" };
    }
    const hintRe = /\s+(ending|starting)\s+in\s+(\d{1,4})$/i;
    const m = raw.match(hintRe);
    if (m) {
      const brand = raw.slice(0, m.index).trim();
      const pos = m[1].toLowerCase() === "starting" ? "Starting with" : "Ending in";
      return { brand: brand || raw, reference: `${pos} ${m[2]}` };
    }
    const legacy = raw.match(/^(.*?)\s*\((\d{1,4})\)\s*$/);
    if (legacy) {
      const b = legacy[1].trim();
      return { brand: b || raw, reference: `Ending in ${legacy[2]}` };
    }
    return { brand: raw, reference: "N/A" };
  }

  function normalizeTransaction(tx, index = 0) {
    const parsedDate = parseTxDate(tx);
    const amount = safeAmount(tx.amount);
    const vendor = (tx.vendor || "Unknown merchant").trim();
    const card = (tx.card || "Unassigned").trim();
    const status = tx.status === "pending" ? "pending" : "settled";
    return {
      ...tx,
      id: tx.id || `${vendor}-${card}-${index}`,
      amount,
      vendor,
      card,
      status,
      parsedDate,
      monthKey: parsedDate ? monthKey(parsedDate) : null,
      searchBlob: `${vendor} ${card} ${status} ${parsedDate ? shortDate(parsedDate) : ""}`.toLowerCase(),
      sortStamp: parsedDate ? parsedDate.getTime() : 0,
    };
  }

  function sortTransactions(items) {
    items.sort((a, b) => b.sortStamp - a.sortStamp || b.amount - a.amount);
    return items;
  }

  function normalizeTransactions(raw) {
    return sortTransactions(raw.map((tx, index) => normalizeTransaction(tx, index)));
  }

  function sumAmounts(items) {
    return items.reduce((sum, item) => sum + item.amount, 0);
  }

  function getMonthlyData(txs) {
    const map = new Map();
    for (const tx of txs) {
      const key = tx.monthKey || "Unknown";
      if (!map.has(key)) {
        map.set(key, { key, total: 0, count: 0, pending: 0 });
      }
      const bucket = map.get(key);
      bucket.total += tx.amount;
      bucket.count += 1;
      if (tx.status === "pending") bucket.pending += tx.amount;
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.key === "Unknown" && b.key === "Unknown") return 0;
      if (a.key === "Unknown") return 1;
      if (b.key === "Unknown") return -1;
      return a.key < b.key ? 1 : -1;
    });
  }

  function getTopVendors(txs) {
    const map = new Map();
    for (const tx of txs) {
      const key = tx.vendor;
      if (!map.has(key)) {
        map.set(key, { name: key, total: 0, count: 0 });
      }
      const vendor = map.get(key);
      vendor.total += tx.amount;
      vendor.count += 1;
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  function getCardMix(txs) {
    const map = new Map();
    for (const tx of txs) {
      const key = tx.card;
      if (!map.has(key)) {
        map.set(key, { name: key, total: 0, count: 0, pending: 0 });
      }
      const card = map.get(key);
      card.total += tx.amount;
      card.count += 1;
      if (tx.status === "pending") card.pending += tx.amount;
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  function topSummaryLabel(count, singular, limit) {
    if (!count) return `No ${singular} data`;
    if (count >= limit) return `Top ${limit} ${count === 1 ? singular : `${singular}s`} by spend`;
    return `${pluralize(count, singular)} by spend`;
  }

  // Summary tab only — month/card/merchant drill-down. Never reads
  // transactionsState or batchesState; those tabs are isolated.
  function getSummarySelection(overrides = {}) {
    const filters = { ...summaryState, ...overrides };
    return allTransactions.filter(tx => {
      if (filters.card !== "all" && tx.card !== filters.card) return false;
      if (filters.merchant !== "all" && tx.vendor !== filters.merchant) return false;
      return true;
    });
  }

  function getTransactionsSelection() {
    const s = transactionsState;
    const query = s.search.trim().toLowerCase();
    return allTransactions.filter(tx => {
      if (s.status !== "all" && tx.status !== s.status) return false;
      if (s.card !== "all" && tx.card !== s.card) return false;
      if (s.month !== "all" && tx.monthKey !== s.month) return false;
      if (query && !tx.searchBlob.includes(query)) return false;
      if (s.amountOp !== "any" && s.amountValue > 0) {
        if (s.amountOp === "over" && !(tx.amount > s.amountValue)) return false;
        if (s.amountOp === "under" && !(tx.amount < s.amountValue)) return false;
      }
      return true;
    });
  }

  function batchMatchesFilters(batch) {
    const s = batchesState;
    if (s.month !== "all" && batch.monthKey !== s.month) return false;
    if (s.totalOp !== "any" && s.totalValue > 0) {
      if (s.totalOp === "over" && !(batch.total > s.totalValue)) return false;
      if (s.totalOp === "under" && !(batch.total < s.totalValue)) return false;
    }
    if (s.itemsOp !== "any" && s.itemsValue > 0) {
      if (s.itemsOp === "over" && !(batch.count > s.itemsValue)) return false;
      if (s.itemsOp === "under" && !(batch.count < s.itemsValue)) return false;
    }
    return true;
  }

  function ensureSummaryValid() {
    const cards = new Set(allTransactions.map(tx => tx.card));
    if (summaryState.card !== "all" && !cards.has(summaryState.card)) summaryState.card = "all";

    const merchants = new Set(allTransactions.map(tx => tx.vendor));
    if (summaryState.merchant !== "all" && !merchants.has(summaryState.merchant)) summaryState.merchant = "all";
  }

  function ensureTransactionsValid() {
    const months = new Set(allTransactions.map(tx => tx.monthKey).filter(Boolean));
    if (transactionsState.month !== "all" && !months.has(transactionsState.month)) transactionsState.month = "all";
    const cards = new Set(allTransactions.map(tx => tx.card));
    if (transactionsState.card !== "all" && !cards.has(transactionsState.card)) transactionsState.card = "all";
  }

  function updateTxClearVisibility() {
    const s = transactionsState;
    const hasFilters = (
      s.status !== "all" ||
      s.card !== "all" ||
      s.month !== "all" ||
      Boolean(s.search) ||
      (s.amountOp !== "any" && s.amountValue > 0)
    );
    const btn = document.getElementById("clearFiltersBtn");
    if (btn) btn.style.display = hasFilters ? "inline-flex" : "none";
  }

  function updateBatchClearVisibility() {
    const s = batchesState;
    const hasFilters = (
      s.month !== "all" ||
      (s.totalOp !== "any" && s.totalValue > 0) ||
      (s.itemsOp !== "any" && s.itemsValue > 0)
    );
    const btn = document.getElementById("batchClearBtn");
    if (btn) btn.style.display = hasFilters ? "inline-flex" : "none";
  }

  function syncTxControls() {
    const s = transactionsState;
    const searchEl = document.getElementById("searchInput");
    if (searchEl && document.activeElement !== searchEl) searchEl.value = s.search;

    document.querySelectorAll("#statusFilters .filter-btn").forEach(item => {
      item.classList.toggle("active", item.dataset.status === s.status);
    });

    const cardFilter = document.getElementById("cardFilter");
    if (cardFilter) {
      cardFilter.value = [...cardFilter.options].some(o => o.value === s.card) ? s.card : "all";
    }

    const monthFilter = document.getElementById("txMonthFilter");
    if (monthFilter) {
      monthFilter.value = [...monthFilter.options].some(o => o.value === s.month) ? s.month : "all";
    }

    const amountOp = document.getElementById("txAmountOp");
    if (amountOp) amountOp.value = s.amountOp;
    const amountValue = document.getElementById("txAmountValue");
    if (amountValue && document.activeElement !== amountValue) {
      amountValue.value = s.amountValue > 0 ? String(s.amountValue) : "";
    }
  }

  function syncBatchControls() {
    const s = batchesState;
    const monthEl = document.getElementById("batchMonthFilter");
    if (monthEl) {
      monthEl.value = [...monthEl.options].some(o => o.value === s.month) ? s.month : "all";
    }
    const totalOp = document.getElementById("batchTotalOp");
    if (totalOp) totalOp.value = s.totalOp;
    const totalValue = document.getElementById("batchTotalValue");
    if (totalValue && document.activeElement !== totalValue) {
      totalValue.value = s.totalValue > 0 ? String(s.totalValue) : "";
    }
    const itemsOp = document.getElementById("batchItemsOp");
    if (itemsOp) itemsOp.value = s.itemsOp;
    const itemsValue = document.getElementById("batchItemsValue");
    if (itemsValue && document.activeElement !== itemsValue) {
      itemsValue.value = s.itemsValue > 0 ? String(s.itemsValue) : "";
    }
  }

  function distinctMonthKeys(items) {
    const keys = new Set();
    for (const item of items) {
      if (item.monthKey) keys.add(item.monthKey);
    }
    return Array.from(keys).sort((a, b) => (a < b ? 1 : -1));
  }

  /** Month keys (YYYY-MM) that appear anywhere in the ledger — drives Spend
   *  Trend checkboxes and stays in sync whenever `allTransactions` refreshes. */
  function allLedgerMonthKeys() {
    return distinctMonthKeys(allTransactions);
  }

  function renderMonthOptions(selectEl, keys) {
    if (!selectEl) return;
    const existing = selectEl.value;
    selectEl.innerHTML = `<option value="all">All months</option>` + keys.map(k => `
      <option value="${escapeHtml(k)}">${escapeHtml(monthLabel(k))}</option>
    `).join("");
    if ([...selectEl.options].some(o => o.value === existing)) selectEl.value = existing;
  }

  // The headline cards are intentionally filter-agnostic — they describe
  // "always true" stats about the account (all-time, this calendar month,
  // a rolling window, lifetime count). The visualisations below the cards
  // are the filter-aware surface.
  const ROLLING_STORAGE_KEY = "expense_rolling_days";
  const ROLLING_DEFAULT_DAYS = 30;
  const ROLLING_MAX_DAYS = 365;

  function readStoredRollingDays() {
    try {
      const raw = parseInt(localStorage.getItem(ROLLING_STORAGE_KEY), 10);
      if (Number.isFinite(raw) && raw >= 1 && raw <= ROLLING_MAX_DAYS) return raw;
    } catch (err) { /* localStorage blocked */ }
    return ROLLING_DEFAULT_DAYS;
  }

  let rollingDays = readStoredRollingDays();

  function sumSpendInLastDays(days) {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const now = Date.now();
    const startMs = now - days * 24 * 60 * 60 * 1000;
    let total = 0;
    for (const tx of allTransactions) {
      if (!tx.parsedDate) continue;
      const t = tx.parsedDate.getTime();
      if (t >= startMs && t <= now) total += tx.amount;
    }
    return total;
  }

  function sumSpendInCurrentMonth() {
    const key = monthKey(new Date());
    let total = 0;
    for (const tx of allTransactions) {
      if (tx.monthKey === key) total += tx.amount;
    }
    return total;
  }

  function renderMetrics() {
    const allTimeTotal = sumAmounts(allTransactions);
    const currentMonthTotal = sumSpendInCurrentMonth();
    const rollingTotal = sumSpendInLastDays(rollingDays);

    document.getElementById("metricTotalSpend").textContent = currencyWhole.format(allTimeTotal);
    document.getElementById("metricCurrentMonth").textContent = currencyWhole.format(currentMonthTotal);
    document.getElementById("metricRolling").textContent = currencyWhole.format(rollingTotal);
    document.getElementById("rollingDaysLabel").textContent = String(rollingDays);
    document.getElementById("metricTransactions").textContent = integerFormat.format(allTransactions.length);
    syncRollingPresetActive();
  }

  function syncRollingPresetActive() {
    document.querySelectorAll(".rolling-preset").forEach(btn => {
      const d = parseInt(btn.dataset.days, 10);
      btn.classList.toggle("active", d === rollingDays);
    });
  }

  function setRollingDays(days) {
    const n = Math.max(1, Math.min(ROLLING_MAX_DAYS, Math.round(days)));
    rollingDays = n;
    try { localStorage.setItem(ROLLING_STORAGE_KEY, String(n)); } catch (err) { /* ignore */ }
    renderMetrics();
  }

  function openRollingPopover() {
    const pop = document.getElementById("rollingPopover");
    const btn = document.getElementById("rollingDaysBtn");
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const input = document.getElementById("rollingDaysInput");
    input.value = String(rollingDays);
    syncRollingPresetActive();
    setTimeout(() => input.focus({ preventScroll: true }), 0);
  }

  function closeRollingPopover() {
    const pop = document.getElementById("rollingPopover");
    const btn = document.getElementById("rollingDaysBtn");
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function toggleRollingPopover() {
    const pop = document.getElementById("rollingPopover");
    if (pop.hidden) openRollingPopover();
    else closeRollingPopover();
  }

  function syncTrendMonthSelection(availableKeys) {
    const avail = new Set(availableKeys);
    trendSelectedMonths = trendSelectedMonths.filter(k => avail.has(k));
    if (availableKeys.length === 0) {
      trendSelectedMonths = [];
      return;
    }
    if (trendSelectedMonths.length === 0) {
      const cur = monthKey(new Date());
      trendSelectedMonths = availableKeys.includes(cur) ? [cur] : [availableKeys[0]];
    }
    if (trendSelectedMonths.length > MAX_TREND_MONTHS_SELECTED) {
      trendSelectedMonths = [...trendSelectedMonths]
        .sort((a, b) => b.localeCompare(a))
        .slice(0, MAX_TREND_MONTHS_SELECTED);
    }
  }

  function syncInsightGridLayout(selectedCount) {
    const grid = document.getElementById("insightGrid");
    if (!grid) return;
    grid.classList.remove("insight-grid--density-a", "insight-grid--density-b", "insight-grid--density-c");
    const n = Math.max(1, selectedCount);
    if (n <= 2) grid.classList.add("insight-grid--density-a");
    else if (n <= 4) grid.classList.add("insight-grid--density-b");
    else grid.classList.add("insight-grid--density-c");
  }

  function populateTrendMonthChecks(availableKeys) {
    const el = document.getElementById("trendMonthChecks");
    const note = document.getElementById("trendMonthCapNote");
    if (!el) return;
    const max = MAX_TREND_MONTHS_SELECTED;
    const count = trendSelectedMonths.length;
    const atCap = count >= max;

    el.innerHTML = availableKeys.map(key => {
      const checked = trendSelectedMonths.includes(key);
      const dis = !checked && atCap;
      return `
        <label class="trend-month-option">
          <input type="checkbox" value="${escapeHtml(key)}" ${checked ? "checked" : ""}${dis ? " disabled" : ""} />
          <span>${escapeHtml(monthLabel(key))}</span>
        </label>`;
    }).join("");

    if (note) {
      if (!availableKeys.length) {
        note.hidden = true;
      } else {
        note.hidden = false;
        if (atCap) {
          note.innerHTML = `<strong>Limit reached (${max} months).</strong> Uncheck one to pick a different month.`;
        } else {
          note.textContent = `You can compare up to ${max} months at once.`;
        }
      }
    }
  }

  function openTrendMonthPopover() {
    const pop = document.getElementById("trendMonthPopover");
    const btn = document.getElementById("trendMonthBtn");
    if (!pop || !btn) return;
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  function closeTrendMonthPopover() {
    const pop = document.getElementById("trendMonthPopover");
    const btn = document.getElementById("trendMonthBtn");
    if (!pop || !btn || pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function toggleTrendMonthPopover() {
    const pop = document.getElementById("trendMonthPopover");
    if (!pop) return;
    if (pop.hidden) openTrendMonthPopover();
    else closeTrendMonthPopover();
  }

  function renderTrend(contextTxs) {
    const availableKeys = allLedgerMonthKeys();
    syncTrendMonthSelection(availableKeys);
    populateTrendMonthChecks(availableKeys);

    const monthlyFiltered = getMonthlyData(contextTxs);
    const byKey = new Map(monthlyFiltered.map(m => [m.key, m]));

    const displayMonths = [...trendSelectedMonths]
      .filter(k => availableKeys.includes(k))
      .sort((a, b) => b.localeCompare(a));

    const listEl = document.getElementById("trendList");
    if (!listEl) return;

    if (!displayMonths.length) {
      listEl.innerHTML = `<div class="mini-empty">No month data for the current view.</div>`;
      syncInsightGridLayout(
        trendSelectedMonths.filter(k => availableKeys.includes(k)).length,
      );
      return;
    }

    const max = Math.max(...displayMonths.map(k => (byKey.get(k)?.total ?? 0)), 1);
    listEl.innerHTML = displayMonths.map(key => {
      const bucket = byKey.get(key);
      const total = bucket ? bucket.total : 0;
      return `
      <div class="trend-row">
        <div class="trend-label">${monthLabel(key)}</div>
        <div class="trend-track"><span class="trend-fill" style="width:${(total / max) * 100}%"></span></div>
        <div class="trend-value">${currencyWhole.format(total)}</div>
      </div>`;
    }).join("");

    syncInsightGridLayout(
      trendSelectedMonths.filter(k => availableKeys.includes(k)).length,
    );
  }

  function syncCompareModePills() {
    const wrap = document.getElementById("compareModePills");
    if (!wrap) return;
    wrap.querySelectorAll(".compare-mode-pill").forEach(pill => {
      const mode = pill.dataset.compareMode;
      const active = mode === compareYMode;
      pill.classList.toggle("active", active);
      pill.setAttribute("aria-selected", active ? "true" : "false");
      pill.setAttribute("tabindex", active ? "0" : "-1");
    });
  }

  function renderCompareChart(contextTxs) {
    const mount = document.getElementById("compareChartMount");
    if (!mount) return;

    const availableKeys = allLedgerMonthKeys();
    const monthlyFiltered = getMonthlyData(contextTxs);
    const byKey = new Map(monthlyFiltered.map(m => [m.key, m]));

    let ordered = [...trendSelectedMonths]
      .filter(k => availableKeys.includes(k))
      .sort((a, b) => a.localeCompare(b));

    const totalPicked = ordered.length;
    let truncated = false;
    if (ordered.length > MAX_TREND_MONTHS_SELECTED) {
      ordered = ordered.slice(-MAX_TREND_MONTHS_SELECTED);
      truncated = true;
    }

    if (!ordered.length) {
      mount.innerHTML = `<div class="compare-empty">Select months in Spend Trend to compare.</div>`;
      return;
    }

    const rows = ordered.map(key => {
      const bucket = byKey.get(key);
      const total = bucket ? bucket.total : 0;
      const daysDivisor = getCompareDaysDivisor(key);
      const yVal = compareYMode === "averages" ? total / daysDivisor : total;
      return { key, total, yVal, daysDivisor };
    });

    const dataMax = Math.max(...rows.map(r => r.yVal), 0);
    const maxScale = niceCeilingAxisTight(Math.max(dataMax, 1e-9));
    const tickSteps = 4;
    const ticks = [];
    for (let i = tickSteps; i >= 0; i--) {
      ticks.push((maxScale * i) / tickSteps);
    }

    const gapPx = rows.length <= 3 ? 14 : rows.length <= 5 ? 9 : 5;

    const barsHtml = rows.map((r, i) => {
      const h = maxScale > 0 ? Math.min(100, (r.yVal / maxScale) * 100) : 0;
      const fill = COMPARE_BAR_GRADIENTS[i % COMPARE_BAR_GRADIENTS.length];
      const averageTip = `Month total ${currencyExact.format(r.total)} · ${formatCompareTick(r.yVal, "averages")}/day (÷${r.daysDivisor})`;
      const tip = compareYMode === "averages"
        ? `Month total ${currencyExact.format(r.total)} · ${formatCompareTick(r.yVal, "averages")}/day (÷30)`
        : `Month total ${currencyExact.format(r.total)}`;
      return `
        <div class="compare-bar-col">
          <div class="compare-bar-track">
            <div class="compare-bar-stack" style="--compare-h-pct:${h}%;">
              <div class="compare-bar-fill" style="background:${fill};box-shadow:0 2px 10px rgba(35,55,70,0.2);" role="presentation"></div>
              <div class="compare-bar-value" title="${escapeHtml(compareYMode === "averages" ? averageTip : tip)}">${escapeHtml(formatCompareBarValue(r.yVal, compareYMode))}</div>
            </div>
          </div>
        </div>`;
    }).join("");

    const xLabels = rows.map(r => `<span>${escapeHtml(shortMonthLabel(r.key))}</span>`).join("");

    const yLabels = ticks.map(t => `<span>${escapeHtml(formatCompareTick(t, compareYMode))}</span>`).join("");

    const yAxisTitle = compareYMode === "averages"
      ? "Average spend per day"
      : "Total spend";

    let foot = "";
    if (truncated) {
      foot += `Showing ${MAX_TREND_MONTHS_SELECTED} most recent of ${totalPicked} selected months. `;
    }
    foot += compareYMode === "averages"
      ? "Each selected month’s total is divided by 30 days so daily pace is comparable."
      : "Total spend compared between each month selected.";

    if (compareYMode === "averages") {
      foot = `${truncated ? `Showing ${MAX_TREND_MONTHS_SELECTED} most recent of ${totalPicked} selected months. ` : ""}Completed months use their full calendar length. The current month uses elapsed days so pace stays comparable as the month unfolds.`;
    }

    mount.innerHTML = `
      <div class="compare-chart-shell" role="img" aria-label="Compare: ${escapeHtml(yAxisTitle)} for selected months">
        <div class="compare-y-axis-label">
          <span class="compare-y-axis-label-text">${escapeHtml(yAxisTitle)}</span>
        </div>
        <div class="compare-y-axis" aria-hidden="true">${yLabels}</div>
        <div class="compare-plot" style="--compare-gap:${gapPx}px">
          <div class="compare-bars" style="gap:var(--compare-gap)">${barsHtml}</div>
          <div class="compare-x-labels" style="gap:var(--compare-gap)">${xLabels}</div>
        </div>
      </div>
      <p class="compare-footnote">${escapeHtml(foot)}</p>`;
  }

  function renderCards(contextTxs, activeCard) {
    const allCards = getCardMix(contextTxs);
    const cards = allCards.slice(0, TOP_CARDS_LIMIT);
    const total = sumAmounts(contextTxs) || 1;
    document.getElementById("cardsSpan").textContent = topSummaryLabel(allCards.length, "card", TOP_CARDS_LIMIT);

    if (!cards.length) {
      document.getElementById("cardList").innerHTML = `<div class="mini-empty">No card data for the current view.</div>`;
      return;
    }

    document.getElementById("cardList").innerHTML = cards.map(card => {
      const share = (card.total / total) * 100;
      const countLabel = card.count === 1 ? "transaction" : "transactions";
      const pending = card.pending ? ` - ${currencyWhole.format(card.pending)} pending` : "";
      return `
      <button type="button" class="card-row interactive-row ${activeCard === card.name ? "active" : ""}" data-filter-key="card" data-filter-value="${escapeHtml(card.name)}" aria-pressed="${activeCard === card.name ? "true" : "false"}">
        <div class="top-name-col">
          <div class="card-label">${escapeHtml(card.name)}</div>
          <div class="card-meta">${integerFormat.format(card.count)} ${countLabel}${pending}</div>
        </div>
        <div class="share-track"><span class="share-fill" style="width:${share}%"></span></div>
        <div class="top-value-col">${currencyExact.format(card.total)}</div>
        <div class="top-share-label">${Math.round(share)}% of spend</div>
      </button>`;
    }).join("");
  }

  function renderMerchants(contextTxs, activeMerchant) {
    const allVendors = getTopVendors(contextTxs);
    const vendors = allVendors.slice(0, TOP_MERCHANTS_LIMIT);
    const total = sumAmounts(contextTxs) || 1;
    document.getElementById("merchantSpan").textContent = topSummaryLabel(allVendors.length, "merchant", TOP_MERCHANTS_LIMIT);

    if (!vendors.length) {
      document.getElementById("merchantList").innerHTML = `<div class="mini-empty">No merchant data for the current view.</div>`;
      return;
    }

    document.getElementById("merchantList").innerHTML = vendors.map(vendor => {
      const share = (vendor.total / total) * 100;
      const countLabel = vendor.count === 1 ? "transaction" : "transactions";
      return `
      <button type="button" class="merchant-row interactive-row ${activeMerchant === vendor.name ? "active" : ""}" data-filter-key="merchant" data-filter-value="${escapeHtml(vendor.name)}" aria-pressed="${activeMerchant === vendor.name ? "true" : "false"}">
        <div class="top-name-col">
          <div class="merchant-label">${escapeHtml(vendor.name)}</div>
          <div class="merchant-meta">${integerFormat.format(vendor.count)} ${countLabel}</div>
        </div>
        <div class="share-track"><span class="share-fill" style="width:${share}%"></span></div>
        <div class="top-value-col">${currencyExact.format(vendor.total)}</div>
        <div class="top-share-label">${Math.round(share)}% of spend</div>
      </button>`;
    }).join("");
  }

  function populateCardFilter(contextTxs) {
    const select = document.getElementById("cardFilter");
    if (!select) return;
    const existing = select.value;
    const cards = getCardMix(contextTxs);
    select.innerHTML = `<option value="all">All cards</option>` + cards.map(card => `
      <option value="${escapeHtml(card.name)}">${escapeHtml(card.name)}</option>
    `).join("");
    if ([...select.options].some(o => o.value === existing)) select.value = existing;
  }

  function updateStatusFilterCounts(contextTxs) {
    const settledCount = contextTxs.filter(tx => tx.status === "settled").length;
    const pendingCount = contextTxs.filter(tx => tx.status === "pending").length;
    document.querySelector('[data-status="all"]').textContent = `All (${integerFormat.format(contextTxs.length)})`;
    document.querySelector('[data-status="settled"]').textContent = `Settled (${integerFormat.format(settledCount)})`;
    document.querySelector('[data-status="pending"]').textContent = `Pending (${integerFormat.format(pendingCount)})`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getTransactionById(txId) {
    return allTransactions.find(tx => tx.id === txId) || null;
  }

  function mergeUpdatedTransaction(updatedTx) {
    const normalized = normalizeTransaction(updatedTx);
    const idx = allTransactions.findIndex(tx => tx.id === normalized.id);
    if (idx === -1) allTransactions.push(normalized);
    else allTransactions[idx] = normalized;
    sortTransactions(allTransactions);
    return normalized;
  }

  async function patchTransaction(txId, payload, fallbackMessage) {
    const res = await fetch(`/api/transactions/${encodeURIComponent(txId)}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || fallbackMessage || "Could not update transaction");
      return null;
    }
    const updated = mergeUpdatedTransaction(data.transaction || { id: txId, ...payload });
    renderSummary();
    renderTransactionsLedger();
    renderBatches();
    if (activeTxId === updated.id && document.getElementById("txModal").classList.contains("visible")) {
      populateTxModal(updated);
    }
    return updated;
  }

  function setInlineEdit(txId, field) {
    activeInlineEdit = { txId, field };
    renderTransactionsLedger();
    requestAnimationFrame(() => {
      const input = Array.from(document.querySelectorAll(".inline-edit-box"))
        .find(box => box.dataset.txId === txId && box.dataset.field === field)
        ?.querySelector(".inline-edit-input");
      if (!input) return;
      input.focus();
      if (typeof input.select === "function") input.select();
    });
  }

  function clearInlineEdit(rerender = true) {
    activeInlineEdit = { txId: "", field: "" };
    if (rerender) renderTransactionsLedger();
  }

  function renderIconButton({ action, txId, label, icon, title, field = "", nextStatus = "", className = "" }) {
    return `
      <button
        type="button"
        class="${className}"
        data-action="${action}"
        data-tx-id="${escapeHtml(txId)}"
        ${field ? `data-field="${escapeHtml(field)}"` : ""}
        ${nextStatus ? `data-next-status="${escapeHtml(nextStatus)}"` : ""}
        title="${escapeHtml(title || label)}"
        aria-label="${escapeHtml(label)}"
      >
        ${icon}
      </button>`;
  }

  function renderDateCell(tx) {
    const editing = activeInlineEdit.txId === tx.id && activeInlineEdit.field === "date";
    if (editing) {
      return `
        <div class="inline-edit-box inline-edit-box--date" data-tx-id="${escapeHtml(tx.id)}" data-field="date">
          <input class="inline-edit-input" type="date" value="${escapeHtml(txIsoDate(tx))}" />
          <div class="inline-edit-actions">
            ${renderIconButton({ action: "save-inline-edit", txId: tx.id, field: "date", label: "Save date", title: "Save date", icon: ICONS.check, className: "cell-icon-btn cell-icon-btn--confirm" })}
            ${renderIconButton({ action: "cancel-inline-edit", txId: tx.id, field: "date", label: "Cancel date edit", title: "Cancel", icon: ICONS.x, className: "cell-icon-btn cell-icon-btn--cancel" })}
          </div>
        </div>`;
    }
    return `
      <div class="ledger-editable">
        <span class="ledger-editable-text">${escapeHtml(shortDate(tx.parsedDate))}</span>
        ${renderIconButton({ action: "start-inline-edit", txId: tx.id, field: "date", label: `Edit date for ${tx.vendor}`, title: "Edit date", icon: ICONS.pencil, className: "cell-icon-btn cell-edit-btn" })}
      </div>`;
  }

  function renderMerchantCell(tx) {
    const editing = activeInlineEdit.txId === tx.id && activeInlineEdit.field === "vendor";
    if (editing) {
      return `
        <div class="inline-edit-box inline-edit-box--merchant" data-tx-id="${escapeHtml(tx.id)}" data-field="vendor">
          <input class="inline-edit-input" type="text" value="${escapeHtml(tx.vendor)}" maxlength="120" />
          <div class="inline-edit-actions">
            ${renderIconButton({ action: "save-inline-edit", txId: tx.id, field: "vendor", label: `Save merchant for ${tx.vendor}`, title: "Save merchant", icon: ICONS.check, className: "cell-icon-btn cell-icon-btn--confirm" })}
            ${renderIconButton({ action: "cancel-inline-edit", txId: tx.id, field: "vendor", label: "Cancel merchant edit", title: "Cancel", icon: ICONS.x, className: "cell-icon-btn cell-icon-btn--cancel" })}
          </div>
        </div>`;
    }
    return `
      <div class="merchant-cell-shell">
        <div class="merchant-cell">
          <div class="merchant-name">${escapeHtml(tx.vendor)}</div>
          <div class="merchant-sub">${escapeHtml(tx.monthKey ? monthLabel(tx.monthKey) : "Undated entry")}</div>
        </div>
        ${renderIconButton({ action: "start-inline-edit", txId: tx.id, field: "vendor", label: `Edit merchant for ${tx.vendor}`, title: "Edit merchant", icon: ICONS.pencil, className: "cell-icon-btn cell-edit-btn" })}
      </div>`;
  }

  function renderStatusCell(tx) {
    const pending = tx.status === "pending";
    const nextStatus = pending ? "settled" : "pending";
    const buttonLabel = pending ? `Mark ${tx.vendor} as settled` : `Mark ${tx.vendor} as pending`;
    const buttonTitle = pending ? "Mark as settled" : "Mark as pending";
    const buttonIcon = pending ? ICONS.check : ICONS.clock;
    const buttonClass = pending
      ? "status-toggle-btn status-toggle-btn--settled"
      : "status-toggle-btn status-toggle-btn--pending";
    return `
      <td data-label="Status" class="status-cell">
        <div class="status-cell-inner">
          <span class="status-pill${pending ? " pending" : ""}">${pending ? "Pending" : "Settled"}</span>
          ${renderIconButton({ action: "toggle-status", txId: tx.id, nextStatus, label: buttonLabel, title: buttonTitle, icon: buttonIcon, className: buttonClass })}
        </div>
      </td>`;
  }

  function renderAmountCell(tx) {
    const editing = activeInlineEdit.txId === tx.id && activeInlineEdit.field === "amount";
    if (editing) {
      return `
        <div class="inline-edit-box inline-edit-box--amount" data-tx-id="${escapeHtml(tx.id)}" data-field="amount">
          <div class="inline-edit-amount-wrap">
            <span class="amount-prefix">$</span>
            <input class="inline-edit-input inline-edit-input--amount" type="number" min="0.01" step="0.01" value="${escapeHtml(tx.amount.toFixed(2))}" inputmode="decimal" />
          </div>
          <div class="inline-edit-actions">
            ${renderIconButton({ action: "save-inline-edit", txId: tx.id, field: "amount", label: `Save amount for ${tx.vendor}`, title: "Save amount", icon: ICONS.check, className: "cell-icon-btn cell-icon-btn--confirm" })}
            ${renderIconButton({ action: "cancel-inline-edit", txId: tx.id, field: "amount", label: "Cancel amount edit", title: "Cancel", icon: ICONS.x, className: "cell-icon-btn cell-icon-btn--cancel" })}
          </div>
        </div>`;
    }
    return `
      <div class="amount-cell-inner">
        <span class="amount-value">${escapeHtml(currencyExact.format(tx.amount))}</span>
        ${renderIconButton({ action: "start-inline-edit", txId: tx.id, field: "amount", label: `Edit amount for ${tx.vendor}`, title: "Edit amount", icon: ICONS.pencil, className: "cell-icon-btn cell-edit-btn" })}
      </div>`;
  }

  function renderLedger(txs) {
    const body = document.getElementById("ledgerBody");

    if (!txs.length) {
      body.innerHTML = `<tr><td colspan="5"><div class="ledger-empty">No transactions match the current filters.</div></td></tr>`;
      return;
    }

    body.innerHTML = txs.map(tx => {
      const pending = tx.status === "pending";
      const rowClass = pending ? "ledger-row-pending" : "";
      const mobileStatus = pending
        ? `<span class="mobile-ledger-status-pill pending">Pending</span>`
        : `<span class="mobile-ledger-status-pill settled">Settled</span>`;
      return `
      <tr class="${rowClass}" data-tx-id="${escapeHtml(tx.id)}">
        <td data-label="Date" class="date-cell">${renderDateCell(tx)}</td>
        <td data-label="Merchant">
          <button type="button" class="mobile-ledger-row" data-tx-id="${escapeHtml(tx.id)}" aria-label="View or edit ${escapeHtml(tx.vendor)}">
            <div class="mobile-ledger-main">
              <div class="mobile-ledger-vendor">${escapeHtml(mobileVendorLabel(tx.vendor))}</div>
              <div class="mobile-ledger-meta">${escapeHtml(shortDateNumeric(tx.parsedDate))}</div>
            </div>
            ${mobileStatus}
            <div class="mobile-ledger-amount">${escapeHtml(currencyWhole.format(tx.amount))}</div>
            <span class="mobile-ledger-chevron" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>
          ${renderMerchantCell(tx)}
        </td>
        <td data-label="Card" class="card-cell">${escapeHtml(tx.card)}</td>
        ${renderStatusCell(tx)}
        <td data-label="Amount" class="amount-cell">${renderAmountCell(tx)}</td>
      </tr>`;
    }).join("");
  }

  function readInlineEditPayload(txId, field) {
    const tx = getTransactionById(txId);
    const box = Array.from(document.querySelectorAll(".inline-edit-box"))
      .find(el => el.dataset.txId === txId && el.dataset.field === field);
    const input = box?.querySelector(".inline-edit-input");
    if (!tx || !input) return null;

    if (field === "date") {
      const value = input.value.trim();
      if (!value) {
        showToast("Choose a valid date.");
        input.focus();
        return null;
      }
      if (value === txIsoDate(tx)) return {};
      return { date: value };
    }

    if (field === "vendor") {
      const value = input.value.trim().replace(/\s+/g, " ");
      if (!value) {
        showToast("Merchant is required.");
        input.focus();
        return null;
      }
      if (value === tx.vendor) return {};
      return { vendor: value };
    }

    if (field === "amount") {
      const parsed = parseFloat(input.value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showToast("Amount must be greater than 0.");
        input.focus();
        return null;
      }
      const amount = Number(parsed.toFixed(2));
      if (Math.abs(amount - tx.amount) < 0.005) return {};
      return { amount };
    }

    return null;
  }

  async function saveInlineEdit(txId, field, triggerEl) {
    const box = triggerEl.closest(".inline-edit-box");
    if (!box) return;
    const payload = readInlineEditPayload(txId, field);
    if (payload == null) return;
    if (!Object.keys(payload).length) {
      clearInlineEdit();
      return;
    }

    box.querySelectorAll("button").forEach(btn => { btn.disabled = true; });
    const updated = await patchTransaction(txId, payload, "Could not save your changes");
    if (!updated) {
      box.querySelectorAll("button").forEach(btn => { btn.disabled = false; });
      return;
    }
    clearInlineEdit();
  }

  async function toggleTransactionStatus(txId, nextStatus, button) {
    if (!txId || !nextStatus) return;
    if (button) button.disabled = true;
    const updated = await patchTransaction(txId, { status: nextStatus }, "Could not update status");
    if (!updated && button) button.disabled = false;
  }

  document.getElementById("ledgerBody").addEventListener("click", event => {
    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn && !actionBtn.disabled) {
      event.preventDefault();
      const txId = actionBtn.dataset.txId;
      const field = actionBtn.dataset.field || "";
      const action = actionBtn.dataset.action;
      if (!txId || !action) return;
      if (action === "start-inline-edit") {
        setInlineEdit(txId, field);
        return;
      }
      if (action === "cancel-inline-edit") {
        clearInlineEdit();
        return;
      }
      if (action === "save-inline-edit") {
        saveInlineEdit(txId, field, actionBtn);
        return;
      }
      if (action === "toggle-status") {
        toggleTransactionStatus(txId, actionBtn.dataset.nextStatus || "", actionBtn);
        return;
      }
    }

    const mobileRow = event.target.closest(".mobile-ledger-row");
    if (!mobileRow) return;
    const txId = mobileRow.dataset.txId;
    if (!txId) return;
    openTxModal(txId);
  });

  document.getElementById("ledgerBody").addEventListener("keydown", event => {
    const box = event.target.closest(".inline-edit-box");
    if (!box) return;
    if (event.key === "Escape") {
      event.preventDefault();
      clearInlineEdit();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const saveBtn = box.querySelector('[data-action="save-inline-edit"]');
      if (saveBtn) saveInlineEdit(box.dataset.txId || "", box.dataset.field || "", saveBtn);
    }
  });

  function setMobileLedgerActiveRow(txId) {
    document.querySelectorAll("#ledgerBody .mobile-ledger-row").forEach(el => {
      el.classList.toggle("is-active", Boolean(txId) && el.dataset.txId === txId);
    });
  }

  function populateTxModal(tx) {
    const pending = tx.status === "pending";
    document.getElementById("txModalTitle").textContent = tx.vendor;
    document.getElementById("txModalSubtitle").textContent = shortDate(tx.parsedDate);
    document.getElementById("txModalAmount").textContent = currencyExact.format(tx.amount);
    const { brand, reference } = parseCardForModal(tx.card);
    document.getElementById("txModalCardBrand").textContent = brand;
    document.getElementById("txModalCardHint").textContent = reference;
    const statusEl = document.getElementById("txModalStatus");
    statusEl.textContent = pending ? "Pending" : "Settled";
    statusEl.classList.remove("settled", "pending");
    statusEl.classList.add(pending ? "pending" : "settled");
    document.getElementById("txModalMerchantInput").value = tx.vendor;
    document.getElementById("txModalDateInput").value = txIsoDate(tx);
    document.getElementById("txModalAmountInput").value = tx.amount.toFixed(2);

    const statusBtn = document.getElementById("txModalStatusBtn");
    const nextStatus = pending ? "settled" : "pending";
    statusBtn.dataset.nextStatus = nextStatus;
    statusBtn.disabled = false;
    statusBtn.classList.remove("is-settled", "is-pending");
    statusBtn.classList.add(pending ? "is-settled" : "is-pending");
    statusBtn.innerHTML = `${pending ? ICONS.check : ICONS.clock}<span>${pending ? "Mark Settled" : "Mark Pending"}</span>`;

    const saveBtn = document.getElementById("txModalSaveBtn");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Changes";
  }

  function openTxModal(txId) {
    const tx = getTransactionById(txId);
    if (!tx) return;
    activeTxId = tx.id;
    setMobileLedgerActiveRow(txId);
    populateTxModal(tx);
    document.getElementById("txModal").classList.add("visible");
  }

  function closeTxModal() {
    setMobileLedgerActiveRow("");
    document.getElementById("txModal").classList.remove("visible");
    activeTxId = "";
  }

  async function toggleTxStatusFromModal() {
    if (!activeTxId) return;
    const btn = document.getElementById("txModalStatusBtn");
    const nextStatus = btn.dataset.nextStatus || "";
    if (!nextStatus) return;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span><span>Updating</span>`;
    const updated = await patchTransaction(activeTxId, { status: nextStatus }, "Could not update status");
    if (!updated) {
      btn.disabled = false;
      const current = getTransactionById(activeTxId);
      if (current) populateTxModal(current);
    }
  }

  async function saveTxFromModal() {
    if (!activeTxId) return;
    const tx = getTransactionById(activeTxId);
    if (!tx) return;

    const merchant = document.getElementById("txModalMerchantInput").value.trim().replace(/\s+/g, " ");
    const date = document.getElementById("txModalDateInput").value.trim();
    const amountRaw = document.getElementById("txModalAmountInput").value.trim();
    const payload = {};

    if (!merchant) {
      showToast("Merchant is required.");
      document.getElementById("txModalMerchantInput").focus();
      return;
    }
    if (!date) {
      showToast("Choose a valid date.");
      document.getElementById("txModalDateInput").focus();
      return;
    }
    const parsedAmount = parseFloat(amountRaw);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast("Amount must be greater than 0.");
      document.getElementById("txModalAmountInput").focus();
      return;
    }

    if (merchant !== tx.vendor) payload.vendor = merchant;
    if (date !== txIsoDate(tx)) payload.date = date;
    const nextAmount = Number(parsedAmount.toFixed(2));
    if (Math.abs(nextAmount - tx.amount) >= 0.005) payload.amount = nextAmount;

    if (!Object.keys(payload).length) {
      closeTxModal();
      return;
    }

    const btn = document.getElementById("txModalSaveBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span><span>Saving</span>`;
    const updated = await patchTransaction(activeTxId, payload, "Could not save changes");
    if (!updated) {
      btn.disabled = false;
      btn.textContent = "Save Changes";
      return;
    }
    showToast("Transaction updated.");
    closeTxModal();
  }

  function setHeader(_txs) {
  }

  function clearTransactionsFilters() {
    transactionsState.search = "";
    transactionsState.status = "all";
    transactionsState.card = "all";
    transactionsState.month = "all";
    transactionsState.amountOp = "any";
    transactionsState.amountValue = 0;
    renderTransactionsLedger();
  }

  function clearBatchesFilters() {
    batchesState.month = "all";
    batchesState.totalOp = "any";
    batchesState.totalValue = 0;
    batchesState.itemsOp = "any";
    batchesState.itemsValue = 0;
    renderBatches();
  }

  function renderSummary() {
    ensureSummaryValid();

    const filtered = getSummarySelection();
    const cardContext = getSummarySelection({ card: "all" });
    const merchantContext = getSummarySelection({ merchant: "all" });

    renderMetrics();
    renderSummaryScope();
    renderTrend(filtered);
    renderCompareChart(filtered);
    renderCards(cardContext, summaryState.card);
    renderMerchants(merchantContext, summaryState.merchant);
    syncCompareModePills();
  }

  function renderTransactionsLedger() {
    ensureTransactionsValid();

    populateCardFilter(allTransactions);
    renderMonthOptions(document.getElementById("txMonthFilter"), allLedgerMonthKeys());

    const statusContext = getTransactionsSelection_exceptStatus();
    updateStatusFilterCounts(statusContext);

    const selected = getTransactionsSelection();
    updateTxClearVisibility();
    syncTxControls();
    renderLedger(selected);
  }

  // Transactions-tab status filter counts show how many would match if the
  // user toggled each status, holding other filters constant.
  function getTransactionsSelection_exceptStatus() {
    const s = transactionsState;
    const query = s.search.trim().toLowerCase();
    return allTransactions.filter(tx => {
      if (s.card !== "all" && tx.card !== s.card) return false;
      if (s.month !== "all" && tx.monthKey !== s.month) return false;
      if (query && !tx.searchBlob.includes(query)) return false;
      if (s.amountOp !== "any" && s.amountValue > 0) {
        if (s.amountOp === "over" && !(tx.amount > s.amountValue)) return false;
        if (s.amountOp === "under" && !(tx.amount < s.amountValue)) return false;
      }
      return true;
    });
  }


  async function load() {
    try {
      const res = await fetch("/api/transactions", { headers: { "Authorization": `Bearer ${token}` } });
      if (res.status === 401) {
        window.location.href = "/app";
        return;
      }

      const data = await res.json();
      allTransactions = normalizeTransactions(data.transactions || []);

      document.getElementById("loadingState").style.display = "none";

      if (!allTransactions.length) {
        document.getElementById("emptyState").style.display = "block";
        return;
      }

      renderSummary();
      renderTransactionsLedger();
      renderBatches();
      showView(currentView);
    } catch (e) {
      document.getElementById("loadingState").innerHTML = `<h2>Could not load your history</h2><p>Network error. Refresh and try again.</p>`;
    }
  }

  function showView(view) {
    currentView = VIEWS.includes(view) ? view : "summary";

    document.getElementById("summaryView").hidden = currentView !== "summary";
    document.getElementById("transactionsView").hidden = currentView !== "transactions";
    document.getElementById("batchesView").hidden = currentView !== "batches";

    const tabs = {
      summary: document.getElementById("viewTabSummary"),
      transactions: document.getElementById("viewTabTransactions"),
      batches: document.getElementById("viewTabBatches"),
    };
    for (const [name, el] of Object.entries(tabs)) {
      const active = name === currentView;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", active);
    }

    const url = new URL(window.location);
    if (currentView === "summary") url.searchParams.delete("view");
    else url.searchParams.set("view", currentView);
    window.history.replaceState({}, "", url);

    if (currentView === "batches") {
      renderBatches();
    }
  }

  function computeBatches(txs) {
    const map = new Map();
    for (const tx of txs) {
      const id = tx.batch_id;
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, {
          id,
          createdAt: tx.created_at || "",
          count: 0,
          total: 0,
          merchants: new Set(),
          cards: new Set(),
          transactions: [],
        });
      }
      const b = map.get(id);
      b.count += 1;
      b.total += tx.amount;
      if (tx.vendor) b.merchants.add(tx.vendor.toLowerCase());
      if (tx.card) b.cards.add(tx.card);
      b.transactions.push(tx);
      if (tx.created_at && (!b.createdAt || tx.created_at < b.createdAt)) {
        b.createdAt = tx.created_at;
      }
    }

    const batches = Array.from(map.values()).map(b => {
      const ts = b.createdAt ? new Date(b.createdAt) : null;
      const valid = ts && !Number.isNaN(ts.getTime());
      return {
        ...b,
        dateLabel: valid ? ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown date",
        timeLabel: valid ? ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        cardLabel: b.cards.size === 1 ? [...b.cards][0] : (b.cards.size === 0 ? "Unassigned" : [...b.cards].join(", ")),
        mixed: b.cards.size > 1,
        sortStamp: valid ? ts.getTime() : 0,
        monthKey: valid ? monthKey(ts) : null,
      };
    });

    batches.sort((a, b) => b.sortStamp - a.sortStamp);
    return batches;
  }

  function renderBatches() {
    const all = computeBatches(allTransactions);
    const list = document.getElementById("batchesList");

    // Month dropdown is populated from the full batch set — not the filtered
    // one — so you can always flip back to a previously hidden month.
    renderMonthOptions(document.getElementById("batchMonthFilter"), distinctMonthKeys(all));

    // Drop any filter that no longer maps to a real batch month (can happen
    // after a batch is deleted). Other filters are numeric thresholds and are
    // always valid.
    const validMonths = new Set(all.map(b => b.monthKey).filter(Boolean));
    if (batchesState.month !== "all" && !validMonths.has(batchesState.month)) batchesState.month = "all";

    syncBatchControls();
    updateBatchClearVisibility();

    const batches = all.filter(batchMatchesFilters);

    if (!all.length) {
      list.innerHTML = `
        <div style="padding: 54px 28px; text-align: center; color: var(--muted);">
          <p style="font-size: 1rem; color: var(--ink); margin-bottom: 6px;">No batches yet.</p>
          <p style="font-size: 0.88rem; line-height: 1.6;">Analyze screenshots on the <a href="/app" style="color: var(--accent); font-weight: 700;">workspace</a> and confirm a transaction to create your first batch.</p>
        </div>`;
      return;
    }

    if (!batches.length) {
      list.innerHTML = `
        <div style="padding: 54px 28px; text-align: center; color: var(--muted);">
          <p style="font-size: 1rem; color: var(--ink); margin-bottom: 6px;">No batches match the current filters.</p>
          <p style="font-size: 0.88rem; line-height: 1.6;">Try widening your thresholds or clearing filters.</p>
        </div>`;
      return;
    }

    list.innerHTML = batches.map(b => `
      <button class="batch-row" type="button" data-batch-id="${escapeHtml(b.id)}">
        <div class="batch-cell-primary">
          <strong>${escapeHtml(b.dateLabel)}</strong>
          <span>${escapeHtml(b.timeLabel || "")}</span>
          <span class="batch-mobile-inline">
            ${integerFormat.format(b.count)} items · ${currencyWhole.format(b.total)} · ${integerFormat.format(b.merchants.size)} ${b.merchants.size === 1 ? "merchant" : "merchants"}
          </span>
        </div>
        <div>
          <div class="batch-cell-number">${integerFormat.format(b.count)}</div>
          <div class="batch-cell-sub">${b.count === 1 ? "item" : "items"}</div>
        </div>
        <div>
          <div class="batch-cell-number">${currencyWhole.format(b.total)}</div>
          <div class="batch-cell-sub">total</div>
        </div>
        <div>
          <div class="batch-cell-number">${integerFormat.format(b.merchants.size)}</div>
          <div class="batch-cell-sub">${b.merchants.size === 1 ? "merchant" : "merchants"}</div>
        </div>
        <div class="batch-cell-card">
          ${escapeHtml(b.cardLabel)}${b.mixed ? '<span class="mixed-flag">multi-card</span>' : ""}
        </div>
        <div class="batch-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>
    `).join("");

    list.querySelectorAll(".batch-row").forEach(row => {
      row.addEventListener("click", () => {
        const id = row.dataset.batchId;
        const batch = batches.find(b => b.id === id);
        if (batch) openBatchModal(batch);
      });
    });
  }

  function openBatchModal(batch) {
    activeBatch = batch;
    let modalDateLabel = batch.dateLabel;
    if (batch.createdAt) {
      const parsed = new Date(batch.createdAt);
      if (!Number.isNaN(parsed.getTime())) {
        modalDateLabel = parsed.toLocaleDateString("en-US", {
          month: "numeric",
          day: "numeric",
          year: "2-digit",
        });
      }
    }
    const suffix = batch.timeLabel ? ` - ${batch.timeLabel}` : "";
    document.getElementById("batchModalTitle").textContent = `${modalDateLabel}${suffix}`;
    document.getElementById("batchModalSubtitle").textContent = `Analysis session - ${pluralize(batch.count, "transaction")}`;
    document.getElementById("batchStatItems").textContent = integerFormat.format(batch.count);
    document.getElementById("batchStatTotal").textContent = currencyExact.format(batch.total);
    document.getElementById("batchStatMerchants").textContent = integerFormat.format(batch.merchants.size);
    document.getElementById("batchStatCard").textContent = batch.cardLabel;

    const sortedTxs = [...batch.transactions].sort((a, b) => b.amount - a.amount);
    document.getElementById("batchTxList").innerHTML = sortedTxs.map(tx => `
      <div class="modal-tx-row">
        <div>
          <div class="tx-vendor">${escapeHtml(tx.vendor)}</div>
          <div class="tx-meta">${escapeHtml(tx.parsedDate ? shortDate(tx.parsedDate) : "No date")} - ${escapeHtml(tx.card)}${tx.status === "pending" ? " - Pending" : ""}</div>
        </div>
        <div class="tx-amount">${currencyExact.format(tx.amount)}</div>
      </div>
    `).join("");

    const btn = document.getElementById("batchDeleteBtn");
    btn.disabled = false;
    btn.innerHTML = "Delete Batch";

    document.getElementById("batchModal").classList.add("visible");
  }

  function closeBatchModal() {
    document.getElementById("batchModal").classList.remove("visible");
    activeBatch = null;
  }

  async function deleteBatch() {
    if (!activeBatch) return;
    const btn = document.getElementById("batchDeleteBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Deleting';

    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(activeBatch.id)}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(`Could not delete batch: ${data.error || "network error"}`);
        btn.disabled = false;
        btn.innerHTML = "Delete Batch";
        return;
      }

      const data = await res.json();
      const deletedIds = new Set(activeBatch.transactions.map(t => t.id));
      const deletedCount = data.deleted || activeBatch.count;
      allTransactions = allTransactions.filter(t => !deletedIds.has(t.id));

      closeBatchModal();
      showToast(`Batch deleted - ${pluralize(deletedCount, "transaction")} removed.`);

      if (!allTransactions.length) {
        document.getElementById("summaryView").hidden = true;
        document.getElementById("transactionsView").hidden = true;
        document.getElementById("batchesView").hidden = true;
        document.getElementById("emptyState").style.display = "block";
        return;
      }

      renderSummary();
      renderTransactionsLedger();
      renderBatches();
    } catch (e) {
      showToast("Could not delete batch. Network error.");
      btn.disabled = false;
      btn.innerHTML = "Delete Batch";
    }
  }

  function showToast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function csvEscape(value) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function txIsoDate(tx) {
    const raw = (tx.date || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (tx.parsedDate) {
      const d = tx.parsedDate;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    return "";
  }

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function getFilteredBatches() {
    return computeBatches(allTransactions).filter(batchMatchesFilters);
  }

  function exportTransactionsCsv() {
    const rows = getTransactionsSelection();
    if (!rows.length) {
      showToast("No transactions to export for the current filters.");
      return;
    }
    const lines = [["date", "vendor", "card", "amount", "status"].map(csvEscape).join(",")];
    for (const tx of rows) {
      lines.push([
        csvEscape(txIsoDate(tx)),
        csvEscape(tx.vendor),
        csvEscape(tx.card),
        csvEscape(tx.amount),
        csvEscape(tx.status),
      ].join(","));
    }
    downloadTextFile(
      `expense-agent-transactions-${exportStamp()}.csv`,
      `\uFEFF${lines.join("\n")}`,
      "text/csv;charset=utf-8",
    );
  }

  function exportBatchesCsv() {
    const batches = getFilteredBatches();
    if (!batches.length) {
      showToast("No batches to export for the current filters.");
      return;
    }
    const header = ["batch_id", "session_date", "session_time", "item_count", "total", "merchant_count", "card_label"];
    const lines = [header.map(csvEscape).join(",")];
    for (const b of batches) {
      lines.push([
        csvEscape(b.id),
        csvEscape(b.dateLabel),
        csvEscape(b.timeLabel || ""),
        csvEscape(b.count),
        csvEscape(b.total),
        csvEscape(b.merchants.size),
        csvEscape(b.cardLabel),
      ].join(","));
    }
    downloadTextFile(
      `expense-agent-batches-${exportStamp()}.csv`,
      `\uFEFF${lines.join("\n")}`,
      "text/csv;charset=utf-8",
    );
  }

  function summaryFilterLine() {
    const parts = [];
    if (summaryState.card !== "all") parts.push(`Card filter: ${summaryState.card}`);
    if (summaryState.merchant !== "all") parts.push(`Merchant filter: ${summaryState.merchant}`);
    return parts.length ? parts.join(" · ") : "Charts: all cards and merchants (headline metrics are account-wide).";
  }

  function summaryScopeText() {
    const parts = [];
    if (summaryState.card !== "all") parts.push(`card: ${summaryState.card}`);
    if (summaryState.merchant !== "all") parts.push(`merchant: ${summaryState.merchant}`);
    return parts.length
      ? `Charts scoped to ${parts.join(" | ")}. Headline metrics remain account-wide.`
      : "Charts scoped to all cards and merchants. Headline metrics remain account-wide.";
  }

  function renderSummaryScope() {
    const scopeEl = document.getElementById("summaryScopeSummary");
    if (scopeEl) scopeEl.textContent = summaryScopeText();

    const clearBtn = document.getElementById("clearSummaryFiltersBtn");
    if (!clearBtn) return;

    const hasFilters = summaryState.card !== "all" || summaryState.merchant !== "all";
    clearBtn.classList.toggle("is-visible", hasFilters);
    const scopeBar = clearBtn.closest(".scope-bar");
    if (scopeBar) scopeBar.classList.toggle("has-filters", hasFilters);
  }

  function clearSummaryFilters() {
    summaryState.card = "all";
    summaryState.merchant = "all";
    renderSummary();
  }

  function exportSummaryPdf() {
    if (!allTransactions.length) return;
    document.documentElement.classList.add("print-summary");
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.documentElement.classList.remove("print-summary");
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(cleanup, 120000);
    window.print();
  }

  function exportSummaryPptx() {
    if (!allTransactions.length) return;
    if (typeof PptxGenJS === "undefined") {
      showToast("Could not load presentation library. Check your connection and try again.");
      return;
    }

    try {
    const filtered = getSummarySelection();
    const pptx = new PptxGenJS();
    pptx.author = "Expense Agent";
    pptx.title = "Expense Agent Summary";

    const s1 = pptx.addSlide();
    s1.addText("Expense Agent — Summary", { x: 0.5, y: 0.6, w: 12, fontSize: 28, bold: true, color: "18212B" });
    s1.addText(new Date().toLocaleString(), { x: 0.5, y: 1.35, w: 12, fontSize: 11, color: "5D6872" });
    s1.addText(summaryFilterLine(), { x: 0.5, y: 1.85, w: 12, fontSize: 12, color: "18212B" });

    const allTime = sumAmounts(allTransactions);
    const currentMonthTotal = sumSpendInCurrentMonth();
    const rollingTotal = sumSpendInLastDays(rollingDays);
    const headlineRows = [
      ["Metric", "Value"],
      ["Lifetime spend", currencyWhole.format(allTime)],
      ["Current calendar month", currencyWhole.format(currentMonthTotal)],
      [`Last ${rollingDays} days`, currencyWhole.format(rollingTotal)],
      ["Total transactions (count)", integerFormat.format(allTransactions.length)],
    ];
    const s2 = pptx.addSlide();
    s2.addText("Headline metrics (account-wide)", { x: 0.5, y: 0.45, w: 12, fontSize: 16, bold: true, color: "18212B" });
    s2.addTable(headlineRows, { x: 0.5, y: 1.1, w: 9, colW: [4, 3], fontSize: 11, border: { pt: 0.5, color: "CCCCCC" } });

    const monthly = getMonthlyData(filtered);
    const trendRows = [["Month", "Total", "Transactions"]].concat(
      monthly.map(m => [monthLabel(m.key), currencyWhole.format(m.total), integerFormat.format(m.count)]),
    );
    const s3 = pptx.addSlide();
    s3.addText("Spend by month (filtered)", { x: 0.5, y: 0.45, w: 12, fontSize: 16, bold: true, color: "18212B" });
    if (trendRows.length <= 1) {
      s3.addText("No month data for the current filters.", { x: 0.5, y: 1.2, w: 12, fontSize: 12, color: "5D6872" });
    } else {
      s3.addTable(trendRows, { x: 0.5, y: 1.05, w: 11, colW: [3.5, 2.5, 2], fontSize: 10, border: { pt: 0.5, color: "CCCCCC" } });
    }

    const cards = getCardMix(filtered).slice(0, TOP_CARDS_LIMIT);
    const cardRows = [["Card", "Total", "Share of filtered spend"]].concat(
      cards.map(c => {
        const total = sumAmounts(filtered) || 1;
        const share = Math.round((c.total / total) * 100);
        return [c.name, currencyWhole.format(c.total), `${share}%`];
      }),
    );
    const s4 = pptx.addSlide();
    s4.addText(`Top ${TOP_CARDS_LIMIT} cards (filtered)`, { x: 0.5, y: 0.45, w: 12, fontSize: 16, bold: true, color: "18212B" });
    if (cardRows.length <= 1) {
      s4.addText("No card data for the current filters.", { x: 0.5, y: 1.2, w: 12, fontSize: 12, color: "5D6872" });
    } else {
      s4.addTable(cardRows, { x: 0.5, y: 1.05, w: 11, colW: [4, 2.5, 2], fontSize: 10, border: { pt: 0.5, color: "CCCCCC" } });
    }

    const vendors = getTopVendors(filtered).slice(0, TOP_MERCHANTS_LIMIT);
    const merchRows = [["Merchant", "Total", "Transactions"]].concat(
      vendors.map(v => [v.name, currencyWhole.format(v.total), integerFormat.format(v.count)]),
    );
    const s5 = pptx.addSlide();
    s5.addText(`Top ${TOP_MERCHANTS_LIMIT} merchants (filtered)`, { x: 0.5, y: 0.45, w: 12, fontSize: 16, bold: true, color: "18212B" });
    if (merchRows.length <= 1) {
      s5.addText("No merchant data for the current filters.", { x: 0.5, y: 1.2, w: 12, fontSize: 12, color: "5D6872" });
    } else {
      s5.addTable(merchRows, { x: 0.5, y: 1.05, w: 11, colW: [4, 2.5, 2], fontSize: 10, border: { pt: 0.5, color: "CCCCCC" } });
    }

    pptx.writeFile({ fileName: `expense-agent-summary-${exportStamp()}.pptx` }).catch(() => {
      showToast("Could not build the presentation file.");
    });
    } catch {
      showToast("Could not build the presentation file.");
    }
  }

  // Transactions-tab controls --------------------------------------------
  document.getElementById("searchInput").addEventListener("input", event => {
    transactionsState.search = event.target.value.trim();
    renderTransactionsLedger();
  });

  document.getElementById("cardFilter").addEventListener("change", event => {
    transactionsState.card = event.target.value;
    renderTransactionsLedger();
  });

  document.getElementById("statusFilters").addEventListener("click", event => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    transactionsState.status = button.dataset.status;
    renderTransactionsLedger();
  });

  document.getElementById("txMonthFilter").addEventListener("change", event => {
    transactionsState.month = event.target.value;
    renderTransactionsLedger();
  });

  document.getElementById("txAmountOp").addEventListener("change", event => {
    transactionsState.amountOp = event.target.value;
    renderTransactionsLedger();
  });

  document.getElementById("txAmountValue").addEventListener("input", event => {
    const parsed = parseFloat(event.target.value);
    transactionsState.amountValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    renderTransactionsLedger();
  });

  document.getElementById("clearFiltersBtn").addEventListener("click", clearTransactionsFilters);

  document.getElementById("exportTxCsvBtn").addEventListener("click", exportTransactionsCsv);
  document.getElementById("exportBatchesCsvBtn").addEventListener("click", exportBatchesCsv);
  document.getElementById("exportSummaryPdfBtn").addEventListener("click", exportSummaryPdf);
  document.getElementById("exportSummaryPptxBtn").addEventListener("click", exportSummaryPptx);
  document.getElementById("clearSummaryFiltersBtn").addEventListener("click", clearSummaryFilters);

  // Summary-tab click-to-filter (scoped to #summaryView so Transactions /
  // Batches UI never participates, even if markup gains data-filter-key later).
  document.getElementById("summaryView").addEventListener("click", event => {
    const target = event.target.closest("[data-filter-key]");
    if (!target) return;
    const key = target.dataset.filterKey;
    const value = target.dataset.filterValue;
    if (!(key in summaryState)) return;
    summaryState[key] = summaryState[key] === value ? "all" : value;
    renderSummary();
  });

  // Batches-tab controls --------------------------------------------------
  document.getElementById("batchMonthFilter").addEventListener("change", event => {
    batchesState.month = event.target.value;
    renderBatches();
  });
  document.getElementById("batchTotalOp").addEventListener("change", event => {
    batchesState.totalOp = event.target.value;
    renderBatches();
  });
  document.getElementById("batchTotalValue").addEventListener("input", event => {
    const parsed = parseFloat(event.target.value);
    batchesState.totalValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    renderBatches();
  });
  document.getElementById("batchItemsOp").addEventListener("change", event => {
    batchesState.itemsOp = event.target.value;
    renderBatches();
  });
  document.getElementById("batchItemsValue").addEventListener("input", event => {
    const parsed = parseInt(event.target.value, 10);
    batchesState.itemsValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    renderBatches();
  });
  document.getElementById("batchClearBtn").addEventListener("click", clearBatchesFilters);

  document.querySelectorAll(".view-tab").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  document.getElementById("batchCancelBtn").addEventListener("click", closeBatchModal);
  document.getElementById("batchDeleteBtn").addEventListener("click", deleteBatch);
  document.getElementById("batchModal").addEventListener("click", (event) => {
    if (event.target.id === "batchModal") closeBatchModal();
  });
  document.getElementById("txModalCloseBtn").addEventListener("click", closeTxModal);
  document.getElementById("txModalStatusBtn").addEventListener("click", toggleTxStatusFromModal);
  document.getElementById("txModalSaveBtn").addEventListener("click", saveTxFromModal);
  document.getElementById("txModal").addEventListener("click", (event) => {
    if (event.target.id === "txModal") closeTxModal();
  });

  document.getElementById("rollingDaysBtn").addEventListener("click", event => {
    event.stopPropagation();
    toggleRollingPopover();
  });
  document.getElementById("rollingPresets").addEventListener("click", event => {
    const btn = event.target.closest(".rolling-preset");
    if (!btn) return;
    const n = parseInt(btn.dataset.days, 10);
    if (Number.isFinite(n)) {
      setRollingDays(n);
      closeRollingPopover();
    }
  });
  document.getElementById("rollingDaysOk").addEventListener("click", () => {
    const raw = parseInt(document.getElementById("rollingDaysInput").value, 10);
    if (!Number.isFinite(raw) || raw < 1) return;
    setRollingDays(raw);
    closeRollingPopover();
  });
  document.getElementById("rollingDaysInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("rollingDaysOk").click();
    }
  });

  document.getElementById("trendMonthBtn").addEventListener("click", event => {
    event.stopPropagation();
    toggleTrendMonthPopover();
  });
  document.getElementById("trendMonthChecks").addEventListener("change", event => {
    const input = event.target;
    if (input.type !== "checkbox") return;
    const key = input.value;
    if (input.checked) {
      if (trendSelectedMonths.length >= MAX_TREND_MONTHS_SELECTED && !trendSelectedMonths.includes(key)) {
        input.checked = false;
        showToast(`You can select up to ${MAX_TREND_MONTHS_SELECTED} months.`);
        return;
      }
      if (!trendSelectedMonths.includes(key)) trendSelectedMonths.push(key);
    } else {
      const next = trendSelectedMonths.filter(k => k !== key);
      if (!next.length) {
        input.checked = true;
        return;
      }
      trendSelectedMonths = next;
    }
    renderSummary();
  });

  document.addEventListener("click", event => {
    const rpop = document.getElementById("rollingPopover");
    if (!rpop.hidden) {
      if (event.target.closest("#rollingPopover") || event.target.closest("#rollingDaysBtn")) return;
      closeRollingPopover();
    }
    const tpop = document.getElementById("trendMonthPopover");
    if (!tpop.hidden) {
      if (event.target.closest("#trendMonthPopover") || event.target.closest("#trendMonthBtn")) return;
      closeTrendMonthPopover();
    }
  });

  document.getElementById("compareModePills").addEventListener("click", event => {
    const pill = event.target.closest(".compare-mode-pill");
    if (!pill) return;
    event.stopPropagation();
    const mode = pill.dataset.compareMode;
    if (mode !== "totals" && mode !== "averages") return;
    if (mode === compareYMode) return;
    compareYMode = mode;
    try { localStorage.setItem(COMPARE_Y_STORAGE_KEY, compareYMode); } catch (err) { /* ignore */ }
    renderSummary();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("batchModal").classList.contains("visible")) closeBatchModal();
    else if (document.getElementById("txModal").classList.contains("visible")) closeTxModal();
    else if (!document.getElementById("trendMonthPopover").hidden) closeTrendMonthPopover();
    else if (!document.getElementById("rollingPopover").hidden) closeRollingPopover();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !token) return;
    load();
  });

  load();
