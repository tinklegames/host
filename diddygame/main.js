function triggerKey(code, type = "keydown") {
  document.dispatchEvent(new KeyboardEvent(type, { key: code }));
}

function setupButton(id, key) {
  const btn = document.getElementById(id);

  // Touch support
  btn.addEventListener("touchstart", e => {
    e.preventDefault();
    triggerKey(key, "keydown");
  });
  btn.addEventListener("touchend", e => {
    e.preventDefault();
    triggerKey(key, "keyup");
  });

  // Mouse support (for desktop clicks)
  btn.addEventListener("mousedown", e => {
    e.preventDefault();
    triggerKey(key, "keydown");
  });
  btn.addEventListener("mouseup", e => {
    e.preventDefault();
    triggerKey(key, "keyup");
  });
}

setupButton("btn-left", "ArrowLeft");
setupButton("btn-right", "ArrowRight");
setupButton("btn-up", "ArrowUp");
setupButton("btn-down", "ArrowDown");