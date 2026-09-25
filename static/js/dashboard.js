/* Spending dashboard, shared by the landing page (illustrative data) and
   /history (the user's rows), so the page never promises more than the product.
   Pick a year, a month, and a card; every figure redraws for that selection.

   ComplineDashboard.mount(root, {
     years:   [2024, 2025, 2026],          // ascending
     cards:   ["Capital One", ...],        // colour order
     month:   (year, m) => ({ "Capital One": [["Uber", 12.5], ...], ... }) | null,
     initial: { year, month },
     charges: (year, m, card) => [12.5, ...], // optional: per-charge amounts; with one
                                           // card, fills the left column with stats
     onChange: state => {},                // optional
   }) -> { getState, setState } */
(function () {
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SWATCHES = ["var(--accent)", "color-mix(in srgb,var(--accent) 55%,#fff)", "var(--accent-line)", "var(--g-400)", "var(--g-100)"];
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function sum(rows) { return rows.reduce(function (a, r) { return a + r[1]; }, 0); }
  function esc(text) { return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function mount(root, opts) {
    var years = opts.years.slice();
    var cards = opts.cards.slice();
    var colour = function (name) { return SWATCHES[cards.indexOf(name) % SWATCHES.length]; };
    var state = { year: opts.initial.year, month: opts.initial.month, card: "all" };
    var multiCard = cards.length > 1;

    function monthAt(year, m) { return opts.month(year, m) || null; }
    function cardTotal(month, name) { return month && month[name] ? sum(month[name]) : 0; }
    function scopeTotal(month, card) {
      if (!month) return 0;
      return card === "all" ? cards.reduce(function (a, c) { return a + cardTotal(month, c); }, 0) : cardTotal(month, card);
    }
    // One comparison, and only when it means something: the previous month.
    function describe(year, m, card, total) {
      var before = scopeTotal(m > 0 ? monthAt(year, m - 1) : monthAt(year - 1, 11), card);
      if (!before) return "";
      var name = MONTHS[(m + 11) % 12];
      var pct = Math.round((total - before) / before * 100);
      return pct === 0 ? "Level with " + name : (pct > 0 ? "Up " : "Down ") + Math.abs(pct) + "% from " + name;
    }

    root.innerHTML =
      '<div class="dash-top">' +
        '<h3 class="dash-label">Monthly spending</h3>' +
        (years.length > 1 ? '<div class="seg" role="group" aria-label="Year">' +
          years.map(function (y) { return '<button type="button" data-year="' + y + '">' + y + "</button>"; }).join("") + "</div>" : "") +
      "</div>" +
      '<div class="dash-months" role="group" aria-label="Month">' +
        MONTHS.map(function (name, i) {
          return '<button type="button" class="dash-col" data-month="' + i + '" style="--i:' + i + '">' +
            '<span class="dash-col-bar"><span class="dash-col-track"><span class="dash-col-val"></span><i></i></span></span>' +
            '<span class="dash-col-label"><span class="is-long">' + name.slice(0, 3) + '</span><span class="is-short">' + name[0] + "</span></span>" +
          "</button>";
        }).join("") +
      "</div>" +
      '<div class="dash-body">' +
        '<div class="dash-summary">' +
          '<div class="dash-period" aria-live="polite"><h4 class="dash-label dash-month"></h4><strong class="dash-total"></strong><span class="dash-delta"></span></div>' +
          (!multiCard && opts.charges ?
            '<dl class="dash-stats"><div><dt>Charges</dt><dd data-stat="count"></dd></div><div><dt>Average</dt><dd data-stat="avg"></dd></div><div><dt>Largest</dt><dd data-stat="max"></dd></div></dl>' : "") +
          (multiCard ?
            '<div class="split-bar dash-split" aria-hidden="true">' + cards.map(function (c) { return '<span style="background:' + colour(c) + '"></span>'; }).join("") + "</div>" +
            '<div class="dash-cards" role="group" aria-label="Card">' +
              '<button type="button" class="chip" data-card="all"><i style="background:linear-gradient(90deg,' + SWATCHES[0] + " 0 40%," + SWATCHES[1] + " 40% 75%," + SWATCHES[2] + ' 75%)"></i><span>All cards</span><b></b></button>' +
              cards.map(function (c) { return '<button type="button" class="chip" data-card="' + esc(c) + '"><i style="background:' + colour(c) + '"></i><span>' + esc(c) + "</span><b></b></button>"; }).join("") +
            "</div>" : "") +
        "</div>" +
        '<div class="dash-merchants"><h4 class="dash-label">Top merchants</h4><ol class="dash-ranks"></ol></div>' +
      "</div>";

    var yearBtns = root.querySelectorAll("[data-year]");
    var cols = root.querySelectorAll(".dash-col");
    var chips = root.querySelectorAll(".chip");
    var segs = root.querySelectorAll(".dash-split span");
    var monthEl = root.querySelector(".dash-month");
    var totalEl = root.querySelector(".dash-total");
    var deltaEl = root.querySelector(".dash-delta");
    var ranksEl = root.querySelector(".dash-ranks");
    var statsEl = root.querySelector(".dash-stats");

    var tween = null;
    function setTotal(value) {
      var from = parseInt(totalEl.textContent.replace(/[^0-9]/g, ""), 10) || 0;
      if (tween) cancelAnimationFrame(tween);
      if (reduceMotion || !totalEl.textContent) { totalEl.textContent = money(value); return; }
      var start = null;
      (function frame(now) {
        if (now === undefined) { tween = requestAnimationFrame(frame); return; }
        if (start === null) start = now;
        var t = Math.min((now - start) / 320, 1);
        totalEl.textContent = money(from + (value - from) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) tween = requestAnimationFrame(frame);
      })();
    }

    function render() {
      var year = state.year, card = state.card;
      var totals = MONTHS.map(function (_, m) { return scopeTotal(monthAt(year, m), card); });
      var max = Math.max.apply(null, totals) || 1;

      yearBtns.forEach(function (btn) { btn.setAttribute("aria-pressed", String(+btn.dataset.year === year)); });
      cols.forEach(function (col, m) {
        var has = !!monthAt(year, m);
        col.disabled = !has;
        col.setAttribute("aria-pressed", String(m === state.month));
        col.setAttribute("aria-label", MONTHS[m] + " " + year + (has ? ", " + money(totals[m]) : ", no charges"));
        col.querySelector(".dash-col-val").textContent = has ? money(totals[m]) : "";
        col.style.setProperty("--h", has ? Math.max(totals[m] / max * 100, 3) + "%" : "0%");
      });

      var month = monthAt(year, state.month);
      var total = scopeTotal(month, card);
      monthEl.textContent = MONTHS[state.month] + " " + year + (multiCard ? " · " + (card === "all" ? "All cards" : card) : "");
      setTotal(total);

      deltaEl.textContent = describe(year, state.month, card, total);

      if (statsEl) {
        var amounts = opts.charges(year, state.month, card) || [];
        var count = amounts.length;
        statsEl.querySelector('[data-stat="count"]').textContent = count.toLocaleString("en-US");
        statsEl.querySelector('[data-stat="avg"]').textContent = count ? money(total / count) : "$0";
        statsEl.querySelector('[data-stat="max"]').textContent = count ? money(Math.max.apply(null, amounts)) : "$0";
      }

      var all = scopeTotal(month, "all") || 1;
      cards.forEach(function (c, i) {
        if (!segs[i]) return;
        segs[i].style.width = (cardTotal(month, c) / all * 100) + "%";
        segs[i].classList.toggle("is-dim", card !== "all" && card !== c);
      });
      chips.forEach(function (chip) {
        var id = chip.dataset.card;
        chip.setAttribute("aria-pressed", String(id === card));
        chip.querySelector("b").textContent = money(scopeTotal(month, id));
      });

      // A merchant charged on several cards is one row: amounts combine, cards are listed.
      var byName = {};
      cards.forEach(function (c) {
        if (card !== "all" && card !== c) return;
        ((month && month[c]) || []).forEach(function (r) {
          var row = byName[r[0]] || (byName[r[0]] = { name: r[0], amount: 0, cards: [] });
          row.amount += r[1];
          row.cards.push({ name: c, amount: r[1] });
        });
      });
      var rows = Object.keys(byName).map(function (k) { return byName[k]; });
      rows.sort(function (a, b) { return b.amount - a.amount; });
      rows = rows.slice(0, 4);
      ranksEl.innerHTML = rows.map(function (r) {
        var via = multiCard && card === "all"
          ? "<small>" + esc(r.cards.sort(function (a, b) { return b.amount - a.amount; }).map(function (c) { return c.name; }).join(" + ")) + "</small>" : "";
        return '<li><span class="dash-rank-name">' + esc(r.name) + via + "</span>" +
          '<span class="dash-rank-bar"><i style="width:' + (r.amount / rows[0].amount * 100) + '%"></i></span>' +
          "<b>" + money(r.amount) + "</b></li>";
      }).join("");

      if (opts.onChange) opts.onChange({ year: state.year, month: state.month, card: state.card });
    }

    function latestMonthIn(year) {
      for (var m = 11; m >= 0; m--) if (monthAt(year, m)) return m;
      return 0;
    }

    root.addEventListener("click", function (event) {
      var yearBtn = event.target.closest("[data-year]");
      var col = event.target.closest(".dash-col");
      var chip = event.target.closest(".chip");
      if (yearBtn) {
        state.year = +yearBtn.dataset.year;
        if (!monthAt(state.year, state.month)) state.month = latestMonthIn(state.year);
      } else if (col && !col.disabled) {
        state.month = +col.dataset.month;
      } else if (chip) {
        state.card = chip.dataset.card;
      } else {
        return;
      }
      render();
    });

    // Arrow keys step to the previous or next month that has charges, across years.
    root.querySelector(".dash-months").addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      var step = event.key === "ArrowRight" ? 1 : -1;
      var y = state.year, m = state.month;
      for (var guard = 0; guard < 48; guard++) {
        m += step;
        if (m < 0) { y -= 1; m = 11; } else if (m > 11) { y += 1; m = 0; }
        if (y < years[0] || y > years[years.length - 1]) return;
        if (monthAt(y, m)) break;
      }
      event.preventDefault();
      state.year = y; state.month = m;
      render();
      cols[m].focus();
    });

    render();
    return {
      getState: function () { return { year: state.year, month: state.month, card: state.card }; },
      setState: function (next) { Object.assign(state, next); render(); },
    };
  }

  window.ComplineDashboard = { mount: mount, MONTHS: MONTHS };
})();
