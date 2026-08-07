(function () {
  const widgets = document.querySelectorAll("[data-azl-nav-ticker]");
  if (!widgets.length) return;

  function price(value) {
    if (!Number.isFinite(Number(value))) return "—";
    return "$" + Number(value).toLocaleString(undefined, {
      minimumSignificantDigits: 5,
      maximumSignificantDigits: 6,
    });
  }

  function render(data) {
    const healthy = data?.oracle?.azlPerEth && Number(data.oracle.azlPerEth) > 0;
    for (const widget of widgets) {
      widget.querySelector("[data-azl-nav-price]").textContent = price(data?.market?.priceUsd);
      widget.dataset.oracle = healthy ? "healthy" : "unavailable";
      widget.title = healthy
        ? "AZL market price · Oracle healthy · Open $AZL"
        : "AZL market price · Oracle status unavailable · Open $AZL";
    }
  }

  fetch("/api/azl/market", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("market unavailable")))
    .then(render)
    .catch(() => {
      for (const widget of widgets) {
        widget.dataset.oracle = "unavailable";
        widget.title = "AZL market data unavailable · Open $AZL";
      }
    });
})();
