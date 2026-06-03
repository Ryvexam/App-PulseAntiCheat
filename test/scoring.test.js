const test = require("node:test");
const assert = require("node:assert/strict");
const { isInfractionType, getSeverity } = require("../src/scoring");

test("isInfractionType: known infraction types", () => {
  assert.equal(isInfractionType("vm_detectee"), true);
  assert.equal(isInfractionType("changement_onglet"), true);
  assert.equal(isInfractionType("requete_ia_bloquee"), true);
  assert.equal(isInfractionType("clavier_detecte"), true);
  assert.equal(isInfractionType("copier_coller_detecte"), true);
});

test("isInfractionType: substring heuristics for *_bloquee / *_detectee", () => {
  assert.equal(isInfractionType("requete_inconnue_bloquee"), true);
  assert.equal(isInfractionType("anomalie_detectee"), true);
});

test("isInfractionType: benign / telemetry types are not infractions", () => {
  assert.equal(isInfractionType("input_events"), false);
  assert.equal(isInfractionType("page_loaded"), false);
  assert.equal(isInfractionType(""), false);
  assert.equal(isInfractionType(undefined), false);
});

test("getSeverity: explicit scores", () => {
  assert.equal(getSeverity("vm_detectee"), 100);
  assert.equal(getSeverity("ecran_verrouille"), 95);
  assert.equal(getSeverity("fullscreen_exit"), 45);
  assert.equal(getSeverity("input_events"), 5);
  assert.equal(getSeverity("clavier_detecte"), 50);
  assert.equal(getSeverity("copier_coller_detecte"), 85);
});

test("getSeverity: unknown infraction defaults to 40, benign to 5", () => {
  // unknown but matches the *_bloquee infraction heuristic
  assert.equal(getSeverity("autre_truc_bloquee"), 40);
  // unknown and benign
  assert.equal(getSeverity("totally_unknown"), 5);
});

test("getSeverity: severities are bounded 0..100", () => {
  for (const type of ["vm_detectee", "fullscreen_exit", "window_blur", "unknown"]) {
    const s = getSeverity(type);
    assert.ok(s >= 0 && s <= 100, `${type} severity ${s} out of range`);
  }
});
