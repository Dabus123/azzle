(function () {
  "use strict";

  let refreshTimer = null;
  let openTaskId = null;
  let currentView = "open";

  const $ = (id) => document.getElementById(id);
  const BASESCAN = "https://basescan.org";

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

  function fmtUsdc(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return "$" + (Math.round(v * 100) / 100).toLocaleString();
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
    const res = await fetch("/api/get-open-tasks?limit=100", { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load open tasks");
    return data.tasks ?? [];
  }

  async function fetchRecentTasks() {
    const res = await fetch("/api/get-recent-tasks?limit=50", { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load task history");
    return data.tasks ?? [];
  }

  function stateTone(state) {
    if (state === "POSTED") return "open";
    if (state === "CLAIMED" || state === "ACTIVE" || state === "IN_REVIEW") return "live";
    if (state === "COMPLETED" || state === "RESOLVED") return "done";
    if (state === "DISPUTED" || state === "PAUSED") return "warn";
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

    if (!grid || !task) return;

    if (title) title.textContent = "Task #" + task.id;
    if (sub) {
      sub.textContent = task.discoveryPrivate
        ? "Private listing · negotiate scope via XMTP before claiming"
        : task.claimable
          ? "Open on the search market · claim costs $5 USDC + 1,000 AZL"
          : "State: " + task.state;
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
      detailRow("Budget", escapeHtml(fmtUsdc(task.budgetUsdc) + " USDC")) +
      detailRow("Escrow locked", escapeHtml(fmtUsdc(task.lockedUsdc) + " USDC")) +
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
      detailRow("Settlement digest", "<code>" + escapeHtml(fmtDigest(task.settlementDigest)) + "</code>");

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
        '" target="_blank" rel="noopener">Escrow vault</a>';
      links.hidden = false;
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
    if (modal) modal.hidden = true;
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

    openTaskId = String(taskId);
    modal.hidden = false;
    document.body.classList.add("rd-market-modal-open");
    syncUrl(openTaskId);

    if (grid) grid.hidden = true;
    if ($("rd-market-detail-scope")) $("rd-market-detail-scope").hidden = true;
    if (note) note.hidden = true;
    if (links) links.hidden = true;
    setDetailStatus("Loading task #" + openTaskId + "…", "busy");

    try {
      const task = await fetchTaskDetail(openTaskId);
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
          fmtUsdc(t.budgetUsdc) +
          " USDC</td>" +
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
          fmtUsdc(t.budgetUsdc) +
          " USDC</td>" +
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

  function loadCurrentView() {
    if (currentView === "history") return loadHistoryTasks();
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
    const next = view === "history" ? "history" : "open";
    currentView = next;

    const openTab = $("rd-market-view-open");
    const historyTab = $("rd-market-view-history");
    const openPanel = $("rd-market-panel-open");
    const historyPanel = $("rd-market-panel-history");
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
    if (openPanel) openPanel.hidden = next !== "open";
    if (historyPanel) historyPanel.hidden = next !== "history";

    if (title) title.textContent = next === "history" ? "Task history" : "Open market";
    if (lead) {
      lead.textContent =
        next === "history"
          ? "Recent tasks across all states on Base — settled, active, and closed."
          : "All POSTED tasks on Base — claimable on the search market. Claim costs $5 USDC + 1,000 AZL.";
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
    $("rd-market-view-open")?.addEventListener("click", () => setView("open"));
    $("rd-market-view-history")?.addEventListener("click", () => setView("history"));
    $("rd-market-detail-close")?.addEventListener("click", closeDetail);
    $("rd-market-detail-backdrop")?.addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("rd-market-detail-modal")?.hidden) closeDetail();
    });

    const params = new URLSearchParams(window.location.search);
    openTaskId = params.get("task") || params.get("id");
    const view = params.get("view");
    if (view === "history") currentView = "history";

    setView(currentView);
    scheduleRefresh();
  });
})();
