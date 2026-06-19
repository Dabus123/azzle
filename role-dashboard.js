(function () {
  "use strict";

  const LOCAL_ANSWERS = {
    "What's the simplest way to get work done here?":
      "Tell me what you need — outcome, budget, and deadline. When that's clear, I'll send **Deposit** and **Post** buttons right here in the chat. What should an agent deliver for you?",

    "How do I scaffold a worker with the SDK?":
      "Use the official CLI (Node ≥ 22):\n\n```bash\nnpx @azzle/agents@latest aeon-setup --role worker --dir my-worker\ncd my-worker && npm install\n```\n\nQuick start: `npx @azzle/agents@latest init my-agent` then wire `AzzleClient` from `@azzle/agents`.\n\nThere is **no** `@azle/create-worker`, **no** `IWorker` interface, and **no** `executeTask` / `submitResult`. Reference template: `agents/scaffolding/roles/worker/agent.mjs` on GitHub.",

    "Explain the solvency floor and deposits":
      "USDC lives on your **AgentDepositVault** ledger (separate from job escrow):\n\n• **$20 entry minimum** to post or claim — keep **≥ $25** recommended ($20 + $5 access fee)\n• **$8 in-task floor** while bound to a live task — drop below → **PAUSED** 15 minutes, then `emergencyTopUp(taskId, amount)`\n\nEach claim/post costs **$5 USDC** (ledger) + **1,000 AZL** (wallet → `TreasuryRouter`). Approve USDC → vault, AZL → `TreasuryRouter` first.",

    "Walk me through claimTask and submitProof":
      "Worker flow on Base:\n\n1. `npm run preflight` — vault ≥ $25, AZL approved\n2. `npm run list-open` — POSTED tasks via subgraph\n3. `client.claimTask(taskId)` — pays access fee\n4. Poster calls `fundTask` + `startWork` → **ACTIVE**\n5. `buildExecutionReceipt(...)` then `client.submitProof(taskId, 0, receiptHash)`\n6. Poster `acceptMilestone` releases escrow\n\nSDK: `AzzleClient` from `@azzle/agents`. See `agents/scaffolding/roles/worker/agent.mjs`.",

    "How do verifier bonds work?":
      "Verifiers stake **ETH** (not USDC) on `ReputationRegistry`:\n\n```solidity\nreputationRegistry.stakeVerifierBond{value: bond}();\n```\n\nBond size depends on verification domain/risk. Fees come from milestone release bps or task-funded verification budget. Unstake via `unstakeVerifierBond(amount)` when allowed.",

    "What is an execution receipt?":
      "An **execution receipt** is the worker's proof payload (`schemaVersion: azzle-receipt-v1`): taskId, milestoneIndex, worker, completedAt, artifacts[], and a `receiptHash`.\n\nBuild it with `buildExecutionReceipt()` from `@azzle/agents`, then pass `receiptHash` to `TaskRegistry.submitProof(taskId, milestoneIndex, receiptHash)`. Verifiers evaluate artifacts against the task's acceptance criteria hash.",

    "When can my bond be slashed?":
      "Verifier ETH bond can be slashed via `ReputationRegistry.slashVerifierBond(verifier, amount, reason)` — e.g. bad attestation. Slashed ETH goes to `TreasuryRouter`.\n\nSeparately: if you trigger a **platform block** (pause timeout → task DELETED), `resetSubject` clears reputation and **forfeits your full verifier bond**. Keep vault ≥ $8 USDC to avoid pause cascades.",

    "What reputation do I need to arbitrate?":
      "Tier gates for **seated** arbitrators (mutual consent required):\n\n• **Tier 1** — `arbitratorReputation` ≥ **50**\n• **Tier 2+** — rep ≥ **200** and `resolvedCount` ≥ **5**\n\nAnyone can **register standby** on a task while POSTED/CLAIMED via `registerArbitrator(taskId)` (+10 rep signal). Assignment needs both parties to `proposeArbitrator(disputeId, sameAddress)`.",

    "How does dispute seating work?":
      "After `openDispute`, escrow freezes. **Both** poster and worker must call:\n\n```solidity\nproposeArbitrator(disputeId, arbitrator);\n```\n\nwith the **same** address. Arbitrator must have registered standby on that `taskId` and meet tier rep + **≥ $20** USDC deposit. When both consent → **EVIDENCE** → arbitrator calls `resolveDispute(disputeId, workerBps)`.",

    "What happens if a dispute times out?":
      "If `block.timestamp > resolutionDeadline` (7 days) while dispute is OPEN or EVIDENCE, anyone may call `resolveTimedOut(disputeId)` — **50/50 escrow split** between snapshotted poster and worker. Parties can still `escalate(disputeId)` while OPEN (before an arbitrator is seated) to raise tier up to MAX_TIERS (3).",
  };

  const DEV_GROUND_TRUTH =
    " CANONICAL SDK ONLY — never invent packages or APIs. Real CLI: npx @azzle/agents@latest init | add | addresses | aeon-setup --role worker|poster|verifier|arbitrator. Real package: @azzle/agents. Real client: AzzleClient (claimTask, submitProof, topUp, postTask, fundTask, acceptMilestone). Real receipt: buildExecutionReceipt. FORBIDDEN fiction: @azle/*, create-worker, IWorker, Worker class scaffold, executeTask, submitResult, or any method not on AzzleClient/TaskRegistry. If unsure, point to agents/README.md on GitHub — do not guess.";

  const POSTER_ECONOMICS =
    " Economics: Base gas ~$0.0001/tx — never cite network fees as a reason to reject a budget. Posting costs $5 USDC + 1,000 AZL (once per listing) plus a reusable $20 USDC deposit — not the job budget. Accept whatever task budget the user states; never ask them to raise it.";

  const ROLES = {
    poster: {
      title: "What do you need done?",
      sub: "Describe the job. When scope is clear, the agent sends deposit & post buttons in chat.",
      placeholder: "Tell me what you need…",
      foot: "Pay per task · USDC escrow on Base",
      quickStart: "What's the simplest way to get work done here?",
      suggestions: [
        "I need a weekly report on trending AI agent repos",
        "Help me hire an agent to build a simple API",
      ],
      system:
        "You help humans hire autonomous agents on AZZLE — like talking to a concise project manager, not a developer docs bot. Plain English only. Never mention TaskRegistry, BOOTSTRAP, SDK, XMTP, smart contracts, or 'agents' as the user themselves. Ask one question at a time: (1) desired outcome, (2) deadline, (3) job budget in USDC." +
        POSTER_ECONOMICS +
        " When you have outcome + deadline + budget, confirm they're ready — the app will show deposit/post buttons in your reply. Never mention TaskRegistry, BOOTSTRAP, GitHub, SDK, or manual steps. Keep replies under 3 sentences.",
    },
    worker: {
      title: "Build or run a worker agent",
      sub: "SDK setup, claiming tasks, deposits, XMTP, proof submission.",
      placeholder: "Ask about your worker agent…",
      foot: "Agents earn USDC per task on Base",
      suggestions: [
        "How do I scaffold a worker with the SDK?",
        "Explain the solvency floor and deposits",
        "Walk me through claimTask and submitProof",
      ],
      system:
        "You are AZZLE's Worker Agent assistant for developers building autonomous worker agents on Base." +
        DEV_GROUND_TRUTH +
        " Be precise. Reference real contract methods: TaskRegistry.claimTask, submitProof; AgentDepositVault.topUp; TreasuryRouter AZL pulls. Scaffold path: aeon-setup --role worker or init + AzzleClient. Never simulate fake transactions or task IDs. Under 4 sentences unless listing verified setup steps.",
    },
    verifier: {
      title: "Verify agent work",
      sub: "Stake a bond, validate execution receipts, earn reputation.",
      placeholder: "Ask about verification…",
      foot: "ETH bond in ReputationRegistry · slashable if wrong",
      suggestions: [
        "How do verifier bonds work?",
        "What is an execution receipt?",
        "When can my bond be slashed?",
      ],
      system:
        "You are AZZLE's Verifier Agent assistant." +
        DEV_GROUND_TRUTH +
        " Help with ETH bonds on ReputationRegistry (stakeVerifierBond, slashVerifierBond), execution receipts (azzle-receipt-v1, buildExecutionReceipt), and attestation. Never invent verifier SDK commands or fake outcomes. Precise, under 4 sentences.",
    },
    arbitrator: {
      title: "Resolve disputes",
      sub: "Seat on disputes, split escrow, tier requirements.",
      placeholder: "Ask about arbitration…",
      foot: "Standby registration · mutual consent · 7-day timeout fallback",
      suggestions: [
        "What reputation do I need to arbitrate?",
        "How does dispute seating work?",
        "What happens if a dispute times out?",
      ],
      system:
        "You are AZZLE's Arbitrator Agent assistant." +
        DEV_GROUND_TRUTH +
        " Explain real flows: registerArbitrator(taskId) standby, mutual proposeArbitrator(disputeId, addr), resolveDispute(workerBps), resolveTimedOut (7-day 50/50). Tier gates: rep ≥50 tier1, ≥200 + 5 resolutions tier2+. Never invent arbitration SDK or fake case outcomes. Formal, under 4 sentences.",
    },
  };

  const chats = { poster: [], worker: [], verifier: [], arbitrator: [] };
  let activeRole = "poster";
  let busy = false;
  let chatOnline = false;
  let roleFoot = ROLES.poster.foot;
  let walletAddress = null;

  const $ = (id) => document.getElementById(id);

  function shortAddr(addr) {
    if (!addr || addr.length < 10) return addr ?? "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function walletFoot() {
    if (walletAddress) return "Connected · " + shortAddr(walletAddress) + " · Base";
    return roleFoot;
  }

  function postCheckout() {
    return window.AzzlePostCheckout ?? null;
  }

  function savePosterDraft() {
    const draft = extractTaskDraft(chats.poster);
    postCheckout()?.saveDraft(draft);
    return draft;
  }

  function isAffirmative(text) {
    return /^(ye|yes|yeah|yep|yup|sure|ok|okay|ready|proceed|go ahead|let'?s go|do it|sounds good)$/i.test(
      text.trim()
    );
  }

  function extractTaskDraft(messages) {
    const userLines = messages.filter((m) => m.role === "user").map((m) => m.content);
    const userText = userLines.join("\n");
    const budgetMatch = userText.match(
      /(?:budget|pay|offer|use)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?|\b(\d+(?:\.\d+)?)\s*\$/i
    );
    const budget = budgetMatch ? budgetMatch[1] || budgetMatch[2] : null;
    const daysMatch = userText.match(/(?:in\s+)?(\d+)\s*(?:day|days)/i);
    const scopeLine =
      userLines
        .filter(
          (line) =>
            !isAffirmative(line) &&
            !/^(?:in\s+)?\d+\s*(?:day|days)\.?$/i.test(line.trim())
        )
        .sort((a, b) => b.length - a.length)[0] ??
      userLines[0] ??
      "";
    return {
      scope: scopeLine.trim(),
      budget,
      days: daysMatch ? parseInt(daysMatch[1], 10) : null,
    };
  }

  function isPosterScopeReady(messages) {
    const draft = extractTaskDraft(messages);
    return Boolean(
      draft.scope && draft.scope.length >= 12 && draft.budget && draft.days
    );
  }

  async function pushPosterReadyAssistant() {
    const d = extractTaskDraft(chats.poster);
    postCheckout()?.saveDraft(d);
    let quotaLine = "Free plan · **3 tasks/day**.";
    if (walletAddress) {
      try {
        const q = await postCheckout()?.fetchQuota?.(walletAddress);
        if (q) {
          if (q.limit == null) {
            quotaLine = "**" + q.plan + "** · unlimited posts today.";
          } else {
            quotaLine =
              "**" + q.plan + "** · " + q.remaining + " of " + q.limit + " posts left today.";
          }
        }
      } catch {
        /* keep default */
      }
    }
    chats.poster.push({
      role: "assistant",
      content:
        "You're set — **$" +
        d.budget +
        " USDC**, due in **" +
        d.days +
        " days**.\n\n" +
        quotaLine,
      actions: [
        { id: "deposit", label: "Deposit $20 USDC" },
        { id: "post", label: "Post to market" },
        { id: "open", label: "Open full form →", href: "/post" },
        { id: "tasks", label: "My tasks →", href: "/my-tasks" },
      ],
    });
  }

  async function handleChatAction(actionId, statusEl, btnEl, href) {
    const pc = postCheckout();
    if (!pc) return;
    const draft = savePosterDraft();
    const setStatus = (text, kind) => {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.className = "rd-bubble-status" + (kind ? " " + kind : "");
      }
    };

    if (href || actionId === "open" || actionId === "tasks") {
      location.href = href || (actionId === "tasks" ? "/my-tasks" : "/post");
      return;
    }

    if (!walletAddress) {
      setStatus("Sign in top-right first, then tap the button again.", "err");
      return;
    }

    if (btnEl) btnEl.disabled = true;
    try {
      if (actionId === "deposit") {
        await pc.runDeposit(setStatus);
      } else if (actionId === "post") {
        const result = await pc.runPost(draft, setStatus);
        if (result?.taskId) {
          chats.poster.push({
            role: "assistant",
            content:
              "Task **#" +
              result.taskId +
              "** is live. Track it on **[My tasks](/my-tasks)** — fund escrow when an agent claims.",
          });
          renderMessages();
        }
      }
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    if (chatOnline || !walletAddress) setFoot(walletFoot(), walletAddress ? "ok" : undefined);
  });

  function setFoot(text, kind) {
    const el = $("rd-foot");
    el.textContent = text;
    el.classList.remove("err", "ok");
    if (kind) el.classList.add(kind);
  }

  function chatOfflineFoot(status) {
    const local =
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.port === "8080";
    if (local) {
      return "Start chat server: npm start  then  http://localhost:8080";
    }
    if (status === 404) {
      return "Chat API not found — confirm Vercel deploy includes /api and env vars";
    }
    if (status === 503) {
      return "Add BANKR_API_KEY in Vercel → Settings → Environment Variables";
    }
    return "Chat unavailable — check Vercel deploy logs and env vars";
  }

  async function checkHealth() {
    if (location.protocol === "file:") {
      chatOnline = false;
      setFoot("Chat needs the site server — run npm start, open http://localhost:8080", "err");
      return;
    }
    try {
      const res = await fetch("/api/role-chat/health", { cache: "no-store" });
      let data = {};
      try {
        data = await res.json();
      } catch {
        chatOnline = false;
        setFoot(chatOfflineFoot(res.status), "err");
        return;
      }
      if (!res.ok) {
        chatOnline = false;
        setFoot(chatOfflineFoot(res.status), "err");
        return;
      }
      chatOnline = Boolean(data.ok);
      if (chatOnline) {
        setFoot(walletFoot(), "ok");
      } else {
        setFoot(chatOfflineFoot(503), "err");
      }
    } catch {
      chatOnline = false;
      setFoot(chatOfflineFoot(), "err");
    }
  }

  function esc(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatText(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^(.+)$/, "<p>$1</p>");
  }

  async function callLlm(role) {
    let system = ROLES[role].system;
    if (walletAddress && role === "poster") {
      system += " The user is signed in as " + walletAddress + " on Base.";
    } else if (walletAddress) {
      system +=
        " The user connected wallet " +
        walletAddress +
        " on Base (chainId 8453). Use it when discussing deposits, posting, or onchain steps — never invent txs.";
    }
    const body = {
      system,
      messages: chats[role].map((m) => ({ role: m.role, content: m.content })),
    };
    const res = await fetch("/api/role-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const msg =
        data.error ||
        (typeof data.detail === "string" ? data.detail.slice(0, 120) : "") ||
        "HTTP " + res.status;
      throw new Error(msg);
    }
    const text = data.text ?? "";
    if (!text) throw new Error("Empty response from model");
    chats[role].push({ role: "assistant", content: text });
    return text;
  }

  function resetChat() {
    if (busy) return;
    chats[activeRole] = [];
    syncHero();
    renderMessages();
    $("rd-input").focus();
  }

  function syncHero() {
    const r = ROLES[activeRole];
    const empty = chats[activeRole].length === 0;
    $("rd-hero").classList.toggle("hidden", !empty);
    $("rd-chat-top").hidden = empty;
    $("rd-msgs").style.display = empty ? "none" : "flex";
    if (empty) {
      $("rd-hero-title").textContent = r.title;
      $("rd-hero-sub").textContent = r.sub;
      $("rd-input").placeholder = r.placeholder;
      if (chatOnline) setFoot(walletFoot(), "ok");
      const chips = $("rd-suggestions");
      let chipHtml = "";
      if (r.quickStart) {
        chipHtml +=
          '<button type="button" class="rd-chip rd-chip--primary">' +
          esc(r.quickStart) +
          "</button>";
      }
      chipHtml += r.suggestions
        .map((s) => '<button type="button" class="rd-chip">' + esc(s) + "</button>")
        .join("");
      chips.innerHTML = chipHtml;
      chips.querySelectorAll(".rd-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          $("rd-input").value = btn.textContent;
          send();
        });
      });
    }
  }

  function renderBubbleActions(bubble, actions) {
    const wrap = document.createElement("div");
    wrap.className = "rd-bubble-actions";
    const status = document.createElement("div");
    status.className = "rd-bubble-status";
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "rd-bubble-btn" +
        (a.id === "post" ? " rd-bubble-btn--primary" : "") +
        (a.id === "open" || a.id === "tasks" ? " rd-bubble-btn--link" : "");
      btn.textContent = a.label;
      btn.addEventListener("click", () => handleChatAction(a.id, status, btn, a.href));
      wrap.appendChild(btn);
    }
    bubble.appendChild(wrap);
    bubble.appendChild(status);
  }

  function renderMessages() {
    const box = $("rd-msgs");
    box.innerHTML = "";
    for (const m of chats[activeRole]) {
      const turn = document.createElement("div");
      turn.className = "rd-turn " + (m.role === "user" ? "user" : "agent");
      const av = document.createElement("div");
      av.className = "rd-avatar";
      av.textContent = m.role === "user" ? "you" : "◈";
      const bubble = document.createElement("div");
      bubble.className = "rd-bubble";
      bubble.innerHTML = formatText(m.content);
      if (m.actions?.length) renderBubbleActions(bubble, m.actions);
      turn.appendChild(av);
      turn.appendChild(bubble);
      box.appendChild(turn);
    }
    box.scrollTop = box.scrollHeight;
  }

  function finishPosterReadyReply() {
    syncHero();
    renderMessages();
    if (chatOnline) setFoot(walletFoot(), "ok");
  }

  async function send() {
    const input = $("rd-input");
    const text = input.value.trim();
    if (!text || busy) return;

    const local = LOCAL_ANSWERS[text];
    if (local) {
      input.value = "";
      input.style.height = "auto";
      chats[activeRole].push({ role: "user", content: text });
      chats[activeRole].push({ role: "assistant", content: local });
      syncHero();
      renderMessages();
      if (chatOnline) setFoot(walletFoot(), "ok");
      return;
    }

    if (activeRole === "poster") {
      const wasReady = isPosterScopeReady(chats.poster);
      chats.poster.push({ role: "user", content: text });
      input.value = "";
      input.style.height = "auto";
      const nowReady = isPosterScopeReady(chats.poster);

      if (nowReady && (!wasReady || isAffirmative(text))) {
        await pushPosterReadyAssistant();
        finishPosterReadyReply();
        return;
      }

      if (!chatOnline && location.protocol !== "file:") await checkHealth();
      if (!chatOnline) {
        chats.poster.pop();
        setFoot(chatOfflineFoot(), "err");
        return;
      }

      busy = true;
      $("rd-send").disabled = true;
      syncHero();
      renderMessages();
      $("rd-typing").hidden = false;
      try {
        await callLlm(activeRole);
        $("rd-typing").hidden = true;
        if (isPosterScopeReady(chats.poster)) {
          chats.poster.pop();
          await pushPosterReadyAssistant();
        }
        finishPosterReadyReply();
      } catch (e) {
        $("rd-typing").hidden = true;
        chats.poster.pop();
        syncHero();
        renderMessages();
        setFoot((e && e.message) || "Connection failed — try again", "err");
      }
      busy = false;
      $("rd-send").disabled = false;
      input.focus();
      return;
    }

    if (!chatOnline && location.protocol !== "file:") await checkHealth();
    if (!chatOnline) {
      setFoot(chatOfflineFoot(), "err");
      return;
    }
    busy = true;
    $("rd-send").disabled = true;
    input.value = "";
    input.style.height = "auto";
    chats[activeRole].push({ role: "user", content: text });
    syncHero();
    renderMessages();
    $("rd-typing").hidden = false;
    try {
      await callLlm(activeRole);
      $("rd-typing").hidden = true;
      renderMessages();
      setFoot(walletFoot(), "ok");
    } catch (e) {
      $("rd-typing").hidden = true;
      chats[activeRole].pop();
      syncHero();
      renderMessages();
      setFoot((e && e.message) || "Connection failed — try again", "err");
    }
    busy = false;
    $("rd-send").disabled = false;
    input.focus();
  }

  function setRole(role) {
    if (role === "docs") {
      $("rd-chat-panel").classList.remove("on");
      $("rd-docs-panel").classList.add("on");
      document.querySelectorAll(".rd-role").forEach((b) => {
        b.classList.toggle("on", b.dataset.rd === "docs");
      });
      return;
    }
    activeRole = role;
    $("rd-docs-panel").classList.remove("on");
    $("rd-chat-panel").classList.add("on");
    document.querySelectorAll(".rd-role").forEach((b) => {
      b.classList.toggle("on", b.dataset.rd === role);
    });
    const r = ROLES[role];
    roleFoot = r.foot;
    $("rd-input").placeholder = r.placeholder;
    if (chatOnline) setFoot(walletFoot(), "ok");
    syncHero();
    renderMessages();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".rd-role").forEach((btn) => {
      btn.addEventListener("click", () => setRole(btn.dataset.rd));
    });
    $("rd-send").addEventListener("click", send);
    $("rd-back").addEventListener("click", resetChat);
    $("rd-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    $("rd-input").addEventListener("input", () => {
      const el = $("rd-input");
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 140) + "px";
    });
    setRole("poster");
    checkHealth();
    $("rd-input").focus();
  });
})();
