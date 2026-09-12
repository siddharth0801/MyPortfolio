/* Types a string into an element one character at a time. */
window.TypeWriter = (function () {
  "use strict";
  var timer = null;

  function start(el, text, speed) {
    if (!el || !text) return;
    clearTimeout(timer); // calling twice used to interleave into itself
    el.textContent = "";
    // Screen readers get the whole line at once rather than character by
    // character, and it is announced as decoration only.
    el.setAttribute("aria-label", text);
    var i = 0;

    (function step() {
      if (i >= text.length) return;
      // textContent, not innerHTML +=, which reparsed the growing string on
      // every one of ~40 ticks.
      el.textContent += text.charAt(i);
      i += 1;
      timer = setTimeout(step, speed);
    })();
  }

  return { start: start };
})();
