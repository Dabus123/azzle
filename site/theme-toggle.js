(function () {
  "use strict";
  const key = "azzle-theme";
  const root = document.documentElement;
  const stored = localStorage.getItem(key);
  if (stored === "light" || stored === "dark") root.dataset.theme = stored;
  else if (window.matchMedia("(prefers-color-scheme: light)").matches) root.dataset.theme = "light";

  function update(button) {
    const light = root.dataset.theme === "light";
    button.setAttribute("aria-pressed", light ? "true" : "false");
    button.setAttribute("aria-label", light ? "Use dark mode" : "Use light mode");
    button.title = light ? "Use dark mode" : "Use light mode";
    button.innerHTML = light ? "☾<span>Dark</span>" : "☼<span>Light</span>";
  }

  if (!document.querySelector("[data-theme-toggle]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "azzle-theme-toggle azzle-theme-toggle--floating";
    button.dataset.themeToggle = "";
    button.setAttribute("aria-pressed", "false");
    button.textContent = "☼";
    document.body.appendChild(button);
  }

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    update(button);
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "light" ? "dark" : "light";
      root.dataset.theme = next;
      localStorage.setItem(key, next);
      update(button);
    });
  });
})();
