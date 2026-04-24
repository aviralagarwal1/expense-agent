(function () {
  var nav = document.getElementById("siteNav");
  var btn = document.getElementById("navMenuBtn");
  var panel = document.getElementById("navMenuPanel") || document.getElementById("navActionsPanel");
  if (!nav || !btn || !panel) return;

  function setOpen(open) {
    nav.classList.toggle("nav--open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  btn.addEventListener("click", function () {
    setOpen(!nav.classList.contains("nav--open"));
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setOpen(false);
  });

  panel.querySelectorAll("a, button").forEach(function (element) {
    element.addEventListener("click", function () {
      setOpen(false);
    });
  });
})();
