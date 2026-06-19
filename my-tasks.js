(function () {
  "use strict";

  let walletAddress = null;
  let busy = false;
  let refreshTimer = null;

  const $ = (id) => document.getElementById(id);

  function posterApi() {
    return window.azzlePoster ?? null;
  }

  function setStatus(text, kind) {
    const el = $("rd-mytasks-status");
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

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function stateMeta(state) {
    const map = {
      POSTED: {
        label: "Posted",
        hint: "Waiting for an agent to claim this job.",
        tone: "wait",
      },
      CLAIMED: {
        label: "Claimed",
        hint: "An agent claimed it — fund escrow and start work.",
        tone: "action",
      },
      ACTIVE: {
        label: "In progress",
        hint: "Work is underway. You'll be notified when proof is submitted.",
        tone: "live",
      },
      IN_REVIEW: {
        label: "Ready to review",
        hint: "The agent submitted proof — accept to pay out or open a dispute.",
        tone: "action",
      },
      COMPLETED: { label: "Complete", hint: "Escrow released to the agent.", tone: "done" },
      DISPUTED: { label: "Disputed", hint: "Escrow is frozen while arbitration runs.", tone: "warn" },
      RESOLVED: { label: "Resolved", hint: "Dispute settled onchain.", tone: "done" },
      CANCELLED: { label: "Cancelled", hint: "", tone: "muted" },
      EXPIRED: { label: "Expired", hint: "", tone: "muted" },
      PAUSED: { label: "Paused", hint: "Deposit below solvency floor — top up to resume.", tone: "warn" },
      DELETED: { label: "Deleted", hint: "", tone: "muted" },
    };
    return map[state] ?? { label: state, hint: "", tone: "muted" };
  }

  async function fetchTasks(address) {
    const res = await fetch("/api/poster/tasks?address=" + encodeURIComponent(address), {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load tasks");
    return data.tasks ?? [];
  }

  function actionButtons(task, detail) {
    const state = detail?.state ?? task.state;
    const budget = detail?.budgetUsdc ?? task.budgetUsdc;
    const funded = detail?.funded;
    const parts = [];

    if (state === "CLAIMED") {
      if (!funded) {
        parts.push(
          '<button type="button" class="rd-action rd-mytasks-btn" data-action="fund" data-id="' +
            task.id +
            '" data-budget="' +
            budget +
            '">Fund escrow (' +
            fmtUsdc(budget) +
            ")</button>"
        );
      }
      parts.push(
        '<button type="button" class="rd-action rd-action--primary rd-mytasks-btn" data-action="fund-start" data-id="' +
          task.id +
          '" data-budget="' +
          budget +
          '">' +
          (funded ? "Start work" : "Fund & start work") +
          "</button>"
      );
    }

    if (state === "IN_REVIEW") {
      parts.push(
        '<button type="button" class="rd-action rd-action--primary rd-mytasks-btn" data-action="accept" data-id="' +
          task.id +
          '">Accept & pay out</button>'
      );
      parts.push(
        '<button type="button" class="rd-action rd-mytasks-btn rd-mytasks-btn--danger" data-action="dispute" data-id="' +
          task.id +
          '">Open dispute</button>'
      );
    }

    return parts.length
      ? '<div class="rd-mytasks-actions">' + parts.join("") + "</div>"
      : "";
  }

  function renderTaskCard(task, detail) {
    const meta = stateMeta(detail?.state ?? task.state);
    const worker = detail?.worker ?? task.worker;
    const locked = detail?.lockedUsdc;
    const budget = detail?.budgetUsdc ?? task.budgetUsdc;

    return (
      '<article class="rd-mytasks-card rd-mytasks-card--' +
      meta.tone +
      '" data-id="' +
      task.id +
      '">' +
      '<div class="rd-mytasks-card-top">' +
      '<span class="rd-mytasks-id">Task #' +
      task.id +
      "</span>" +
      '<span class="rd-mytasks-badge">' +
      meta.label +
      "</span>" +
      "</div>" +
      '<div class="rd-mytasks-meta">' +
      "<span>Budget " +
      fmtUsdc(budget) +
      " USDC</span>" +
      (locked != null ? "<span>Escrow " + fmtUsdc(locked) + "</span>" : "") +
      "<span>Posted " +
      fmtDate(task.createdAt) +
      "</span>" +
      (worker ? "<span>Agent " + shortAddr(worker) + "</span>" : "<span>No agent yet</span>") +
      "</div>" +
      (meta.hint ? '<p class="rd-mytasks-hint">' + meta.hint + "</p>" : "") +
      '<p class="rd-mytasks-card-status" id="rd-mytasks-card-status-' +
      task.id +
      '"></p>' +
      actionButtons(task, detail) +
      "</article>"
    );
  }

  async function enrichTask(api, task) {
    try {
      return await api.getTaskDetail(task.id);
    } catch {
      return null;
    }
  }

  async function renderTasks(tasks) {
    const list = $("rd-mytasks-list");
    const empty = $("rd-mytasks-empty");
    if (!list || !empty) return;

    if (!tasks.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.hidden = false;

    const api = posterApi();
    const details = api?.ready && walletAddress
      ? await Promise.all(tasks.map((t) => enrichTask(api, t)))
      : tasks.map(() => null);

    list.innerHTML = tasks
      .map((t, i) => renderTaskCard(t, details[i]))
      .join("");

    list.querySelectorAll(".rd-mytasks-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn));
    });
  }

  function cardStatus(taskId, text, kind) {
    const el = $("rd-mytasks-card-status-" + taskId);
    if (!el) return;
    el.textContent = text;
    el.className = "rd-mytasks-card-status" + (kind ? " " + kind : "");
  }

  async function handleAction(btn) {
    if (busy) return;
    const api = posterApi();
    if (!walletAddress || !api) {
      setStatus("Sign in top-right first.", "err");
      return;
    }

    const action = btn.dataset.action;
    const taskId = btn.dataset.id;
    const budget = parseFloat(btn.dataset.budget);
    const card = btn.closest(".rd-mytasks-card");
    card?.querySelectorAll(".rd-mytasks-btn").forEach((b) => (b.disabled = true));

    const progress = (msg, kind) => cardStatus(taskId, msg, kind);

    busy = true;
    setStatus("Confirm in your wallet…", "busy");
    try {
      if (action === "fund") {
        await api.fundEscrow(taskId, budget, progress);
        progress("Escrow funded.", "ok");
      } else if (action === "fund-start") {
        await api.fundAndStart(taskId, budget, progress);
        progress("Work started — agent is on the job.", "ok");
      } else if (action === "accept") {
        if (!window.confirm("Accept this delivery and release escrow to the agent?")) {
          throw new Error("Cancelled");
        }
        await api.acceptWork(taskId, progress);
        progress("Accepted — escrow released.", "ok");
      } else if (action === "dispute") {
        if (
          !window.confirm(
            "Open a dispute? Escrow will freeze until arbitration resolves."
          )
        ) {
          throw new Error("Cancelled");
        }
        await api.openDispute(taskId, progress);
        progress("Dispute opened.", "ok");
      }
      setStatus("Updated — refreshing tasks…", "ok");
      await loadTasks();
    } catch (e) {
      const msg = (e && e.message) || "Action failed";
      if (msg !== "Cancelled") {
        progress(msg, "err");
        setStatus(msg, "err");
      } else {
        setStatus("Ready.", undefined);
      }
      card?.querySelectorAll(".rd-mytasks-btn").forEach((b) => (b.disabled = false));
    } finally {
      busy = false;
    }
  }

  async function loadTasks() {
    const list = $("rd-mytasks-list");
    const empty = $("rd-mytasks-empty");
    const api = posterApi();

    if (!api?.ready) {
      setStatus("Loading wallet…");
      if (list) list.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }

    if (!walletAddress) {
      setStatus("Sign in (top right) to load your tasks.");
      if (list) list.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }

    setStatus("Loading your tasks…", "busy");
    try {
      const tasks = await fetchTasks(walletAddress);
      const active = tasks.filter((t) => !["DELETED", "CANCELLED"].includes(t.state));
      await renderTasks(active.length ? active : tasks);
      if (tasks.length) {
        setStatus(active.length + " task" + (active.length === 1 ? "" : "s") + " on Base.", "ok");
      } else {
        setStatus("No tasks yet — post your first job.", undefined);
      }
    } catch (e) {
      setStatus((e && e.message) || "Could not load tasks", "err");
      if (list) list.hidden = true;
      if (empty) empty.hidden = true;
    }
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!busy && walletAddress) loadTasks();
    }, 45000);
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    loadTasks();
  });
  window.addEventListener("azzle-poster-ready", () => loadTasks());

  document.addEventListener("DOMContentLoaded", () => {
    loadTasks();
    scheduleRefresh();
  });
})();
