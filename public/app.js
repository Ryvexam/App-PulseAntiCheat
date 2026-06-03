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

const EVENT_COPY = {
  input_events: {
    label: "Interaction sur le QCM",
    description: "Clic, changement de selection ou interaction normale avec la page."
  },
  clavier_detecte: {
    label: "Utilisation du clavier",
    description: "Une touche a ete utilisee alors que ce QCM est attendu principalement au clic."
  },
  copier_coller_detecte: {
    label: "Copier/coller detecte",
    description: "Une action copier, couper ou coller a ete detectee pendant l'examen."
  },
  fenetre_redimensionnee: {
    label: "Fenetre redimensionnee",
    description: "La taille de la fenetre d'examen a change."
  },
  dom_tamper: {
    label: "Modification de la page detectee",
    description: "Un changement inhabituel a ete detecte dans la page d'examen."
  },
  window_blur: {
    label: "Fenetre d'examen quittee",
    description: "La fenetre d'examen n'etait plus au premier plan."
  },
  perte_focus_fenetre: {
    label: "Perte de focus",
    description: "L'eleve a clique ou bascule en dehors de la fenetre d'examen."
  },
  tab_hidden: {
    label: "Onglet d'examen masque",
    description: "L'onglet d'examen a ete masque, souvent apres un changement d'onglet ou d'application."
  },
  examen_quitte: {
    label: "Sortie de l'examen",
    description: "La page d'examen a ete quittee ou la session s'est interrompue."
  },
  heartbeat: {
    label: "Extension active",
    description: "Signal regulier indiquant que l'extension fonctionne toujours."
  },
  changement_onglet: {
    label: "Changement d'onglet",
    description: "L'eleve a bascule vers un autre onglet."
  },
  fullscreen_exit: {
    label: "Sortie du plein ecran",
    description: "Le mode plein ecran obligatoire n'etait plus actif."
  },
  fullscreen_api_exit: {
    label: "Plein ecran desactive",
    description: "Le navigateur a signale une sortie du mode plein ecran."
  },
  faux_fullscreen_exit: {
    label: "Faux plein ecran detecte",
    description: "La fenetre ne correspondait pas a un vrai plein ecran."
  },
  extension_activee: {
    label: "Extension non autorisee active",
    description: "Une autre extension Chrome etait active pendant l'examen."
  },
  extensions_non_autorisees: {
    label: "Extensions non autorisees",
    description: "Des extensions Chrome doivent etre desactivees avant de continuer."
  },
  multi_ecran: {
    label: "Plusieurs ecrans detectes",
    description: "L'environnement indique l'utilisation de plusieurs affichages."
  },
  ecran_verrouille: {
    label: "Ecran verrouille",
    description: "L'ordinateur semble avoir ete verrouille pendant l'examen."
  },
  vm_detectee: {
    label: "Environnement virtuel detecte",
    description: "L'examen semble lance dans une machine virtuelle ou un environnement suspect."
  },
  requete_bloquee: {
    label: "Site bloque",
    description: "Une tentative d'acces a un site non autorise a ete bloquee."
  },
  requete_ia_bloquee: {
    label: "Outil d'IA bloque",
    description: "Une tentative d'acces a un service d'IA a ete bloquee."
  },
  screenshot: {
    label: "Capture enregistree",
    description: "Une capture d'ecran a ete ajoutee aux preuves."
  }
};

