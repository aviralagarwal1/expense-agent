(function () {
  function clearExpenseSessionStorage() {
    sessionStorage.removeItem("compline_token");
    sessionStorage.removeItem("compline_refresh_token");
  }

  window.clearExpenseSessionStorage = clearExpenseSessionStorage;
  window.doLogout = function doLogout() {
    clearExpenseSessionStorage();
    window.location.href = "/app";
  };
})();
