const HOLD_MS = 600;

export function initSettingsMenu() {
  const btn = document.getElementById('settings-btn');
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  const tabs = panel.querySelectorAll('.stab');
  const pages = panel.querySelectorAll('.spage');
  const closeBtn = panel.querySelector('.spanel-close');

  let holdTimer = null;

  function startHold(e) {
    e.preventDefault();
    clearTimeout(holdTimer);
    btn.classList.add('holding');
    holdTimer = setTimeout(openPanel, HOLD_MS);
  }

  function cancelHold() {
    clearTimeout(holdTimer);
    btn.classList.remove('holding');
  }

  btn.addEventListener('pointerdown', startHold);
  btn.addEventListener('pointerup', cancelHold);
  btn.addEventListener('pointercancel', cancelHold);
  btn.addEventListener('pointerleave', cancelHold);
  btn.addEventListener('contextmenu', e => e.preventDefault());

  function openPanel() {
    btn.classList.remove('holding');
    overlay.classList.add('visible');
    panel.classList.add('visible');
  }

  function closePanel() {
    overlay.classList.remove('visible');
    panel.classList.remove('visible');
  }

  overlay.addEventListener('click', closePanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      pages.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      pages[i].classList.add('active');
    });
  });
}
