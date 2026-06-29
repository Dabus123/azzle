(function () {
  "use strict";

  const DRAFT_KEY = "azzle-task-draft";
  const TASK_ID_KEY = "azzle-last-task-id";
  const TIER_RANK = { free: 0, basic: 1, premium: 2, enterprise: 3 };

  let checkoutBusy = false;
  let walletAddress = null;
  let postingPlans = [];
  let currentQuota = null;
  let azlPreviews = {};

  const $ = (id) => document.getElementById(id);

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 120) || "HTTP " + res.status);
    }
  }

  function posterApi() {
    return window.azzlePoster ?? null;
  }

  function saveDraft(draft) {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  function loadDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {
      return null;
    }
  }

  function readDiscoveryOpen() {
    const open = document.querySelector('input[name="rd-discovery"]:checked');
    return open ? open.value === "open" : true;
  }

  function readDraftFromForm() {
    const text = ($("rd-task-scope")?.value ?? "").trim();
    return {
      scope: text,
      taskPrompt: text,
      budget: ($("rd-task-budget")?.value ?? "").trim(),
      days: parseInt($("rd-task-days")?.value ?? "7", 10),
      discoveryOpen: readDiscoveryOpen(),
    };
  }

  function syncFormFromDraft(draft) {
    if (!draft || !$("rd-checkout")) return;
    const text = (draft.taskPrompt || draft.scope || "").trim();
    if (text) $("rd-task-scope").value = text;
    if (draft.budget) $("rd-task-budget").value = draft.budget;
    if (draft.days) $("rd-task-days").value = draft.days;
    const mode = draft.discoveryOpen === false ? "private" : "open";
    const radio = document.querySelector('input[name="rd-discovery"][value="' + mode + '"]');
    if (radio) radio.checked = true;
  }

  function setCheckoutStatus(text, kind) {
    setPanelStatus("rd-checkout-status", text, kind);
  }

  function setPricingStatus(text, kind) {
    setPanelStatus("rd-pricing-status", text, kind);
  }

  function setPanelStatus(id, text, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function setStepState(step, state) {
    const el = document.querySelector('.rd-step[data-step="' + step + '"]');
    if (!el) return;
    el.classList.remove("done", "on");
    if (state) el.classList.add(state);
  }

  function formatQuotaLine(quota) {
    if (!quota) return "";
    if (quota.limit == null) return quota.plan + " · unlimited posts today";
    return quota.plan + " · " + quota.used + " / " + quota.limit + " posts today";
  }

  const DEFAULT_PLANS = [
    { id: "free", label: "Free", dailyLimit: 3, priceUsdc: 0, billing: "none", description: "3 tasks per day" },
    { id: "basic", label: "Basic", dailyLimit: 50, priceUsdc: 20, billing: "monthly", description: "50 tasks per day · $20 USDC/month" },
    { id: "premium", label: "Premium", dailyLimit: 300, priceUsdc: 60, billing: "monthly", description: "300 tasks per day · $60 USDC/month" },
    { id: "enterprise", label: "Enterprise", dailyLimit: null, priceUsdc: 5000, billing: "lifetime", description: "Unlimited · one-time $5,000 USDC" },
  ];

  async function loadSitePlans() {
    if (postingPlans.length) return postingPlans;
    try {
      const res = await fetch("/api/site-config", { cache: "no-store" });
      if (res.ok) {
        const cfg = await parseJsonResponse(res);
        postingPlans = cfg.postingPlans?.length ? cfg.postingPlans : DEFAULT_PLANS;
      } else {
        postingPlans = DEFAULT_PLANS;
      }
    } catch {
      postingPlans = DEFAULT_PLANS;
    }
    return postingPlans;
  }

  async function fetchQuota(address) {
    if (!address) return null;
    const res = await fetch("/api/get-posting-quota?address=" + encodeURIComponent(address), {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseJsonResponse(res);
  }

  async function checkCanPost(address) {
    const res = await fetch("/api/posting-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      const err = new Error(data.error || "Daily posting limit reached");
      err.quota = data.quota ?? null;
      throw err;
    }
    return data;
  }

  async function recordPostSuccess(address, taskId, txHash, task) {
    const res = await fetch("/api/posting-record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        taskId,
        txHash,
        description: task?.description,
        budgetUsdc: task?.budgetUsdc,
        deadlineDays: task?.deadlineDays,
        discoveryOpen: task?.discoveryOpen !== false,
      }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not record post");
    return data;
  }

  function renderPlanBar(quota) {
    const bar = $("rd-plan-bar");
    if (!bar) return;
    if (!quota || !walletAddress) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const nameEl = $("rd-plan-name");
    const usageEl = $("rd-plan-usage");
    const expiresEl = $("rd-plan-expires");
    if (nameEl) nameEl.textContent = quota.plan;
    if (usageEl) {
      usageEl.textContent =
        quota.limit == null ? "Unlimited today" : quota.remaining + " of " + quota.limit + " left today";
    }
    if (expiresEl) {
      if (quota.tierExpiresAt) {
        expiresEl.hidden = false;
        expiresEl.textContent = "Renews " + new Date(quota.tierExpiresAt).toLocaleDateString();
      } else if (quota.tier === "enterprise") {
        expiresEl.hidden = false;
        expiresEl.textContent = "Lifetime unlimited posting";
      } else {
        expiresEl.hidden = true;
      }
    }
  }

  function priceLabel(plan) {
    if (!plan.priceUsdc) return "Free";
    if (plan.billing === "lifetime") return "$" + plan.priceUsdc.toLocaleString() + " once";
    return "$" + plan.priceUsdc + "/mo";
  }

  function limitLabel(plan) {
    if (plan.dailyLimit == null) return "Unlimited / day";
    return plan.dailyLimit + " tasks / day";
  }

  function fmtAzlAmount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B AZL";
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M AZL";
    return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
  }

  async function loadAzlPreviews(plans) {
    const paid = (plans ?? []).filter((p) => p.priceUsdc > 0);
    const entries = await Promise.all(
      paid.map(async (p) => {
        try {
          const res = await fetch("/api/get-azl-preview?tier=" + encodeURIComponent(p.id), {
            cache: "no-store",
          });
          if (!res.ok) return [p.id, null];
          return [p.id, await parseJsonResponse(res)];
        } catch {
          return [p.id, null];
        }
      })
    );
    azlPreviews = Object.fromEntries(entries);
  }

  function upgradeButtonsHtml(tierId, plan) {
    const preview = azlPreviews[tierId];
    const azlHint = preview
      ? '<span class="rd-pricing-azl">' +
        fmtAzlAmount(preview.azlAmountFormatted ?? preview.azlAmount) +
        " (~$" +
        preview.discountedUsd +
        " · 10% off)</span>"
      : "";
    return (
      '<div class="rd-pricing-pay-row">' +
      '<button type="button" class="rd-action rd-action--primary rd-pricing-btn" data-tier="' +
      tierId +
      '" data-pay="usdc">' +
      (plan.billing === "lifetime"
        ? "Pay $5,000 USDC"
        : "Pay $" + plan.priceUsdc + " USDC") +
      "</button>" +
      '<button type="button" class="rd-action rd-pricing-btn rd-pricing-btn--azl" data-tier="' +
      tierId +
      '" data-pay="azl">Pay in AZL · 10% off</button>' +
      azlHint +
      "</div>"
    );
  }

  function renderPricingGrid(quota, plans) {
    const grid = $("rd-pricing-grid");
    if (!grid) return;

    const tier = quota?.tier ?? "free";
    const sorted = [...(plans ?? [])].sort(
      (a, b) => (TIER_RANK[a.id] ?? 0) - (TIER_RANK[b.id] ?? 0)
    );

    grid.innerHTML = sorted
      .map((p) => {
        const isCurrent = walletAddress && p.id === tier;
        const rank = TIER_RANK[p.id] ?? 0;
        const currentRank = TIER_RANK[tier] ?? 0;
        const canUpgrade = walletAddress && p.priceUsdc > 0 && rank > currentRank;
        let cta = "";
        if (isCurrent) {
          cta = '<span class="rd-pricing-badge">Current plan</span>';
        } else if (canUpgrade) {
          cta = upgradeButtonsHtml(p.id, p);
        } else if (!walletAddress && p.priceUsdc > 0) {
          cta = upgradeButtonsHtml(p.id, p);
        } else if (p.id === "free" && !walletAddress) {
          cta = '<span class="rd-pricing-hint">Default when signed in</span>';
        } else if (p.priceUsdc > 0 && rank <= currentRank) {
          cta = '<span class="rd-pricing-hint">Included in your plan</span>';
        }

        return (
          '<article class="rd-pricing-card' +
          (isCurrent ? " rd-pricing-card--current" : "") +
          '" data-tier="' +
          p.id +
          '">' +
          '<div class="rd-pricing-card-head">' +
          "<h6>" +
          p.label +
          "</h6>" +
          '<span class="rd-pricing-price">' +
          priceLabel(p) +
          "</span>" +
          "</div>" +
          '<p class="rd-pricing-limit">' +
          limitLabel(p) +
          "</p>" +
          "<p>" +
          p.description +
          "</p>" +
          cta +
          "</article>"
        );
      })
      .join("");

    grid.querySelectorAll(".rd-pricing-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        runUpgrade(btn.dataset.tier, setPricingStatus, btn.dataset.pay || "usdc").catch(() => {});
      });
    });
  }

  function renderUpgradeCards(quota, plans) {
    const section = $("rd-upgrade");
    const grid = $("rd-upgrade-grid");
    if (!section || !grid) return;

    const tier = quota?.tier ?? "free";
    const upgrades = (plans ?? []).filter(
      (p) => p.priceUsdc > 0 && (TIER_RANK[p.id] ?? 0) > (TIER_RANK[tier] ?? 0)
    );

    if (!walletAddress || !upgrades.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    grid.innerHTML = upgrades
      .map((p) => {
        const preview = azlPreviews[p.id];
        return (
          '<article class="rd-upgrade-card" data-tier="' +
          p.id +
          '">' +
          "<h6>" +
          p.label +
          "</h6>" +
          "<p>" +
          p.description +
          "</p>" +
          (preview
            ? '<p class="rd-pricing-azl">' +
              fmtAzlAmount(preview.azlAmountFormatted ?? preview.azlAmount) +
              " with AZL (10% off · ~$" +
              preview.discountedUsd +
              ")</p>"
            : "") +
          '<div class="rd-pricing-pay-row">' +
          '<button type="button" class="rd-action rd-upgrade-btn" data-tier="' +
          p.id +
          '" data-pay="usdc">Pay $' +
          p.priceUsdc +
          " USDC</button>" +
          '<button type="button" class="rd-action rd-action--primary rd-upgrade-btn rd-pricing-btn--azl" data-tier="' +
          p.id +
          '" data-pay="azl">Pay in AZL · 10% off</button>' +
          "</div></article>"
        );
      })
      .join("");

    grid.querySelectorAll(".rd-upgrade-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        runUpgrade(btn.dataset.tier, setCheckoutStatus, btn.dataset.pay || "usdc").catch(() => {});
      });
    });
  }

  async function refreshCheckout() {
    const panel = $("rd-checkout");
    if (!panel) return;

    const depositBtn = $("rd-btn-deposit");
    const postBtn = $("rd-btn-post");
    const api = posterApi();

    if (!api?.ready) {
      setStepState("signin", "on");
      setCheckoutStatus("Loading wallet…");
      if (depositBtn) depositBtn.disabled = true;
      if (postBtn) postBtn.disabled = true;
      renderPlanBar(null);
      renderUpgradeCards(null, postingPlans);
      return;
    }

    if (!walletAddress) {
      setStepState("signin", "on");
      setStepState("deposit", null);
      setStepState("post", null);
      setCheckoutStatus("Sign in (top right) to deposit and post.");
      if (depositBtn) depositBtn.disabled = true;
      if (postBtn) postBtn.disabled = true;
      renderPlanBar(null);
      renderUpgradeCards(null, postingPlans);
      return;
    }

    setStepState("signin", "done");
    await loadSitePlans();
    await loadAzlPreviews(postingPlans);

    try {
      currentQuota = await fetchQuota(walletAddress);
      renderPlanBar(currentQuota);
      renderUpgradeCards(currentQuota, postingPlans);

      const status = await api.getStatus();
      if (!status.configured) {
        setCheckoutStatus("Server missing contract config.", "err");
        if (depositBtn) depositBtn.disabled = true;
        if (postBtn) postBtn.disabled = true;
        return;
      }

      const lastTaskId = localStorage.getItem(TASK_ID_KEY) ?? "";
      const quotaLine = currentQuota ? formatQuotaLine(currentQuota) : "";
      const quotaBlocked = currentQuota && !currentQuota.canPost;

      if (status.depositReady) {
        setStepState("deposit", "done");
        setStepState("post", quotaBlocked ? null : "on");
        if (quotaBlocked) {
          setCheckoutStatus(
            "Daily limit reached (" + quotaLine + "). Upgrade at /pricing.",
            "err"
          );
        } else if (status.needsPostTopUp) {
          setCheckoutStatus(
            "$" +
              status.depositUsdc +
              " entry on file — listing debits $" +
              status.listingFeeUsdc +
              " from your deposit (+ 1,000 AZL). Post will top up $" +
              status.listingFeeUsdc +
              " automatically if needed.",
            undefined
          );
        } else if (status.canPost) {
          setCheckoutStatus(
            "Deposit on file ($" +
              status.depositUsdc +
              "). " +
              quotaLine +
              " · listing uses $5 + 1,000 AZL.",
            "ok"
          );
        } else {
          setCheckoutStatus("You need at least 1,000 AZL in your wallet to list a task.", "err");
        }
        if (depositBtn) {
          depositBtn.disabled = checkoutBusy;
          depositBtn.textContent = "Add USDC";
        }
        if (postBtn) {
          postBtn.disabled = checkoutBusy || quotaBlocked || (!status.canPost && !status.needsPostTopUp);
        }
      } else {
        setStepState("deposit", "on");
        setStepState("post", null);
        if (!status.canDeposit) {
          setCheckoutStatus(
            "Add $20 USDC on Base — you have $" + status.usdcWallet + " in your wallet.",
            "err"
          );
        } else {
          setCheckoutStatus(
            "One-time $20 USDC entry deposit on Base (wallet USDC: $" +
              status.usdcWallet +
              "). First listing also debits $5 from this deposit. " +
              (quotaLine || "Free: 3 posts/day."),
            undefined
          );
        }
        if (depositBtn) {
          depositBtn.disabled = checkoutBusy;
          depositBtn.textContent = "Deposit $20 USDC";
        }
        if (postBtn) postBtn.disabled = true;
      }

      if (lastTaskId) {
        setCheckoutStatus(
          "Task #" + lastTaskId + " posted. An agent will claim it — escrow locks when they do.",
          "ok"
        );
        setStepState("post", "done");
      }
    } catch (e) {
      setCheckoutStatus((e && e.message) || "Could not read wallet status", "err");
    }
  }

  function resolveDraft(override) {
    const fromForm = $("rd-checkout") ? readDraftFromForm() : null;
    const draft = override ?? (fromForm?.scope ? fromForm : null) ?? loadDraft();
    if (!draft?.scope && !draft?.taskPrompt) throw new Error("No task scope — start from the chat first.");
    const budgetUsdc = parseFloat(draft.budget);
    const deadlineDays = parseInt(draft.days, 10);
    if (!Number.isFinite(budgetUsdc) || budgetUsdc <= 0) throw new Error("Invalid budget in USDC.");
    if (!Number.isFinite(deadlineDays) || deadlineDays <= 0) throw new Error("Invalid deadline.");
    const description = (draft.taskPrompt || draft.scope || "").trim();
    if (!description) throw new Error("No task description — start from the chat first.");
    const discoveryOpen = draft.discoveryOpen !== false;
    return { description, budgetUsdc, deadlineDays, discoveryOpen };
  }

  async function runDeposit(onProgress) {
    const api = posterApi();
    if (!api || checkoutBusy) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    if (!walletAddress) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    checkoutBusy = true;
    if ($("rd-btn-deposit")) $("rd-btn-deposit").disabled = true;
    onProgress?.("Checking balance…", "busy");
    try {
      const result = await api.deposit((msg) => onProgress?.(msg, "busy"));
      if (result?.alreadyDeposited) {
        onProgress?.("Deposit already on file — you're ready to post.", "ok");
      } else {
        onProgress?.("USDC deposited.", "ok");
      }
      await refreshCheckout();
      return { ok: true };
    } catch (e) {
      onProgress?.((e && e.message) || "Deposit failed", "err");
      await refreshCheckout();
      return { ok: false };
    } finally {
      checkoutBusy = false;
    }
  }

  async function runPost(draftOverride, onProgress) {
    const api = posterApi();
    if (!api || checkoutBusy) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    if (!walletAddress) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }

    let task;
    try {
      task = resolveDraft(draftOverride);
    } catch (e) {
      onProgress?.((e && e.message) || "Invalid task details", "err");
      return { ok: false };
    }

    try {
      await checkCanPost(walletAddress);
    } catch (e) {
      const q = e.quota;
      const hint = q
        ? " (" + q.used + "/" + q.limit + " today on " + q.plan + ")"
        : "";
      onProgress?.(
        (e.message || "Daily limit reached") + hint + " — upgrade at /pricing.",
        "err"
      );
      return { ok: false };
    }

    saveDraft({
      scope: task.description,
      taskPrompt: task.description,
      budget: String(task.budgetUsdc),
      days: task.deadlineDays,
      discoveryOpen: task.discoveryOpen,
    });

    checkoutBusy = true;
    if ($("rd-btn-post")) $("rd-btn-post").disabled = true;
    onProgress?.("Confirm in your wallet…", "busy");
    try {
      const result = await api.postTask(task, (msg) => onProgress?.(msg, "busy"));
      await recordPostSuccess(walletAddress, result.taskId, result.hash, task);
      localStorage.setItem(TASK_ID_KEY, result.taskId);
      const scopeNote =
        task.discoveryOpen !== false && result.scopePublished
          ? " Scope published onchain."
          : task.discoveryOpen === false
            ? " Private listing — share scope via XMTP."
            : "";
      onProgress?.(
        "Posted · task #" + result.taskId + scopeNote + " Track it at /my-tasks.",
        "ok"
      );
      if ($("rd-checkout")) setStepState("post", "done");
      await refreshCheckout();
      return result;
    } catch (e) {
      onProgress?.((e && e.message) || "Post failed", "err");
      await refreshCheckout();
      return { ok: false };
    } finally {
      checkoutBusy = false;
    }
  }

  async function runUpgrade(tierId, onProgress, payWith) {
    const currency = payWith || "usdc";
    const api = posterApi();
    if (!api || checkoutBusy) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    if (!walletAddress) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }

    checkoutBusy = true;
    onProgress?.("Confirm payment in your wallet…", "busy");
    try {
      let quote = null;
      if (currency === "azl") {
        onProgress?.("Fetching live AZL price…", "busy");
        const qRes = await fetch(
          "/api/posting-quote?tier=" +
            encodeURIComponent(tierId) +
            "&address=" +
            encodeURIComponent(walletAddress) +
            "&payWith=azl",
          { cache: "no-store" }
        );
        quote = await parseJsonResponse(qRes);
        if (!qRes.ok) throw new Error(quote.error || "Could not quote AZL price");
        onProgress?.(
          "Pay " + fmtAzlAmount(quote.azlAmountFormatted ?? quote.azlAmount) + " (~$" + quote.discountedUsd + ")…",
          "busy"
        );
      }

      const payment = await api.payUpgrade(
        tierId,
        { payWith: currency, quote },
        (msg) => onProgress?.(msg, "busy")
      );

      const res = await fetch("/api/posting-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: walletAddress,
          tier: tierId,
          txHash: payment.hash,
          payWith: currency,
          quoteId: quote?.quoteId,
        }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || "Upgrade failed");
      currentQuota = data;
      onProgress?.("Upgraded to " + data.plan + ". " + formatQuotaLine(data), "ok");
      await refreshAll();
      return { ok: true, quota: data };
    } catch (e) {
      onProgress?.((e && e.message) || "Upgrade failed", "err");
      return { ok: false };
    } finally {
      checkoutBusy = false;
    }
  }

  async function refreshPricing() {
    const panel = $("rd-pricing");
    if (!panel) return;

    await loadSitePlans();
    await loadAzlPreviews(postingPlans);
    const api = posterApi();

    if (!api?.ready) {
      setPricingStatus("Loading wallet…");
      renderPlanBar(null);
      renderPricingGrid(null, postingPlans);
      return;
    }

    if (!walletAddress) {
      setPricingStatus("Sign in (top right) to see your plan and upgrade.");
      renderPlanBar(null);
      renderPricingGrid(null, postingPlans);
      return;
    }

    try {
      currentQuota = await fetchQuota(walletAddress);
      renderPlanBar(currentQuota);
      renderPricingGrid(currentQuota, postingPlans);
      if (currentQuota.tier === "enterprise") {
        setPricingStatus("You're on Enterprise — unlimited posting.", "ok");
      } else if (currentQuota.canPost) {
        setPricingStatus(formatQuotaLine(currentQuota) + " · pick a plan below to upgrade.", "ok");
      } else {
        setPricingStatus(
          "Daily limit reached (" + formatQuotaLine(currentQuota) + "). Upgrade below.",
          "err"
        );
      }
    } catch (e) {
      setPricingStatus((e && e.message) || "Could not load plan", "err");
    }
  }

  async function refreshAll() {
    await refreshCheckout();
    await refreshPricing();
  }

  function initPanel() {
    const draft = loadDraft();
    syncFormFromDraft(draft);
    loadSitePlans().then(() => refreshCheckout());

    $("rd-btn-deposit")?.addEventListener("click", () => {
      runDeposit(setCheckoutStatus).catch(() => {});
    });
    $("rd-btn-post")?.addEventListener("click", () => {
      runPost(null, setCheckoutStatus).catch(() => {});
    });

    ["rd-task-scope", "rd-task-budget", "rd-task-days"].forEach((id) => {
      $(id)?.addEventListener("change", () => saveDraft(readDraftFromForm()));
    });
    document.querySelectorAll('input[name="rd-discovery"]').forEach((el) => {
      el.addEventListener("change", () => saveDraft(readDraftFromForm()));
    });

    const params = new URLSearchParams(location.search);
    const action = params.get("action");
    refreshCheckout().then(() => {
      if (action === "deposit") runDeposit(setCheckoutStatus).catch(() => {});
      if (action === "post") runPost(null, setCheckoutStatus).catch(() => {});
    });
  }

  function initPricingPanel() {
    loadSitePlans().then(() => refreshPricing());
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    refreshAll();
  });
  window.addEventListener("azzle-poster-ready", () => refreshAll());

  window.AzzlePostCheckout = {
    saveDraft,
    loadDraft,
    runDeposit,
    runPost,
    runUpgrade,
    fetchQuota,
    formatQuotaLine,
    refreshCheckout,
    initPanel,
  };

  if ($("rd-checkout")) {
    document.addEventListener("DOMContentLoaded", initPanel);
  }
  if ($("rd-pricing")) {
    document.addEventListener("DOMContentLoaded", initPricingPanel);
  }
})();
