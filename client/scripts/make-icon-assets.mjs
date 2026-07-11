// Generate the @capacitor/assets source images (client/assets/) for the Android
// launcher icon + splash from the web app's own mosque logo, so `npx
// capacitor-assets generate --android` produces brand icons instead of the stock
// Capacitor placeholder (docs/NATIVE_ALARM_FIXES_SPEC.md §2c).
//
//   Run from client/:  node scripts/make-icon-assets.mjs
//   Then:              npx capacitor-assets generate --android
//
// Outputs (custom mode — capacitor-assets composes the adaptive layers itself):
//   assets/icon-foreground.png  1024  maskable art (already in the safe zone)
//   assets/icon-background.png  1024  solid brand background
//   assets/icon-only.png        1024  full favicon (legacy square icon)
//   assets/splash.png           2732  brand background + centered logo
//   assets/splash-dark.png      2732  same (single dark brand look)

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, "..");
const pub = (p) => resolve(clientDir, "public/icons", p);
const out = (p) => resolve(clientDir, "assets", p);

const BRAND_BG = "#04181a"; // brand dark (matches manifest theme + favicon gradient end)
const ICON = 1024;
const SPLASH = 2732;

mkdirSync(resolve(clientDir, "assets"), { recursive: true });

const bg = (size) => ({
  create: { width: size, height: size, channels: 4, background: BRAND_BG },
});

// Rasterize the favicon SVG crisply at a target pixel size (density = 72 * px/512
// because the SVG viewBox is 512).
function rasterFavicon(px) {
  const svg = readFileSync(pub("favicon.svg"));
  return sharp(svg, { density: Math.round((72 * px) / 512) })
    .resize(px, px, { fit: "contain", background: BRAND_BG })
    .png()
    .toBuffer();
}

async function main() {
  // Adaptive foreground: the maskable PNG is already designed for the safe zone.
  await sharp(pub("icon-maskable-512.png"))
    .resize(ICON, ICON, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out("icon-foreground.png"));

  // Adaptive background: solid brand color.
  await sharp(bg(ICON)).png().toFile(out("icon-background.png"));

  // Legacy square icon: the full favicon (its own rounded dark background is fine).
  await sharp(await rasterFavicon(ICON)).png().toFile(out("icon-only.png"));

  // Splash: brand background with the logo centered at ~25% of the canvas width.
  const logoPx = Math.round(SPLASH * 0.25);
  const logo = await rasterFavicon(logoPx);
  for (const name of ["splash.png", "splash-dark.png"]) {
    await sharp(bg(SPLASH))
      .composite([{ input: logo, gravity: "centre" }])
      .png()
      .toFile(out(name));
  }

  console.log("wrote assets/: icon-foreground, icon-background, icon-only, splash, splash-dark");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
