// About + Install modals. Both live at the top level of the DOM (above the
// splash screen) so they can be opened from the app menu and the splash alike.
let _openAbout = () => {};
let _openInstall = () => {};
export function openAbout() { _openAbout(); }
export function openInstall() { _openInstall(); }

export function initSettingsMenu() {
  _openAbout = wireModal('about').open;
  const install = wireModal('install');

  // Install modal: iPad / Android device tabs.
  const panel = document.getElementById('install-panel');
  const wrap = panel.querySelector('.install-pages');
  const tabs = panel.querySelectorAll('.install-tab');
  const pages = panel.querySelectorAll('.install-page');

  // The two pages have a different number of steps, so the panel height changes
  // between them. Pages are stacked absolutely; we drive the wrapper height here
  // so the swap eases (and the pages cross-fade) instead of jump-cutting.
  const activePage = () => panel.querySelector('.install-page.active');
  const sizeTo = (page, animate) => {
    if (!page) return;
    if (!animate) wrap.style.transition = 'none';
    wrap.style.height = page.offsetHeight + 'px';
    if (!animate) { void wrap.offsetHeight; wrap.style.transition = ''; }
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const device = tab.dataset.device;
      let target = null;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      pages.forEach(p => {
        const on = p.dataset.device === device;
        p.classList.toggle('active', on);
        if (on) target = p;
      });
      sizeTo(target, true);
    });
  });

  // Set the starting height with no animation each time the modal opens, then
  // correct it on the next frame once fonts/layout have settled.
  _openInstall = () => {
    install.open();
    sizeTo(activePage(), false);
    requestAnimationFrame(() => sizeTo(activePage(), false));
  };

  // Keep the height correct if the viewport reflows while the modal is open.
  window.addEventListener('resize', () => {
    if (panel.classList.contains('visible')) sizeTo(activePage(), false);
  });
}

// Wire a modal's overlay click, close button, and Escape; return its open()/close().
function wireModal(name) {
  const overlay = document.getElementById(name + '-overlay');
  const panel = document.getElementById(name + '-panel');
  const open = () => { overlay.classList.add('visible'); panel.classList.add('visible'); };
  const close = () => { overlay.classList.remove('visible'); panel.classList.remove('visible'); };

  overlay.addEventListener('click', close);
  panel.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  return { open, close };
}
