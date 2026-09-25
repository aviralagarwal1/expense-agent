/* Disclosure menus. Handles any number per page: anything declared with
   data-menu / data-menu-btn / data-menu-panel (account menu, export menu) and
   the public pages' mobile nav toggle. */
(function () {
  var menus = [];

  function setOpen(menu, open, moveFocus) {
    menu.root.classList.toggle(menu.openClass, open);
    menu.btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && moveFocus) {
      var first = menu.panel.querySelector("a, button");
      if (first) first.focus();
    }
  }

  function closeAll(except) {
    menus.forEach(function (menu) {
      if (menu !== except) setOpen(menu, false, false);
    });
  }

  function register(root, btn, panel, openClass) {
    if (!root || !btn || !panel) return;
    var menu = { root: root, btn: btn, panel: panel, openClass: openClass };
    menus.push(menu);

    btn.addEventListener("click", function (event) {
      event.stopPropagation();
      var willOpen = !root.classList.contains(openClass);
      closeAll(menu);
      setOpen(menu, willOpen, true);
    });

    // Following a link or firing an action should always dismiss the menu.
    panel.querySelectorAll("a, button").forEach(function (element) {
      element.addEventListener("click", function () {
        setOpen(menu, false, false);
      });
    });
  }

  document.querySelectorAll("[data-menu]").forEach(function (root) {
    register(
      root,
      root.querySelector("[data-menu-btn]"),
      root.querySelector("[data-menu-panel]"),
      "is-open"
    );
  });

  var nav = document.getElementById("siteNav");
  var navBtn = document.getElementById("navMenuBtn");
  var navPanel = document.getElementById("navActionsPanel");
  if (nav && navBtn && navPanel) register(nav, navBtn, navPanel, "nav--open");

  if (!menus.length) return;

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    menus.forEach(function (menu) {
      if (menu.root.classList.contains(menu.openClass)) {
        setOpen(menu, false, false);
        menu.btn.focus();
      }
    });
  });

  document.addEventListener("click", function (event) {
    menus.forEach(function (menu) {
      if (menu.root.classList.contains(menu.openClass) && !menu.root.contains(event.target)) {
        setOpen(menu, false, false);
      }
    });
  });
})();

/* Public pages: someone who already has a session should be offered their
   workspace, not another sign-in prompt. */
(function () {
  var token = "";
  try { token = sessionStorage.getItem("expense_token") || ""; } catch (err) { return; }
  if (!token) return;
  document.querySelectorAll('a[href="/auth/google"]').forEach(function (link) {
    link.setAttribute("href", "/app");
    link.textContent = link.classList.contains("nav-cta") ? "Open workspace" : "Workspace";
  });
})();

/* Reveal-on-scroll for landing sections marked `.reveal`. They render fully
   without this - the class only adds an entrance, once, so a viewer with JS
   off or reduced motion on still sees the finished page. */
(function () {
  var targets = document.querySelectorAll(".reveal");
  if (!targets.length || typeof IntersectionObserver !== "function") return;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
  targets.forEach(function (el) { observer.observe(el); });
})();
