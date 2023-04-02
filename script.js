const modal = document.getElementById("contact-modal");
const btn = document.getElementById("contact-btn");
const span = document.getElementsByClassName("close")[0];
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
