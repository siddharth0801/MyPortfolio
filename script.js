const modal = document.getElementById("contact-modal");
const btn = document.getElementById("contact-btn");
const span = document.querySelector(".contact-modal__close");
const form = document.getElementById("contact-form");

btn.addEventListener("click", function () {
  modal.style.display = "block";
});

span.addEventListener("click", function () {
  modal.style.display = "none";
});

window.addEventListener("click", function (event) {
  if (event.target === modal) {
    modal.style.display = "none";
  }
});

// Collapse the mobile navbar after a nav link is tapped.
// Replaces the jQuery snippet that used to live in index.html.
const navCollapse = document.getElementById("navbarNav");
if (navCollapse) {
  // toggle:false is required — the Collapse constructor toggles by default,
  // which would open the menu on page load.
  const collapse = bootstrap.Collapse.getOrCreateInstance(navCollapse, { toggle: false });
  navCollapse.addEventListener("click", function (event) {
    // Above the lg breakpoint the menu is always visible, so hiding it there
    // would fire collapse events on every desktop nav click.
    if (event.target.closest(".nav-link") && navCollapse.classList.contains("show")) {
      collapse.hide();
    }
  });
}
