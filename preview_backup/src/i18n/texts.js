// Multi-language texts for Letter Loom
export const TEXTS = {
  es: {
    appTitle: "Letter Loom",
    playerCount: "Jugadores",
    phase1Time: "Fase Estrategia",
    phase2Time: "Fase Creación",
    modality: "Modalidad",
    rounds: "Rondas",
    points: "Puntos",
    scoreTracking: "Anotar Puntos",
    yes: "Sí",
    no: "No",
    playerCustomization: "Nombres de jugadores",
    customize: "Personalizar",
    startGame: "Comenzar juego",
    roundLabel: "Ronda {n}",
    phaseStrategy: "Estrategia",
    phaseWordBuilding: "Crear Palabras",
    phaseScoring: "Anotar puntuación",
    phaseTieBreak: "Ronda de desempate",
    phaseGameOver: "Fin de partida",
    scoreAdjust: "Ajustar puntos",
    save: "Guardar",
    cancel: "Cancelar",
    resetStrategy: "Reiniciar estrategia",
    nextRound: "Siguiente ronda",
    resetFullGame: "Reiniciar juego",
    resetGameConfirm: "¿Seguro que quieres reiniciar el juego?",
    goToPlayerConfirm: "¿Ir al turno de {playerName}?",
    confirm: "Confirmar",
    close: "Cerrar",
    settings: "Ajustes",
    adjustments: "Ajustes",
    ok: "Aceptar",
    go: "¡Jugar!",
    playerPrefix: "J",
    suggestedPlayerNames: [
      "Chispa", "Rayo", "Galleta", "Nube", "Tornado", "Luna", "Pixel", "Bambú", "Cactus", "Menta",
      "Tiza", "Sol", "Búho", "Mimo", "Kiwi", "Bingo", "Bicho", "Coral", "Oliva", "Fresa"
    ],
    duplicateNamesTitle: "Nombres repetidos",
    duplicateNamesWarning: "Hay nombres repetidos. Si continuas, añadiré la posición para que puedas diferenciarlos.",
    nameHistoryTitle: "Histórico de nombres",
    nameHistoryInfo: "Selecciona un nombre de la lista para usarlo.",
    delete: "Borrar",
    pause: "Pausa",
    resume: "Reanudar",
    dragHandle: "Arrastrar para reordenar",
    confirmDeleteName: "¿Eliminar este nombre del histórico?",
    timeUp: "¡Tiempo!",
    dealerLabel: "Reparte"
  },
  en: {
    appTitle: "Letter Loom",
    playerCount: "Players",
    phase1Time: "Strategy Phase",
    phase2Time: "Creation Phase",
    modality: "Modality",
    rounds: "Rounds",
    points: "Points",
    scoreTracking: "Score Tracking",
    yes: "Yes",
    no: "No",
    playerCustomization: "Player Names",
    customize: "Customize",
    startGame: "Start Game",
    roundLabel: "Round {n}",
    phaseStrategy: "Strategy",
    phaseWordBuilding: "Word Building",
    phaseScoring: "Scoring",
    phaseTieBreak: "Tie-break Round",
    phaseGameOver: "Game Over",
    scoreAdjust: "Adjust points",
    save: "Save",
    cancel: "Cancel",
    resetStrategy: "Reset strategy",
    nextRound: "Next round",
    resetFullGame: "Reset game",
    resetGameConfirm: "Are you sure you want to reset the game?",
    goToPlayerConfirm: "Go to {playerName}'s turn?",
    confirm: "Confirm",
    close: "Close",
    settings: "Settings",
    adjustments: "Adjustments",
    ok: "OK",
    go: "Go!",
    playerPrefix: "P",
    suggestedPlayerNames: [
      "Spark", "Ray", "Cookie", "Cloud", "Twister", "Moon", "Pixel", "Bamboo", "Cactus", "Mint",
      "Chalk", "Sun", "Owl", "Mime", "Kiwi", "Bingo", "Bug", "Coral", "Olive", "Strawberry"
    ],
    duplicateNamesTitle: "Duplicate Names",
    duplicateNamesWarning: "There are duplicate names. If you proceed, I will add the position to differentiate them.",
    nameHistoryTitle: "Name History",
    nameHistoryInfo: "Select a name from the list to use it.",
    delete: "Delete",
    pause: "Pause",
    resume: "Resume",

    dragHandle: "Drag to reorder",
    confirmDeleteName: "Delete this name from history?",
    timeUp: "Time!",
    dealerLabel: "Dealer"
  }
};


// Devuelve el array de idiomas disponibles en TEXTS
export function getAvailableLanguages() {
  return Object.keys(TEXTS);
}

// Utilidad para interpolar variables en los textos, ej: interpolate(TEXTS[lang].goToPlayerConfirm, {playerName: 'Juan'})
export function interpolate(str, vars) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function setTextVars(el, vars = {}) {
  if (!el) return;
  el.setAttribute('data-text-var', 'true');
  for (const k in vars) {
    el.setAttribute('data-text-var-' + k, vars[k]);
  }
}

export function clearTextVars(el) {
  if (!el) return;
  if (el.hasAttribute('data-text-var')) {
    el.removeAttribute('data-text-var');
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('data-text-var-')) {
        el.removeAttribute(attr.name);
      }
    });
  }
}