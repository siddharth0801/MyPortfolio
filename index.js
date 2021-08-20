var i = 0;
var txt = 'Student, Coder, Chess Player';
var speed = 110;

function typeWriter() {
  if (i < txt.length) {
    document.getElementById("text-write").innerHTML += txt.charAt(i);
    i++;
    setTimeout(typeWriter, speed);
  }
}
