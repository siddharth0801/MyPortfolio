var i = 0;
var txt = 'Software Engineer, Explorer, Chess Player';
var speed = 110;

function typeWriter() {
  if (i < txt.length) {
    document.getElementById("text-write").innerHTML += txt.charAt(i);
    i++;
    setTimeout(typeWriter, speed);
  }
}

// Previously called from an inline <script> in index.html. This file is
// deferred, so the DOM is parsed by the time it runs.
typeWriter();
