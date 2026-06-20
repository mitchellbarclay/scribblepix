// About + Install modals. Both live at the top level of the DOM (above the
// splash screen) so they can be opened from the app menu and the splash alike.
let _openAbout = () => {};
let _openInstall = () => {};
export function openAbout() { _openAbout(); }
export function openInstall() { _openInstall(); }

export function initSettingsMenu() {
  _openAbout = wireModal('about').open;
  _openInstall = wireModal('install').open;

  // Install modal: iPad / Android device tabs.
  const panel = document.getElementById('install-panel');
  const tabs = panel.querySelectorAll('.install-tab');
  const pages = panel.querySelectorAll('.install-page');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const device = tab.dataset.device;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      pages.forEach(p => p.classList.toggle('active', p.dataset.device === device));
    });
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
