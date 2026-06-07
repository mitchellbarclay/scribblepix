export function initRailSync() {
  var toolPill = document.getElementById('tool-pill');
  var sliderGroup = document.getElementById('slider-group');

  function sync() {
    sliderGroup.style.height = toolPill.offsetHeight + 'px';
  }

  new ResizeObserver(function() { requestAnimationFrame(sync); }).observe(toolPill);
}
