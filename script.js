// Contact form: submit to Formspree over fetch so the visitor stays on the
// page. The form keeps its action/method, so without JavaScript it still
// works as a plain POST.
const form = document.getElementById("contact-form");
const statusEl = document.getElementById("form-status");
const submitBtn = document.getElementById("contact-submit");

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("form-status--success", "form-status--error");
  if (kind) {
    statusEl.classList.add("form-status--" + kind);
  }
  statusEl.hidden = !message;
}

form.addEventListener("submit", async function (event) {
  // No novalidate on the form, so the browser has already enforced `required`
  // by the time this fires.
  event.preventDefault();
  setStatus("", null);

  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  try {
    const response = await fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      // Without this header Formspree answers 302 to its own thank-you page,
      // which fetch follows transparently — response.ok would be misleading.
      // Content-Type is deliberately unset: the browser has to generate the
      // multipart boundary itself.
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      form.reset();
      setStatus("Thanks! Your message has been sent.", "success");
    } else {
      const data = await response.json().catch(() => ({}));
      const message =
        Array.isArray(data.errors) && data.errors.length
          ? data.errors.map((e) => e.message).join(" ")
          : "Something went wrong. Please try again, or email me directly.";
      setStatus(message, "error");
    }
  } catch (err) {
    console.error("[contact]", err);
    setStatus("Network error — check your connection and try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

// Clear a stale result when the dialog is reopened.
document
  .getElementById("contact-modal")
  .addEventListener("hidden.bs.modal", () => setStatus("", null));

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
