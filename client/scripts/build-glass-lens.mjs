// Generates the Liquid-Glass edge-lensing displacement maps (docs/V2_REDESIGN_SPEC.md
// Phase 7). Technique: signed-distance-field displacement toward the element center,
// strongest at the rounded rim, neutral (128,128) in the flat middle — the map feeds
// an SVG feDisplacementMap used as `backdrop-filter: url(#glass-lens-*)` (Chromium
// only; index.html hosts the filter defs). Re-run with `node scripts/build-glass-lens.mjs`
// after tuning; outputs are committed like other generated assets.
//
// Adapted from the MIT-licensed https://github.com/shuding/liquid-glass fragment
// (roundedRectSDF + smoothstep edge falloff); PNG encoding is hand-rolled on
// node:zlib so the script needs no dependencies.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// ── math (liquid-glass fragment) ─────────────────────────────────────────────

const smoothStep = (a, b, t) => {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
};

const roundedRectSDF = (x, y, w, h, r) => {
  const qx = Math.abs(x) - w + r;
  const qy = Math.abs(y) - h + r;
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    r
  );
};

/**
 * Compute the displacement field for a W×H map: each pixel's sampling offset
 * (dx, dy) pulls toward the center near the rounded rim (lens minification),
 * neutral in the middle. Returns RGBA bytes (R=X, G=Y, 128=zero) + the px
 * scale that feDisplacementMap must use so the encoding stays lossless.
 */
function buildMap(width, height, rect) {
  const raw = new Float32Array(width * height * 2);
  let maxAbs = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ix = x / width - 0.5;
      const iy = y / height - 0.5;
      const d = roundedRectSDF(ix, iy, rect.w, rect.h, rect.r);
      // Wide flat center, bend confined to a narrow rim band: inside the
      // plateau (d ≤ 0) falloff = 1 (identity); across the band it eases to 0
      // (max pull). rect.band controls the rim width in normalized units.
      const falloff = smoothStep(rect.band, 0, d);
      const scaled = smoothStep(0, 1, falloff);
      // Texture-lookup target (fraction of the box) → offset in map pixels.
      const dx = (ix * scaled + 0.5) * width - x;
      const dy = (iy * scaled + 0.5) * height - y;
      const i = (y * width + x) * 2;
      raw[i] = dx;
      raw[i + 1] = dy;
      maxAbs = Math.max(maxAbs, Math.abs(dx), Math.abs(dy));
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = Math.round((raw[p * 2] / maxAbs) * 127 + 128); // R = X
    rgba[p * 4 + 1] = Math.round((raw[p * 2 + 1] / maxAbs) * 127 + 128); // G = Y
    rgba[p * 4 + 2] = 128;
    rgba[p * 4 + 3] = 255;
  }
  return { rgba, scale: maxAbs };
}

// ── minimal PNG encoder (RGBA8, filter 0) ────────────────────────────────────

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = scanlines.subarray(y * (1 + width * 4) + 1);
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── targets ──────────────────────────────────────────────────────────────────
// Maps are smooth fields — small canvases stretch cleanly via feImage
// preserveAspectRatio="none". `rect` is the SDF plateau in normalized units:
// bigger w/h → wider flat center; r → how round the lensing corners are.

const TARGETS = [
  // Floating tab capsule (~362×56 rendered): full-round pill, thin lens rim.
  { name: "glass-lens-bar", width: 186, height: 28, rect: { w: 0.42, h: 0.28, r: 0.22, band: 0.2 } },
  // Hero card (~358×430 rendered): 2rem-radius rounded rect — clear center,
  // bend confined to the outer ~10% band.
  { name: "glass-lens-card", width: 128, height: 152, rect: { w: 0.42, h: 0.4, r: 0.1, band: 0.14 } },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const t of TARGETS) {
  const { rgba, scale } = buildMap(t.width, t.height, t.rect);
  const file = join(OUT_DIR, `${t.name}.png`);
  writeFileSync(file, encodePng(t.width, t.height, rgba));
  // The px scale is relative to the MAP canvas; the rendered element is ~2×
  // larger, so the effective on-screen displacement ≈ scale × (element/map).
  console.log(`${t.name}.png  ${t.width}x${t.height}  feDisplacementMap scale=${scale.toFixed(1)}`);
}
