(function () {
  const $ = (id) => document.getElementById(id);
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
  const numeric = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  function usd(value) {
    if (!Number.isFinite(Number(value))) return "—";
    const n = Number(value);
    return n < 0.01
      ? "$" + n.toLocaleString(undefined, { minimumSignificantDigits: 2, maximumSignificantDigits: 4 })
      : "$" + numeric.format(n);
  }

  function preciseUsd(value) {
    const raw = String(value ?? "").trim();
    if (!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw)) return "—";
    if (/e/i.test(raw)) return "$" + Number(raw).toLocaleString(undefined, {
      minimumSignificantDigits: 6,
      maximumSignificantDigits: 8,
      useGrouping: false,
    });
    const [whole, fraction = ""] = raw.split(".");
    if (whole !== "0") return "$" + Number(raw).toLocaleString(undefined, { maximumFractionDigits: 6 });

    const firstSignificant = fraction.search(/[1-9]/);
    if (firstSignificant === -1) return "$0";
    const precision = Math.min(fraction.length, firstSignificant + 6);
    return "$0." + fraction.slice(0, precision);
  }

  function signedPercent(bps) {
    if (!Number.isFinite(Number(bps))) return "—";
    const percent = Number(bps) / 100;
    return (percent > 0 ? "+" : "") + percent.toFixed(2) + "%";
  }

  function setStatus(text, kind) {
    const status = $("azl-status");
    status.textContent = text;
    status.className = "rd-checkout-status" + (kind ? " " + kind : "");
  }

  function shortAddress(address) {
    return address.slice(0, 8) + "…" + address.slice(-6);
  }

  function setLink(id, href) {
    const link = $(id);
    if (href) link.href = href;
  }

  function duration(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    if (seconds < 60) return seconds + "s";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m";
    return (seconds / 3600).toFixed(1) + "h";
  }

  function renderOracle(oracle) {
    const hasQuote = Number(oracle?.azlPerEth) > 0;
    const health = hasQuote ? "Healthy" : oracle?.valid === false ? "Unavailable" : "Unknown";
    $("azl-oracle-health").textContent = health;
    const observation = oracle?.observation;
    const gates = [
      hasQuote ? compact.format(Number(oracle.azlPerEth)) + " AZL / ETH" : "AZL/ETH quote unavailable",
      oracle?.valid === true ? "USD oracle valid" : oracle?.valid === false ? "USD oracle unavailable" : "USD oracle unknown",
      observation?.fresh === true ? "observation fresh" : observation?.fresh === false ? "observation stale" : "observation unknown",
    ];
    $("azl-oracle-summary").textContent = gates.join(" · ");
    const reference = oracle?.referenceActivatedAt
      ? " Reference active since " + new Date(oracle.referenceActivatedAt * 1000).toLocaleString() + "."
      : "";
    const freshness = observation?.ageSeconds === null || observation?.ageSeconds === undefined
      ? "Latest observation timestamp unavailable; TWAP readiness remains the authoritative gate."
      : "Latest observation is " + duration(observation.ageSeconds) + " old; maximum permitted gap is " + duration(observation.maxObservationGapSeconds) + ".";
    $("azl-oracle-detail-title").textContent = hasQuote ? "Oracle validation is live" : "Oracle validation is unavailable";
    $("azl-oracle-detail").textContent = hasQuote
      ? "The live adapter quote is " + compact.format(Number(oracle.azlPerEth)) + " AZL per ETH. " + freshness + reference + "Become a keeper to help maintain the protocol's health."
      : freshness + reference + " The protocol fails closed for value-increasing actions when validation gates do not pass.";
    $("azl-oracle-usd-price").textContent = preciseUsd(oracle?.impliedPriceUsd);
    $("azl-oracle-price-precision").textContent = oracle?.azlPerEth && oracle?.ethUsd
      ? "Derived from " + preciseAzlPerEth(oracle.azlPerEth) + " AZL/ETH"
      : "AZL/ETH × Chainlink ETH/USD unavailable";
    $("azl-dex-usd-price").textContent = preciseUsd(oracle?.dexComparison?.dexPriceUsd);
    $("azl-dex-price-precision").textContent = oracle?.dexComparison?.dexPriceUsd
      ? "DexScreener spot"
      : "External pool price unavailable";
    $("azl-price-deviation").textContent = signedPercent(oracle?.dexComparison?.deviationBps);
  }

  function preciseAzlPerEth(value) {
    const raw = String(value ?? "").trim();
    if (!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw)) return "—";
    if (/e/i.test(raw)) return Number(raw).toLocaleString(undefined, {
      minimumSignificantDigits: 6,
      maximumSignificantDigits: 8,
      useGrouping: false,
    });
    const [whole, fraction = ""] = raw.split(".");
    if (whole !== "0") return Number(raw).toLocaleString(undefined, { maximumFractionDigits: 4 });

    const firstSignificant = fraction.search(/[1-9]/);
    if (firstSignificant === -1) return "0";
    return "0." + fraction.slice(0, Math.min(fraction.length, firstSignificant + 6));
  }

  async function refresh() {
    setStatus("Loading market data from Base…", "busy");
    $("azl-refresh").disabled = true;
    try {
      const res = await fetch("/api/azl/market", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load AZL market data.");

      const { token, market, oracle, errors } = data;
      $("azl-decimals").textContent = String(token.decimals);
      $("azl-contract").textContent = shortAddress(token.address);
      setLink("azl-contract", token.baseScanUrl);
      setLink("azl-basescan-link", token.baseScanUrl);
      $("azl-supply").textContent = token.totalSupply === null ? "Unavailable" : compact.format(Number(token.totalSupply)) + " AZL";

      if (market) {
        $("azl-price").textContent = usd(market.priceUsd);
        $("azl-liquidity").textContent = market.liquidityUsd === null ? "Unavailable" : usd(market.liquidityUsd);
        $("azl-price-source").textContent = "Source: " + market.source + " · " + new Date(market.updatedAt).toLocaleTimeString();
        setLink("azl-pair-link", market.dexScreenerUrl);
        setLink("azl-buy-link", market.dexScreenerUrl);
      } else {
        $("azl-price").textContent = "Unavailable";
        $("azl-liquidity").textContent = "Unavailable";
        $("azl-price-source").textContent = "No eligible Base market source responded";
      }
      renderOracle(oracle);

      const incomplete = [errors?.market, errors?.supply, errors?.oracle].filter(Boolean);
      setStatus(
        incomplete.length ? "Some live values are unavailable. Token details remain verified from Base." : "Live data refreshed.",
        incomplete.length ? "" : "ok"
      );
    } catch (error) {
      setStatus(error.message || "Could not load AZL market data.", "err");
      $("azl-oracle-usd-price").textContent = "Unavailable";
      $("azl-dex-usd-price").textContent = "Unavailable";
      $("azl-price-deviation").textContent = "Unavailable";
    } finally {
      $("azl-refresh").disabled = false;
    }
  }

  $("azl-refresh").addEventListener("click", refresh);
  refresh();
})();
