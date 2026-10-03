#!/usr/bin/env node
// First-pass scanner for template-default styling in frontend source.
// Every finding is a candidate for human or agent triage, not a verdict.
// Runs on Node 22+ or Bun with no dependencies.
//
//   scan.mjs [--json] [--fail-on high|medium|low] <file-or-dir>...
//
// Exit codes: 0 nothing at or above the failing severity, 1 findings at or
// above it, 2 bad usage (unknown flag, no paths, missing path, zero files).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const EXTENSIONS = new Set([
  ".html",
  ".css",
  ".scss",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".vercel",
  ".netlify",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".astro",
  ".git",
  "storybook-static",
]);
const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

const HINTS = {
  "purple-blue-gradient":
    "Indigo, violet or purple blended with blue is a stock hero look. Keep it only if the brand palette calls for it.",
  "violet-accent":
    "Violet or indigo accent. Confirm the brief or design tokens chose this hue rather than a starter template.",
  "gradient-text":
    "Gradient-filled text. Check it is a deliberate display treatment, readable, and not repeated across every heading.",
  "single-stock-font":
    "Choose type that fits the product, or record why this stock face was chosen.",
  "frosted-glass":
    "Backdrop blur panel. Fine for overlays over busy content; on flat backgrounds it only costs contrast and paint time.",
  "emoji-icon":
    "Emoji standing in for an icon in a heading, control or nav item. Use the project's icon set or plain text.",
  "neon-glow":
    "Colored glow shadow. Check it signals focus or state rather than decorating everything.",
  "library-default-token":
    "Unmodified component-library default value. Replace it with the product's own token if the theme was never customized.",
  "tracked-caps":
    "Wide-tracked all-caps label. Check it is used sparingly and that the text stays readable at small sizes.",
};
const SEVERITY = {
  "purple-blue-gradient": "high",
  "violet-accent": "medium",
  "gradient-text": "medium",
  "single-stock-font": "medium",
  "emoji-icon": "medium",
  "neon-glow": "medium",
  "frosted-glass": "low",
  "library-default-token": "low",
  "tracked-caps": "low",
};

// ---------- color parsing ----------

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: Math.min(1, s), l };
}

function oklchToHsl(L, C, H) {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, bl] = lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.sign(x) * Math.abs(x) ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  });
  return rgbToHsl(r, g, bl);
}

const channel = (v) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v) / 255);
const hueUnits = (v, unit) =>
  unit === "turn" ? v * 360 : unit === "rad" ? (v * 180) / Math.PI : v;

// Returns every color literal on a line as { h, s, l, index }.
function colorsIn(line) {
  const out = [];
  for (const m of line.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi)) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    out.push({ ...rgbToHsl(r, g, b), index: m.index });
  }
  for (const m of line.matchAll(/rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/gi)) {
    out.push({ ...rgbToHsl(channel(m[1]), channel(m[2]), channel(m[3])), index: m.index });
  }
  for (const m of line.matchAll(
    /hsla?\(\s*([\d.]+)(deg|turn|rad)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/gi,
  )) {
    out.push({
      h: hueUnits(parseFloat(m[1]), m[2]) % 360,
      s: m[3] / 100,
      l: m[4] / 100,
      index: m.index,
    });
  }
  // Bare HSL triplets in custom properties, as theme generators emit them.
  for (const m of line.matchAll(/--[\w-]+\s*:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out.push({ h: parseFloat(m[1]) % 360, s: m[2] / 100, l: m[3] / 100, index: m.index });
  }
  for (const m of line.matchAll(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)/gi)) {
    const L = m[2] ? m[1] / 100 : parseFloat(m[1]);
    const C = m[4] ? (m[3] / 100) * 0.4 : parseFloat(m[3]);
    out.push({ ...oklchToHsl(L, C, parseFloat(m[5])), index: m.index });
  }
  return out;
}

const chromatic = (c) => c.s >= 0.35 && c.l >= 0.15 && c.l <= 0.9;
const isViolet = (c) => chromatic(c) && c.l >= 0.2 && c.l <= 0.85 && c.h >= 235 && c.h <= 290;
const isCool = (c) => c.h >= 185 && c.h <= 320;

// ---------- line rules ----------

const TW_VIOLET =
  /\b(?:bg|text|border|ring|outline|fill|stroke|accent|decoration|divide|caret|shadow|from|via|to)-(?:indigo|violet|purple)-\d{2,3}\b/;
const TW_GRADIENT_STOP = /\b(?:from|via|to)-([a-z]+)-\d{2,3}\b/g;
const TW_COOL = new Set(["blue", "sky", "cyan", "indigo", "violet", "purple", "fuchsia"]);
const TW_VIOLET_NAMES = new Set(["indigo", "violet", "purple"]);
const TW_CHROMA =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

