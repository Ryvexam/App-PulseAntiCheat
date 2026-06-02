const test = require("node:test");
const assert = require("node:assert/strict");
const { isWeak } = require("../src/security");

test("isWeak: empty and placeholder values are weak", () => {
  assert.equal(isWeak(""), true);
  assert.equal(isWeak("   "), true);
  assert.equal(isWeak("change-me-api-token"), true);
  assert.equal(isWeak("change-me-dashboard-token"), true);
  assert.equal(isWeak("GK0123456789abcdef01234567"), true);
  assert.equal(isWeak("pulse-garage-admin-token-change-me"), true);
});

test("isWeak: a generated secret is not weak", () => {
  assert.equal(isWeak("19b591927ad7af839cf403d14dfe557f425d24b765ffe6b3411e29ea84686660"), false);
  assert.equal(isWeak("GK1dc26f27d339f38c7c67a956"), false);
});
