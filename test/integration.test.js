// Integration tests — require the full stack running:
//   ./setup.sh -y && docker compose up -d --build
//   npm run test:integration
//
// Exercises the API end-to-end, including a Postgres + Garage round-trip
// (screenshot upload → evidence retrieval).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ── Load .env (no dependency) so the suite is self-contained ───────────────
(function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
})();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const API_TOKEN = process.env.PULSE_API_TOKEN || "";
const DASH_TOKEN = process.env.PULSE_DASHBOARD_TOKEN || API_TOKEN;

const STUDENT_ID = `itest-${Date.now()}`;
const EXAM_ID = "itest-exam";

const apiHeaders = API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
const jsonHeaders = { "Content-Type": "application/json", ...apiHeaders };

// 1x1 PNG
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Read the body exactly once (consuming it twice throws "Body already read").
async function asJson(res) {
  const text = await res.text();
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: null };
  }
}

test("the stack is reachable before running integration tests", async () => {
  let res;
  try {
    res = await fetch(`${BASE_URL}/health`);
  } catch (err) {
    assert.fail(`Cannot reach ${BASE_URL} — is the stack up? (docker compose up -d). ${err.message}`);
  }
  const { body, text } = await asJson(res);
  assert.equal(res.ok, true, text);
  assert.equal(body.ok, true);
  assert.ok(body.version, "health should report a version");
});

test("ingestion endpoints reject requests without a token", { skip: !API_TOKEN }, async () => {
  const res = await fetch(`${BASE_URL}/api/exam/infractions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: STUDENT_ID, examId: EXAM_ID, type: "window_blur" })
  });
  assert.equal(res.status, 401);
});

test("POST /api/exam/infractions persists an event", async () => {
  const res = await fetch(`${BASE_URL}/api/exam/infractions`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ studentId: STUDENT_ID, examId: EXAM_ID, type: "changement_onglet" })
  });
  const { body, text } = await asJson(res);
  assert.equal(res.ok, true, text);
  assert.equal(body.ok, true);
  assert.ok(body.id);
});

test("POST /api/exam/heartbeat is accepted", async () => {
  const res = await fetch(`${BASE_URL}/api/exam/heartbeat`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      studentId: STUDENT_ID, examId: EXAM_ID, timestamp: Date.now(),
      extensionActive: true, sessionActive: true, fullscreen: true
    })
  });
  assert.equal(res.ok, true, (await asJson(res)).text);
});

test("POST /api/exam/environment is accepted", async () => {
  const res = await fetch(`${BASE_URL}/api/exam/environment`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      studentId: STUDENT_ID, examId: EXAM_ID, score: 10, niveau: "natif",
      signaux: [{ nom: "cpu_cores", valeur: 8, suspect: false }], userAgent: "itest"
    })
  });
  assert.equal(res.ok, true, (await asJson(res)).text);
});

test("screenshot upload round-trips through Garage and back via the evidence proxy", async () => {
  const form = new FormData();
  form.append("screenshot", new Blob([PNG_1x1], { type: "image/png" }), "shot.png");
  form.append("studentId", STUDENT_ID);
  form.append("examId", EXAM_ID);
  form.append("timestamp", String(Date.now()));
  form.append("kind", "evidence");
  form.append("eventType", "changement_onglet");

  const up = await fetch(`${BASE_URL}/api/exam/screenshots`, {
    method: "POST", headers: apiHeaders, body: form
  });
  const { body: upBody, text: upText } = await asJson(up);
  assert.equal(up.ok, true, upText);
  assert.ok(upBody.objectKey, "upload should return the Garage object key");
  assert.ok(upBody.sha256, "upload should return a sha256");

  // Fetch the stored object back through the dashboard evidence proxy.
  const url = `${BASE_URL}/api/evidence/${encodeURIComponent(upBody.objectKey)}?token=${encodeURIComponent(DASH_TOKEN)}`;
  const down = await fetch(url);
  assert.equal(down.ok, true, `evidence fetch failed: ${down.status}`);
  const bytes = Buffer.from(await down.arrayBuffer());
  assert.deepEqual(bytes, PNG_1x1, "evidence bytes should match what was uploaded");
});

test("GET /api/exam/sessions lists our session", async () => {
  const res = await fetch(`${BASE_URL}/api/exam/sessions?token=${encodeURIComponent(DASH_TOKEN)}`);
  const { body: sessions, text } = await asJson(res);
  assert.equal(res.ok, true, text);
  assert.ok(Array.isArray(sessions));
  const mine = sessions.find(s => s.studentId === STUDENT_ID && s.examId === EXAM_ID);
  assert.ok(mine, "the session created during this run should be present");
  assert.ok(mine.infractions >= 1);
  assert.ok(mine.screenshots >= 1);
});

test("GET /api/audit/overview returns totals", async () => {
  const res = await fetch(`${BASE_URL}/api/audit/overview?token=${encodeURIComponent(DASH_TOKEN)}`);
  const { body, text } = await asJson(res);
  assert.equal(res.ok, true, text);
  assert.ok(body.totals);
  assert.ok(Number.isInteger(body.totals.sessions));
  assert.ok(body.totals.sessions >= 1);
});

test("the dashboard requires a valid token", { skip: !DASH_TOKEN }, async () => {
  const res = await fetch(`${BASE_URL}/api/audit/overview`);
  assert.equal(res.status, 401);
});
