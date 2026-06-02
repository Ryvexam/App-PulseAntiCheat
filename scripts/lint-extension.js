const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checkedExtensions = new Set([".js", ".json", ".css", ".html", ".md"]);
const ignoredDirs = new Set([".git", "dist", "node_modules"]);
const errors = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (checkedExtensions.has(path.extname(entry.name))) {
      lintFile(fullPath);
    }
  }
}

function report(file, line, message) {
  const relativePath = path.relative(root, file);
  errors.push(`${relativePath}:${line}: ${message}`);
}

function lintFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split("\n");

  if (!source.endsWith("\n")) {
    report(file, lines.length, "missing final newline");
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/\s+$/.test(line)) {
      report(file, lineNumber, "trailing whitespace");
    }

    if (line.includes("\t")) {
      report(file, lineNumber, "tab character");
    }

    if (path.extname(file) === ".js" && /^\s*var\s+/.test(line)) {
      report(file, lineNumber, "use const/let instead of var");
    }
  });
}

walk(root);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Extension style lint passed.");
