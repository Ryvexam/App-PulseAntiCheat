function minutesBetween(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, (end - start) / 60000);
}

function groupCount(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function analyzeBehavior({ session, events = [], screenshots = [], heartbeats = [], environment = null }) {
  const infractions = events.filter(event => event.isInfraction || event.is_infraction);
  const startedAt = session.started_at || session.startedAt || events[0]?.timestamp || screenshots[0]?.timestamp;
  const lastSeenAt = session.last_seen_at || session.lastSeenAt || events.at(-1)?.timestamp || screenshots.at(-1)?.timestamp;
  const durationMinutes = minutesBetween(startedAt, lastSeenAt);
  const byType = groupCount(infractions, "type");
  const findings = [];

  function add(id, label, severity, evidence, recommendation) {
    findings.push({ id, label, severity, evidence, recommendation });
  }

  const tabSwitches = byType.changement_onglet || 0;
  if (tabSwitches >= 3) {
    add(
      "repeated_tab_switching",
      "Changements d'onglet répétés",
      Math.min(100, 40 + tabSwitches * 8),
      `${tabSwitches} changements d'onglet (${(tabSwitches / durationMinutes).toFixed(2)}/min)`,
      "Revoir les preuves autour des changements d'onglet et comparer avec la progression de l'examen."
    );
  }

  const focusLosses = (byType.window_blur || 0) + (byType.tab_hidden || 0);
  if (focusLosses >= 5) {
    add(
      "unstable_focus",
      "Focus navigateur instable",
      Math.min(90, 25 + focusLosses * 5),
      `${focusLosses} pertes de focus ou masquages d'onglet`,
      "Vérifier si les événements sont regroupés autour de réponses sensibles ou d'accès externes."
    );
  }

  const forbiddenExtensions = (byType.extension_activee || 0) + (byType.extensions_non_autorisees || 0);
  if (forbiddenExtensions > 0) {
    add(
      "extension_risk",
      "Extensions non autorisées",
      85,
      `${forbiddenExtensions} événement(s) lié(s) aux extensions`,
      "Identifier les extensions et conserver les captures de preuve associées."
    );
  }

  const aiRequests = byType.requete_ia_bloquee || 0;
  if (aiRequests > 0) {
    add(
      "ai_request_attempt",
      "Tentative d'accès IA bloquée",
      90,
      `${aiRequests} requête(s) IA bloquée(s)`,
      "Contrôler les URLs bloquées et les screenshots multi-onglets post-infraction."
    );
  }

  const windowResizes = byType.fenetre_redimensionnee || 0;
  if (windowResizes > 0) {
    add(
      "window_resize",
      "Fenêtre redimensionnée hors plein écran",
      Math.min(80, 40 + windowResizes * 10),
      `${windowResizes} redimensionnement(s)`,
      "Vérifier si l'élève a tenté de quitter le mode plein écran."
    );
  }

  const focusLossWin = byType.perte_focus_fenetre || 0;
  if (focusLossWin > 0) {
    add(
      "window_focus_loss",
      "Perte de focus fenêtre (alt-tab)",
      Math.min(90, 35 + focusLossWin * 12),
      `${focusLossWin} perte(s) de focus`,
      "Vérifier les évidences pour détecter applications externes."
    );
  }

  const domTamper = byType.dom_tamper || 0;
  if (domTamper > 0) {
    add(
      "dom_tamper",
      "Altération DOM détectée",
      95,
      `${domTamper} modification(s) non sollicitée(s) du QCM`,
      "Inspecter DevTools / script injecté. Infraction critique."
    );
  }

  const fullscreenExits = (byType.fullscreen_exit || 0) + (byType.fullscreen_api_exit || 0) + (byType.faux_fullscreen_exit || 0);
  if (fullscreenExits >= 2) {
    add(
      "fullscreen_instability",
      "Sorties plein écran répétées",
      Math.min(80, 30 + fullscreenExits * 8),
      `${fullscreenExits} sorties ou anomalies plein écran`,
      "Revoir si l'étudiant sort du plein écran pendant les phases de réponse."
    );
  }

  const multiScreen = byType.multi_ecran || 0;
  if (multiScreen > 0) {
    add(
      "multi_screen",
      "Multi-écran détecté",
      80,
      `${multiScreen} détection(s) multi-écran`,
      "Confirmer avec le surveillant si un écran externe était autorisé."
    );
  }

  const vmScore = environment?.score || environment?.vmScore || 0;
  if (vmScore >= 60 || byType.vm_detectee > 0) {
    add(
      "virtualized_environment",
      "Environnement virtualisé probable",
      95,
      `Score environnement ${vmScore || "inconnu"}`,
      "Bloquer ou faire valider manuellement selon la politique d'examen."
    );
  }

  const heartbeatGaps = [];
  for (let i = 1; i < heartbeats.length; i++) {
    const previous = new Date(heartbeats[i - 1].timestamp || heartbeats[i - 1].received_at).getTime();
    const current = new Date(heartbeats[i].timestamp || heartbeats[i].received_at).getTime();
    if (current - previous > 45000) heartbeatGaps.push(current - previous);
  }
  if (heartbeatGaps.length > 0) {
    add(
      "heartbeat_gaps",
      "Trous de heartbeat",
      Math.min(75, 35 + heartbeatGaps.length * 10),
      `${heartbeatGaps.length} interruption(s) de plus de 45 secondes`,
      "Vérifier réseau, désactivation extension ou fermeture temporaire de session."
    );
  }

  const suspiciousTabs = screenshots
    .filter(shot => shot.tab_url || shot.tabUrl)
    .filter(shot => {
      const url = String(shot.tab_url || shot.tabUrl || "").toLowerCase();
      return /chatgpt|openai|claude|gemini|copilot|perplexity|mistral|poe\.com|you\.com|phind/.test(url);
    });
  if (suspiciousTabs.length > 0) {
    add(
      "suspicious_tabs_in_evidence",
      "Onglets suspects dans les preuves",
      95,
      `${suspiciousTabs.length} capture(s) d'onglet potentiellement IA`,
      "Inspecter les captures et l'horodatage relatif à l'infraction."
    );
  }

  const suspicionScore = Math.min(100, findings.reduce((score, finding) => score + finding.severity, 0));
  const verdict = suspicionScore >= 90 ? "critique" :
    suspicionScore >= 70 ? "élevé" :
    suspicionScore >= 40 ? "à vérifier" :
    "normal";

  return {
    verdict,
    suspicionScore,
    durationMinutes: Math.round(durationMinutes),
    findingCount: findings.length,
    findings: findings.sort((a, b) => b.severity - a.severity)
  };
}

module.exports = { analyzeBehavior };
