#!/usr/bin/env node
/**
 * Renders the GitHub stats cards as SVG files committed to this repo.
 *
 * The popular third-party card services run on shared free-tier Vercel
 * deployments that get paused or rate-limited without warning, which leaves
 * broken images on the profile. Generating them here means the cards are
 * served from raw.githubusercontent.com and can never be throttled.
 *
 * Output: assets/stats-card.svg, assets/langs-card.svg
 */

import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "Alirewa";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = "assets";

/** tokyonight-ish palette, matched to the other cards on the profile. */
const C = {
  bg: "#0d1117",
  border: "#1f2430",
  title: "#a78bfa",
  text: "#c9d1d9",
  dim: "#8b949e",
  accent: "#a78bfa",
};

/** Colors for the language bar — GitHub's own linguist colors. */
const LANG_COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  CSS: "#563d7c",
  HTML: "#e34c26",
  Shell: "#89e051",
  PowerShell: "#012456",
  Dockerfile: "#384d54",
  SCSS: "#c6538c",
  Vue: "#41b883",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  Batchfile: "#C1F12E",
  Makefile: "#427819",
  Roff: "#ecdebe",
};
const FALLBACK_COLORS = ["#a78bfa", "#7c3aed", "#60a5fa", "#34d399", "#fbbf24", "#f87171"];

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile-cards`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** XML-escape text that goes into the SVG. */
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmt = (n) => n.toLocaleString("en-US");

const FONT =
  "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";

/** Shared card chrome: rounded background, border, title, fade-in. */
function card({ width, height, title, body }) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">
  <style>
    .t { font: 600 17px ${FONT}; fill: ${C.title}; }
    .k { font: 400 14px ${FONT}; fill: ${C.text}; }
    .v { font: 700 14px ${FONT}; fill: ${C.accent}; }
    .s { font: 400 12px ${FONT}; fill: ${C.dim}; }
    .fade { opacity: 0; animation: fadeIn .5s ease-in-out forwards; }
    @keyframes fadeIn { to { opacity: 1; } }
  </style>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
  <text x="25" y="35" class="t">${esc(title)}</text>
  <g class="fade">${body}</g>
</svg>`;
}

/** Stats card: a two-column key/value grid. */
function statsCard(rows) {
  const width = 460;
  const rowH = 30;
  const top = 66;
  const height = top + rows.length * rowH + 18;

  const body = rows
    .map(([icon, label, value], i) => {
      const y = top + i * rowH;
      return `<text x="25" y="${y}" class="k">${esc(icon)}  ${esc(label)}</text>` +
        `<text x="${width - 25}" y="${y}" class="v" text-anchor="end">${esc(value)}</text>`;
    })
    .join("\n    ");

  return card({ width, height, title: `${USER} · GitHub Stats`, body });
}

/** Languages card: a stacked percentage bar plus a legend. */
function langsCard(langs) {
  const width = 460;
  const barY = 58;
  const barH = 10;
  const barW = width - 50;
  // One column keeps the language name and its percentage on the same line and
  // makes this card's height line up with the stats card beside it.
  const cols = 1;
  const legendTop = barY + barH + 28;
  const rowH = 27;
  const legendRows = Math.ceil(langs.length / cols);
  const height = legendTop + legendRows * rowH + 8;

  const total = langs.reduce((s, l) => s + l.bytes, 0) || 1;

  let x = 25;
  const segments = langs
    .map((l, i) => {
      const w = (l.bytes / total) * barW;
      // Round the outer edges of the bar only.
      const rx = i === 0 || i === langs.length - 1 ? 5 : 0;
      const seg = `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(w, 1).toFixed(1)}" height="${barH}" rx="${rx}" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("\n    ");

  const legend = langs
    .map((l, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = 25 + col * (barW / cols);
      const ly = legendTop + row * rowH;
      const pct = ((l.bytes / total) * 100).toFixed(1);
      return `<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${l.color}"/>` +
        `<text x="${lx + 20}" y="${ly}" class="k">${esc(l.name)}</text>` +
        `<text x="${lx + 20 + barW / cols - 45}" y="${ly}" class="s" text-anchor="end">${pct}%</text>`;
    })
    .join("\n    ");

  return card({
    width,
    height,
    title: "Most Used Languages",
    body: `${segments}\n    ${legend}`,
  });
}

// ---------------------------------------------------------------- data

const [user, repos] = await Promise.all([
  gh(`/users/${USER}`),
  gh(`/users/${USER}/repos?per_page=100&type=owner`),
]);

const own = repos.filter((r) => !r.fork);

const totalStars = own.reduce((s, r) => s + r.stargazers_count, 0);
const totalForks = own.reduce((s, r) => s + r.forks_count, 0);

// Commit count across all public repos. The search API caps out, but for a
// profile of this size the number is exact.
let totalCommits = 0;
try {
  const search = await gh(`/search/commits?q=author:${USER}&per_page=1`);
  totalCommits = search.total_count ?? 0;
} catch {
  totalCommits = 0; // non-fatal: the row is dropped below
}

// Aggregate language bytes across every non-fork repo.
const byteTotals = new Map();
const langResults = await Promise.all(
  own.map((r) => gh(`/repos/${USER}/${r.name}/languages`).catch(() => ({})))
);
for (const langs of langResults) {
  for (const [name, bytes] of Object.entries(langs)) {
    byteTotals.set(name, (byteTotals.get(name) || 0) + bytes);
  }
}

const TOP_N = 6;
const sorted = [...byteTotals.entries()].sort((a, b) => b[1] - a[1]);
const top = sorted.slice(0, TOP_N);
const restBytes = sorted.slice(TOP_N).reduce((s, [, b]) => s + b, 0);

const langs = top.map(([name, bytes], i) => ({
  name,
  bytes,
  color: LANG_COLORS[name] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
}));
if (restBytes > 0) langs.push({ name: "Other", bytes: restBytes, color: "#6e7681" });

const years = ((Date.now() - new Date(user.created_at)) / 31557600000).toFixed(1);

const rows = [
  ["⭐", "Total Stars Earned", fmt(totalStars)],
  ["🍴", "Total Forks", fmt(totalForks)],
  ["📦", "Public Repositories", fmt(own.length)],
  ["👥", "Followers", fmt(user.followers)],
  ["💻", "Languages Used", fmt(byteTotals.size)],
  ["🗓️", "Years on GitHub", years],
];
if (totalCommits > 0) rows.splice(2, 0, ["📝", "Total Commits", fmt(totalCommits)]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/stats-card.svg`, statsCard(rows));
writeFileSync(`${OUT_DIR}/langs-card.svg`, langsCard(langs));

console.log(
  `Cards written — ${totalStars} stars, ${own.length} repos, ${byteTotals.size} languages, ` +
    `top: ${langs.map((l) => l.name).join(", ")}`
);
