/* Boot: render every section from the data, then wire up behaviour. */
(function () {
  "use strict";

  function showBanner(message) {
    var banner = document.getElementById("render-error");
    if (!banner) return;
    if (message) banner.textContent = message;
    banner.hidden = false;
  }

  function initNavCollapse() {
    var collapse = document.getElementById("navbarNav");
    if (!collapse || !window.bootstrap) return;
    // toggle:false is required — the Collapse constructor toggles by default,
    // which would open the mobile menu on page load.
    var instance = window.bootstrap.Collapse.getOrCreateInstance(collapse, { toggle: false });
    collapse.addEventListener("click", function (event) {
      // Above the lg breakpoint the menu is always visible, so hiding it there
      // would fire collapse events on every desktop nav click.
      if (event.target.closest(".nav-link") && collapse.classList.contains("show")) {
        instance.hide();
      }
    });
  }

  function boot() {
    if (!window.PORTFOLIO) {
      throw new Error("PORTFOLIO is undefined — data/content.js failed to load or has a syntax error.");
    }

    var failed = window.Render.all();
    if (failed.length) {
      // A section threw. The rest of the page is fine, but say so rather
      // than leaving a silently empty region.
      showBanner("Some content failed to load: " + failed.join(", ") + ".");
    }

    var profile = window.PORTFOLIO.profile || {};
    var typeEl = document.getElementById("text-write");
    if (typeEl && profile.roles && profile.roles.length) {
      // Runs after Render.all(), which is what creates #text-write.
      window.TypeWriter.start(typeEl, profile.roles.join(", "), profile.typeSpeedMs || 110);
    }

    window.Contact.init(window.PORTFOLIO.contact || {});
    initNavCollapse();
  }

  try {
    boot();
  } catch (err) {
    console.error("[portfolio] render failed:", err);
    showBanner(null); // keep the markup's default message and its contact link
  }
})();