function humanizeCode(value) {
  const label = String(value || "evenement")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function eventCopy(item) {
  const type = item.type || item.kind;
  return EVENT_COPY[type] || {
    label: humanizeCode(type),
    description: "Evenement enregistre par l'extension pendant l'examen."
  };
}

function severityMeta(item) {
  const n = Number(item.severity || 0);
  if (!n || item.type === "heartbeat") {
    return { label: "Information", className: "severity-info", title: "" };
  }
  if (n >= 90) return { label: "Critique", className: "severity-critical", title: `Score technique ${n}/100` };
  if (n >= 70) return { label: "Tres eleve", className: "severity-high", title: `Score technique ${n}/100` };
  if (n >= 40) return { label: "Eleve", className: "severity-warning", title: `Score technique ${n}/100` };
  if (n >= 20) return { label: "Moyen", className: "severity-medium", title: `Score technique ${n}/100` };
  return { label: "Faible", className: "severity-low", title: `Score technique ${n}/100` };
}

function renderTimelineEvent(item) {
  const copy = eventCopy(item);
  const severity = severityMeta(item);
  const technicalType = item.type || item.kind || "evenement";
  return `
    <div class="event ${item.isInfraction ? "infraction" : ""}">
      <time>${fmt(item.timestamp)}</time>
      <div class="event-main">
        <strong>${escapeHtml(copy.label)}</strong>
        <p>${escapeHtml(copy.description)}</p>
      </div>
      <span class="event-severity ${severity.className}" title="${escapeHtml(severity.title)}">${escapeHtml(severity.label)}</span>
      <span class="event-code" title="Code technique">${escapeHtml(technicalType)}</span>
    </div>
  `;
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

function groupSessionsByExam(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const examId = session.examId || "Examen sans nom";
    if (!groups.has(examId)) {
      groups.set(examId, {
        examId,
        sessions: [],
        active: 0,
        infractions: 0,
        screenshots: 0,
        maxRisk: 0,
        lastSeenAt: null
      });
    }

    const group = groups.get(examId);
    group.sessions.push(session);
    group.active += session.status === "active" ? 1 : 0;
    group.infractions += Number(session.infractions || 0);
    group.screenshots += Number(session.screenshots || 0);
    group.maxRisk = Math.max(group.maxRisk, Number(session.riskScore || 0));
    if (!group.lastSeenAt || new Date(session.lastSeenAt) > new Date(group.lastSeenAt)) {
      group.lastSeenAt = session.lastSeenAt;
    }
  }
  return [...groups.values()];
}

function pluralize(count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
}

function renderSessions(sessions) {
  const groups = groupSessionsByExam(sessions);
  document.getElementById("session-list").innerHTML = groups.map(group => {
    const isCurrentExam = selectedSession?.examId === group.examId;
    const groupSummary = [
      pluralize(group.sessions.length, "eleve", "eleves"),
      group.active ? `${group.active} active${group.active > 1 ? "s" : ""}` : null,
      pluralize(group.infractions, "alerte", "alertes"),
      `${group.screenshots} capture${group.screenshots > 1 ? "s" : ""}`
    ].filter(Boolean).join(" · ");

    return `
      <section class="exam-group ${isCurrentExam ? "active" : ""}">
        <div class="exam-group-head">
          <div>
            <span class="exam-group-label">Examen</span>
            <h3>${escapeHtml(group.examId)}</h3>
          </div>
          <div class="exam-risk" title="Risque maximal de cet examen">
            <span>${group.maxRisk}</span>
            <small>max</small>
          </div>
        </div>
        <div class="exam-group-meta">
          <span>${escapeHtml(groupSummary)}</span>
          <time>${fmt(group.lastSeenAt)}</time>
        </div>
        <div class="exam-students">
          ${group.sessions.map(session => `
            <button class="session ${selectedSession?.studentId === session.studentId && selectedSession?.examId === session.examId ? "active" : ""}"
              data-student="${escapeHtml(session.studentId)}" data-exam="${escapeHtml(session.examId)}">
              <span class="session-title">
                <span>${escapeHtml(session.studentName || session.studentId)}</span>
                <span class="risk">${session.riskScore}</span>
              </span>
              <span class="session-meta">${session.studentName ? `ID ${escapeHtml(session.studentId)}<br>` : ""}${session.infractions} alerte${session.infractions > 1 ? "s" : ""} · ${session.screenshots} capture${session.screenshots > 1 ? "s" : ""}<br>${fmt(session.lastSeenAt)}</span>
              <span class="verdict">${session.analysis?.verdict || "normal"} · ${session.analysis?.suspicionScore || 0}</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");

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
    .map(renderTimelineEvent)
    .join("");

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
  const rows = [["timestamp", "libelle", "type_technique", "impact", "score_technique", "details"]];
  for (const event of currentDetail.timeline) {
    const copy = eventCopy(event);
    const severity = severityMeta(event);
    rows.push([
      event.timestamp || "",
      copy.label,
      event.type || event.kind || "",
      severity.label,
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
