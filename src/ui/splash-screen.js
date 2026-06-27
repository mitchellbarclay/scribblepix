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
    let removed = false;
    const finish = () => {
      if (removed) return;
      removed = true;
      splash.remove();
      if (callback) callback();
    };
    splash.addEventListener('transitionend', finish, { once: true });
    // Fallback: never strand the splash if transitionend doesn't fire (tab
    // backgrounded mid-dismiss, reduced-motion stripping the transition, etc.).
    setTimeout(finish, 600);
  }

  // Kill the ambient loop the instant a finger lands on any button — frees the
  // main thread before the click resolves, so a tap can't be swallowed while the
  // screensaver is saturating the frame budget.
  splash.querySelectorAll('button').forEach((b) =>
    b.addEventListener('pointerdown', () => stopSplashAmbient()));

  document.getElementById('splash-draw-btn').addEventListener('click', () => dismiss());
  document.getElementById('splash-open-btn').addEventListener('click', () => {
    dismiss(() => document.getElementById('open-image-input').click());
  });

  // Install: open the shared install modal (same one the app menu uses).
  document.getElementById('splash-install-btn').addEventListener('click', () => {
    openInstall();
  });
}
