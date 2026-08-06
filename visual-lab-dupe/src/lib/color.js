// Color helpers used by the render loop. Kept as pure, dependency-free
// functions so they can be unit-tested without a canvas or DOM.

// Minimal HSL->RGB. h in [0,360) (values outside are wrapped), s/l in [0,1].
// Returns [r, g, b] with each channel in [0,255].
export const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

// Parse a 6-digit hex color (with or without a leading "#") to [r, g, b].
// Falls back to the app's default cyan [0, 240, 255] for anything it can't
// parse (empty string, 3-digit shorthand, named colors, etc.).
export const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [0, 240, 255];
};
