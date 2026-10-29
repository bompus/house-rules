// Renders the README banners and the GitHub social preview into docs/assets/. Remake the images with it
// whenever the tagline, a chip or the facts line changes (rules/references/release-batching.md).
//
// The repository has no browser dependency, so run a copy of this file from a scratch folder:
//   mkdir scratch && cd scratch && bun add playwright-core
//   cp <checkout>/docs/assets/build-assets.ts . && bun build-assets.ts <out-dir>
// playwright-core needs a Chromium it can launch (PLAYWRIGHT_BROWSERS_PATH, or `bunx playwright-core install
// chromium`). Without an out-dir the PNGs land beside the script. Fonts: Lato for text; the page falls back to
// Ubuntu Sans, then sans-serif, so install Lato for output that matches the committed PNGs (with Lato installed
// and Chromium 156 the three files are byte-identical to the committed ones).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const OUT = process.argv[2] ?? import.meta.dir; // the script sits in docs/assets/

const NAME = "house-rules";
const TAGLINE = "Working rules and skills for AI coding agents";
const CHIPS = ["Core rules", "Opt-in modifiers", "Your own layer", "Each repo's AGENTS.md"];
const FACTS = "One composed rules file · Linux, macOS, Windows · MIT";
const URL_TEXT = "github.com/bompus/house-rules";

type Theme = "dark" | "light";

const BASE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{overflow:hidden}
  body{font-family:Lato,'Ubuntu Sans',sans-serif}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:40px 40px;
    mask-image:radial-gradient(ellipse at center,#000 30%,transparent 80%)}
  .grad{background:linear-gradient(90deg,#5eead4,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
`;

/** Four stacked layers, core to repo. */
function mark(size: number): string {
  const colors = ["#f472b6", "#a78bfa", "#60a5fa", "#5eead4"];
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64">${colors
    .map(
      (c, i) =>
        `<rect x="10" y="${8 + i * 13}" width="44" height="9" rx="4.5" fill="${c}" opacity="${0.75 + i * 0.08}"/>`,
    )
    .join("")}</svg>`;
}

function themeCss(theme: Theme): string {
  return theme === "dark"
    ? `body{color:#e8ecf8;background:radial-gradient(900px 400px at 90% -20%,rgba(94,234,212,.18),transparent 60%),
        radial-gradient(700px 400px at -5% 120%,rgba(139,92,246,.22),transparent 60%),#070b18}
       .tag{color:#aab3cc}.chip{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#c9d1e8}
       .facts{color:#8a93ad}`
    : `body{color:#0f172a;background:radial-gradient(900px 400px at 90% -20%,rgba(20,184,166,.16),transparent 60%),
        radial-gradient(700px 400px at -5% 120%,rgba(139,92,246,.14),transparent 60%),#f8fafc}
       .grid{background-image:linear-gradient(rgba(15,23,42,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,.05) 1px,transparent 1px)}
       .grad{background:linear-gradient(90deg,#0d9488,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent}
       .tag{color:#334155}.chip{background:rgba(255,255,255,.8);border-color:rgba(15,23,42,.12);color:#334155}
       .facts{color:#64748b}`;
}

const chips = () => CHIPS.map((c) => `<span class="chip">${c}</span>`).join("");

function bannerHtml(theme: Theme): string {
  return `<!doctype html><html><head><style>${BASE_CSS}
    html,body{width:1280px;height:320px}
    ${themeCss(theme)}
    .row{position:absolute;inset:0;display:flex;align-items:center;gap:40px;padding:0 72px}
    h1{font-size:76px;font-weight:900;letter-spacing:-.02em;line-height:1}
    .tag{font-size:26px;margin-top:12px}
    .chips{display:flex;gap:10px;margin-top:22px}
    .chip{font-size:16px;font-weight:700;padding:7px 14px;border-radius:999px;border:1px solid}
  </style></head><body><div class="grid"></div><div class="row">${mark(150)}
    <div><h1 class="grad">${NAME}</h1><div class="tag">${TAGLINE}</div>
    <div class="chips">${chips()}</div></div></div></body></html>`;
}

function socialHtml(): string {
  return `<!doctype html><html><head><style>${BASE_CSS}
    html,body{width:1280px;height:640px}
    ${themeCss("dark")}
    .wrap{position:absolute;inset:0;padding:96px 96px;display:flex;flex-direction:column;justify-content:center}
    h1{font-size:110px;font-weight:900;letter-spacing:-.02em;line-height:1;margin-top:28px}
    .tag{font-size:38px;margin-top:22px;max-width:1000px;line-height:1.2}
    .chips{display:flex;gap:12px;margin-top:36px;flex-wrap:wrap}
    .chip{font-size:22px;font-weight:700;padding:9px 18px;border-radius:999px;border:1px solid}
    .facts{position:absolute;left:96px;right:96px;bottom:48px;display:flex;justify-content:space-between;font-size:22px}
    .facts b{color:#c9d1e8}
  </style></head><body><div class="grid"></div><div class="wrap">${mark(120)}
    <h1 class="grad">${NAME}</h1><div class="tag">${TAGLINE}</div>
    <div class="chips">${chips()}</div></div>
    <div class="facts"><span>${FACTS}</span><b>${URL_TEXT}</b></div></body></html>`;
}

const browser = await chromium.launch();
try {
  mkdirSync(OUT, { recursive: true });
  const shot = async (html: string, file: string, width: number, height: number, scale: number) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, file) });
    await page.close();
    console.log(`wrote ${file}`);
  };
  for (const theme of ["dark", "light"] as Theme[]) {
    await shot(bannerHtml(theme), `banner-${theme}.png`, 1280, 320, 2);
  }
  await shot(socialHtml(), "social-preview.png", 1280, 640, 1);
} finally {
  await browser.close();
}