// CSS gradient functions often span several lines, so these are read from the
// whole file: each purple-to-blue one as its start and end offsets.
function cssGradients(text) {
  const out = [];
  for (const m of text.matchAll(/(?:linear|radial|conic)-gradient\(/gi)) {
    let end = m.index + m[0].length - 1;
    for (let depth = 0; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    const stops = colorsIn(text.slice(m.index, end + 1)).filter(chromatic);
    if (stops.length >= 2 && stops.every(isCool) && stops.some(isViolet)) {
      out.push({ start: m.index, end });
    }
  }
  return out;
}

function twGradientHit(line) {
  const names = [...line.matchAll(TW_GRADIENT_STOP)];
  if (names.length >= 2) {
    const colors = names.map((m) => m[1]);
    if (colors.every((c) => TW_COOL.has(c)) && colors.some((c) => TW_VIOLET_NAMES.has(c))) {
      return names[0].index;
    }
  }
  return -1;
}

function violetHit(line) {
  const c = colorsIn(line).find(isViolet);
  if (c) return c.index;
  const m = line.match(TW_VIOLET);
  return m ? m.index : -1;
}

function gradientTextHit(line) {
  return line.search(
    /(?:-webkit-)?background-clip\s*:\s*text|(?:Webkit)?[bB]ackgroundClip\s*:\s*['"]text|\bbg-clip-text\b/,
  );
}

function frostedHit(line) {
  return line.search(
    /backdrop-filter\s*:[^;]*blur\(|backdropFilter\s*:\s*['"`][^'"`]*blur\(|\bbackdrop-blur\b/,
  );
}

function glowHit(line) {
  const tw = line.match(new RegExp(`\\bshadow-(?:${TW_CHROMA})-\\d{2,3}\\b`));
  if (tw) return tw.index;
  const prop = line.search(/box-shadow|text-shadow|boxShadow|textShadow|drop-shadow|shadow-\[/);
  if (prop === -1) return -1;
  const off = line.match(/(?:^|[\s:,'"(_[])0(?:px)?[\s_]+0(?:px)?[\s_]+(\d+(?:\.\d+)?)px/);
  if (!off || parseFloat(off[1]) < 10) return -1;
  const saturated = colorsIn(line).some((c) => c.s >= 0.5 && c.l >= 0.25 && c.l <= 0.8);
  return saturated ? prop : -1;
}

const EMOJI_CONTEXT =
  /<(?:h[1-6]|button|a|nav|li|summary|label|Button|Link|NavLink|MenuItem|Tab|Badge)\b|\b(?:icon|emoji|label|title)\s*[:=]/;

function emojiHit(line, prev) {
  for (const m of line.matchAll(/\p{Extended_Pictographic}/gu)) {
    // Below U+2600 sit (c), (R), TM, arrows and other text symbols, not icons.
    if (m[0].codePointAt(0) < 0x2600) continue;
    if (EMOJI_CONTEXT.test(line) || EMOJI_CONTEXT.test(prev)) return m.index;
  }
  return -1;
}

const LIBRARY_DEFAULTS = [
  [/#0d6efd(?![0-9a-f])/i, "Bootstrap 5 primary"],
  [/#007bff(?![0-9a-f])/i, "Bootstrap 4 primary"],
  [/#6200ee(?![0-9a-f])/i, "Material Design baseline primary"],
  [/#1976d2(?![0-9a-f])/i, "MUI default primary"],
  [/#1677ff(?![0-9a-f])/i, "Ant Design 5 primary"],
  [/#1890ff(?![0-9a-f])/i, "Ant Design 4 primary"],
  [/#3182ce(?![0-9a-f])/i, "Chakra UI blue.500"],
  [/#646cff(?![0-9a-f])/i, "Vite starter accent"],
  [/222\.2 47\.4% 11\.2%/, "shadcn/ui slate theme primary"],
  [/222\.2 84% 4\.9%/, "shadcn/ui slate theme foreground"],
  [/oklch\(0\.205 0 0\)/, "shadcn/ui neutral theme primary"],
];

function libraryHit(line) {
  for (const [re, source] of LIBRARY_DEFAULTS) {
    const m = line.match(re);
    if (m) return { index: m.index, source };
  }
  return null;
}

function twTrackedCapsHit(line) {
  if (!/(?:^|[\s"'`])uppercase(?=[\s"'`]|$)/.test(line)) return -1;
  const m = line.match(/\btracking-(?:wider|widest|\[([\d.]+)(em|rem|px)\])/);
  if (!m) return -1;
  if (m[1] && !wideSpacing(parseFloat(m[1]), m[2])) return -1;
  return m.index;
}

function wideSpacing(value, unit) {
  if (unit === "em" || unit === "rem") return value >= 0.08;
  return value >= 1.5; // px, or a unitless number in a JS style object
}

// Rule blocks: innermost { ... } in CSS, SCSS or JS style objects.
function trackedCapsBlocks(text) {
  const hits = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const body = m[0];
    const caps = body.search(/text-transform\s*:\s*uppercase|textTransform\s*:\s*['"]uppercase/);
    if (caps === -1) continue;
    const sp = body.match(
      /letter-spacing\s*:\s*([\d.]+)(em|rem|px)|letterSpacing\s*:\s*['"]?([\d.]+)(em|rem|px)?/,
    );
    if (!sp) continue;
    const ok = sp[1]
      ? wideSpacing(parseFloat(sp[1]), sp[2])
      : wideSpacing(parseFloat(sp[3]), sp[4] ?? "px");
    if (ok) hits.push(m.index + caps);
  }
  return hits;
}

// ---------- font aggregation ----------

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "helvetica",
  "helvetica neue",
  "arial",
  "inherit",
  "initial",
  "unset",
  "revert",
  "emoji",
  "math",
  "apple color emoji",
  "segoe ui emoji",
  "noto color emoji",
]);
const STOCK_SANS = new Set([
  "inter",
  "roboto",
  "open sans",
  "poppins",
  "montserrat",
  "lato",
  "geist",
  "dm sans",
  "plus jakarta sans",
  "nunito",
  "manrope",
  "outfit",
]);

function normalizeFamily(raw) {
  return raw
    .replace(/["'`[\]]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s*(?:var|variable)$/, "")
    .replace(/^intervariable$/, "inter");
}

function primaryFamily(list) {
  const first = list.split(",")[0]?.trim() ?? "";
  if (!first || first.startsWith("var(") || first.startsWith("$")) return null;
  const name = normalizeFamily(first);
  if (!/^[a-z0-9 ]+$/.test(name) || GENERIC_FONTS.has(name)) return null;
  if (/mono|code|courier|consolas|menlo/.test(name)) return null;
  return name;
}

function fontDeclarations(line) {
  const lists = [];
  for (const m of line.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) lists.push([m[1], m.index]);
  for (const m of line.matchAll(/fontFamily\s*:\s*(.+)/g)) lists.push([m[1], m.index]);
  for (const m of line.matchAll(/\b(?:sans|display|heading|body|brand)\s*:\s*\[([^\]]*)/g))
    lists.push([m[1], m.index]);
  for (const m of line.matchAll(/\bfont\s*:[^;]*?\d(?:px|rem|em|%)(?:\/[\d.]+\w*)?\s+([^;]+)/g))
    lists.push([m[1], m.index]);
  const gf = line.match(/fonts\.googleapis\.com\/css2?\?[^"'\s)]*/);
  if (gf) {
    for (const m of gf[0].matchAll(/family=([^&:;"')]+)/g)) {
      lists.push([decodeURIComponent(m[1].replace(/\+/g, " ")), gf.index]);
    }
  }
  const nf = line.match(/import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/);
  if (nf) for (const name of nf[1].split(",")) lists.push([name.split(/\s+as\s+/)[0], nf.index]);
  for (const m of line.matchAll(/@fontsource(?:-variable)?\/([\w-]+)/g))
    lists.push([m[1], m.index]);
  return lists
    .map(([list, index]) => ({ family: primaryFamily(list), index }))
    .filter((d) => d.family);
}

// ---------- scanning ----------

function excerpt(line, index) {
  const at = Math.max(0, index);
  if (line.trim().length <= 120) return line.trim();
  const start = Math.max(0, at - 40);
  const piece = line.slice(start, start + 120).trim();
  return `${start > 0 ? "..." : ""}${piece}${start + 120 < line.length ? "..." : ""}`;
}

function scanFile(path, display, fonts) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const findings = [];
  const seen = new Set();
  const add = (rule, lineNo, index, hint = HINTS[rule]) => {
    const key = `${rule}:${lineNo}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      rule,
      severity: SEVERITY[rule],
      file: display,
      line: lineNo,
      match: excerpt(lines[lineNo - 1], index),
      hint,
    });
  };

  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineAt = (offset) => {
    let lo = 0;
    while (lo + 1 < starts.length && starts[lo + 1] <= offset) lo++;
    return lo;
  };

  // A gradient is reported once, at its first line; its stops are not reported
  // again as violet accents.
  const gradientLines = new Set();
  for (const { start, end } of cssGradients(text)) {
    const first = lineAt(start);
    add("purple-blue-gradient", first + 1, start - starts[first]);
    for (let k = first; k <= lineAt(end); k++) gradientLines.add(k + 1);
  }

  lines.forEach((line, i) => {
    const n = i + 1;
    let at = twGradientHit(line);
    if (at !== -1) add("purple-blue-gradient", n, at);
    else if (!gradientLines.has(n) && (at = violetHit(line)) !== -1) add("violet-accent", n, at);
    if ((at = gradientTextHit(line)) !== -1) add("gradient-text", n, at);
    if ((at = frostedHit(line)) !== -1) add("frosted-glass", n, at);
    if ((at = glowHit(line)) !== -1) add("neon-glow", n, at);
    if ((at = emojiHit(line, lines[i - 1] ?? "")) !== -1) add("emoji-icon", n, at);
    if ((at = twTrackedCapsHit(line)) !== -1) add("tracked-caps", n, at);
    const lib = libraryHit(line);
    if (lib)
      add(
        "library-default-token",
        n,
        lib.index,
        `${lib.source}. ${HINTS["library-default-token"]}`,
      );
    for (const d of fontDeclarations(line))
      fonts.push({ ...d, file: display, line: n, text: line });
  });

  for (const offset of trackedCapsBlocks(text)) {
    const lo = lineAt(offset);
    add("tracked-caps", lo + 1, offset - starts[lo]);
  }
  return findings;
}

function fontFinding(fonts) {
  const families = new Set(fonts.map((d) => d.family));
  if (families.size !== 1 || fonts.length < 2) return null;
  const [family] = families;
  if (!STOCK_SANS.has(family)) return null;
  const first = fonts[0];
  return {
    rule: "single-stock-font",
    severity: SEVERITY["single-stock-font"],
    file: first.file,
    line: first.line,
    match: excerpt(first.text, first.index),
    hint: `"${family}" is the only named sans face across ${fonts.length} declarations. ${HINTS["single-stock-font"]}`,
  };
}

function collect(paths) {
  const files = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && wanted(entry.name)) {
        files.add(full);
      }
    }
  };
  for (const p of paths) {
    const abs = resolve(p);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs);
    else if (st.isFile() && wanted(abs)) files.add(abs);
  }
  return [...files].sort();
}

function wanted(name) {
  return EXTENSIONS.has(extname(name).toLowerCase()) && !/\.min\.(?:js|css)$/i.test(name);
}

// ---------- CLI ----------

const USAGE = `Usage: scan.mjs [--json] [--fail-on high|medium|low] <file-or-dir>...

Flags template-default styling for triage. Exit 0 when nothing reaches the
failing severity (default high), 1 when something does, 2 on bad usage.`;

function usageError(message) {
  process.stderr.write(`scan: ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

function main(argv) {
  let json = false;
  let failOn = "high";
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      paths.push(...argv.slice(i + 1));
      break;
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--fail-on" || arg.startsWith("--fail-on=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      if (!(value in SEVERITY_RANK))
        usageError(`--fail-on needs high, medium or low, got ${value ?? "nothing"}`);
      failOn = value;
    } else if (arg.startsWith("-")) {
      usageError(`unknown flag ${arg}`);
    } else {
      paths.push(arg);
    }
  }
  if (paths.length === 0) usageError("no files or directories given");
  for (const p of paths) {
    try {
      statSync(p);
    } catch {
      usageError(`no such file or directory: ${p}`);
    }
  }

  const files = collect(paths);
  if (files.length === 0)
    usageError(`no scannable files (${[...EXTENSIONS].join(" ")}) under the given paths`);

  const fonts = [];
  const findings = files.flatMap((f) => scanFile(f, relative(process.cwd(), f) || f, fonts));
  const font = fontFinding(fonts);
  if (font) findings.push(font);
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  const failing = findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ filesScanned: files.length, failOn, counts, findings }, null, 2)}\n`,
    );
  } else {
    for (const f of findings) {
      process.stdout.write(
        `${f.file}:${f.line}  ${f.severity.padEnd(6)}  ${f.rule}\n    ${f.match}\n    hint: ${f.hint}\n`,
      );
    }
    process.stdout.write(
      `Scanned ${files.length} file${files.length === 1 ? "" : "s"}: ${counts.high} high, ${counts.medium} medium, ${counts.low} low (failing at ${failOn}).\n`,
    );
  }
  process.exit(failing ? 1 : 0);
}

main(process.argv.slice(2));
