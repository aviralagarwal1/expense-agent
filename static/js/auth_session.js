(function () {
  function clearExpenseSessionStorage() {
    sessionStorage.removeItem("expense_token");
    sessionStorage.removeItem("expense_refresh_token");
  }

  window.clearExpenseSessionStorage = clearExpenseSessionStorage;
  window.doLogout = function doLogout() {
    clearExpenseSessionStorage();
    window.location.href = "/app";
  };
})();
