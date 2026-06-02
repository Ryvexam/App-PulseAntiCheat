let selectedSession = null;
let currentDetail = null;

const tokenInput = document.getElementById("token");
const savedToken = localStorage.getItem("pulseDashboardToken") || "";
tokenInput.value = savedToken;

function authQuery() {
  const token = localStorage.getItem("pulseDashboardToken") || "";
  return token ? `?token=${encodeURIComponent(token)}` : "";
}

async function api(path) {
  const token = localStorage.getItem("pulseDashboardToken") || "";
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${token ? `${separator}token=${encodeURIComponent(token)}` : ""}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function fmt(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("fr-FR");
}

function renderMetrics(totals) {
  document.getElementById("metrics").innerHTML = [
    ["Sessions", totals.sessions],
    ["Actives", totals.active],
    ["Infractions", totals.infractions],
    ["Captures", totals.screenshots],
    ["Risque élevé", totals.highRisk]
  ].map(([label, value]) => `
    <div class="metric"><strong>${value}</strong><span>${label}</span></div>
  `).join("");
}

function renderSessions(sessions) {
  document.getElementById("session-list").innerHTML = sessions.map(session => `
    <button class="session ${selectedSession?.studentId === session.studentId && selectedSession?.examId === session.examId ? "active" : ""}"
      data-student="${session.studentId}" data-exam="${session.examId}">
      <span class="session-title">
        <span>${escapeHtml(session.studentName || session.studentId)}</span>
        <span class="risk">${session.riskScore}</span>
      </span>
      <span class="session-meta">${session.studentName ? `ID ${escapeHtml(session.studentId)}<br>` : ""}${escapeHtml(session.examId)}<br>${session.infractions} infractions · ${session.screenshots} captures<br>${fmt(session.lastSeenAt)}</span>
      <span class="verdict">${session.analysis?.verdict || "normal"} · ${session.analysis?.suspicionScore || 0}</span>
    </button>
  `).join("");

  document.querySelectorAll(".session").forEach(button => {
    button.addEventListener("click", () => loadDetail(button.dataset.student, button.dataset.exam));
  });
}

function renderDetail(detail) {
  currentDetail = detail;
  document.getElementById("detail-empty").hidden = true;
  document.getElementById("detail-content").hidden = false;
  document.getElementById("detail-exam").textContent = detail.examId;
  document.getElementById("detail-student").textContent = detail.studentName
    ? `${detail.studentName} · ID ${detail.studentId}`
    : detail.studentId;
  document.getElementById("ai-panel").hidden = true;
  document.getElementById("ai-result").textContent = "";
  document.getElementById("ai-status").textContent = "";
  const analysis = detail.analysis || { verdict: "normal", suspicionScore: 0, findings: [] };
  document.getElementById("analysis-verdict").textContent = `${analysis.verdict} · score ${analysis.suspicionScore}/100`;
  document.getElementById("analysis-findings").innerHTML = analysis.findings.length
    ? analysis.findings.map(finding => `
      <article class="finding">
        <strong>${finding.label} · ${finding.severity}</strong>
        <p>${finding.evidence}</p>
        <p>${finding.recommendation}</p>
      </article>
    `).join("")
    : `<article class="finding"><strong>Aucun signal fort</strong><p>La session ne présente pas de pattern comportemental prioritaire.</p></article>`;

  document.getElementById("timeline").innerHTML = detail.timeline
    .filter(item => item.type !== "screenshot" || item.kind === "evidence")
    .slice(-200)
    .map(item => `
      <div class="event ${item.isInfraction ? "infraction" : ""}">
        <time>${fmt(item.timestamp)}</time>
        <strong>${item.type || item.kind}</strong>
        ${item.severity ? `<span> · gravité ${item.severity}</span>` : ""}
      </div>
    `).join("");

  document.getElementById("evidence").innerHTML = detail.screenshots
    .filter(item => item.kind === "evidence")
    .slice(-120)
    .map(item => `
      <article class="shot">
        <img src="${item.url}" alt="Capture preuve">
        <div>
          ${item.eventType || "preuve"} · ${item.relativeMs || 0} ms<br>
          ${item.tabTitle || item.tabUrl || "onglet inconnu"}<br>
          SHA ${String(item.sha256 || "").slice(0, 12)}
        </div>
      </article>
    `).join("");
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

const VERDICT_LABELS = {
  ras: { label: "RAS", color: "#4a8c4a" },
  vigilance: { label: "Vigilance", color: "#c89028" },
  suspicion: { label: "Suspicion", color: "#d96b1a" },
  suspicion_averee: { label: "Suspicion avérée", color: "#c0392b" },
  critique: { label: "Critique", color: "#8b1e1e" },
  fraude_probable: { label: "Fraude probable", color: "#8b1e1e" }
};

function renderVerdict(analysis) {
  const v = VERDICT_LABELS[analysis.verdict] || { label: analysis.verdict || "—", color: "#666" };
  const score = analysis.suspicion_score ?? analysis.suspicionScore ?? 0;
  return `
    <div class="ai-verdict" style="border-color:${v.color}">
      <div class="ai-verdict-badge" style="background:${v.color}">${escapeHtml(v.label)}</div>
      <div class="ai-verdict-score">
        <div class="ai-score-num">${score}<span>/100</span></div>
        <div class="ai-score-bar"><div style="width:${Math.min(100, score)}%;background:${v.color}"></div></div>
      </div>
    </div>
  `;
}

function renderAiAnalysis(json) {
  const a = json.analysis || {};
  const findings = a.key_findings || a.findings || [];
  const evidence = a.evidence_to_review || [];
  const actions = a.recommended_actions || [];
  const limits = a.limitations || [];

  const findingsHtml = findings.length ? findings.map(f => `
    <div class="ai-finding" style="border-left-color:${severityColor(f.severity)}">
      <div class="ai-finding-head">
        <strong>${escapeHtml(f.label || f.id)}</strong>
        <span class="ai-sev" style="background:${severityColor(f.severity)}">${f.severity ?? "—"}</span>
      </div>
      ${f.evidence ? `<div class="ai-evidence">📌 ${escapeHtml(f.evidence)}</div>` : ""}
      ${f.recommendation ? `<div class="ai-reco">💡 ${escapeHtml(f.recommendation)}</div>` : ""}
    </div>
  `).join("") : `<p class="ai-empty">Aucun finding.</p>`;

  const actionsHtml = actions.length ? `
    <ul class="ai-actions">
      ${actions.map(act => `
        <li class="ai-action ai-prio-${escapeHtml(act.priority || "low")}">
          <span class="ai-prio-badge">${escapeHtml(act.priority || "—")}</span>
          <strong>${escapeHtml(act.action)}</strong>
          <p>${escapeHtml(act.description || "")}</p>
        </li>
      `).join("")}
    </ul>` : "";

  const evidenceHtml = evidence.length ? `<ul class="ai-list">${evidence.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : "";
  const limitsHtml = limits.length ? `<ul class="ai-list ai-limits">${limits.map(l => `
    <li><strong>${escapeHtml(l.limitation)}</strong> — <em>${escapeHtml(l.impact || "")}</em></li>
  `).join("")}</ul>` : "";

  return `
    ${renderVerdict(a)}
    ${a.summary ? `<div class="ai-summary">${escapeHtml(a.summary)}</div>` : ""}
    <h4 class="ai-h">Findings (${findings.length})</h4>
    <div class="ai-findings">${findingsHtml}</div>
    ${evidence.length ? `<h4 class="ai-h">Preuves à examiner</h4>${evidenceHtml}` : ""}
    ${actions.length ? `<h4 class="ai-h">Actions recommandées</h4>${actionsHtml}` : ""}
    ${limits.length ? `<h4 class="ai-h">Limites</h4>${limitsHtml}` : ""}
    <details class="ai-raw"><summary>JSON brut</summary><pre>${escapeHtml(JSON.stringify(a, null, 2))}</pre></details>
  `;
}

function severityColor(sev) {
  const n = Number(sev) || 0;
  if (n >= 90) return "#8b1e1e";
  if (n >= 70) return "#c0392b";
  if (n >= 50) return "#d96b1a";
  if (n >= 30) return "#c89028";
  return "#4a8c4a";
}

async function runAiAgent() {
  if (!currentDetail) return;
  const panel = document.getElementById("ai-panel");
  const status = document.getElementById("ai-status");
  const result = document.getElementById("ai-result");
  panel.hidden = false;
  status.textContent = "Analyse en cours...";
  result.innerHTML = `<p class="ai-loading">Préparation du dossier (logs, infractions, heartbeats, captures suspectes)...</p>`;

  try {
    const token = localStorage.getItem("pulseDashboardToken") || "";
    const response = await fetch(
      `/api/ai/analyze/${encodeURIComponent(currentDetail.studentId)}/${encodeURIComponent(currentDetail.examId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      { method: "POST" }
    );
    const json = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(json, null, 2));
    status.textContent = `${json.model} · ${json.input.screenshotsSent} captures transmises`;
    result.innerHTML = renderAiAnalysis(json);
  } catch (error) {
    status.textContent = "Erreur";
    result.innerHTML = `<pre class="ai-error">${escapeHtml(error.message)}</pre>`;
  }
}

async function loadOverview() {
  const overview = await api("/api/audit/overview");
  renderMetrics(overview.totals);
  renderSessions(overview.sessions);
}

async function loadDetail(studentId, examId) {
  selectedSession = { studentId, examId };
  const detail = await api(`/api/exam/sessions/${encodeURIComponent(studentId)}/${encodeURIComponent(examId)}`);
  renderDetail(detail);
  await loadOverview();
}

function exportCsv() {
  if (!currentDetail) return;
  const rows = [["timestamp", "type", "severity", "details"]];
  for (const event of currentDetail.timeline) {
    rows.push([
      event.timestamp || "",
      event.type || event.kind || "",
      event.severity || "",
      JSON.stringify(event.details || event.tabUrl || "")
    ]);
  }
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentDetail.studentId}_${currentDetail.examId}_audit.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById("save-token").addEventListener("click", () => {
  localStorage.setItem("pulseDashboardToken", tokenInput.value);
  loadOverview().catch(error => alert(error.message));
});
document.getElementById("refresh").addEventListener("click", () => loadOverview().catch(error => alert(error.message)));
document.getElementById("export-csv").addEventListener("click", exportCsv);
document.getElementById("ai-agent").addEventListener("click", runAiAgent);

loadOverview().catch(() => {});
