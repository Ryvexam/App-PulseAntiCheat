const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { root, resolveExtensionSource, displayPath } = require("./extension-paths");

const extensionDir = resolveExtensionSource();

function readJson(fullPath) {
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    throw new Error(`${displayPath(fullPath)}: JSON invalide (${error.message})`);
  }
}

function assertFile(fullPath) {
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${displayPath(fullPath)}: fichier manquant`);
  }
}

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(fullPath);
    return entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

console.log(`Checking extension source: ${displayPath(extensionDir)}`);

const manifest = readJson(path.join(extensionDir, "manifest.json"));

if (manifest.manifest_version !== 3) {
  throw new Error("manifest.json: manifest_version doit valoir 3");
}

for (const file of [
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((script) => [...(script.js || []), ...(script.css || [])]),
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {})
].filter(Boolean)) {
  assertFile(path.join(extensionDir, file));
}

for (const resource of manifest.declarative_net_request?.rule_resources || []) {
  const resourcePath = path.join(extensionDir, resource.path);
  assertFile(resourcePath);
  readJson(resourcePath);
}

for (const jsFile of listJsFiles(extensionDir)) {
  const result = spawnSync(process.execPath, ["--check", jsFile], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("Extension manifest, rules and JavaScript syntax are valid.");
