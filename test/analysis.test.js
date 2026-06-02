const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeBehavior } = require("../src/analysis");

function session(extra = {}) {
  const now = Date.now();
  return {
    started_at: new Date(now - 30 * 60000).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    ...extra
  };
}

function infraction(type, extra = {}) {
  return { type, isInfraction: true, timestamp: new Date().toISOString(), ...extra };
}

test("clean session → normal verdict, no findings", () => {
  const result = analyzeBehavior({ session: session(), events: [], screenshots: [], heartbeats: [] });
  assert.equal(result.verdict, "normal");
  assert.equal(result.suspicionScore, 0);
  assert.equal(result.findingCount, 0);
  assert.deepEqual(result.findings, []);
});

test("repeated tab switching is flagged", () => {
  const events = [
    infraction("changement_onglet"),
    infraction("changement_onglet"),
    infraction("changement_onglet")
  ];
  const result = analyzeBehavior({ session: session(), events });
  const ids = result.findings.map(f => f.id);
  assert.ok(ids.includes("repeated_tab_switching"));
});

test("two tab switches stay below the threshold", () => {
  const events = [infraction("changement_onglet"), infraction("changement_onglet")];
  const result = analyzeBehavior({ session: session(), events });
  assert.ok(!result.findings.some(f => f.id === "repeated_tab_switching"));
});

test("virtualized environment flagged via environment score", () => {
  const result = analyzeBehavior({
    session: session(),
    events: [],
    environment: { score: 75 }
  });
  assert.ok(result.findings.some(f => f.id === "virtualized_environment"));
});

test("AI tab in evidence screenshots is flagged", () => {
  const result = analyzeBehavior({
    session: session(),
    events: [],
    screenshots: [{ tabUrl: "https://chatgpt.com/c/abc", kind: "evidence" }]
  });
  assert.ok(result.findings.some(f => f.id === "suspicious_tabs_in_evidence"));
});

test("heartbeat gap over 45s is flagged", () => {
  const base = Date.now();
  const heartbeats = [
    { timestamp: new Date(base).toISOString() },
    { timestamp: new Date(base + 60000).toISOString() }
  ];
  const result = analyzeBehavior({ session: session(), events: [], heartbeats });
  assert.ok(result.findings.some(f => f.id === "heartbeat_gaps"));
});

test("high-severity infractions escalate the verdict to critique", () => {
  const events = [
    infraction("vm_detectee"),
    infraction("changement_onglet"),
    infraction("changement_onglet"),
    infraction("changement_onglet")
  ];
  const result = analyzeBehavior({
    session: session(),
    events,
    environment: { score: 90 },
    screenshots: [{ tabUrl: "https://chat.openai.com", kind: "evidence" }]
  });
  assert.equal(result.suspicionScore, 100); // capped
  assert.equal(result.verdict, "critique");
});

test("findings are sorted by descending severity", () => {
  const events = [
    infraction("changement_onglet"),
    infraction("changement_onglet"),
    infraction("changement_onglet"),
    infraction("extension_activee")
  ];
  const result = analyzeBehavior({ session: session(), events });
  for (let i = 1; i < result.findings.length; i++) {
    assert.ok(result.findings[i - 1].severity >= result.findings[i].severity);
  }
});
