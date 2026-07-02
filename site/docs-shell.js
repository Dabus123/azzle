/** Mobile docs sidebar toggle */
(function () {
  const btn = document.querySelector(".docs-sidebar-toggle");
  const nav = document.querySelector(".docs-sidebar-nav");
  if (!btn || !nav) return;
  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
})();
