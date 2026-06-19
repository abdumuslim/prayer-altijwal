// Generates the PWA PNG icons (192, 512, maskable-512, badge) from scratch with
// no external dependencies — draws the mosque/crescent mark into a pixel buffer
// and encodes a valid PNG via Node's zlib. Run: `node scripts/gen-icons.mjs`.
//
// Kept dependency-free on purpose (no sharp/canvas) so the icons regenerate in
// any CI/build environment. The on-screen UI uses the crisp SVG favicon; these
// rasters exist for the manifest / home-screen install.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// ── tiny RGBA canvas ────────────────────────────────────────────────────────
function createCanvas(size) {
  return { size, px: new Uint8ClampedArray(size * size * 4) };
}
function setPx(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const sa = a / 255;
  const da = c.px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  c.px[i] = (r * sa + c.px[i] * da * (1 - sa)) / oa;
  c.px[i + 1] = (g * sa + c.px[i + 1] * da * (1 - sa)) / oa;
  c.px[i + 2] = (b * sa + c.px[i + 2] * da * (1 - sa)) / oa;
  c.px[i + 3] = oa * 255;
}

// hex → rgba
function rgba(hex, a = 255) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

// linear vertical gradient sampler
function grad(c1, c2, t) {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
    255,
  ];
}

// ── shape fills with light supersampling for smooth edges ───────────────────
function fill(c, test, color) {
  const ss = 3; // 3x3 supersample
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss;
          const fy = y + (sy + 0.5) / ss;
          if (test(fx, fy)) hits++;
        }
      }
      if (hits === 0) continue;
      const a = (hits / (ss * ss)) * 255;
      const col = typeof color === "function" ? color(x, y) : color;
      setPx(c, x, y, [col[0], col[1], col[2], (col[3] ?? 255) * (a / 255)]);
    }
  }
}

function roundedRect(x0, y0, w, h, r) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
}
function circle(cx, cy, r) {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function rect(x0, y0, w, h) {
  return (x, y) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h;
}
// dome: half-ellipse top on a body
function dome(cx, top, halfW, bottom) {
  const ry = (bottom - top) * 0.45;
  const cyArc = top + ry;
  return (x, y) => {
    if (y < top || y > bottom) return false;
    if (y <= cyArc) {
      return ((x - cx) / halfW) ** 2 + ((y - cyArc) / ry) ** 2 <= 1;
    }
    return Math.abs(x - cx) <= halfW;
  };
}

// ── PNG encoder ─────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(c) {
  const { size, px } = c;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size * 4; x++) {
      raw[y * (size * 4 + 1) + 1 + x] = px[y * size * 4 + x];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── draw the mark ───────────────────────────────────────────────────────────
const NIGHT_1 = rgba("#0a2c2a");
const NIGHT_2 = rgba("#04181a");
const TEAL = rgba("#2dd4bf");
const TEAL_DEEP = rgba("#0f766e");
const GOLD = rgba("#f5c451");
const GOLD_SOFT = rgba("#fbe3a1");

function drawMark(c, { maskable = false } = {}) {
  const S = c.size;
  const k = S / 512; // scale from the 512 design grid
  // background gradient
  fill(c, () => true, (x, y) => grad(NIGHT_1, NIGHT_2, (x + y) / (2 * S)));

  // maskable: keep mark within the safe ~80% circle by shrinking slightly
  const pad = maskable ? 0.12 : 0;
  const tx = (v) => (v * k - S / 2) * (1 - pad) + S / 2;
  const tk = k * (1 - pad);

  const teal = (x, y) => grad(TEAL, TEAL_DEEP, (x + y) / (2 * S));
  const gold = (x, y) => grad(GOLD_SOFT, GOLD, (x + y) / (2 * S));

  // crescent (outer gold circle minus offset inner circle)
  const cresOuter = circle(tx(348), tx(150), 76 * tk);
  const cresInner = circle(tx(372), tx(150), 60 * tk);
  fill(c, (x, y) => cresOuter(x, y) && !cresInner(x, y), gold);

  // minarets
  fill(c, roundedRect(tx(150), tx(248), 22 * tk, 112 * tk, 11 * tk), teal);
  fill(c, circle(tx(161), tx(240), 14 * tk), teal);
  fill(c, roundedRect(tx(340), tx(248), 22 * tk, 112 * tk, 11 * tk), teal);
  fill(c, circle(tx(351), tx(240), 14 * tk), teal);

  // central dome body
  fill(c, dome(tx(256), tx(196), 72 * tk, tx(360)), teal);
  // finial
  fill(c, roundedRect(tx(251), tx(160), 10 * tk, 28 * tk, 5 * tk), gold);
  fill(c, circle(tx(256), tx(160), 11 * tk), gold);

  // doorway (carve back to background)
  const door = dome(tx(256), tx(300), 30 * tk, tx(362));
  fill(c, door, (x, y) => grad(NIGHT_1, NIGHT_2, (x + y) / (2 * S)));

  // base platform
  fill(c, roundedRect(tx(138), tx(360), 236 * tk, 22 * tk, 11 * tk), gold);
}

function drawBadge(c) {
  // simple monochrome crescent on transparent for the notification badge
  const S = c.size;
  const k = S / 96;
  const cresOuter = circle(46 * k, 48 * k, 38 * k);
  const cresInner = circle(58 * k, 44 * k, 30 * k);
  fill(c, (x, y) => cresOuter(x, y) && !cresInner(x, y), [255, 255, 255, 255]);
}

function write(name, size, drawer) {
  const c = createCanvas(size);
  drawer(c);
  writeFileSync(join(OUT, name), encodePng(c));
  console.log("wrote", name, `${size}x${size}`);
}

write("icon-192.png", 192, (c) => drawMark(c));
write("icon-512.png", 512, (c) => drawMark(c));
write("icon-maskable-512.png", 512, (c) => drawMark(c, { maskable: true }));
write("badge.png", 96, (c) => drawBadge(c));
console.log("done");
