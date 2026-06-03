#!/usr/bin/env node
// Build pipeline: bundle extension sources and inject build-time config.
//
// Config (read from process.env, falling back to ./.env):
//   PULSE_BACKEND_URL     backend the extension sends data to (default localhost:3000)
//   PULSE_EXAM_ORIGINS    match patterns where the extension runs / is whitelisted
//   PULSE_WHITELIST_URLS  extra hosts allowed during the exam (comma-separated)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { root: ROOT, loadDotEnv, resolveExtensionSource, displayPath } = require("./extension-paths");

loadDotEnv();

const SRC = resolveExtensionSource();
const OUT = path.join(ROOT, "dist", "extension");
const WASM_SRC = path.join(ROOT, "assembly", "build", "core.wasm");

const BACKEND_URL = (process.env.PULSE_BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");
const EXAM_ORIGINS = (process.env.PULSE_EXAM_ORIGINS || "https://*.hesias.fr/*,https://*.hesias.net/*")
  .split(",").map(s => s.trim()).filter(Boolean);
const WHITELIST = (process.env.PULSE_WHITELIST_URLS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const JS_ENTRIES = [
  { in: ["vmdetect.js", "content.js"], out: "content.js", config: true },
  { in: ["url-allow.js", "db.js", "uploader.js", "background.js"], out: "background.js", config: true },
  { in: ["popup.js"], out: "popup.js", config: false }
];

const COPY_FILES = ["popup.html", "overlay.css"];
const COPY_DIRS = ["icons", "rules"];

// "https://*.hesias.fr/*" → "hesias.fr"
function hostFromPattern(pattern) {
  return String(pattern || "").trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^\*\./, "")
    .replace(/:\d+$/, "");
}

function configBanner() {
  return [
    "// ─── Injected at build time (scripts/build-extension.js) ───",
    `const PULSE_BACKEND_URL = ${JSON.stringify(BACKEND_URL)};`,
    `const PULSE_EXAM_ORIGINS = ${JSON.stringify(EXAM_ORIGINS)};`,
    "",
    ""
  ].join("\n");
}

function clean() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function concatEntry(entry) {
  let code = entry.in.map(f => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n\n");
  // Dependencies are inlined above; drop importScripts of those files so the
  // packed service worker does not try to fetch non-existent separate files.
  code = code.replace(/^[ \t]*importScripts\([^)]*\);?[ \t]*$/gm, "// importScripts inlined at build time");
  if (entry.config) code = configBanner() + code;
  fs.writeFileSync(path.join(OUT, entry.out), code);
  console.log(`✓ ${entry.out} (${(code.length / 1024).toFixed(1)} KB)`);
}

function patchManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  manifest.update_url = `${BACKEND_URL}/updates.xml`;
  const keyPath = path.join(ROOT, "extension.pem");
  if (fs.existsSync(keyPath)) {
    const pem = fs.readFileSync(keyPath, "utf8");
    const priv = crypto.createPrivateKey(pem);
    const pub = crypto.createPublicKey(priv).export({ type: "spki", format: "der" });
    manifest.key = pub.toString("base64");
  }
  manifest.content_scripts = manifest.content_scripts.map(cs => ({
    ...cs,
    js: cs.js.includes("vmdetect.js") || cs.js.includes("content.js") ? ["content.js"] : cs.js,
    matches: EXAM_ORIGINS
  }));
  const war = manifest.web_accessible_resources || [];
  const hasCore = war.some(r => (r.resources || []).includes("core.wasm"));
  if (!hasCore) {
    war.push({ resources: ["core.wasm"], matches: ["<all_urls>"] });
    manifest.web_accessible_resources = war;
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✓ manifest.json (update_url=${manifest.update_url}, version=${manifest.version}, matches=${EXAM_ORIGINS.join(",")})`);
  return manifest.version;
}

function patchRules() {
  const rulesPath = path.join(OUT, "rules", "rules.json");
  if (!fs.existsSync(rulesPath)) return;
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const examHosts = [...new Set(EXAM_ORIGINS.map(hostFromPattern).filter(Boolean))];
  const defaultHosts = ["hesias.fr", "hesias.net"];
  const sameAsDefault = (arr) =>
    Array.isArray(arr) && arr.length === defaultHosts.length && defaultHosts.every(d => arr.includes(d));

  // Follow the configured exam origins on rules still using the default hosts.
  for (const rule of rules) {
    const c = rule.condition || {};
    if (sameAsDefault(c.initiatorDomains)) c.initiatorDomains = examHosts;
    if (sameAsDefault(c.requestDomains)) c.requestDomains = examHosts;
  }

  let nextId = rules.reduce((m, r) => Math.max(m, r.id || 0), 0);
  nextId = Math.max(nextId, 300) + 1;

  // Always allow the configured backend (additive, high priority).
  rules.push({
    id: nextId++,
    priority: 100,
    action: { type: "allow" },
    condition: {
      urlFilter: `|${BACKEND_URL}/api/`,
      initiatorDomains: examHosts,
      resourceTypes: ["xmlhttprequest", "websocket"]
    }
  });

  // Operator-provided extra whitelist hosts.
  for (const entry of WHITELIST) {
    const host = hostFromPattern(entry);
    if (!host) continue;
    rules.push({
      id: nextId++,
      priority: 20,
      action: { type: "allow" },
      condition: {
        urlFilter: `||${host}/*`,
        resourceTypes: ["xmlhttprequest", "script", "stylesheet", "image", "media", "font", "websocket", "other", "sub_frame"]
      }
    });
  }

  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + "\n");
  console.log(`✓ rules.json (backend allow=${BACKEND_URL}, examHosts=${examHosts.join(",")}, whitelist+=${WHITELIST.length})`);
}

function copyWasm() {
  if (!fs.existsSync(WASM_SRC)) {
    console.warn(`! ${WASM_SRC} missing — skipping WASM (run \`npm run build:wasm\` first)`);
    return;
  }
  fs.copyFileSync(WASM_SRC, path.join(OUT, "core.wasm"));
  const size = fs.statSync(path.join(OUT, "core.wasm")).size;
  console.log(`✓ core.wasm (${(size / 1024).toFixed(1)} KB)`);
}

function main() {
  console.log(`[build-extension] source=${displayPath(SRC)}`);
  console.log(`[build-extension] backend=${BACKEND_URL} origins=${EXAM_ORIGINS.join(",")}`);
  clean();
  for (const entry of JS_ENTRIES) concatEntry(entry);
  for (const f of COPY_FILES) {
    fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
    console.log(`✓ ${f}`);
  }
  for (const d of COPY_DIRS) {
    copyDir(path.join(SRC, d), path.join(OUT, d));
    console.log(`✓ ${d}/`);
  }
  copyWasm();
  const version = patchManifest();
  patchRules();
  console.log(`[build-extension] done → ${OUT} (v${version})`);
}

main();
