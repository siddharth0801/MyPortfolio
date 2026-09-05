/* Contact form: submits to Formspree over fetch so the visitor stays on the
   page. The form keeps its action/method, so without JavaScript it still
   works as an ordinary POST. */
window.Contact = (function () {
  "use strict";

  var DEFAULTS = {
    sendingLabel: "Sending…",
    successMessage: "Thanks! Your message has been sent.",
    errorMessage: "Something went wrong. Please try again, or email me directly.",
    networkErrorMessage: "Network error — check your connection and try again.",
  };

  function init(config) {
    var cfg = Object.assign({}, DEFAULTS, config || {});
    var form = document.getElementById("contact-form");
    var statusEl = document.getElementById("form-status");
    var submitBtn = document.getElementById("contact-submit");
    var modal = document.getElementById("contact-modal");
    if (!form || !statusEl || !submitBtn) return;

    function setStatus(message, kind) {
      statusEl.textContent = message;
      statusEl.classList.remove("form-status--success", "form-status--error");
      if (kind) statusEl.classList.add("form-status--" + kind);
      statusEl.hidden = !message;
    }

    form.addEventListener("submit", async function (event) {
      // The form has no novalidate, so the browser has already enforced
      // `required` by the time this fires.
      event.preventDefault();
      setStatus("", null);

      var originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = cfg.sendingLabel;

      try {
        var response = await fetch(form.action, {
          method: "POST",
          body: new FormData(form),
          // Without this header Formspree answers 302 to its own thank-you
          // page, which fetch follows transparently, making response.ok
          // misleading. Content-Type is deliberately unset so the browser
          // generates the multipart boundary itself.
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          form.reset();
          setStatus(cfg.successMessage, "success");
        } else {
          var data = await response.json().catch(function () {
            return {};
          });
          var message =
            Array.isArray(data.errors) && data.errors.length
              ? data.errors
                  .map(function (e) {
                    return e.message;
                  })
                  .join(" ")
              : cfg.errorMessage;
          setStatus(message, "error");
        }
      } catch (err) {
        console.error("[contact]", err);
        setStatus(cfg.networkErrorMessage, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });

    // Clear a stale result when the dialog is reopened.
    if (modal) {
      modal.addEventListener("hidden.bs.modal", function () {
        setStatus("", null);
      });
    }
  }

  return { init: init };
})();
