/** Homepage section quicknav — dot rail + scroll spy */
(function () {
  const nav = document.querySelector(".home-quicknav");
  if (!nav) return;

  const dots = [...nav.querySelectorAll(".home-quicknav-dot")];
  const sections = dots
    .map((d) => {
      const id = (d.getAttribute("href") || "").slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  if (!sections.length) return;

  function setActive(id) {
    dots.forEach((d) => {
      const on = d.getAttribute("href") === "#" + id;
      d.classList.toggle("on", on);
      if (on) d.setAttribute("aria-current", "true");
      else d.removeAttribute("aria-current");
    });
  }

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]?.target?.id) setActive(visible[0].target.id);
    },
    { rootMargin: "-42% 0px -42% 0px", threshold: [0, 0.15, 0.4, 0.65] }
  );

  sections.forEach((s) => io.observe(s));

  dots.forEach((d) => {
    d.addEventListener("click", (e) => {
      const id = (d.getAttribute("href") || "").slice(1);
      const el = id && document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
    });
  });
})();
