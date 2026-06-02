#!/usr/bin/env node
// Pack dist/extension/ → releases/pulse-vX.Y.Z.crx + updates.xml
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const crypto = require("crypto");
const crx3 = require("crx3");

const ROOT = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT, "dist", "extension");
const RELEASES = path.join(ROOT, "releases");
const KEY_PATH = path.join(ROOT, "extension.pem");
const BACKEND_URL = process.env.PULSE_BACKEND_URL || "http://localhost:3000";

function ensureKey() {
  if (fs.existsSync(KEY_PATH)) return;
  console.log(`[pack-crx] generating RSA key → ${KEY_PATH}`);
  execSync(`openssl genrsa -out "${KEY_PATH}" 2048`, { stdio: "inherit" });
  fs.chmodSync(KEY_PATH, 0o600);
}

function pubKeyDer(pemPath) {
  return execSync(`openssl rsa -in "${pemPath}" -pubout -outform DER 2>/dev/null`);
}

function chromeExtensionId(pubDer) {
  const hex = crypto.createHash("sha256").update(pubDer).digest("hex").slice(0, 32);
  return hex.split("").map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

async function main() {
  ensureKey();
  if (!fs.existsSync(EXT_DIR)) {
    console.error("dist/extension/ missing — run build-extension first");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  const version = manifest.version;
  fs.mkdirSync(RELEASES, { recursive: true });

  const pubDer = pubKeyDer(KEY_PATH);
  const id = chromeExtensionId(pubDer);
  manifest.key = pubDer.toString("base64");
  fs.writeFileSync(path.join(EXT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  const crxPath = path.join(RELEASES, `pulse-v${version}.crx`);
  const codebase = `${BACKEND_URL.replace(/\/+$/, "")}/releases/pulse-v${version}.crx`;
  const xmlPath = path.join(RELEASES, "updates.xml");

  await crx3([path.join(EXT_DIR, "manifest.json")], {
    keyPath: KEY_PATH,
    crxPath,
    xmlPath,
    crxURL: codebase,
    appVersion: version
  });

  console.log(`✓ ${crxPath} (${(fs.statSync(crxPath).size / 1024).toFixed(1)} KB)`);
  console.log(`✓ ${xmlPath}`);
  console.log(`[pack-crx] done — id=${id} version=${version}`);
}

main().catch(err => { console.error(err); process.exit(1); });
