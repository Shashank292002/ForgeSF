/**
 * Draws the ForgeSF mark and writes it as a PNG.
 *
 * Kept in the repo so the logo can be regenerated rather than being a binary
 * nobody can edit. There is no image library here on purpose: adding one for
 * a file that changes once a year is not worth the dependency, and Node's own
 * zlib is all a PNG needs.
 *
 *   node make-logo.cjs            → icon-source.png (1024²)
 *   node make-logo.cjs 512 out.png
 *
 * Feed the result to `pnpm tauri icon <file>` to produce every platform size.
 */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const SIZE = Number(process.argv[2]) || 1024;
const OUT = process.argv[3] || path.join(__dirname, "icon-source.png");

/* ── The mark, described on a 1024 grid ─────────────────────────────
   An anvil: the forge in ForgeSF. It is a silhouette, so it survives
   being drawn at 16px in a taskbar, which a detailed illustration or a
   lettermark would not. Everything is centred on x = 532. */
const GRID = 1024;

const TILE = { x0: 32, y0: 32, x1: 992, y1: 992, r: 216 };

/* The mark fills about half the tile and every limb is thick. An anvil
   drawn daintily turns to mush at 32px, which is the size it is seen at
   most often — in a taskbar. Centred on x = 560; the horn carries the
   weight back to the left. */

// Top face: wide, flat, and deep enough to survive downsampling.
const SLAB = { x0: 240, y0: 300, x1: 880, y1: 436 };

// The horn, blunt and thick. It starts well inside the slab so the join
// leaves no step where it meets the rounded corner.
const HORN = [
  [330, 300],
  [110, 344],
  [110, 392],
  [330, 436],
];

// The body: undercut below the slab, pinched at the waist, flaring to the
// foot. The waist stays wide — a narrow one vanishes when scaled down.
const BODY = [
  [392, 436],
  [728, 436],
  [686, 580],
  [728, 700],
  [392, 700],
  [434, 580],
];

const FOOT = { x0: 300, y0: 690, x1: 820, y1: 812, r: 20 };

// A spark off the blow, clear of the slab so it never crowds it.
const SPARK = { cx: 852, cy: 188, arm: 62, waist: 14 };
/* ── Brand palette ─────────────────────────────────────────────── */
const GRADIENT = [
  [0.0, [0x6d, 0x5b, 0xff]], // --color-primary
  [0.55, [0x9d, 0x4d, 0xff]], // --color-secondary
  [1.0, [0xec, 0x48, 0x99]], // --color-pink
];
const ANVIL = [0xff, 0xff, 0xff];
const ACCENT = [0x22, 0xd3, 0xee]; // --color-accent

/* ── Geometry ──────────────────────────────────────────────────── */
function inPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inRoundedRect(px, py, { x0, y0, x1, y1, r }) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  // Only the four corner boxes need the radius test.
  const cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px;
  const cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py;
  if (cx === px || cy === py) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** A four-pointed star: two crossed lenses, so it reads as a spark. */
function inSpark(px, py, { cx, cy, arm, waist }) {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  if (dx > arm || dy > arm) return false;
  // Concave sides: the arm thins as it extends.
  return (
    dy <= waist * (1 - dx / arm) ** 0.55 || dx <= waist * (1 - dy / arm) ** 0.55
  );
}

const inAnvil = (px, py) =>
  inRoundedRect(px, py, { ...SLAB, r: 10 }) ||
  inPolygon(px, py, HORN) ||
  inPolygon(px, py, BODY) ||
  inRoundedRect(px, py, FOOT);

/* ── Colour ────────────────────────────────────────────────────── */
function gradientAt(px, py) {
  // 135°: constant along the anti-diagonal, which is what CSS draws.
  const t = Math.min(1, Math.max(0, (px + py) / (GRID * 2)));
  for (let i = 1; i < GRADIENT.length; i++) {
    const [t1, c1] = GRADIENT[i];
    const [t0, c0] = GRADIENT[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((n) => Math.round(c0[n] + (c1[n] - c0[n]) * k));
    }
  }
  return GRADIENT[GRADIENT.length - 1][1];
}

/* ── Raster ────────────────────────────────────────────────────── */
// Samples per pixel, per axis. Scaled to the output so a 32px icon is
// averaged from the same amount of detail a 1024px one is.
const SAMPLES = Math.min(16, Math.max(4, Math.round(GRID / SIZE)));
const scale = GRID / SIZE;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let tile = 0;
    let anvil = 0;
    let spark = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const gx = (x + (sx + 0.5) / SAMPLES) * scale;
        const gy = (y + (sy + 0.5) / SAMPLES) * scale;
        if (!inRoundedRect(gx, gy, TILE)) continue;
        tile += 1;
        if (inAnvil(gx, gy)) anvil += 1;
        else if (inSpark(gx, gy, SPARK)) spark += 1;
      }
    }
    const total = SAMPLES * SAMPLES;
    const offset = (y * SIZE + x) * 4;
    if (tile === 0) continue;

    const base = gradientAt(x * scale, y * scale);
    let [r, g, b] = base;
    // Composite the mark over the tile by coverage.
    const a = anvil / total;
    const s = spark / total;
    if (a > 0)
      [r, g, b] = [0, 1, 2].map((n) => base[n] + (ANVIL[n] - base[n]) * a);
    if (s > 0) [r, g, b] = [0, 1, 2].map((n) => r0(n, [r, g, b], ACCENT, s));

    pixels[offset] = Math.round(r);
    pixels[offset + 1] = Math.round(g);
    pixels[offset + 2] = Math.round(b);
    pixels[offset + 3] = Math.round((tile / total) * 255);
  }
}

function r0(n, from, to, k) {
  return from[n] + (to[n] - from[n]) * k;
}

/* ── PNG ───────────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// 10–12: deflate, adaptive filtering, no interlace — all zero.

// Each scanline is prefixed with its filter byte (0 = none).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(OUT, png);
console.log(
  `wrote ${OUT} (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`,
);
