const INFRACTION_TYPES = new Set([
  "fullscreen_exit",
  "fullscreen_api_exit",
  "faux_fullscreen_exit",
  "window_blur",
  "tab_hidden",
  "changement_onglet",
  "extension_activee",
  "extensions_non_autorisees",
  "multi_ecran",
  "ecran_verrouille",
  "vm_detectee",
  "requete_bloquee",
  "requete_ia_bloquee",
  "clavier_detecte",
  "copier_coller_detecte"
]);

function isInfractionType(type) {
  return INFRACTION_TYPES.has(type) ||
    String(type || "").includes("bloquee") ||
    String(type || "").includes("detectee");
}

function getSeverity(type) {
  const scores = {
    vm_detectee: 100,
    ecran_verrouille: 95,
    extension_activee: 85,
    extensions_non_autorisees: 80,
    changement_onglet: 75,
    requete_ia_bloquee: 70,
    multi_ecran: 70,
    faux_fullscreen_exit: 60,
    fullscreen_api_exit: 50,
    fullscreen_exit: 45,
    tab_hidden: 35,
    window_blur: 25,
    requete_bloquee: 25,
    clavier_detecte: 50,
    copier_coller_detecte: 85,
    input_events: 5
  };
  return scores[type] || (isInfractionType(type) ? 40 : 5);
}

module.exports = { isInfractionType, getSeverity };
