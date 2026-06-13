// Lets the app menu deep-link to a specific settings page (About / Install).
let _openSettingsTo = () => {};
export function openSettings(pageIndex) { _openSettingsTo(pageIndex || 0); }

export function initSettingsMenu() {
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  const body = panel.querySelector('.spanel-body');
  const pill = panel.querySelector('.stab-pill');
  const tabs = panel.querySelectorAll('.stab');
  const pages = panel.querySelectorAll('.spage');
  const closeBtn = panel.querySelector('.spanel-close');

  let heightCleanup = null;

  // Open the panel directly on a chosen page (used by the app menu).
  _openSettingsTo = (i) => {
    tabs.forEach((t, j) => t.classList.toggle('active', j === i));
    pages.forEach((p, j) => p.classList.toggle('active', j === i));
    openPanel();
  };

  // ── Pill ──────────────────────────────────────────────────────────────────

  function placePill(targetTab, animate) {
    pill.classList.toggle('sliding', animate);
    pill.style.left   = targetTab.offsetLeft  + 'px';
    pill.style.top    = targetTab.offsetTop   + 'px';
    pill.style.width  = targetTab.offsetWidth  + 'px';
    pill.style.height = targetTab.offsetHeight + 'px';
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function openPanel() {
    body.style.height = ''; // clear any stale height from a previous animation
    body.classList.add('settled');
    overlay.classList.add('visible');
    panel.classList.add('visible');
    requestAnimationFrame(() => placePill(panel.querySelector('.stab.active'), false));
  }

  function closePanel() {
    overlay.classList.remove('visible');
    panel.classList.remove('visible');
    if (heightCleanup) {
      body.removeEventListener('transitionend', heightCleanup);
      heightCleanup = null;
    }
    body.style.height = '';
  }

  overlay.addEventListener('click', closePanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  // ── Tab switching ─────────────────────────────────────────────────────────

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) return;

      placePill(tab, true);

      if (heightCleanup) {
        body.removeEventListener('transitionend', heightCleanup);
        heightCleanup = null;
      }

      // FLIP: measure from-height while body is still auto, switch content,
      // then measure to-height (also auto), only THEN pin the body to fromH.
      // This avoids the overflow:hidden child-constraint problem where an
      // explicit height on the body causes children to report that height too.
      const fromH = body.offsetHeight; // reflow #1 — current content, auto body

      // Switch content
      tabs.forEach(t => t.classList.remove('active'));
      pages.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      pages[i].classList.add('active');

      const toH = body.offsetHeight; // reflow #2 — new content, still auto body

      if (fromH === toH) return; // nothing to animate

      body.classList.remove('settled');

      // Pin to fromH (synchronous, no paint frame yet), then animate to toH.
      body.style.height = fromH + 'px';

      requestAnimationFrame(() => {
        body.style.height = toH + 'px';

        heightCleanup = e => {
          if (e.propertyName !== 'height') return;
          body.style.height = '';
          body.classList.add('settled');
          body.removeEventListener('transitionend', heightCleanup);
          heightCleanup = null;
        };
        body.addEventListener('transitionend', heightCleanup);
      });
    });
  });
}
