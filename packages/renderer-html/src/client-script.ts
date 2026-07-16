export const CLIENT_SCRIPT = `
(function () {
  var scenes = Array.prototype.slice.call(document.querySelectorAll(".scene"));
  var counter = document.getElementById("rvs-counter");
  var live = document.getElementById("rvs-live");
  var index = 0;

  function render() {
    scenes.forEach(function (scene, i) {
      scene.classList.toggle("is-active", i === index);
    });
    if (counter) counter.textContent = (index + 1) + " / " + scenes.length;
    if (live) live.textContent = scenes[index] ? scenes[index].getAttribute("aria-label") : "";
  }

  function goTo(next) {
    index = Math.max(0, Math.min(scenes.length - 1, next));
    render();
  }

  function fitStage() {
    var stage = document.querySelector(".stage");
    if (!stage || document.body.classList.contains("rvs-print-preview")) return;
    var scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = "scale(" + scale + ")";
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); goTo(index + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); goTo(0); }
    else if (event.key === "End") { event.preventDefault(); goTo(scenes.length - 1); }
  });

  var prevBtn = document.getElementById("rvs-prev");
  var nextBtn = document.getElementById("rvs-next");
  if (prevBtn) prevBtn.addEventListener("click", function () { goTo(index - 1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { goTo(index + 1); });

  window.addEventListener("resize", fitStage);

  var params = new URLSearchParams(window.location.search);
  if (params.get("print") === "1") {
    document.body.classList.add("rvs-print-preview");
  }

  window.__rvs = {
    total: scenes.length,
    goTo: goTo,
    getIndex: function () { return index; },
    setPrintPreview: function (on) {
      document.body.classList.toggle("rvs-print-preview", Boolean(on));
      fitStage();
    },
  };

  fitStage();
  render();
})();
`;
