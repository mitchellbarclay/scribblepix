import state from '../state.js';

export function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

export function hslToRgb(hsl) {
  var m = hsl.match(/hsl\((\d+),100%,50%\)/);
  if (!m) return [255, 0, 0];
  var h = parseInt(m[1]) / 360;
  function f(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q-p)*6*t;
    if (t < 0.5) return q;
    if (t < 2/3) return p + (q-p)*(2/3-t)*6;
    return p;
  }
  return [Math.round(f(0,1,h+1/3)*255), Math.round(f(0,1,h)*255), Math.round(f(0,1,h-1/3)*255)];
}

export function parseColorRgb(css) {
  if (!css) return [0, 0, 0];
  if (css[0] === '#') return hexToRgb(css);
  if (css.indexOf('hsl') === 0) return hslToRgb(css);
  var m = css.match(/\d+/g);
  return m ? [+m[0]|0, +m[1]|0, +m[2]|0] : [0, 0, 0];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(function(c) { return ('0' + c.toString(16)).slice(-2); }).join('');
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r,g,b), mn = Math.min(r,g,b);
  var h = 0, s = 0, l = (mx+mn)/2;
  if (mx !== mn) {
    var d = mx - mn;
    s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
    if (mx === r)      h = (g-b)/d + (g < b ? 6 : 0);
    else if (mx === g) h = (b-r)/d + 2;
    else               h = (r-g)/d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgbCss(h, s, l) {
  h = ((h%360)+360)%360/360;
  if (s <= 0) { var v = Math.round(l*255); return 'rgb('+v+','+v+','+v+')'; }
  var q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  function f(t) {
    t = (t%1+1)%1;
    if (t < 1/6) return p+(q-p)*6*t;
    if (t < 0.5) return q;
    if (t < 2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  }
  return 'rgb('+Math.round(f(h+1/3)*255)+','+Math.round(f(h)*255)+','+Math.round(f(h-1/3)*255)+')';
}

// Deterministic shade: dl shifts lightness, dh nudges hue (degrees).
export function shadeColor(css, dl, dh) {
  var rgb = parseColorRgb(css);
  var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  var h = hsl[0] + (dh || 0);
  var s = Math.max(0.05, Math.min(1, hsl[1] + (dl < 0 ? -0.05 : 0.04)));
  var l = Math.max(0.05, Math.min(0.95, hsl[2] + dl));
  return hslToRgbCss(h, s, l);
}

export function adjacentColor(css, hueRange) {
  if (state.rainbowMode) return 'hsl(' + Math.floor(Math.random()*360) + ',95%,55%)';
  hueRange = hueRange == null ? 22 : hueRange;
  var rgb = parseColorRgb(css);
  var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  var h = hsl[0] + (Math.random()-0.5)*hueRange*2;
  var s = Math.max(0.05, Math.min(1, hsl[1] + (Math.random()-0.5)*0.18));
  var l = Math.max(0.18, Math.min(0.85, hsl[2] + (Math.random()-0.5)*0.22));
  return hslToRgbCss(h, s, l);
}

// Colour-track stops (matches the CSS gradient in drawing-app.html)
export var colorStops = [
  {pos:0.00, rgb:[255,255,255]},
  {pos:0.10, rgb:[255,95,162]},
  {pos:0.22, rgb:[196,61,255]},
  {pos:0.34, rgb:[111,95,255]},
  {pos:0.47, rgb:[63,166,255]},
  {pos:0.60, rgb:[63,255,138]},
  {pos:0.73, rgb:[255,229,63]},
  {pos:0.83, rgb:[255,127,63]},
  {pos:0.92, rgb:[255,63,63]},
  {pos:1.00, rgb:[0,0,0]}
];

export function colorAtPos(p) {
  for (var i = 0; i < colorStops.length-1; i++) {
    if (p <= colorStops[i+1].pos) {
      var a = colorStops[i], b = colorStops[i+1];
      var span = b.pos - a.pos;
      var t = span > 0 ? (p - a.pos) / span : 0;
      return [
        Math.round(a.rgb[0] + (b.rgb[0]-a.rgb[0])*t),
        Math.round(a.rgb[1] + (b.rgb[1]-a.rgb[1])*t),
        Math.round(a.rgb[2] + (b.rgb[2]-a.rgb[2])*t)
      ];
    }
  }
  return colorStops[colorStops.length-1].rgb;
}

export function muteColor(rgb) {
  var t = 0.72;
  return [
    Math.round(rgb[0]*(1-t)+12*t),
    Math.round(rgb[1]*(1-t)+12*t),
    Math.round(rgb[2]*(1-t)+24*t)
  ];
}

export function lightenColor(rgb, t) {
  return [
    Math.round(rgb[0]*(1-t)+255*t),
    Math.round(rgb[1]*(1-t)+255*t),
    Math.round(rgb[2]*(1-t)+255*t)
  ];
}

export function darkenColor(rgb, t) {
  return [Math.round(rgb[0]*(1-t)), Math.round(rgb[1]*(1-t)), Math.round(rgb[2]*(1-t))];
}
