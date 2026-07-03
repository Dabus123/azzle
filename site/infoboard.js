(function () {
  "use strict";

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
    board.style.minHeight = "";
    requestAnimationFrame(() => {
      const bw = board.clientWidth;
      const sw = el.scrollWidth;
      if (bw < 1 || sw <= bw) return;
      const scale = bw / sw;
      el.style.setProperty("--flap-scale", String(scale));
      board.style.minHeight = `${el.getBoundingClientRect().height}px`;
    });
  }

  function buildFlapLine(el) {
    if (el.dataset.flapBuilt === "1") return;
    const text = (el.dataset.flapLine || "").trim().toUpperCase();
    if (!text) return;

    el.textContent = "";
    el.setAttribute("role", "text");
    el.setAttribute("aria-label", text);
    el.dataset.flapBuilt = "1";
    delete el.dataset.flapLine;

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

    cells.forEach((cell, i) => {
      setTimeout(() => rollCell(cell), 140 + i * 46);
    });
    fitFlapLine(el);
  }

  function init() {
    if (window.__azzleInfoboardInit) return;
    window.__azzleInfoboardInit = true;
    document.querySelectorAll("[data-flap-line]").forEach(buildFlapLine);
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
