const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const extensionDir = path.join(root, "extension-pulse");

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    throw new Error(`${relativePath}: JSON invalide (${error.message})`);
  }
}

function assertFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${relativePath}: fichier manquant`);
  }
}

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(fullPath);
    return entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

const manifest = readJson("extension-pulse/manifest.json");

if (manifest.manifest_version !== 3) {
  throw new Error("manifest.json: manifest_version doit valoir 3");
}

for (const file of [
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((script) => [...(script.js || []), ...(script.css || [])]),
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {})
].filter(Boolean)) {
  assertFile(path.join("extension-pulse", file));
}

for (const resource of manifest.declarative_net_request?.rule_resources || []) {
  assertFile(path.join("extension-pulse", resource.path));
  readJson(path.join("extension-pulse", resource.path));
}

for (const jsFile of listJsFiles(extensionDir)) {
  const result = spawnSync(process.execPath, ["--check", jsFile], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("Extension manifest, rules and JavaScript syntax are valid.");
