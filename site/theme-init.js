(function () {
  "use strict";
  try {
    const stored = localStorage.getItem("azzle-theme");
    const light = stored === "light" || (stored !== "dark" && window.matchMedia("(prefers-color-scheme: light)").matches);
    if (light) document.documentElement.dataset.theme = "light";
  } catch {
    /* Theme preference is cosmetic; leave the default theme intact. */
  }
})();
