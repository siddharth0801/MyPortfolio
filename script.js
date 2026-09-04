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
