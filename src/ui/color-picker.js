import state from '../state.js';
import { colorAtPos, rgbToHex, rgbToHsl, hslToRgbCss, parseColorRgb, lightenColor, darkenColor } from '../core/color-utils.js';
import { updateBrushPreview } from './brush-slider.js';
import { makeVerticalSlider } from './vertical-slider.js';

// Colour picking is split into two sliders:
//   • base slider  — the full rainbow ramp (keeps white & dark ends, so a child
//     who only uses one slider can still reach every basic colour);
//   • modifier slider — shifts the base lighter (top) or darker (bottom),
//     centred = base untouched, clamped short of pure white / black.
// The final colour = modifier(base) and drives state.color, the swatch and the
// theme.

var baseTrack, baseHandle, modTrack, modHandle, swatchEl;
var baseSlider, modSlider;
var baseP = 0.5, modP = 0.5;

// Total lightness swing across the modifier slider (±half this from centre).
var MOD_RANGE = 0.52;

// Apply the light/dark modifier to a base rgb, returning an rgb array.
function applyModifier(rgb, mp) {
  var dl = (0.5 - mp) * MOD_RANGE;           // top (mp<0.5) lightens, bottom darkens
  var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  var s = dl > 0 ? Math.min(1, hsl[1] + 0.04) : hsl[1]; // keep tints from washing to grey
  var l = Math.max(0.16, Math.min(0.9, hsl[2] + dl));   // never quite white/black
  return parseColorRgb(hslToRgbCss(hsl[0], s, l));
}

// ── Theme — derived from the FINAL colour (unchanged behaviour, new input) ────
var bgPending = null, bgRafScheduled = false;
function updateBackground(finalRgb) {
  bgPending = finalRgb;
  if (bgRafScheduled) return;
  bgRafScheduled = true;
  requestAnimationFrame(function() {
    bgRafScheduled = false;
    var rgb = bgPending;
    var nearWhite = rgb[0] > 240 && rgb[1] > 240 && rgb[2] > 240;
    var c1, c2, c3;
    if (nearWhite) {
      c1 = [232,236,240]; c2 = [218,223,229]; c3 = [198,205,213];
    } else {
      c1 = lightenColor(rgb, 0.84);
      c2 = lightenColor(rgb, 0.78);
      c3 = lightenColor(rgb, 0.72);
    }
    document.body.style.setProperty('--bg-c1', 'rgb('+c1.join(',')+')');
    document.body.style.setProperty('--bg-c2', 'rgb('+c2.join(',')+')');
    document.body.style.setProperty('--bg-c3', 'rgb('+c3.join(',')+')');
    var rail = lightenColor(rgb, 0.62);
    document.body.style.setProperty('--rail-bg', 'rgba('+rail[0]+','+rail[1]+','+rail[2]+',0.55)');
    document.body.style.setProperty('--accent', 'rgb('+rgb.join(',')+')');
    var accDark = darkenColor(rgb, 0.45);
    document.body.style.setProperty('--accent-dark', 'rgb('+accDark.join(',')+')');
  });
}

// At the hard ends of the base slider, lock to pure white / pure black and
// ignore the modifier — so black & white are always one slider away.
var WHITE_END = 0.025, BLACK_END = 0.975;

// Paint the modifier track to preview its actual range for the current hue:
// lightest at top → base in the middle → darkest at bottom. At a locked end
// it shows flat (the modifier has no effect there).
function updateModifierTrack(baseRgb, flat) {
  if (!modTrack) return;
  if (flat) { modTrack.style.background = 'rgb('+baseRgb.join(',')+')'; return; }
  var top = applyModifier(baseRgb, 0);
  var bot = applyModifier(baseRgb, 1);
  modTrack.style.background = 'linear-gradient(to bottom, rgb('+top.join(',')+'), rgb('+baseRgb.join(',')+') 50%, rgb('+bot.join(',')+'))';
}

function recompute() {
  var atWhite = baseP <= WHITE_END, atBlack = baseP >= BLACK_END;
  var baseRgb = atWhite ? [255, 255, 255] : atBlack ? [0, 0, 0] : colorAtPos(baseP);
  var finalRgb = (atWhite || atBlack) ? baseRgb : applyModifier(baseRgb, modP);
  state.color = rgbToHex(finalRgb);
  if (swatchEl) swatchEl.style.background = state.color;
  updateModifierTrack(baseRgb, atWhite || atBlack);
  updateBackground(finalRgb);
  updateBrushPreview();
}

// main.js forwards window-level pointer moves/releases here; fan them out to
// whichever colour slider is currently being dragged (each ignores if idle).
export function onColorMove(clientY) { baseSlider.move(clientY); modSlider.move(clientY); }
export function onColorRelease() { baseSlider.release(); modSlider.release(); }

export function initColorPicker() {
  baseTrack = document.getElementById('color-track');
  baseHandle = document.getElementById('color-handle');
  modTrack = document.getElementById('mod-track');
  modHandle = document.getElementById('mod-handle');
  swatchEl = document.getElementById('color-swatch');

  baseSlider = makeVerticalSlider(baseTrack, baseHandle, function(p) { baseP = p; recompute(); });
  modSlider = makeVerticalSlider(modTrack, modHandle, function(p) { modP = p; recompute(); });

  modSlider.setP(0.5);
  baseSlider.setP(0.5);
}
