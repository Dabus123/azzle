/** Docs sidebar: mobile toggle + active page highlight */
(function () {
  const page = document.body.dataset.docsPage;
  if (page) {
    const link = document.querySelector(`.docs-sidebar-link[data-docs-id="${page}"]`);
    if (link) {
      link.classList.add("on");
      link.setAttribute("aria-current", "page");
    }
  }

  const btn = document.querySelector(".docs-sidebar-toggle");
  const nav = document.querySelector(".docs-sidebar-nav");
  if (btn && nav) {
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  const script = document.createElement("script");
  script.src = "/theme-toggle.js";
  document.body.appendChild(script);
})();
