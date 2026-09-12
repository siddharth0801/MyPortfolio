/* Builds every section of the page from window.PORTFOLIO (data/content.js).
   Nothing here knows any content — change data/content.js, not this file. */
window.Render = (function (window, document) {
  "use strict";

  /** HTML-escape a value for interpolation into a template literal. */
  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** Escaped obj[key], or the raw obj[key + "Html"] sibling when present. */
  function rich(obj, key) {
    return obj[key + "Html"] ? obj[key + "Html"] : esc(obj[key]);
  }

  /** Write html into #id. Warns rather than throwing if the mount is absent. */
  function mount(id, html) {
    var el = document.getElementById(id);
    if (!el) {
      console.warn("[render] missing mount #" + id);
      return null;
    }
    el.innerHTML = html;
    return el;
  }

  /** Map an array to markup, skipping entries that throw, so one bad item
      cannot blank a whole section. */
  function mapSafe(list, fn) {
    return (list || [])
      .map(function (item, i) {
        try {
          return fn(item, i);
        } catch (e) {
          console.error("[render] bad entry at index " + i, item, e);
          return "";
        }
      })
      .join("");
  }

  var P = function () {
    return window.PORTFOLIO;
  };

  /* --------------------------------------------------------------------- */

  function renderMeta() {
    var site = P().site;
    if (site.title) document.title = site.title;
    var desc = document.querySelector('meta[name="description"]');
    if (desc && site.description) desc.setAttribute("content", site.description);
  }

  function renderNav() {
    var site = P().site;
    var brand = document.getElementById("nav-brand");
    if (brand) brand.textContent = site.brand;
    mount(
      "nav-links",
      mapSafe(site.nav, function (item) {
        return (
          '<li class="nav-item">' +
          '<a class="nav-link" href="' + esc(item.href) + '">' + esc(item.label) + "</a>" +
          "</li>"
        );
      })
    );
  }

  function renderHero() {
    var p = P().profile;
    var cv = p.cv || {};
    var contact = p.contact || {};
    mount(
      "hero",
      "<h1>" + esc(p.greeting) + "</h1>" +
        "<h2>I'm " + esc(p.name) + "</h2>" +
        '<div id="text-write"></div>' +
        '<div class="hero-actions">' +
        // Omitted entirely when cv.url is empty, so no dead link ships.
        (cv.url
          ? '<a class="btn btndownloadcv btn-lg" href="' + esc(cv.url) + '" role="button" ' +
            'target="_blank" rel="noopener">' + esc(cv.label || "View CV") + "</a>"
          : "") +
        '<button class="btn btn-lg" id="contact-btn" data-bs-toggle="modal" ' +
        'data-bs-target="#contact-modal">' + esc(contact.label || "Get in Touch") +
        "</button>" +
        "</div>"
    );
  }

  function renderAbout() {
    var p = P().profile;
    mount(
      "about-bio",
      "<h2>" + esc(p.name) + "</h2>" +
        "<h3>" + esc(p.tagline) +
        (p.taglineIcon ? ' <i class="' + esc(p.taglineIcon) + '" aria-hidden="true"></i>' : "") +
        "</h3>" +
        "<p>" + esc(p.bio) + "</p>" +
        '<div class="contact_about" id="about-socials"></div>'
    );
  }

  function renderEducation() {
    mount(
      "education-list",
      mapSafe(P().education, function (e) {
        return (
          '<li class="edu">' +
          '<i class="' + esc(e.icon) + '" aria-hidden="true"></i>' +
          '<div class="edu__body">' +
          '<p class="edu__degree">' + rich(e, "degree") + "</p>" +
          "<p>" + esc(e.institution) + "</p>" +
          (e.score ? "<p>" + esc(e.score) + "</p>" : "") +
          (e.dates ? "<p>" + esc(e.dates) + "</p>" : "") +
          "</div>" +
          "</li>"
        );
      })
    );
  }

  function renderSkills() {
    // A CSS grid, so the layout is a function of how many skills there are.
    // The old markup was a hardcoded 4x4 table whose last row held one cell.
    mount(
      "skills-grid",
      mapSafe(P().skills, function (s) {
        return (
          '<li class="skill">' +
          '<img class="tech-icon" src="' + esc(s.icon) + '" alt="" loading="lazy" ' +
          'decoding="async">' +
          '<span class="skill__name">' + esc(s.name) + "</span>" +
          "</li>"
        );
      })
    );
  }

  function renderProjects() {
    mount(
      "projects-grid",
      mapSafe(P().projects, function (p) {
        var link = p.link || {};
        return (
          '<div class="col">' +
          '<article class="card project-card h-100">' +
          '<img src="' + esc(p.image) + '" class="card-img-top project-card__img" ' +
          'alt="' + esc(p.alt || p.title) + '" loading="lazy" decoding="async">' +
          '<div class="card-body d-flex flex-column">' +
          '<h3 class="card-title h5">' + esc(p.title) + "</h3>" +
          '<p class="card-text">' + esc(p.description) + "</p>" +
          (link.url
            ? '<a href="' + esc(link.url) + '" class="btn btn-outline-dark mt-auto ' +
              'align-self-start" target="_blank" rel="noopener noreferrer">' +
              esc(link.label || "View") +
              '<span class="visually-hidden"> — ' + esc(p.title) + "</span></a>"
            : "") +
          "</div></article></div>"
        );
      })
    );
  }

  function socialsIn(where) {
    return (P().socials || []).filter(function (s) {
      return (s.showIn || []).indexOf(where) !== -1;
    });
  }

  function renderSocials() {
    mount(
      "about-socials",
      mapSafe(socialsIn("about"), function (s) {
        return (
          '<a href="' + esc(s.url) + '" class="btn ' + esc(s.aboutClass || "btn-secondary") +
          ' btn-sm" role="button" target="_blank" rel="noopener" ' +
          'aria-label="' + esc(s.name) + '">' +
          '<i class="' + esc(s.icon) + '" aria-hidden="true"></i></a>'
        );
      })
    );
    mount(
      "footer-socials",
      mapSafe(socialsIn("footer"), function (s) {
        return (
          '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" ' +
          'aria-label="' + esc(s.name) + '">' +
          '<i class="' + esc(s.icon) + '" aria-hidden="true"></i></a>'
        );
      })
    );
  }

  function renderFooter() {
    var site = P().site;
    mount(
      "footer-copyright",
      "<p>Copyright © " + new Date().getFullYear() + " " + esc(site.copyrightHolder) +
        ". " + esc(site.copyrightSuffix) + "</p>"
    );
  }

  function renderContactForm() {
    var c = P().contact;
    var title = document.getElementById("contact-modal-title");
    if (title) title.textContent = c.heading;

    var fields = mapSafe(c.fields, function (f) {
      var control =
        f.type === "textarea"
          ? '<textarea class="form-control" id="' + esc(f.name) + '" name="' + esc(f.name) +
            '" rows="' + esc(f.rows || 5) + '"' + (f.required ? " required" : "") + "></textarea>"
          : '<input type="' + esc(f.type || "text") + '" class="form-control" id="' +
            esc(f.name) + '" name="' + esc(f.name) + '"' + (f.required ? " required" : "") + ">";
      return (
        '<div class="mb-3">' +
        '<label for="' + esc(f.name) + '" class="form-label">' + esc(f.label) + "</label>" +
        control +
        "</div>"
      );
    });

    mount(
      "contact-form-mount",
      // action/method are kept so the form still works as a plain POST if
      // JavaScript fails; js/contact.js intercepts the submit.
      '<form id="contact-form" action="' + esc(c.endpoint) + '" method="POST">' +
        fields +
        '<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" ' +
        'aria-hidden="true" class="visually-hidden">' +
        '<button type="submit" class="btn btn-success" id="contact-submit">' +
        esc(c.submitLabel) + "</button>" +
        '<p id="form-status" class="form-status" role="status" aria-live="polite" hidden></p>' +
        "</form>"
    );
  }

  /** Run every renderer. One failing section never blanks the others. */
  function all() {
    var steps = [
      ["meta", renderMeta],
      ["nav", renderNav],
      ["hero", renderHero],
      ["about", renderAbout],
      ["education", renderEducation],
      ["skills", renderSkills],
      ["projects", renderProjects],
      ["socials", renderSocials],
      ["footer", renderFooter],
      ["contact form", renderContactForm],
    ];
    var failed = [];
    steps.forEach(function (step) {
      try {
        step[1]();
      } catch (e) {
        failed.push(step[0]);
        console.error("[render] section '" + step[0] + "' failed:", e);
      }
    });
    return failed;
  }

  return { all: all, esc: esc };
})(window, document);
