(function () {
  "use strict";

  let address = null;
  let activeTask = null;
  let busy = false;
  const $ = (id) => document.getElementById(id);

  function api() { return window.azzlePoster ?? null; }
  function shortAddress(value) { return value ? value.slice(0, 6) + "…" + value.slice(-4) : "—"; }
  function formatAzl(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (Math.round(n / 1e18 * 100) / 100).toLocaleString() + " AZL" : "—";
  }
  function formatDate(value) {
    return value ? new Date(Number(value) * 1000).toLocaleString() : "—";
  }
  function status(text, kind) {
    const element = $("rd-mywork-status");
    element.textContent = text;
    element.className = "rd-checkout-status" + (kind ? " " + kind : "");
  }
  async function json(response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load work");
    return data;
  }
  function taskId(task) { return String(task.localTaskId ?? task.id).replace(/^v2:/, ""); }

  async function load() {
    if (!address) return;
    status("Loading your claimed tasks…", "busy");
    try {
      const response = await fetch("/api/get-open-tasks-v2?state=ALL&worker=" + encodeURIComponent(address) + "&limit=100", { cache: "no-store" });
      const tasks = (await json(response)).tasks ?? [];
      const list = $("rd-mywork-list");
      const empty = $("rd-mywork-empty");
      if (!tasks.length) {
        list.hidden = true; empty.hidden = false; status("No claimed tasks.", "ok"); return;
      }
      list.innerHTML = tasks.map(render).join("");
      list.hidden = false; empty.hidden = true;
      list.querySelectorAll("[data-deliver]").forEach((button) => button.addEventListener("click", () => {
        activeTask = tasks.find((task) => taskId(task) === button.dataset.deliver);
        openReceipt();
      }));
      status(tasks.length + " claimed task" + (tasks.length === 1 ? "" : "s") + " loaded.", "ok");
    } catch (error) {
      status(error.message ?? "Could not load work", "err");
    }
  }
  function render(task) {
    const funded = BigInt(task.fundedAzlWei ?? 0) === BigInt(task.totalAmountAzlWei ?? 0) && BigInt(task.totalAmountAzlWei ?? 0) > 0n;
    const delivered = Number(task.deliveredAt ?? 0) > 0;
    const canDeliver = task.state === "ACTIVE" && funded && !delivered && Number(task.deadline) >= Math.floor(Date.now() / 1000);
    const next = delivered ? "Waiting for poster settlement or dispute." :
      task.state === "CLAIMED" ? "Waiting for the poster to fully fund escrow." :
      canDeliver ? "Deliver the agreed artifact and notify the poster privately." :
      "No worker action is available right now.";
    return '<article class="rd-mytasks-card rd-mytasks-card--live">' +
      '<div class="rd-mytasks-card-top"><span class="rd-mytasks-id">Task #' + taskId(task) + '</span><span class="rd-mytasks-badge">' + task.state + '</span></div>' +
      '<div class="rd-mytasks-meta"><span>Amount ' + formatAzl(task.totalAmountAzlWei) + '</span><span>Poster ' + shortAddress(task.poster) + '</span><span>Deadline ' + formatDate(task.deadline) + '</span></div>' +
      '<p class="rd-mytasks-hint">' + next + '</p>' +
      (canDeliver ? '<div class="rd-mytasks-actions"><button type="button" class="rd-action rd-action--primary rd-mytasks-btn" data-deliver="' + taskId(task) + '">Send delivery notice</button></div>' : '') +
      '</article>';
  }

  function openReceipt() {
    if (!activeTask) return;
    $("rd-receipt-task").textContent = "Task #" + taskId(activeTask) + " → " + shortAddress(activeTask.poster);
    $("rd-receipt-status").textContent = "";
    $("rd-receipt-dialog").showModal();
  }
  async function submitReceipt(event) {
    event.preventDefault();
    if (!activeTask || busy) return;
    const artifactUri = $("rd-receipt-uri").value.trim();
    const summary = $("rd-receipt-summary").value.trim();
    if (!artifactUri || !summary) return;
    busy = true;
    $("rd-receipt-send").disabled = true;
    const receiptStatus = $("rd-receipt-status");
    try {
      const built = api().buildDeliveryReceipt({
        taskId: taskId(activeTask),
        artifactUri,
        summary,
      });
      receiptStatus.textContent = "Sending private XMTP notice…";
      const notice = await api().sendDeliveryNotice({
        taskId: taskId(activeTask),
        poster: activeTask.poster,
        receiptHash: built.receiptHash,
        receiptUri: artifactUri,
        artifactUris: [artifactUri],
        receipt: built.receipt,
        summary: built.summary,
      }, (message) => { receiptStatus.textContent = message; });
      receiptStatus.textContent = "XMTP message " + notice.messageId + " sent. Confirm Base delivery transaction…";
      const result = await api().markDeliveredV2(taskId(activeTask), (message) => { receiptStatus.textContent = message; });
      receiptStatus.textContent = "Delivery recorded on Base: " + result.hash;
      setTimeout(() => $("rd-receipt-dialog").close(), 1200);
      await load();
    } catch (error) {
      receiptStatus.textContent = error.message ?? "Could not submit delivery";
    } finally {
      busy = false;
      $("rd-receipt-send").disabled = false;
    }
  }
  window.addEventListener("azzle-wallet-change", (event) => {
    address = event.detail?.address ?? null;
    if (address) load();
  });
  document.addEventListener("DOMContentLoaded", () => {
    $("rd-receipt-form").addEventListener("submit", submitReceipt);
    document.addEventListener("azzle-poster-ready", () => {
      address = api()?.address ?? null;
      if (address) load();
    });
  });
})();
