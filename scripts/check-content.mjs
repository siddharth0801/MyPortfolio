#!/usr/bin/env node
/**
 * Validates data/content.js. No dependencies — Node only.
 *
 * Catches the things that break the live site but not local preview:
 *  - an image path whose case does not match the file on disk (GitHub Pages
 *    is case-sensitive; most local setups are not)
 *  - a missing required key, an unparseable URL
 *  - two socials sharing a name, which is how the two LinkedIn links in the
 *    original markup drifted to different profiles
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

/* Evaluate content.js in a sandbox with just a `window` to attach to. */
const source = fs.readFileSync(path.join(ROOT, "data/content.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
try {
  vm.runInContext(source, sandbox, { filename: "data/content.js" });
} catch (e) {
  console.error(`data/content.js failed to parse: ${e.message}`);
  process.exit(1);
}

const P = sandbox.window.PORTFOLIO;
if (!P) {
  console.error("data/content.js did not define window.PORTFOLIO");
  process.exit(1);
}

const REQUIRED = ["site", "profile", "education", "skills", "projects", "socials", "contact"];
const missing = REQUIRED.filter((key) => !P[key]);
if (missing.length) {
  // Stop here: the checks below index into these keys, and a TypeError
  // stack trace would hide the report we just built.
  console.error(`data/content.js: missing top-level key(s): ${missing.join(", ")}`);
  process.exit(1);
}

/* Case-sensitive existence check, one directory listing per directory. */
const listings = new Map();
function fileExists(rel) {
  const dir = path.join(ROOT, path.dirname(rel));
  if (!listings.has(dir)) {
    listings.set(dir, fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set());
  }
  return listings.get(dir).has(path.basename(rel));
}

function checkAsset(rel, where) {
  if (!rel) return;
  if (/^https?:\/\//.test(rel)) return;
  if (!fileExists(rel)) fail(`${where}: file not found (check the exact case): ${rel}`);
}

function checkUrl(url, where) {
  if (!url) return;
  try {
    new URL(url, "https://example.com");
  } catch {
    fail(`${where}: unparseable URL: ${url}`);
  }
}

(P.skills || []).forEach((s, i) => {
  if (!s.name) fail(`skills[${i}]: missing name`);
  checkAsset(s.icon, `skills[${i}] (${s.name})`);
});

(P.projects || []).forEach((p, i) => {
  if (!p.title) fail(`projects[${i}]: missing title`);
  if (!p.alt) fail(`projects[${i}] (${p.title}): missing alt text`);
  checkAsset(p.image, `projects[${i}] (${p.title})`);
  checkUrl(p.link && p.link.url, `projects[${i}] (${p.title})`);
});

const seen = new Set();
const PLACEMENTS = new Set(["about", "footer"]);
(P.socials || []).forEach((s, i) => {
  if (seen.has(s.name)) fail(`socials[${i}]: duplicate name "${s.name}" — each network belongs in one entry`);
  seen.add(s.name);
  checkUrl(s.url, `socials[${i}] (${s.name})`);
  const placements = s.showIn || [];
  if (!placements.length) fail(`socials[${i}] (${s.name}): empty showIn, so it renders nowhere`);
  placements.forEach((w) => {
    if (!PLACEMENTS.has(w)) fail(`socials[${i}] (${s.name}): unknown showIn value "${w}"`);
  });
});

/* The CV button is only rendered when a url is set, so an empty url is fine.
   A set-but-absent file is a warning, not a failure: the path is configured
   ahead of the PDF being added. Set profile.cv.url to "" to hide the button
   until then. */
const cv = (P.profile && P.profile.cv) || {};
if (cv.url && !/^https?:\/\//.test(cv.url) && !fileExists(cv.url)) {
  warn(`profile.cv.url points at ${cv.url}, which does not exist yet — the ` +
       `"View CV" button will 404. Add the file, or set url to "" to hide the button.`);
}

(P.site.nav || []).forEach((n, i) => {
  if (!n.href || !n.href.startsWith("#")) fail(`site.nav[${i}]: href should be an in-page anchor`);
});

if (warnings.length) {
  warnings.forEach((w) => console.warn("  ! " + w));
}

if (errors.length) {
  console.error(`data/content.js: ${errors.length} problem(s)\n`);
  errors.forEach((e) => console.error("  - " + e));
  process.exit(1);
}
console.log(
  `data/content.js OK — ${P.skills.length} skills, ${P.projects.length} projects, ` +
    `${P.socials.length} socials, ${P.education.length} education entries.`
);
