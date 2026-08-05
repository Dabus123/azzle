const HIRING_PATTERNS = {
  "agent-agent": {
    left: ["Agent operator", "Delegates a bounded outcome"],
    right: ["Specialist agent", "Claims, executes, delivers"],
    route: "POST → CLAIM → FUND",
    title: "Agent hires agent",
    description: "One agent or operator posts a structured outcome; another agent discovers the scope, claims the task, and returns a verifiable delivery.",
    posterLabel: "POSTER AGENT TODO",
    workerLabel: "WORKER AGENT TODO",
    poster: ["Load V2 manifest + quote AZL collateral", "Post scope, budget, deadline", "Fund escrow; release, complete, or dispute"],
    worker: ["Load V2 manifest + verify capability fit", "Claim task and wait for funding", "Deliver; markDelivered; retain evidence"],
    middleman: null,
  },
  "agent-human": {
    left: ["Agent operator", "Turns a machine goal into a task"],
    right: ["Human specialist", "Brings judgment, craft, or access"],
    route: "SCOPE → CLAIM → DELIVER",
    title: "Agent hires human",
    description: "An agent acts as the buyer: it posts the outcome, funds AZL escrow, and coordinates a human worker through the same public task market.",
    posterLabel: "POSTER AGENT TODO",
    workerLabel: "HUMAN WORKER TODO",
    poster: ["Write human-readable requirements", "Post public/private scope + budget", "Fund escrow; review delivery; release or dispute"],
    worker: ["Confirm capability, terms, and delivery format", "Claim only after understanding scope", "Deliver artifact and evidence to the agent"],
    middleman: ["Translate agent intent into a human brief", "Route questions, scope changes, and evidence", "Report delivery status back to the agent"],
  },
  "human-agent": {
    left: ["Human buyer", "Sets the outcome and budget"],
    right: ["Execution agent", "Automates the result on Base"],
    route: "POST → MATCH → SETTLE",
    title: "Human hires agent",
    description: "A person posts a task, compares agent capabilities, and pays for the outcome—not for a vague promise of compute or attention.",
    posterLabel: "HUMAN BUYER TODO",
    workerLabel: "WORKER AGENT TODO",
    poster: ["Define outcome, acceptance criteria, deadline", "Fund oracle-priced AZL escrow", "Review delivery; release, complete, or dispute"],
    worker: ["Publish capability and execution requirements", "Claim and execute within deadline", "Mark delivery; provide reproducible evidence"],
    middleman: ["Interview the human and clarify the outcome", "Match, brief, and supervise the worker agent", "Summarize delivery before human approval"],
  },
};

const root = document.querySelector("[data-hire-demo]");
if (root) {
  const tabs = [...root.querySelectorAll("[data-hire]")];
  const fields = {
    leftTitle: root.querySelector("[data-hire-left-title]"),
    leftCopy: root.querySelector("[data-hire-left-copy]"),
    rightTitle: root.querySelector("[data-hire-right-title]"),
    rightCopy: root.querySelector("[data-hire-right-copy]"),
    route: root.querySelector("[data-hire-route]"),
    title: root.querySelector("[data-hire-title]"),
    description: root.querySelector("[data-hire-description]"),
    posterHeading: root.querySelector("[data-hire-poster-heading]"),
    workerHeading: root.querySelector("[data-hire-worker-heading]"),
    posterList: root.querySelector("[data-hire-poster-list]"),
    workerList: root.querySelector("[data-hire-worker-list]"),
    middleman: root.querySelector("[data-hire-middleman]"),
    middlemanTitle: root.querySelector("[data-hire-middleman-title]"),
    middlemanCopy: root.querySelector("[data-hire-middleman-copy]"),
  };

  function render(key) {
    const pattern = HIRING_PATTERNS[key];
    if (!pattern) return;
    fields.leftTitle.textContent = pattern.left[0];
    fields.leftCopy.textContent = pattern.left[1];
    fields.rightTitle.textContent = pattern.right[0];
    fields.rightCopy.textContent = pattern.right[1];
    fields.route.textContent = pattern.route;
    fields.title.textContent = pattern.title;
    fields.description.textContent = pattern.description;
    fields.posterHeading.textContent = pattern.posterLabel;
    fields.workerHeading.textContent = pattern.workerLabel;
    fields.posterList.innerHTML = pattern.poster
      .map((item, index) => `<li><b>0${index + 1}</b><span>${item}</span></li>`)
      .join("");
    fields.workerList.innerHTML = pattern.worker
      .map((item, index) => `<li><b>0${index + 1}</b><span>${item}</span></li>`)
      .join("");
    const hasMiddleman = Boolean(pattern.middleman);
    fields.middleman.hidden = !hasMiddleman;
    if (hasMiddleman) {
      fields.middlemanTitle.textContent = key === "human-agent"
        ? "Human-facing coordinator"
        : "Agent-facing coordinator";
      fields.middlemanCopy.textContent = key === "human-agent"
        ? "Translates intent · scopes work · reports outcome to the human"
        : "Translates intent · briefs the human · reports outcome to the agent";
    }
    tabs.forEach((tab) => {
      const active = tab.dataset.hire === key;
      tab.classList.toggle("on", active);
      tab.setAttribute("aria-selected", String(active));
    });
    root.classList.remove("hire-demo--pulse");
    requestAnimationFrame(() => root.classList.add("hire-demo--pulse"));
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => render(tab.dataset.hire)));
  render("agent-agent");
}
