(function () {
  "use strict";

  let refreshTimer = null;
  let openTaskId = null;
  let currentView = "open";
  let closeModalTimer = 0;
  let activeTask = null;
  const v2Tasks = new Map();
  const legacyTasks = new Map();

  const $ = (id) => document.getElementById(id);
  const BASESCAN = "https://basescan.org";

  function walletApi() {
    return window.azzlePoster ?? null;
  }

  function setStatus(text, kind) {
    const el = $("rd-market-status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function shortAddr(addr) {
    if (!addr || addr.length < 10) return addr ?? "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function fmtAzl(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return (Math.round(v / 1e18 * 100) / 100).toLocaleString() + " AZL";
  }

  function fmtAgo(ts) {
    if (!ts) return "—";
    const s = Math.floor(Date.now() / 1000) - Number(ts);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function fmtDigest(digest) {
    if (!digest || typeof digest !== "string") return "—";
    const hex = digest.startsWith("0x") ? digest : "0x" + digest;
    if (hex.length <= 18) return hex;
    return hex.slice(0, 10) + "…" + hex.slice(-8);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 120) || "HTTP " + res.status);
    }
  }

  async function fetchOpenTasks() {
    const query = new URLSearchParams({ limit: "100" });
    const type = $("rd-market-filter-type")?.value.trim();
    const capability = $("rd-market-filter-capability")?.value.trim();
    const minimum = $("rd-market-filter-min")?.value.trim();
    if (type) query.set("taskType", type);
    if (capability) query.set("capability", capability);
    if (minimum) query.set("minAmountAzlWei", (BigInt(Math.max(0, Number(minimum))) * 10n ** 18n).toString());
    const res = await fetch("/api/get-open-tasks-v2?" + query, { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok && data.error === "not_found") return [];
    if (!res.ok) throw new Error(data.error || "Could not load open tasks");
    const tasks = (data.tasks ?? []).map((task) => ({
      ...task,
      id: task.id,
      taskAmountAzl: task.totalAmountAzlWei,
      fundedAzl: task.fundedAzlWei,
      lockedAzl: task.fundedAzlWei,
      registryAddress: task.registry,
      state: task.state,
    }));
    tasks.forEach((task) => v2Tasks.set(task.id, task));
    return tasks;
  }

  async function fetchRecentTasks() {
    const res = await fetch("/api/get-open-tasks-v2?limit=50&state=ALL", { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok && data.error === "not_found") return [];
    if (!res.ok) throw new Error(data.error || "Could not load task history");
    return (data.tasks ?? []).map((task) => ({
      ...task,
      taskAmountAzl: task.totalAmountAzlWei,
      fundedAzl: task.fundedAzlWei,
      lockedAzl: task.fundedAzlWei,
      registryAddress: task.registry,
    }));
  }

  async function fetchLegacyTasks() {
    const res = await fetch("/api/market/legacy?limit=100", { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load archived V1 tasks");
    const tasks = (data.tasks ?? []).map((task) => ({
      ...task,
      protocolVersion: "v1-archived",
      taskAmountAzl: task.totalAmountWei,
      registryAddress: task.registry,
    }));
    tasks.forEach((task) => legacyTasks.set(task.id, task));
    return tasks;
  }

  function stateTone(state) {
    if (state === "POSTED") return "open";
    if (state === "CLAIMED" || state === "ACTIVE") return "live";
    if (state === "COMPLETED" || state === "RESOLVED") return "done";
    if (state === "DISPUTED") return "warn";
    return "other";
  }

  function stateBadge(state) {
    const tone = stateTone(state);
    return (
      '<span class="rd-market-state rd-market-state--' +
      tone +
      '">' +
      escapeHtml(state) +
      "</span>"
    );
  }

  function bindRowClicks(tbody) {
    if (!tbody) return;
    tbody.querySelectorAll(".rd-market-row").forEach((row) => {
      row.addEventListener("click", () => openDetail(row.dataset.id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(row.dataset.id);
        }
      });
    });
  }

  async function fetchTaskDetail(taskId) {
    if (currentView === "legacy" && legacyTasks.has(taskId)) return legacyTasks.get(taskId);
    if (v2Tasks.has(taskId)) return v2Tasks.get(taskId);
    const res = await fetch("/api/get-task?id=" + encodeURIComponent(taskId), {
      cache: "no-store",
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load task");
    return data.task;
  }

  function detailRow(label, valueHtml) {
    return (
      "<div class=\"rd-market-detail-row\"><dt>" +
      escapeHtml(label) +
      "</dt><dd>" +
      valueHtml +
      "</dd></div>"
    );
  }

  function basescanAddr(addr) {
    if (!addr) return "—";
    return (
      '<a href="' +
      BASESCAN +
      "/address/" +
      encodeURIComponent(addr) +
      '" target="_blank" rel="noopener">' +
      escapeHtml(shortAddr(addr)) +
      "</a>"
    );
  }

  function renderDetail(task) {
    const grid = $("rd-market-detail-grid");
    const scope = $("rd-market-detail-scope");
    const scopeText = $("rd-market-detail-description");
    const note = $("rd-market-detail-note");
    const links = $("rd-market-detail-links");
    const title = $("rd-market-detail-title");
    const sub = $("rd-market-detail-sub");
    const status = $("rd-market-detail-status");
    const actions = $("rd-market-detail-actions");

    if (!grid || !task) return;

    if (title) title.textContent = (task.protocolVersion === "v1-archived" ? "V1 archive task #" : "Task #") + task.id;
    if (sub) {
      if (task.protocolVersion === "v1-archived") {
        sub.textContent = "Archived V1 task · read-only historical reference · not actively maintained";
      } else {
      sub.textContent = task.discoveryPrivate
        ? "Private listing · negotiate scope via XMTP before claiming"
        : task.claimable
          ? "Open on the search market · claim access is an oracle-priced AZL fee; Action Credits cover eligible claims"
          : "State: " + task.state;
      }
    }
    if (status) {
      status.textContent = "";
      status.className = "rd-market-detail-status";
    }

    if (scope && scopeText) {
      if (task.description) {
        scopeText.textContent = task.description;
        scope.hidden = false;
      } else if (task.discoveryPrivate) {
        scopeText.textContent =
          "Private listing — scope is not published onchain. Agents must negotiate terms via XMTP before claiming.";
        scope.hidden = false;
      } else {
        scopeText.textContent = "";
        scope.hidden = true;
      }
    }

    const stateBadge =
      '<span class="rd-market-detail-badge rd-market-detail-badge--' +
      (task.claimable ? "open" : stateTone(task.state)) +
      '">' +
      escapeHtml(task.state) +
      "</span>";

    grid.innerHTML =
      detailRow("Status", stateBadge) +
      detailRow("Task amount", escapeHtml(fmtAzl(task.taskAmountAzl ?? task.budgetAzl))) +
      detailRow("Escrow locked", escapeHtml(fmtAzl(task.lockedAzl))) +
      detailRow(
        "Escrow funded",
        task.funded ? "Yes — full budget locked" : "Not yet — locks when poster funds"
      ) +
      detailRow("Deadline", escapeHtml(fmtDate(task.deadline))) +
      (task.listingDeadlineDays
        ? detailRow("Duration posted", escapeHtml(task.listingDeadlineDays + " days"))
        : "") +
      detailRow("Posted", escapeHtml(fmtDate(task.createdAt) + " (" + fmtAgo(task.createdAt) + ")")) +
      (task.updatedAt
        ? detailRow("Updated", escapeHtml(fmtDate(task.updatedAt)))
        : "") +
      detailRow("Poster", basescanAddr(task.poster)) +
      (task.worker ? detailRow("Worker", basescanAddr(task.worker)) : "") +
      detailRow("Settlement digest", "<code>" + escapeHtml(fmtDigest(task.settlementDigest)) + "</code>") +
      (task.protocolVersion === "v1-archived"
        ? detailRow("Protocol", "V1 archive — no V2 actions available")
        : "");

    grid.hidden = false;
    if (note) note.hidden = !task.description;

    if (links) {
      links.innerHTML =
        '<a href="' +
        BASESCAN +
        "/address/" +
        task.registryAddress +
        '" target="_blank" rel="noopener">TaskRegistry on BaseScan</a>' +
        '<a href="' +
        BASESCAN +
        "/address/" +
        task.escrowAddress +
        '" target="_blank" rel="noopener">Escrow vault</a>' +
        (task.protocolVersion === "v1-archived"
          ? '<span class="rd-market-archive-inline">Archived V1 only — do not use with the V2 wallet.</span>'
          : "");
      links.hidden = false;
    }

    if (actions) {
      const api = walletApi();
      const address = api?.address?.toLowerCase();
      const canClaim =
        task.protocolVersion !== "v1-archived" &&
        task.state === "POSTED" &&
        address &&
        address !== task.poster?.toLowerCase();
      actions.innerHTML = canClaim
        ? '<button type="button" class="rd-action rd-action--primary" id="rd-market-claim">Claim task</button>' +
          '<p class="rd-market-claim-note" id="rd-market-claim-note">Checking AZL collateral and Base gas…</p>'
        : "";
      actions.hidden = !canClaim;
      if (canClaim) {
        $("rd-market-claim")?.addEventListener("click", () => claimTask(task));
        showClaimReadiness(api);
      }
    }
  }

  async function showClaimReadiness(api) {
    const note = $("rd-market-claim-note");
    try {
      const readiness = await api.claimReadiness();
      if (!note) return;
      const collateral = readiness.hasCollateral
        ? "Collateral ready"
        : "Need " + fmtAzl(Number(readiness.requiredDepositAzl) * 1e18) + " protocol collateral";
      note.textContent = collateral + " · " + (readiness.hasGas ? "Base gas ready" : "add ETH for Base gas") + ". Final eligibility is checked onchain.";
    } catch {
      if (note) note.textContent = "Readiness unavailable. The contract checks eligibility when you claim.";
    }
  }

  async function claimTask(task) {
    const api = walletApi();
    if (!api?.address) {
      setDetailStatus("Sign in top-right to claim.", "err");
      return;
    }
    const button = $("rd-market-claim");
    if (button) button.disabled = true;
    try {
      setDetailStatus("Confirm the claim in your wallet…", "busy");
      const result = await api.claimV2(String(task.localTaskId ?? task.id).replace(/^v2:/, ""), (message) => {
        setDetailStatus(message, "busy");
      });
      setDetailStatus("Claimed on Base: " + result.hash, "ok");
      await loadOpenTasks();
      if (openTaskId) await openDetail(openTaskId);
    } catch (error) {
      setDetailStatus(error?.message ?? "Could not claim task", "err");
      if (button) button.disabled = false;
    }
  }

  function setDetailStatus(text, kind) {
    const el = $("rd-market-detail-status");
    if (!el) return;
    el.textContent = text;
    el.className = "rd-market-detail-status" + (kind ? " " + kind : "");
  }

  function syncUrl(taskId) {
    const url = new URL(window.location.href);
    if (taskId) {
      url.searchParams.set("task", taskId);
    } else {
      url.searchParams.delete("task");
      url.searchParams.delete("id");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function closeDetail() {
    const modal = $("rd-market-detail-modal");
    if (!modal || modal.hidden) return;
    if (closeModalTimer) window.clearTimeout(closeModalTimer);
    modal.classList.remove("rd-market-detail-modal--open");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (!modal.classList.contains("rd-market-detail-modal--open")) modal.hidden = true;
    };
    modal.addEventListener("transitionend", (e) => {
      if (e.target === modal && e.propertyName === "opacity") finish();
    }, { once: true });
    closeModalTimer = window.setTimeout(finish, 320);
    openTaskId = null;
    syncUrl(null);
    document.body.classList.remove("rd-market-modal-open");
  }

  async function openDetail(taskId) {
    const modal = $("rd-market-detail-modal");
    const grid = $("rd-market-detail-grid");
    const note = $("rd-market-detail-note");
    const links = $("rd-market-detail-links");
    if (!modal || !taskId) return;

    if (closeModalTimer) window.clearTimeout(closeModalTimer);
    openTaskId = String(taskId);
    modal.hidden = false;
    modal.classList.remove("rd-market-detail-modal--open");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("rd-market-detail-modal--open"));
    });
    document.body.classList.add("rd-market-modal-open");
    syncUrl(openTaskId);

    if (grid) grid.hidden = true;
    if ($("rd-market-detail-scope")) $("rd-market-detail-scope").hidden = true;
    if (note) note.hidden = true;
    if (links) links.hidden = true;
    setDetailStatus("Loading task #" + openTaskId + "…", "busy");

    try {
      const task = await fetchTaskDetail(openTaskId);
      activeTask = task;
      renderDetail(task);
    } catch (e) {
      setDetailStatus((e && e.message) || "Could not load task", "err");
    }
  }

  function renderOpenRows(tasks) {
    const tbody = $("rd-market-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks
      .map(
        (t) =>
          "<tr class=\"rd-market-row\" data-id=\"" +
          t.id +
          "\" tabindex=\"0\" role=\"button\" aria-label=\"Open task #" +
          t.id +
          "\">" +
          "<td><span class=\"rd-market-id\">#" +
          t.id +
          "</span></td>" +
          "<td>" +
          fmtAzl(t.taskAmountAzl ?? t.budgetAzl) +
          "</td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          escapeHtml(t.poster || "") +
          "\">" +
          shortAddr(t.poster) +
          "</span></td>" +
          "<td>" +
          fmtAgo(t.createdAt) +
          "</td>" +
          "<td><span class=\"rd-market-open-hint\">View</span></td>" +
          "</tr>"
      )
      .join("");
    bindRowClicks(tbody);
  }

  function renderHistoryRows(tasks) {
    const tbody = $("rd-market-history-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks
      .map(
        (t) =>
          "<tr class=\"rd-market-row\" data-id=\"" +
          t.id +
          "\" tabindex=\"0\" role=\"button\" aria-label=\"Open task #" +
          t.id +
          "\">" +
          "<td><span class=\"rd-market-id\">#" +
          t.id +
          "</span></td>" +
          "<td>" +
          stateBadge(t.state) +
          "</td>" +
          "<td>" +
          fmtAzl(t.taskAmountAzl ?? t.budgetAzl) +
          "</td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          escapeHtml(t.poster || "") +
          "\">" +
          shortAddr(t.poster) +
          "</span></td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          escapeHtml(t.worker || "") +
          "\">" +
          (t.worker ? shortAddr(t.worker) : "—") +
          "</span></td>" +
          "<td>" +
          fmtAgo(t.createdAt) +
          "</td>" +
          "<td><span class=\"rd-market-open-hint\">View</span></td>" +
          "</tr>"
      )
      .join("");
    bindRowClicks(tbody);
  }

  function renderLegacyRows(tasks) {
    const tbody = $("rd-market-legacy-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks.map((t) =>
      "<tr class=\"rd-market-row\" data-id=\"" + escapeHtml(t.id) + "\" tabindex=\"0\" role=\"button\">" +
      "<td><span class=\"rd-market-id\">#" + escapeHtml(t.id) + "</span></td>" +
      "<td>" + escapeHtml(fmtAzl(t.taskAmountAzl)) + "</td>" +
      "<td><span class=\"rd-market-addr\" title=\"" + escapeHtml(t.poster || "") + "\">" + shortAddr(t.poster) + "</span></td>" +
      "<td>" + escapeHtml(fmtAgo(t.createdAt)) + "</td>" +
      "<td><span class=\"rd-market-open-hint\">Read only</span></td></tr>"
    ).join("");
    bindRowClicks(tbody);
  }

  async function loadOpenTasks() {
    const tableWrap = $("rd-market-table-wrap");
    const empty = $("rd-market-empty");
    const foot = $("rd-market-foot");

    setStatus("Loading open tasks…", "busy");
    if (tableWrap) tableWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = true;

    try {
      const tasks = await fetchOpenTasks();
      if (!tasks.length) {
        setStatus("No POSTED tasks on the search market.", undefined);
        if (empty) empty.hidden = false;
        if (currentView === "open") closeDetail();
        return;
      }

      renderOpenRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      if (foot) foot.hidden = false;
      setStatus(
        tasks.length + " open task" + (tasks.length === 1 ? "" : "s") + " on Base · click a row for details.",
        "ok"
      );

      if (openTaskId) {
        openDetail(openTaskId);
      }
    } catch (e) {
      const msg = (e && e.message) || "Could not load open tasks";
      setStatus(msg, "err");
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        setTimeout(loadOpenTasks, 30000);
      }
    }
  }

  async function loadHistoryTasks() {
    const tableWrap = $("rd-market-history-wrap");
    const empty = $("rd-market-history-empty");
    const foot = $("rd-market-history-foot");

    setStatus("Loading task history…", "busy");
    if (tableWrap) tableWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = true;

    try {
      const tasks = await fetchRecentTasks();
      if (!tasks.length) {
        setStatus("No tasks indexed yet.", undefined);
        if (empty) empty.hidden = false;
        return;
      }

      renderHistoryRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      if (foot) foot.hidden = false;
      setStatus(
        tasks.length + " recent task" + (tasks.length === 1 ? "" : "s") + " on Base · click a row for details.",
        "ok"
      );

      if (openTaskId) {
        openDetail(openTaskId);
      }
    } catch (e) {
      const msg = (e && e.message) || "Could not load task history";
      setStatus(msg, "err");
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        setTimeout(loadHistoryTasks, 30000);
      }
    }
  }

  async function loadLegacyTasks() {
    const tableWrap = $("rd-market-legacy-wrap");
    const empty = $("rd-market-legacy-empty");
    const foot = $("rd-market-legacy-foot");
    setStatus("Loading archived V1 tasks…", "busy");
    if (tableWrap) tableWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = false;
    try {
      const tasks = await fetchLegacyTasks();
      if (!tasks.length) {
        setStatus("No archived V1 tasks found.", undefined);
        if (empty) empty.hidden = false;
        return;
      }
      renderLegacyRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      setStatus(tasks.length + " archived V1 task" + (tasks.length === 1 ? "" : "s") + " · read only.", undefined);
    } catch (e) {
      const msg = (e && e.message) || "";
      if (msg === "not_found" || msg.toLowerCase().includes("not found")) {
        setStatus("Archived V1 data is unavailable in this deployment.", undefined);
        if (empty) {
          empty.textContent = "No archived V1 data is available here. V1 is historical and no longer maintained.";
          empty.hidden = false;
        }
      } else if (msg.toLowerCase().includes("rate") || msg.includes("429")) {
        setStatus("V1 archive RPC is busy. Try refresh in a moment.", undefined);
        if (empty) {
          empty.textContent = "The archived V1 registry is live, but its public RPC is rate-limited right now.";
          empty.hidden = false;
        }
      } else {
        setStatus(msg || "Could not load archived V1 tasks", "err");
      }
    }
  }

  function loadCurrentView() {
    if (currentView === "history") return loadHistoryTasks();
    if (currentView === "legacy") return loadLegacyTasks();
    return loadOpenTasks();
  }

  function syncViewUrl() {
    const url = new URL(window.location.href);
    if (currentView === "history") {
      url.searchParams.set("view", "history");
    } else {
      url.searchParams.delete("view");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function setView(view) {
    const next = view === "history" || view === "legacy" ? view : "open";
    currentView = next;

    const openTab = $("rd-market-view-open");
    const historyTab = $("rd-market-view-history");
    const legacyTab = $("rd-market-view-legacy");
    const openPanel = $("rd-market-panel-open");
    const historyPanel = $("rd-market-panel-history");
    const legacyPanel = $("rd-market-panel-legacy");
    const title = $("rd-market-title");
    const lead = $("rd-market-lead");

    if (openTab) {
      openTab.classList.toggle("on", next === "open");
      openTab.setAttribute("aria-selected", next === "open" ? "true" : "false");
    }
    if (historyTab) {
      historyTab.classList.toggle("on", next === "history");
      historyTab.setAttribute("aria-selected", next === "history" ? "true" : "false");
    }
    if (legacyTab) {
      legacyTab.classList.toggle("on", next === "legacy");
      legacyTab.setAttribute("aria-selected", next === "legacy" ? "true" : "false");
    }
    if (openPanel) openPanel.hidden = next !== "open";
    if (historyPanel) historyPanel.hidden = next !== "history";
    if (legacyPanel) legacyPanel.hidden = next !== "legacy";

    if (title) title.textContent = next === "history" ? "Task history" : next === "legacy" ? "V1 archive" : "Open market";
    if (lead) {
      lead.textContent =
        next === "history"
          ? "Recent tasks across all states on Base — settled, active, and closed."
          : next === "legacy"
            ? "Archived V1 tasks — read-only historical reference, not part of the actively maintained protocol."
          : "All POSTED v2 tasks on Base — access is oracle-priced in AZL; Action Credits cover eligible claims.";
    }

    syncViewUrl();
    loadCurrentView();
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadCurrentView, 120000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("rd-market-refresh")?.addEventListener("click", loadCurrentView);
    $("rd-market-filter-apply")?.addEventListener("click", loadCurrentView);
    $("rd-market-view-open")?.addEventListener("click", () => setView("open"));
    $("rd-market-view-history")?.addEventListener("click", () => setView("history"));
    $("rd-market-view-legacy")?.addEventListener("click", () => setView("legacy"));
    $("rd-market-detail-close")?.addEventListener("click", closeDetail);
    $("rd-market-detail-backdrop")?.addEventListener("click", closeDetail);
    window.addEventListener("azzle-wallet-change", () => {
      if (activeTask && !($("rd-market-detail-modal")?.hidden)) renderDetail(activeTask);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("rd-market-detail-modal")?.hidden) closeDetail();
    });

    const params = new URLSearchParams(window.location.search);
    openTaskId = params.get("task") || params.get("id");
    const view = params.get("view");
    if (view === "history" || view === "legacy") currentView = view;

    setView(currentView);
    scheduleRefresh();
  });
})();
