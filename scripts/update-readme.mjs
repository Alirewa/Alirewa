#!/usr/bin/env node
/**
 * Regenerates the dynamic sections of README.md from the live GitHub API.
 *
 * Sections are delimited by HTML comments so the surrounding hand-written
 * content is never touched:
 *   <!--START_SECTION:projects--> ... <!--END_SECTION:projects-->
 *   <!--START_SECTION:activity--> ... <!--END_SECTION:activity-->
 *   <!--START_SECTION:updated-->  ... <!--END_SECTION:updated-->
 */

import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "Alirewa";
const TOKEN = process.env.GITHUB_TOKEN;
const README = "README.md";

/** Repos that are infrastructure, not portfolio pieces. */
const HIDDEN = new Set([USER, "Ubuntu-Server-setup", "KishNews-live"]);

/** How many projects to show in the featured table. */
const MAX_PROJECTS = 8;

/** How many activity lines to show. */
const MAX_ACTIVITY = 6;

const LANG_ICON = {
  TypeScript: "TS",
  JavaScript: "JS",
  Python: "PY",
  Shell: "SH",
  CSS: "CSS",
  HTML: "HTML",
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile-readme`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** Escape the characters that would break a markdown table cell. */
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

/** Trim a description to a readable length without cutting mid-word. */
function clamp(text, max = 110) {
  const t = cell(text);
  if (t.length <= max) return t;
  return t.slice(0, t.lastIndexOf(" ", max)).trimEnd() + "…";
}

/**
 * Condense a repo description into a short phrase for the table: drop the
 * trailing "Built with X" / marketing clauses and keep the first idea only.
 */
function summarize(description) {
  if (!description) return "—";
  let t = cell(description)
    // Leading emoji, e.g. "🛡️ Self-hosted …"
    .replace(/^[^\p{L}\p{N}]+/u, "")
    // Boilerplate tails that repeat across the repos.
    .replace(/\s*(Built with|Powered by|Made with)\b.*$/i, "")
    .replace(/\s*No (backend|login|account|sign-up)\b.*$/i, "");

  // Keep only the first clause — descriptions here use "—" or "." as the break.
  const [head] = t.split(/\s+—\s+|\.\s+/);
  if (head && head.length >= 14) t = head;

  return clamp(t, 52).replace(/[.,;:]$/, "");
}

function buildProjects(repos) {
  const picked = repos
    .filter((r) => !r.fork && !r.archived && !HIDDEN.has(r.name))
    // Most-starred first, then most recently pushed as the tiebreaker.
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        new Date(b.pushed_at) - new Date(a.pushed_at)
    )
    .slice(0, MAX_PROJECTS);

  const rows = picked.map((r) => {
    const demo = r.homepage ? ` · [demo](${r.homepage})` : "";
    const lang = r.language ? `\`${LANG_ICON[r.language] || r.language}\`` : "—";
    return `| **[${cell(r.name)}](${r.html_url})**${demo} | ${summarize(r.description)} | ${lang} | ⭐ ${r.stargazers_count} |`;
  });

  return [
    "| Project | | Stack | Stars |",
    "| :--- | :--- | :---: | :---: |",
    ...rows,
  ].join("\n");
}

function describeEvent(e) {
  const repo = `[${e.repo.name.split("/")[1]}](https://github.com/${e.repo.name})`;
  switch (e.type) {
    case "PushEvent": {
      const n = e.payload.size ?? e.payload.commits?.length ?? 1;
      const msg = e.payload.commits?.at(-1)?.message?.split("\n")[0];
      return `⬆️ Pushed ${n} commit${n === 1 ? "" : "s"} to ${repo}${
        msg ? ` — ${cell(clamp(msg, 70))}` : ""
      }`;
    }
    case "CreateEvent":
      return e.payload.ref_type === "repository"
        ? `🎉 Created ${repo}`
        : `🌿 Created ${e.payload.ref_type} \`${cell(e.payload.ref)}\` in ${repo}`;
    case "ReleaseEvent":
      return `🏷️ Released \`${cell(e.payload.release.tag_name)}\` of ${repo}`;
    case "PullRequestEvent":
      return `🔀 ${e.payload.action === "closed" ? "Merged" : "Opened"} a pull request in ${repo}`;
    case "IssuesEvent":
      return `📌 ${e.payload.action === "closed" ? "Closed" : "Opened"} an issue in ${repo}`;
    case "WatchEvent":
      return `⭐ Starred ${repo}`;
    case "ForkEvent":
      return `🍴 Forked ${repo}`;
    case "PublicEvent":
      return `📢 Open-sourced ${repo}`;
    default:
      return null;
  }
}

/** Relative time, e.g. "3 days ago". */
function ago(iso) {
  const secs = (Date.now() - new Date(iso)) / 1000;
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

function buildActivity(events, liveRepos) {
  const lines = [];
  // Only the most recent event per repo/type pair — pushing five times to one
  // repo in a day should read as one line, not five.
  const seen = new Set();
  for (const e of events) {
    if (lines.length >= MAX_ACTIVITY) break;
    // Skip repos that have since been deleted or made private — otherwise the
    // profile ends up advertising 404s.
    if (!liveRepos.has(e.repo.name.split("/")[1])) continue;
    const key = `${e.repo.name}:${e.type}`;
    if (seen.has(key)) continue;
    const text = describeEvent(e);
    if (!text) continue;
    seen.add(key);
    lines.push(`- ${text} <sub>· ${ago(e.created_at)}</sub>`);
  }
  return lines.length ? lines.join("\n") : "- _Quiet week — heads down on something new._";
}

function replaceSection(md, name, body) {
  const start = `<!--START_SECTION:${name}-->`;
  const end = `<!--END_SECTION:${name}-->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(md)) throw new Error(`Missing markers for section "${name}"`);
  return md.replace(re, `${start}\n${body}\n${end}`);
}

const [repos, events] = await Promise.all([
  gh(`/users/${USER}/repos?per_page=100&sort=pushed`),
  gh(`/users/${USER}/events/public?per_page=100`),
]);

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

let md = readFileSync(README, "utf8");
md = replaceSection(md, "projects", buildProjects(repos));
const liveRepos = new Set(repos.map((r) => r.name));
md = replaceSection(md, "activity", buildActivity(events, liveRepos));
md = replaceSection(md, "updated", `Last updated automatically on ${stamp}`);

const before = readFileSync(README, "utf8");
if (before === md) {
  console.log("No changes.");
} else {
  writeFileSync(README, md);
  console.log("README updated.");
}
