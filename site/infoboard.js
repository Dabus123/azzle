(function () {
  "use strict";

  const COUNTDOWN_END = 1786676400;

  function startCountdown() {
    const daysEl = document.querySelector("[data-countdown-days]");
    const hoursEl = document.querySelector("[data-countdown-hours]");
    const minutesEl = document.querySelector("[data-countdown-minutes]");
    const secondsEl = document.querySelector("[data-countdown-seconds]");
    if (!daysEl || !hoursEl || !minutesEl || !secondsEl) return;
    const tick = () => {
      const remaining = Math.max(0, COUNTDOWN_END - Math.floor(Date.now() / 1000));
      const days = Math.floor(remaining / 86400);
      const hours = Math.floor((remaining % 86400) / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      const seconds = remaining % 60;
      daysEl.textContent = String(days).padStart(2, "0");
      hoursEl.textContent = String(hours).padStart(2, "0");
      minutesEl.textContent = String(minutes).padStart(2, "0");
      secondsEl.textContent = String(seconds).padStart(2, "0");
    };
    tick();
    window.setInterval(tick, 1000);
  }

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function rollCell(cell) {
    if (reduce.matches) {
      cell.classList.add("rd-flap-settled");
      return;
    }
    cell.classList.remove("rd-flap-rolling", "rd-flap-settled");
    void cell.offsetWidth;
    cell.classList.add("rd-flap-rolling");
  }

  function onRollEnd(cell, e) {
    if (e.animationName !== "rdFlapRollDown") return;
    cell.classList.remove("rd-flap-rolling");
    cell.classList.add("rd-flap-settled");
  }

  function createCell(ch) {
    const cell = document.createElement("span");
    const isDot = ch === "·" || ch === ".";
    cell.className = "rd-flap-cell" + (isDot ? " rd-flap-cell--dot" : "");
    const safe = ch.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    cell.innerHTML =
      `<span class="rd-flap-top-wrap">` +
      `<span class="rd-flap-glyph">${safe}</span></span>` +
      `<span class="rd-flap-bot-wrap">` +
      `<span class="rd-flap-glyph">${safe}</span></span>`;
    cell.addEventListener("mouseenter", () => rollCell(cell));
    cell.querySelector(".rd-flap-top-wrap")?.addEventListener("animationend", (e) => onRollEnd(cell, e));
    return cell;
  }

  function fitFlapLine(el) {
    const board = el.closest(".rd-infoboard");
    if (!board) return;
    el.style.setProperty("--flap-scale", "1");
    el.style.height = "";
    requestAnimationFrame(() => {
      const styles = getComputedStyle(board);
      const bw = board.clientWidth -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight);
      const sw = el.scrollWidth;
      if (bw < 1) return;
      if (sw > bw) {
        const scale = Math.min(1, bw / sw);
        el.style.setProperty("--flap-scale", String(scale));
        el.style.height = `${el.scrollHeight * scale}px`;
      }
    });
  }

  function buildFlapLine(el, explicitText) {
    const text = (explicitText ?? el.dataset.flapLine ?? "").trim().toUpperCase();
    if (!text) return;

    if (el.dataset.flapBuilt === "1" && el.dataset.flapText === text) return;
    el.textContent = "";
    el.setAttribute("role", "text");
    el.setAttribute("aria-label", text);
    el.dataset.flapBuilt = "1";
    el.dataset.flapText = text;
    if (!explicitText) delete el.dataset.flapLine;

    const cells = [];
    for (const ch of text) {
      if (ch === " ") {
        const cell = document.createElement("span");
        cell.className = "rd-flap-cell rd-flap-cell--space";
        cell.setAttribute("aria-hidden", "true");
        el.appendChild(cell);
        continue;
      }
      const cell = createCell(ch);
      cells.push(cell);
      el.appendChild(cell);
    }

    cells.forEach((cell, i) => setTimeout(() => rollCell(cell), 140 + i * 24));
    fitFlapLine(el);
  }

  function init() {
    if (window.__azzleInfoboardInit) return;
    window.__azzleInfoboardInit = true;
    document.querySelectorAll("[data-flap-line]").forEach((el) => buildFlapLine(el));
    startCountdown();
    window.addEventListener("resize", () => {
      document.querySelectorAll(".rd-infoboard-line").forEach(fitFlapLine);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
