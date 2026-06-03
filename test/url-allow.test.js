const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { resolveExtensionSource } = require("../scripts/extension-paths");
const extensionDir = resolveExtensionSource();
const { isAllowedUrl, matchPatternToRegExp } = require(path.join(extensionDir, "url-allow"));

const HESIAS = ["https://*.hesias.fr/*", "https://*.hesias.net/*"];

test("wildcard subdomain matches the apex and subdomains", () => {
  assert.equal(isAllowedUrl("https://hesias.fr/", HESIAS), true);
  assert.equal(isAllowedUrl("https://exam.hesias.fr/mcq/123", HESIAS), true);
  assert.equal(isAllowedUrl("https://a.b.hesias.net/x", HESIAS), true);
});

test("non-listed and look-alike hosts are rejected", () => {
  assert.equal(isAllowedUrl("https://evil.com/", HESIAS), false);
  assert.equal(isAllowedUrl("https://hesias.fr.evil.com/", HESIAS), false);
  assert.equal(isAllowedUrl("https://nothesias.fr/", HESIAS), false);
});

test("scheme is enforced", () => {
  assert.equal(isAllowedUrl("http://exam.hesias.fr/", HESIAS), false);
  assert.equal(isAllowedUrl("http://exam.hesias.fr/", ["*://*.hesias.fr/*"]), true);
});

test("explicit host (no wildcard) matches only that host", () => {
  const pat = ["https://exam.example.com/*"];
  assert.equal(isAllowedUrl("https://exam.example.com/a", pat), true);
  assert.equal(isAllowedUrl("https://other.example.com/a", pat), false);
});

test("invalid patterns are ignored, not thrown", () => {
  assert.equal(matchPatternToRegExp("not-a-pattern"), null);
  assert.equal(isAllowedUrl("https://hesias.fr/", ["garbage", ...HESIAS]), true);
});

test("default exam-origins behaviour matches the old hesias regex", () => {
  // Old guard: /^https:\/\/[^/]*\.hesias\.(fr|net)\//i
  const old = (url) => /^https:\/\/[^/]*\.hesias\.(fr|net)\//i.test(url);
  for (const url of [
    "https://exam.hesias.fr/mcq/1",
    "https://booster.hesias.net/exam/9",
    "https://evil.com/",
    "https://hesias.fr.evil.com/"
  ]) {
    // Both agree on subdomain'd hesias URLs and on rejections.
    if (old(url)) assert.equal(isAllowedUrl(url, HESIAS), true, url);
    else assert.equal(isAllowedUrl(url, HESIAS), false, url);
  }
});
