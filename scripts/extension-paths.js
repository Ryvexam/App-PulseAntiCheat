const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function loadDotEnv() {
  const candidates = [
    path.join(root, ".env"),
    path.join(root, "..", ".env")
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  }
}

function resolveExtensionSource() {
  const candidates = [
    process.env.PULSE_EXTENSION_SRC,
    path.join(root, "extension-pulse"),
    path.join(root, "..", "Extension")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (fs.existsSync(path.join(absolute, "manifest.json"))) {
      return absolute;
    }
  }

  throw new Error(
    "Extension source not found. Set PULSE_EXTENSION_SRC or place the extension in ../Extension."
  );
}

function displayPath(filePath) {
  return path.relative(root, filePath) || ".";
}

module.exports = {
  root,
  loadDotEnv,
  resolveExtensionSource,
  displayPath
};
