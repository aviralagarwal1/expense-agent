/* History: the shared spending dashboard over the user's rows, the charges for
   the selected month (or a search across everything), and the uploads they
   came from. Rows open an edit sheet; uploads open a sheet that can delete them. */
(function () {
  const token = sessionStorage.getItem("expense_token");
  if (!token) {
    window.location.href = "/app";
    return;
  }

  const MONTHS = ComplineDashboard.MONTHS;
  const SHORT = MONTHS.map(m => m.slice(0, 3));
  const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const $ = id => document.getElementById(id);

  let rows = [];            // normalized transactions
  let view = null;          // { year, month, card } from the dashboard
  let dash = null;
  let showAllUploads = false;
  let editing = null;       // row open in the edit sheet
  let openUpload = null;    // upload open in its sheet

  // ── Data ────────────────────────────────────────────────────────────────
  function normalize(tx) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(tx.date || "") ? tx.date : String(tx.created_at || "").slice(0, 10);
    return {
      id: tx.id,
      vendor: tx.vendor || "",
      card: tx.card || "Unassigned",
      date,
      year: +date.slice(0, 4),
      month: +date.slice(5, 7) - 1,
      amount: Number(tx.amount) || 0,
      status: tx.status === "pending" ? "pending" : "settled",
      memo: tx.memo || "",
      batchId: tx.batch_id || "",
      createdAt: tx.created_at || "",
    };
  }

  function api(path, options = {}) {
    const headers = Object.assign({ "Authorization": `Bearer ${token}` }, options.body ? { "Content-Type": "application/json" } : {});
    return fetch(path, Object.assign({}, options, { headers })).then(async res => {
      if (res.status === 401) {
        window.location.href = "/app";
        throw new Error("unauthorized");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "request_failed");
      return data;
    });
  }

  function byDateDesc(a, b) {
    return b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt));
  }

  function formatDay(iso, withYear) {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return `${SHORT[m - 1]} ${d}${withYear || y !== new Date().getFullYear() ? `, ${y}` : ""}`;
  }

  // ── Dashboard ───────────────────────────────────────────────────────────
  function mountDashboard(keep) {
    const years = [...new Set(rows.map(r => r.year))].sort((a, b) => a - b).slice(-4);
    const totals = {};
    rows.forEach(r => { totals[r.card] = (totals[r.card] || 0) + r.amount; });
    const cards = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);

    const index = {};
    rows.forEach(r => {
      const month = index[`${r.year}-${r.month}`] || (index[`${r.year}-${r.month}`] = {});
      const list = month[r.card] || (month[r.card] = []);
      const same = list.find(entry => entry[0] === r.vendor);
      if (same) same[1] += r.amount; else list.push([r.vendor, r.amount]);
    });

    const latest = rows.slice().sort(byDateDesc)[0];
    const initial = keep && index[`${keep.year}-${keep.month}`] ? keep : { year: latest.year, month: latest.month };
    const root = document.querySelector("[data-dash]");
    dash = ComplineDashboard.mount(root, {
      years,
      cards,
      initial,
      month: (year, m) => index[`${year}-${m}`] || null,
      charges: (year, m, card) => rows
        .filter(r => r.year === year && r.month === m && (card === "all" || r.card === card))
        .map(r => r.amount),
      onChange: state => {
        view = state;
        renderLedger();
      },
    });
    if (keep && keep.card !== "all" && cards.includes(keep.card)) dash.setState({ card: keep.card });
  }

  // ── Charges ─────────────────────────────────────────────────────────────
  function visibleRows() {
    const query = $("searchInput").value.trim().toLowerCase();
    if (query) {
      return rows.filter(r => `${r.vendor} ${r.card} ${r.memo}`.toLowerCase().includes(query)).sort(byDateDesc);
    }
    return rows
      .filter(r => r.year === view.year && r.month === view.month && (view.card === "all" || r.card === view.card))
      .sort(byDateDesc);
  }

  function rowEl(r, { withYear = false, onOpen } = {}) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ledger-row";
    row.setAttribute("role", "listitem");
    const name = document.createElement("span");
    name.className = "ledger-name";
    name.textContent = r.vendor;
    if (r.status === "pending") {
      const mark = document.createElement("small");
      mark.className = "pending-mark";
      mark.textContent = "Pending";
      name.appendChild(mark);
    }
    const card = document.createElement("span");
    card.className = "ledger-card";
    card.textContent = r.card;
    const date = document.createElement("time");
    date.className = "ledger-date";
    date.textContent = formatDay(r.date, withYear);
    const amount = document.createElement("b");
    amount.className = "ledger-amount";
    amount.textContent = exact.format(r.amount);
    const sub = document.createElement("small");
    sub.className = "ledger-sub";
    sub.textContent = `${date.textContent} · ${r.card}`;
    name.appendChild(sub);
    if (r.memo) {
      const memo = document.createElement("small");
      memo.className = "ledger-memo";
      memo.textContent = r.memo;
      name.appendChild(memo);
    }
    row.append(name, card, date, amount);
    row.setAttribute("aria-label", `${r.vendor}, ${exact.format(r.amount)}, ${formatDay(r.date, true)}, ${r.card}. Edit`);
    row.addEventListener("click", () => onOpen(r));
    return row;
  }

  function renderLedger() {
    const query = $("searchInput").value.trim();
    const list = visibleRows();
    const total = list.reduce((a, r) => a + r.amount, 0);
    $("ledgerTitle").textContent = query
      ? `Results for “${query}”`
      : `${MONTHS[view.month]} ${view.year}${view.card === "all" ? "" : ` · ${view.card}`}`;
    $("ledgerMeta").textContent = list.length ? `${list.length} charge${list.length === 1 ? "" : "s"} · ${exact.format(total)}` : "";
    const el = $("ledgerList");
    el.replaceChildren(...list.map(r => rowEl(r, { withYear: !!query, onOpen: openEdit })));
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "ledger-empty";
      empty.textContent = query ? "No charges match." : "No charges this month.";
      el.appendChild(empty);
    }
  }

  // ── Uploads ─────────────────────────────────────────────────────────────
  function uploads() {
    const groups = {};
    rows.forEach(r => {
      if (!r.batchId) return;
      const g = groups[r.batchId] || (groups[r.batchId] = { id: r.batchId, rows: [], cards: new Set(), createdAt: r.createdAt });
      g.rows.push(r);
      g.cards.add(r.card);
      if (r.createdAt < g.createdAt) g.createdAt = r.createdAt;
    });
    return Object.values(groups).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function renderUploads() {
    const all = uploads();
    const shown = showAllUploads ? all : all.slice(0, 5);
    $("uploadsMeta").textContent = all.length ? `${all.length} total` : "";
    $("uploadsMore").hidden = all.length <= 5 || showAllUploads;
    const el = $("uploadList");
    el.replaceChildren(...shown.map(u => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ledger-row upload-row";
      row.setAttribute("role", "listitem");
      const total = u.rows.reduce((a, r) => a + r.amount, 0);
      const day = u.createdAt ? formatDay(String(u.createdAt).slice(0, 10)) : "";
      row.innerHTML = `<span class="ledger-name"></span><span class="ledger-card"></span><time class="ledger-date"></time><b class="ledger-amount"></b>`;
      row.querySelector(".ledger-name").textContent = `${u.rows.length} charge${u.rows.length === 1 ? "" : "s"}`;
      row.querySelector(".ledger-card").textContent = [...u.cards].join(", ");
      row.querySelector(".ledger-date").textContent = day;
      row.querySelector(".ledger-amount").textContent = exact.format(total);
      const sub = document.createElement("small");
      sub.className = "ledger-sub";
      sub.textContent = [day, [...u.cards].join(", ")].filter(Boolean).join(" · ");
      row.querySelector(".ledger-name").appendChild(sub);
      row.addEventListener("click", () => openUploadSheet(u));
      return row;
    }));
    if (!all.length) {
      const empty = document.createElement("p");
      empty.className = "ledger-empty";
      empty.textContent = "No uploads yet.";
      el.appendChild(empty);
    }
  }

  $("uploadsMore").addEventListener("click", () => {
    showAllUploads = true;
    renderUploads();
  });

  // ── Edit sheet ──────────────────────────────────────────────────────────
  function resetDanger(btn, label) {
    btn.dataset.armed = "";
    btn.textContent = label;
  }

  function openEdit(r) {
    editing = r;
    $("txDialogSub").textContent = `${r.card} · ${formatDay(r.date, true)}`;
    $("txMerchant").value = r.vendor;
    $("txDate").value = r.date;
    $("txAmount").value = r.amount.toFixed(2);
    $("txStatus").value = r.status;
    $("txNote").value = r.memo;
    resetDanger($("txDelete"), "Delete charge");
    $("txDialog").showModal();
  }

  $("txCancel").addEventListener("click", () => $("txDialog").close());

  $("txForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!editing) return;
    const next = {
      vendor: $("txMerchant").value.trim(),
      date: $("txDate").value,
      amount: Math.round(parseFloat($("txAmount").value) * 100) / 100,
      status: $("txStatus").value,
      memo: $("txNote").value.trim(),
    };
    const current = { vendor: editing.vendor, date: editing.date, amount: editing.amount, status: editing.status, memo: editing.memo };
    const changes = {};
    Object.keys(next).forEach(k => { if (next[k] !== current[k]) changes[k] = next[k]; });
    if (!Object.keys(changes).length) {
      $("txDialog").close();
      return;
    }
    $("txSave").disabled = true;
    try {
      const data = await api(`/api/transactions/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: JSON.stringify(changes) });
      const updated = normalize(Object.assign({ created_at: editing.createdAt, batch_id: editing.batchId }, data.transaction));
      rows = rows.map(r => (r.id === editing.id ? updated : r));
      $("txDialog").close();
      refresh();
    } catch (err) {
      toast(readableError(err));
    } finally {
      $("txSave").disabled = false;
    }
  });

  // Deleting takes two taps on the same button instead of a browser dialog.
  $("txDelete").addEventListener("click", async () => {
    const btn = $("txDelete");
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "Tap again to delete";
      return;
    }
    try {
      await api(`/api/transactions/${encodeURIComponent(editing.id)}`, { method: "DELETE" });
      rows = rows.filter(r => r.id !== editing.id);
      $("txDialog").close();
      refresh();
    } catch (err) {
      toast(readableError(err));
      resetDanger(btn, "Delete charge");
    }
  });

  // ── Upload sheet ────────────────────────────────────────────────────────
  function openUploadSheet(u) {
    openUpload = u;
    const total = u.rows.reduce((a, r) => a + r.amount, 0);
    $("uploadDialogTitle").textContent = `${u.rows.length} charge${u.rows.length === 1 ? "" : "s"} · ${exact.format(total)}`;
    $("uploadDialogSub").textContent = `${[...u.cards].join(", ")}${u.createdAt ? ` · uploaded ${formatDay(String(u.createdAt).slice(0, 10), true)}` : ""}`;
    $("uploadDialogList").replaceChildren(...u.rows.slice().sort(byDateDesc).map(r => rowEl(r, {
      onOpen: row => {
        $("uploadDialog").close();
        openEdit(row);
      },
    })));
    resetDanger($("uploadDelete"), "Delete upload");
    $("uploadDialog").showModal();
  }

  $("uploadClose").addEventListener("click", () => $("uploadDialog").close());

  $("uploadDelete").addEventListener("click", async () => {
    const btn = $("uploadDelete");
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = `Tap again to delete ${openUpload.rows.length} charge${openUpload.rows.length === 1 ? "" : "s"}`;
      return;
    }
    try {
      await api(`/api/batches/${encodeURIComponent(openUpload.id)}`, { method: "DELETE" });
      rows = rows.filter(r => r.batchId !== openUpload.id);
      $("uploadDialog").close();
      refresh();
    } catch (err) {
      toast(readableError(err));
      resetDanger(btn, "Delete upload");
    }
  });

  // Clicking the dimmed area around a sheet closes it.
  document.querySelectorAll("dialog.sheet").forEach(d => {
    d.addEventListener("click", event => { if (event.target === d) d.close(); });
  });

  // ── Export ──────────────────────────────────────────────────────────────
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const lines = [["Date", "Merchant", "Card", "Amount", "Status", "Note"]]
      .concat(visibleRows().map(r => [r.date, r.vendor, r.card, r.amount.toFixed(2), r.status, r.memo]));
    download(`compline-${view.year}-${String(view.month + 1).padStart(2, "0")}.csv`, lines.map(l => l.map(csvCell).join(",")).join("\n"), "text/csv");
  }

  function exportPptx() {
    if (typeof PptxGenJS === "undefined") {
      toast("PowerPoint export is still loading. Try again in a moment.");
      return;
    }
    const year = view.year;
    const inYear = rows.filter(r => r.year === year);
    const pptx = new PptxGenJS();
    pptx.title = `Compline ${year}`;
    const ink = "14201A", green = "0F5137", muted = "5D6B62";
    const title = (slide, text) => slide.addText(text, { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: ink, fontFace: "Arial" });

    const s1 = pptx.addSlide();
    s1.addText(`Spending in ${year}`, { x: 0.5, y: 1.8, w: 9, h: 0.8, fontSize: 32, bold: true, color: ink, fontFace: "Arial" });
    s1.addText(exact.format(inYear.reduce((a, r) => a + r.amount, 0)), { x: 0.5, y: 2.6, w: 9, h: 0.8, fontSize: 28, color: green, fontFace: "Arial" });
    s1.addText(`${inYear.length} charges across ${new Set(inYear.map(r => r.card)).size} cards`, { x: 0.5, y: 3.4, w: 9, h: 0.5, fontSize: 14, color: muted, fontFace: "Arial" });

    const monthly = MONTHS.map((_, m) => inYear.filter(r => r.month === m).reduce((a, r) => a + r.amount, 0));
    const s2 = pptx.addSlide();
    title(s2, "By month");
    s2.addChart(pptx.ChartType.bar, [{ name: "Spend", labels: SHORT, values: monthly.map(v => Math.round(v)) }], {
      x: 0.5, y: 1.2, w: 9, h: 4, barDir: "col", chartColors: [green], valAxisHidden: true, valGridLine: { style: "none" }, showValue: true, dataLabelFormatCode: "$#,##0", catAxisLabelColor: muted,
    });

    const group = key => {
      const t = {};
      inYear.forEach(r => { t[r[key]] = (t[r[key]] || 0) + r.amount; });
      return Object.entries(t).sort((a, b) => b[1] - a[1]);
    };
    [["By card", "card"], ["Top merchants", "vendor"]].forEach(([label, key]) => {
      const s = pptx.addSlide();
      title(s, label);
      s.addTable(group(key).slice(0, 8).map(([name, amount]) => [
        { text: name, options: { color: ink } },
        { text: exact.format(amount), options: { align: "right", bold: true, color: ink } },
      ]), { x: 0.5, y: 1.2, w: 9, fontSize: 14, fontFace: "Arial", border: { type: "none" }, rowH: 0.45 });
    });
    pptx.writeFile({ fileName: `compline-${year}.pptx` }).catch(() => toast("PowerPoint export failed."));
  }

  document.querySelectorAll("[data-export]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.export;
      if (kind === "csv") exportCsv();
      else if (kind === "pdf") window.print();
      else exportPptx();
    });
  });

  // ── Shell ───────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
  }

  function readableError(err) {
    const msg = String((err && err.message) || "");
    if (!msg || msg === "request_failed" || msg === "Failed to fetch") return "Something went wrong. Try again.";
    return msg.charAt(0).toUpperCase() + msg.slice(1).replace(/_/g, " ") + ".";
  }

  function refresh() {
    if (!rows.length) {
      $("historyBody").hidden = true;
      $("exportMenu").hidden = true;
      $("emptyState").hidden = false;
      return;
    }
    mountDashboard(view);
    renderUploads();
  }

  $("searchInput").addEventListener("input", renderLedger);

  api("/api/transactions")
    .then(data => {
      rows = (data.transactions || []).map(normalize).filter(r => r.year);
      $("historyStatus").hidden = true;
      if (!rows.length) {
        $("emptyState").hidden = false;
        return;
      }
      $("historyBody").hidden = false;
      $("exportMenu").hidden = false;
      refresh();
    })
    .catch(err => {
      if (err.message === "unauthorized") return;
      $("historyStatus").textContent = "Could not load your history. Refresh to try again.";
    });
})();
