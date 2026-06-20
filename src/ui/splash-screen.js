import { startSplashAmbient, stopSplashAmbient } from './splash-ambient.js';
import { openInstall } from './settings-menu.js';

const AGENT_MODE = new URLSearchParams(location.search).has('agent');

export function initSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  if (AGENT_MODE) { splash.remove(); return; }

  startSplashAmbient(splash);

  function dismiss(callback) {
    stopSplashAmbient();
    splash.classList.add('hiding');
    splash.addEventListener('transitionend', () => {
      splash.remove();
      if (callback) callback();
    }, { once: true });
  }

  document.getElementById('splash-draw-btn').addEventListener('click', () => dismiss());
  document.getElementById('splash-open-btn').addEventListener('click', () => {
    dismiss(() => document.getElementById('open-image-input').click());
  });

  // Install: open the shared install modal (same one the app menu uses).
  document.getElementById('splash-install-btn').addEventListener('click', () => {
    openInstall();
  });
}
