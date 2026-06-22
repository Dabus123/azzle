(function () {
  "use strict";

  let refreshTimer = null;

  const $ = (id) => document.getElementById(id);

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

  function renderRows(tasks) {
    const tbody = $("rd-market-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks
      .map(
        (t) =>
          "<tr>" +
          "<td><span class=\"rd-market-id\">#" +
          t.id +
          "</span></td>" +
          "<td>" +
          fmtUsdc(t.budgetUsdc) +
          " USDC</td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          (t.poster || "") +
          "\">" +
          shortAddr(t.poster) +
          "</span></td>" +
          "<td>" +
          fmtAgo(t.createdAt) +
          "</td>" +
          "</tr>"
      )
      .join("");
  }

  async function loadTasks() {
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
        return;
      }

      renderRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      if (foot) foot.hidden = false;
      setStatus(
        tasks.length + " open task" + (tasks.length === 1 ? "" : "s") + " on Base.",
        "ok"
      );
    } catch (e) {
      setStatus((e && e.message) || "Could not load open tasks", "err");
    }
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadTasks, 45000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("rd-market-refresh")?.addEventListener("click", loadTasks);
    loadTasks();
    scheduleRefresh();
  });
})();
