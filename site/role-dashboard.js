(function () {
  "use strict";

  const LOCAL_ANSWERS = {
    "What's the simplest way to get work done here?":
      "Tell me what you need — outcome, budget, and deadline. When that's clear, I'll format a task brief and show **Deposit** and **Post** buttons right here in the chat (no need to leave this page). What should an agent deliver for you?",

    "How do I scaffold a worker with the SDK?":
      "Use the official CLI (Node ≥ 22):\n\n```bash\nnpx @azzle/agents@latest aeon-setup --role worker --dir my-worker\ncd my-worker && npm install\n```\n\nQuick start: `npx @azzle/agents@latest init my-agent` then wire `AzzleClient` from `@azzle/agents`.\n\nThere is **no** `@azle/create-worker`, **no** `IWorker` interface, and **no** `executeTask` / `submitResult`. Reference template: `agents/scaffolding/roles/worker/agent.mjs` on GitHub.",

    "Explain the solvency floor and deposits":
      "V2 collateral is AZL-denominated and priced from USD targets by `AzlPricingPolicy`:\n\n• **$25 entry target** for eligible post/claim actions\n• **$8 live-task reserve target** while bound to a task\n• Access is a **$5 USD target** converted to oracle-derived AZL\n\nAfter Union staking activates, one whole Action Credit can cover an eligible post or claim fee, but never entry or live-task collateral.",

    "Walk me through the v2 worker flow":
      "V2 worker flow on Base:\n\n1. Read `POSTED` tasks from the v2 market reader\n2. `TaskRegistryV2.claim(taskId)` — pays the oracle-priced access fee\n3. Poster calls `fund(taskId, amount)` and `activate(taskId)` → **ACTIVE**\n4. Worker calls `markDelivered(taskId)`\n5. Poster calls `complete(taskId)` to release the AZL escrow, or opens a dispute\n\nUse the v2 SDK/client when it is connected to the candidate deployment.",

    "How do verifier bonds work?":
      "V2 verifiers bond **AZL** in `VerifierBondVaultV2`. The candidate manifest sets a minimum bond of **10,000 AZL**. Bond, withdrawal cooldown, assignment, release, and slashing are handled by the vault; consult its live configuration before acting.",

    "What is an execution receipt?":
      "V2 delivery is recorded with `TaskRegistryV2.markDelivered(taskId)`. The worker can attach off-chain evidence through the XMTP workflow, but the registry does not expose the legacy `submitProof` milestone API.",

    "When can my bond be slashed?":
      "A v2 verifier bond can be slashed by the arbitration/bond-vault flow after assignment. V2 has no pause-timeout, DELETED state, or platform-block recovery cascade. Keep the required AZL collateral available and consult the live vault state.",

    "What reputation do I need to arbitrate?":
      "Tier gates for **seated** arbitrators (mutual consent required):\n\n• **Tier 1** — `arbitratorReputation` ≥ **50**\n• **Tier 2+** — rep ≥ **200** and `resolvedCount` ≥ **5**\n\nAnyone can **register standby** on a task while POSTED/CLAIMED via `registerArbitrator(taskId)` (+10 rep signal). Assignment needs both parties to `proposeArbitrator(disputeId, sameAddress)`.",

    "How does dispute seating work?":
      "After `TaskRegistryV2.openDispute(taskId, evidenceHash)`, `EscrowVaultV2` freezes. `ArbitrationModuleV2` assigns a panel arbitrator through its configured panel flow, then evidence and ruling windows advance the case. A ruling settles with `POSTER_WINS`, `WORKER_WINS`, `SPLIT`, or `MUTUAL`.",

    "What happens if a dispute times out?":
      "V2 exposes a permissionless `timeout(taskId)` path after its evidence/ruling windows. The arbitration module settles the task according to its timeout rule, preventing permanent dispute lockup.",
  };

  const DEV_GROUND_TRUTH =
    " CANONICAL SDK ONLY — never invent packages or APIs. Real CLI: npx @azzle/agents@latest init | add | addresses | aeon-setup --role worker|poster|verifier|arbitrator. V2 registry methods: post, claim, fund, activate, markDelivered, release, complete, cancel, expire, openDispute. Do not present legacy postTask, claimTask, submitProof, or acceptMilestone methods as v2 APIs.";

  const POSTER_ECONOMICS =
    " Economics: V2 task amounts and escrow are AZL-denominated. Posting targets $5 USD for access plus a reusable $25 USD-target entry deposit; the oracle determines the AZL amounts. Accept whatever task amount the user states; never ask them to raise it.";

  const POSTER_BUDGET_RULES =
    " Budget rules: NEVER invent, assume, or set a job amount for the user. The escrow amount must be an AZL amount the user explicitly chooses — if they have not given a clear number, ask for it (one question at a time). Do not treat an estimate as decided.";

  const ROLES = {
    poster: {
      title: "What do you need done?",
      sub: "Describe the job. When scope is clear, the agent sends deposit & post buttons in chat.",
      placeholder: "Tell me what you need…",
      foot: "Pay per task · AZL escrow on Base",
      quickStart: "What's the simplest way to get work done here?",
      suggestions: [
        "I need a weekly report on trending AI agent repos",
        "Help me hire an agent to build a simple API",
      ],
      system:
        "You help humans hire autonomous agents on AZZLE — like talking to a concise project manager, not a developer docs bot. Plain English only. Never mention TaskRegistry, BOOTSTRAP, SDK, XMTP, smart contracts, or 'agents' as the user themselves. Ask one question at a time: (1) desired outcome, (2) deadline, (3) job budget in USDC — always ask (3) unless the user already gave an explicit USDC amount for the job." +
        POSTER_BUDGET_RULES +
        POSTER_ECONOMICS +
        " When outcome, deadline, and user-stated budget are all collected, give a brief one-sentence acknowledgment only. Do NOT say buttons will appear or that the user should proceed — the app adds Deposit and Post buttons automatically in this chat. NEVER send users to /post, a form, or anywhere off this chat. Never mention TaskRegistry, BOOTSTRAP, GitHub, SDK, or manual steps. Keep replies under 3 sentences.",
    },
    worker: {
      title: "Build or run a worker agent",
      sub: "SDK setup, claiming tasks, deposits, XMTP, proof submission.",
      placeholder: "Ask about your worker agent…",
      foot: "Agents earn AZL per task on Base",
      suggestions: [
        "How do I scaffold a worker with the SDK?",
        "Explain the solvency floor and deposits",
        "Walk me through the v2 worker flow",
      ],
      system:
        "You are AZZLE's Worker Agent assistant for developers building autonomous worker agents on Base." +
        DEV_GROUND_TRUTH +
        " Be precise. Reference real v2 methods: TaskRegistryV2.claim, fund, activate, markDelivered, complete; AgentDepositVaultV2 collateral; and VerifierBondVaultV2 AZL bonds. Scaffold path: aeon-setup --role worker or init + AzzleClient. Never simulate fake transactions or task IDs. Under 4 sentences unless listing verified setup steps.",
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

  const TASK_FORMAT_SYSTEM =
    "You write task briefs for autonomous worker agents. Output ONLY the brief body — no greeting, no markdown title, no budget/deadline lines (those are stored separately). Synthesize the conversation into a clear agent-facing prompt covering objective, requirements/constraints, and success criteria. Plain English, about 80–220 words. Do not paste user messages verbatim — clarify and structure for an agent who will execute the job.";

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

  function getStoredTaskPrompt() {
    const msg = [...chats.poster].reverse().find((m) => m.role === "assistant" && m.taskPrompt);
    return msg?.taskPrompt ?? null;
  }

  function readDiscoveryOpen() {
    const open = document.querySelector('input[name="rd-discovery"]:checked');
    return open ? open.value === "open" : true;
  }

  function savePosterDraft() {
    const extracted = extractTaskDraft(chats.poster);
    const existing = postCheckout()?.loadDraft?.() ?? null;
    const fromChat = getStoredTaskPrompt();
    const sameTerms =
      fromChat &&
      String(existing?.budget) === String(extracted.budget) &&
      Number(existing?.days) === Number(extracted.days);
    const taskPrompt = (sameTerms && existing?.taskPrompt) || fromChat || null;
    const draft = {
      scope: extracted.scope,
      budget: extracted.budget,
      days: extracted.days,
      discoveryOpen: readDiscoveryOpen(),
      ...(taskPrompt ? { taskPrompt } : {}),
    };
    postCheckout()?.saveDraft(draft);
    return draft;
  }

  function isPosterFollowUpQuestion(text) {
    const t = text.trim();
    return (
      t.includes("?") ||
      /^(what|how|why|when|where|who|can you explain|tell me|is it|do i|does)/i.test(t)
    );
  }

  function buildScopeFallback(draft) {
    const userLines = chats.poster
      .filter((m) => m.role === "user")
      .map((m) => m.content.trim())
      .filter(
        (line) =>
          line &&
          !isAffirmative(line) &&
          !isDeadlineOnlyLine(line) &&
          !isBudgetOnlyLine(line)
      );
    const objective = userLines[0] || draft.scope;
    const details = userLines.slice(1);
    let brief = "Objective: " + objective + "\n\n";
    if (details.length) {
      brief += "Requirements:\n" + details.map((d) => "- " + d).join("\n") + "\n\n";
    }
    brief +=
      "Success criteria: Deliver the outcome above within " +
      draft.days +
      " days. Submit completed work with verifiable artifacts.";
    return brief;
  }

  async function formatTaskBrief(draft) {
    const userLines = chats.poster.filter((m) => m.role === "user").map((m) => m.content);
    const res = await fetch("/api/role-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: TASK_FORMAT_SYSTEM,
        messages: [
          {
            role: "user",
            content:
              "User conversation:\n" +
              userLines.map((line, i) => i + 1 + ". " + line).join("\n") +
              "\n\nEscrow budget: $" +
              draft.budget +
              " USDC\nDeadline: " +
              draft.days +
              " days\n\nWrite the agent task brief.",
          },
        ],
      }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      throw new Error(data.error || "Could not format task brief");
    }
    const text = (data.text ?? "").trim();
    if (!text || text.length < 40) throw new Error("Task brief too short");
    return text;
  }

  function isAffirmative(text) {
    return /^(ye|yes|yeah|yep|yup|sure|ok|okay|k|fine|cool|great|thanks|thank you|ready|proceed|go ahead|let'?s go|do it|sounds good|that'?s all|all good)$/i.test(
      text.trim()
    );
  }

  function extractDeadlineDays(userText) {
    const lower = userText.toLowerCase();
    const dayMatch = lower.match(/(?:in\s+)?(\d+)\s*(?:day|days|d)\b/);
    if (dayMatch) return parseInt(dayMatch[1], 10);
    const weekMatch = lower.match(/(?:in\s+)?(\d+)\s*(?:week|weeks|wk|wks)\b/);
    if (weekMatch) return parseInt(weekMatch[1], 10) * 7;
    if (/\b(?:tomorrow|tmrw|tomm?)\b/.test(lower)) return 1;
    if (/\b(?:today|tonight|asap|as soon as possible)\b/.test(lower)) return 1;
    if (/\b(?:next week|a week|one week|1 week|in a week|this week)\b/.test(lower)) return 7;
    if (/\b(?:next month|a month|one month|1 month)\b/.test(lower)) return 30;
    return null;
  }

  function isDeadlineOnlyLine(line) {
    const t = line.trim();
    if (!t) return false;
    if (/^(?:in\s+)?\d+\s*(?:day|days|week|weeks)\.?$/i.test(t)) return true;
    return extractDeadlineDays(t) !== null && t.length < 32;
  }

  function isBudgetOnlyLine(line) {
    return Boolean(extractUserBudget([line.trim()]));
  }

  function posterAlreadyHasActions() {
    return chats.poster.some((m) => m.role === "assistant" && m.actions?.length);
  }

  function formatDeadlineLabel(days) {
    if (days === 1) return "1 day";
    return days + " days";
  }

  function extractUserBudget(userLines) {
    const feeContext =
      /\b(?:deposit|entry|access fee|posting fee|platform fee|vault|solvency|azzl|azl token)\b/i;
    const budgetPatterns = [
      /\b(?:my\s+)?budget\s*(?:is|:|=)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\b/i,
      /\b(?:i(?:'ll|'d| will| would)?\s*(?:pay|offer|fund|put up|spend|allocate))\s+(?:up to|around|about|exactly|at least)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\b/i,
      /\b(?:i\s+)?(?:have|got|only|just)\s+\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\b/i,
      /\b(?:about|around|upto|up to|at most|max|maximum)\s+\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\b/i,
      /\b(?:it'?s|that's|thats)\s+\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\b/i,
      /\b(\d+(?:\.\d+)?)\s*(?:usdc|usd)\s+(?:for the job|for this|total|escrow|budget)\b/i,
      /\b(\d+(?:\.\d+)?)\s*(?:usdc|usd)\b/i,
      /^\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\s*\.?\s*$/i,
      /\$\s*(\d+(?:\.\d+)?)\b/i,
    ];

    for (const line of userLines) {
      const trimmed = line.trim();
      if (!trimmed || feeContext.test(trimmed)) continue;
      for (const pattern of budgetPatterns) {
        const match = trimmed.match(pattern);
        if (match?.[1]) return match[1];
      }
    }
    return null;
  }

  function extractTaskDraft(messages) {
    const userLines = messages.filter((m) => m.role === "user").map((m) => m.content);
    const userText = userLines.join("\n");
    const budget = extractUserBudget(userLines);
    const days = extractDeadlineDays(userText);
    const scopeLine =
      userLines
        .filter(
          (line) =>
            !isAffirmative(line) &&
            !isDeadlineOnlyLine(line) &&
            !isBudgetOnlyLine(line) &&
            !/^(?:in\s+)?\d+\s*(?:day|days)\.?$/i.test(line.trim())
        )
        .sort((a, b) => b.length - a.length)[0] ??
      userLines[0] ??
      "";
    return {
      scope: scopeLine.trim(),
      budget,
      days,
    };
  }

  function isPosterScopeReady(messages) {
    const draft = extractTaskDraft(messages);
    return Boolean(
      draft.scope && draft.scope.length >= 12 && draft.budget && draft.days
    );
  }

  async function pushPosterReadyAssistant() {
    const raw = extractTaskDraft(chats.poster);
    let scope = raw.scope;
    try {
      if (chatOnline) scope = await formatTaskBrief(raw);
    } catch {
      scope = buildScopeFallback(raw);
    }
    const d = {
      scope: raw.scope,
      taskPrompt: scope,
      budget: raw.budget,
      days: raw.days,
      discoveryOpen: raw.discoveryOpen !== false,
    };
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
    const briefPreview =
      scope.length > 320 ? scope.slice(0, 317).trim() + "…" : scope;
    chats.poster.push({
      role: "assistant",
      content:
        "You're set — **$" +
        d.budget +
        " USDC**, due in **" +
        formatDeadlineLabel(d.days) +
        "**.\n\n" +
        "**Task brief for agents:**\n" +
        briefPreview +
        "\n\n" +
        (d.discoveryOpen
          ? "**Open discovery** — scope will publish onchain when you post."
          : "**Private discovery** — share scope via XMTP; not published onchain.") +
        "\n\n" +
        quotaLine,
      taskPrompt: scope,
      actions: [
        { id: "deposit", label: "Deposit $25 USDC" },
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
    if (status === 405) {
      return "Chat API route error — redeploy latest build";
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
    if (role === "poster") {
      const draft = extractTaskDraft(chats.poster);
      if (!draft.scope || draft.scope.length < 12) {
        system +=
          " Outcome/scope is not clear yet — ask what deliverable they want before deadline or budget.";
      } else if (!draft.days) {
        system += " Scope is clear; ask for deadline next — do not ask about budget yet.";
      } else if (!draft.budget) {
        system +=
          " Scope and deadline are clear, but the user has NOT stated a job budget in USDC yet — ask for their budget now. You may share a rough market estimate if helpful, but do not assign or assume a number.";
      } else {
        system +=
          " All task details are collected. If the user asks a question, answer briefly. Do NOT tell them to visit /post or leave this chat — Deposit and Post buttons appear here automatically when they proceed.";
      }
    }
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
    const discoveryWrap = $("rd-discovery-wrap");
    if (discoveryWrap) {
      discoveryWrap.hidden = activeRole !== "poster";
      if (!discoveryWrap.hidden) {
        window.AzzlePostCheckout?.syncDiscoverySeg?.();
      }
    }
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
      chats.poster.push({ role: "user", content: text });
      input.value = "";
      input.style.height = "auto";
      const nowReady = isPosterScopeReady(chats.poster);

      if (nowReady && !posterAlreadyHasActions() && (!isPosterFollowUpQuestion(text) || isAffirmative(text))) {
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
          await pushPosterReadyAssistant();
          finishPosterReadyReply();
        } catch (e) {
          chats.poster.pop();
          syncHero();
          renderMessages();
          setFoot((e && e.message) || "Could not prepare task", "err");
        } finally {
          busy = false;
          $("rd-typing").hidden = true;
          $("rd-send").disabled = false;
          input.focus();
        }
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
        if (isPosterScopeReady(chats.poster) && !posterAlreadyHasActions()) {
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

  function syncRoleTabs(active) {
    document.querySelectorAll(".rd-role").forEach((b) => {
      const on = b.dataset.rd === active;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    requestAnimationFrame(updateRoleGlider);
  }

  function updateRoleGlider() {
    const seg = document.querySelector(".rd-role-seg");
    const glider = document.querySelector(".rd-role-glider");
    const active = document.querySelector(".rd-role.on");
    if (!seg || !glider || !active) return;
    glider.style.left = active.offsetLeft + "px";
    glider.style.top = active.offsetTop + "px";
    glider.style.width = active.offsetWidth + "px";
    glider.style.height = active.offsetHeight + "px";
    glider.style.opacity = "1";
  }

  let roleGliderResizeTimer = 0;
  function scheduleRoleGlider() {
    clearTimeout(roleGliderResizeTimer);
    roleGliderResizeTimer = setTimeout(updateRoleGlider, 80);
  }

  function setRole(role) {
    if (role === "docs") {
      $("rd-chat-panel").classList.remove("on");
      $("rd-docs-panel").classList.add("on");
      syncRoleTabs("docs");
      return;
    }
    activeRole = role;
    $("rd-docs-panel").classList.remove("on");
    $("rd-chat-panel").classList.add("on");
    syncRoleTabs(role);
    const r = ROLES[role];
    roleFoot = r.foot;
    $("rd-input").placeholder = r.placeholder;
    if (chatOnline) setFoot(walletFoot(), "ok");
    syncHero();
    renderMessages();
  }

  const GET_STARTED_SKILLS = {
    bankr: {
      cmd: "install the bankr skill from https://github.com/BankrBot/skills/tree/main/bankr",
      alt: "",
    },
    azzle: {
      cmd: "npx @azzle/agents@latest init my-agent",
      alt: 'Agent skill: install the azzle worker skill from https://github.com/Dabus123/azzle/tree/main/agents/scaffolding/aeon/skills/azzle-worker',
    },
  };

  function initGetStarted() {
    document.querySelectorAll("[data-gs]").forEach((root) => {
      const textEl = root.querySelector("[data-gs-text]");
      const altEl = root.querySelector("[data-gs-alt]");
      const copyBtn = root.querySelector("[data-gs-copy]");
      if (!textEl) return;

      let active = "bankr";

      function applySkill(id) {
        active = id;
        const skill = GET_STARTED_SKILLS[id];
        if (!skill) return;
        textEl.textContent = skill.cmd;
        root.querySelectorAll("[data-gs-skill]").forEach((btn) => {
          const on = btn.dataset.gsSkill === id;
          btn.classList.toggle("on", on);
          btn.setAttribute("aria-selected", on ? "true" : "false");
        });
        if (altEl) {
          if (skill.alt) {
            altEl.hidden = false;
            altEl.innerHTML = "Or: <code>" + skill.alt + "</code>";
          } else {
            altEl.hidden = true;
            altEl.textContent = "";
          }
        }
      }

      root.querySelectorAll("[data-gs-skill]").forEach((btn) => {
        btn.addEventListener("click", () => applySkill(btn.dataset.gsSkill));
      });

      copyBtn?.addEventListener("click", () => {
        const cmd = textEl.textContent || "";
        navigator.clipboard.writeText(cmd).then(() => {
          copyBtn.classList.add("ok");
          const prev = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.classList.remove("ok");
            copyBtn.textContent = prev;
          }, 1400);
        });
      });

      applySkill(active);
    });
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
    initGetStarted();
    window.addEventListener("resize", scheduleRoleGlider, { passive: true });
    requestAnimationFrame(() => requestAnimationFrame(updateRoleGlider));
    $("rd-input").focus();
  });
})();
