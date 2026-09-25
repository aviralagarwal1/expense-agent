/* Landing ledger: plays the product's core promise once, when the ledger is
   first seen. Rows arrive unreviewed, then are added one at a time while the
   total climbs to the reviewed figure. The markup already holds the finished
   state, so no-JS and reduced-motion viewers see the completed ledger. */
(function () {
  var ledger = document.querySelector("[data-ledger]");
  if (!ledger || typeof IntersectionObserver !== "function") return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var rows = Array.prototype.slice.call(ledger.querySelectorAll(".ledger-row[data-amount]"));
  var totalEl = ledger.querySelector("[data-ledger-total]");
  var captionEl = ledger.querySelector("[data-ledger-caption]");
  if (!rows.length || !totalEl || !captionEl) return;

  var finalTotal = totalEl.textContent;
  var finalCaption = captionEl.textContent;
  var START_DELAY = 500;
  var STEP = 420;
  var COUNT_MS = 360;

  function money(cents) {
    return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function countTo(fromCents, toCents) {
    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / COUNT_MS, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      totalEl.textContent = money(Math.round(fromCents + (toCents - fromCents) * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  ledger.classList.add("is-staged");
  ledger.setAttribute("aria-busy", "true");
  totalEl.textContent = money(0);
  captionEl.textContent = "0 of " + rows.length + " charges reviewed";

  function run() {
    var running = 0;
    ledger.classList.add("is-counting");
    rows.forEach(function (row, i) {
      setTimeout(function () {
        var next = running + Math.round(parseFloat(row.getAttribute("data-amount")) * 100);
        row.classList.add("is-added");
        countTo(running, next);
        running = next;
        captionEl.textContent = (i + 1) + " of " + rows.length + " charges reviewed";
        if (i === rows.length - 1) {
          setTimeout(function () {
            totalEl.textContent = finalTotal;
            captionEl.textContent = finalCaption;
            ledger.classList.remove("is-staged", "is-counting");
            ledger.removeAttribute("aria-busy");
          }, COUNT_MS + 40);
        }
      }, START_DELAY + i * STEP);
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
    observer.disconnect();
    run();
  }, { threshold: 0.45 });
  observer.observe(ledger);
})();

/* Landing dashboard data. The dashboard itself is the shared component in
   dashboard.js, the same one /history uses. The months the rest of the page
   quotes (January to March of the most recent March) are fixed so the page
   agrees with itself; every other month comes from a generator seeded by its
   own year and month, so it is identical on every visit and as the window
   moves. The static panels stay as the no-JS view. */
(function () {
  var root = document.querySelector("[data-dash]");
  var fallback = document.querySelector("[data-dash-fallback]");
  if (!root || !window.ComplineDashboard) return;

  // Dates follow the visitor's clock so the demo never goes stale: the three
  // most recent years, with the current month as the latest one that has data.
  var today = new Date();
  var LAST = { year: today.getFullYear(), month: today.getMonth() };
  var YEARS = [LAST.year - 2, LAST.year - 1, LAST.year];
  // The page's fixed story (the March ledger week, $1,284, up 36% from
  // February) sits in the most recent March that has already happened.
  var STORY = LAST.month >= 2 ? LAST.year : LAST.year - 1;
  var CARDS = [
    { id: "cap", name: "Capital One" },
    { id: "amex", name: "American Express" },
    { id: "disc", name: "Discover" }
  ];
  // One shared merchant list. Weights say how often each card is the one
  // reached for there, so everyday merchants turn up on more than one card.
  var MERCHANTS = [
    ["Whole Foods Market", { amex: 4, cap: 1 }],
    ["Amazon", { cap: 2, amex: 1, disc: 2 }],
    ["Uber", { cap: 3, amex: 1 }],
    ["Shell", { amex: 3, cap: 1 }],
    ["United Airlines", { cap: 3 }],
    ["Delta", { amex: 2 }],
    ["CVS Pharmacy", { cap: 2, disc: 1 }],
    ["Chipotle", { cap: 2, amex: 1 }],
    ["Target", { amex: 1, disc: 2 }],
    ["Trader Joe’s", { amex: 2, cap: 1 }],
    ["Costco", { disc: 3 }],
    ["Apple", { disc: 2, cap: 1 }],
    ["Home Depot", { disc: 1, cap: 1 }]
  ];
  var SEASON = [0.95, 0.85, 1, 0.95, 1.05, 1.1, 1.2, 1.1, 0.95, 1, 1.1, 1.35];

  // Reseeded per month, so a month's figures never change as the window moves.
  var seed = 0;
  function seedFor(year, m) { seed = year * 7919 + m * 104729 + 20260309; }
  function rand() {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function between(lo, hi) { return lo + rand() * (hi - lo); }

  // Pick `count` merchants for a card, weighted by how often that card is used
  // there, then split `total` across them; the rounding remainder goes to the first.
  function spread(total, cardId, count) {
    var pool = MERCHANTS.filter(function (m) { return m[1][cardId]; });
    var names = [];
    while (names.length < count && pool.length) {
      var weightSum = pool.reduce(function (a, m) { return a + m[1][cardId]; }, 0);
      var pick = rand() * weightSum, i = 0;
      while ((pick -= pool[i][1][cardId]) > 0) i++;
      names.push(pool.splice(i, 1)[0][0]);
    }
    var weights = names.map(function () { return rand() + 0.35; });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var rows = names.map(function (name, i) { return [name, Math.floor(total * weights[i] / sum)]; });
    rows[0][1] += total - rows.reduce(function (a, r) { return a + r[1]; }, 0);
    return rows;
  }

  function makeMonth(total) {
    var cap = Math.round(total * between(0.4, 0.47));
    var amex = Math.round(total * between(0.35, 0.42));
    var disc = total - cap - amex;
    return {
      cap: spread(cap, "cap", 5),
      amex: spread(amex, "amex", 4),
      disc: [["Netflix", 15], ["Spotify", 12]].concat(spread(disc - 27, "disc", 3))
    };
  }

  var data = {};
  YEARS.forEach(function (year) {
    for (var m = 0; m < 12; m++) {
      if (year === LAST.year && m > LAST.month) break;
      seedFor(year, m);
      data[year + "-" + m] = makeMonth(Math.round(1050 * SEASON[m] * between(0.85, 1.15)));
    }
  });
  // Months quoted elsewhere on the page.
  seedFor(STORY, 0);
  data[STORY + "-0"] = makeMonth(1107);
  seedFor(STORY, 1);
  data[STORY + "-1"] = makeMonth(942);
  data[STORY + "-2"] = {
    cap: [["United Airlines", 268], ["CVS Pharmacy", 96], ["Uber", 84], ["Whole Foods Market", 38], ["Chipotle", 38], ["Blue Bottle Coffee", 38]],
    amex: [["Whole Foods Market", 312], ["Shell", 141], ["Trader Joe’s", 65]],
    disc: [["Costco", 132], ["Apple", 45], ["Netflix", 15], ["Spotify", 12]]
  };

  ComplineDashboard.mount(root, {
    years: YEARS,
    cards: CARDS.map(function (c) { return c.name; }),
    initial: { year: STORY, month: 2 },
    month: function (year, m) {
      var raw = data[year + "-" + m];
      if (!raw) return null;
      var byName = {};
      CARDS.forEach(function (c) { byName[c.name] = raw[c.id]; });
      return byName;
    },
  });
  root.hidden = false;
  if (fallback) fallback.hidden = true;
})();
