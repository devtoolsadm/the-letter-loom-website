import { TEXTS, setTextVars } from "../i18n/texts.js";
import { APP_VERSION } from "../version.js";
import {
  GameController,
  PHASES,
  MODALITY,
  SCORE_TRACKING,
  SOUNDS,
} from "../gameController.js";
import { showModal, showPlayerCustomizationModal } from "./modals.js";

// =============================
// Letter Loom UI Main Module (Scaffolded)
// =============================
// ----------- Global Constants -----------
const MAX_PLAYERS = 10;
const PLAYER_COLORS = [
  // 15 pastel, únicos y bien diferenciados
  "#F67280", // Coral rosado
  // "#6C5B7B", // Lavanda oscuro
  // "#355C7D", // Azul profundo
  "#C06C84", // Malva
  "#F8B195", // Rosa claro
  "#99B898", // Verde menta
  "#FFE066", // Amarillo pastel
  "#247BA0", // Azul océano
  "#70C1B3", // Turquesa
  "#FFB347", // Naranja pastel
  "#B5EAD7", // Verde agua
  "#FFDAC1", // Melocotón claro
  "#B28DFF", // Lila pastel
  "#FF9AA2", // Rosa sandía
  "#C7CEEA", // Azul lavanda
];
// ----------- State & Config -----------
// Nombres por defecto ahora son fijos: J1, J2... o P1, P2...
let currentLanguage = loadSetting("lang", "es");
let isSoundOn = loadSetting("sound", false);
let players = [];
let gameController;

// ----------- Utility Functions -----------
function shuffle(arr) {
  let a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function loadSetting(key, fallback) {
  try {
    const val = localStorage.getItem("letterloom_" + key);
    if (val === null) return fallback;
    if (val === "true") return true;
    if (val === "false") return false;
    return val;
  } catch {
    return fallback;
  }
}
function saveSetting(key, value) {
  try {
    localStorage.setItem("letterloom_" + key, value);
  } catch {}
}
function loadConfigSetting(key, fallback) {
  const val = loadSetting("cfg_" + key, null);
  if (val === null || val === undefined) return fallback;
  if (
    key === "playerCount" ||
    key === "phase1Time" ||
    key === "phase2Time" ||
    key === "modalityValue"
  )
    return Number(val);
  return val;
}
function saveConfig(config) {
  for (const k in config) {
    saveSetting("cfg_" + k, config[k]);
  }
}

function loadLastPlayers() {
  let lastPlayers = [];
  const lastPlayersJSON = loadSetting("last_players", {});
  if (lastPlayersJSON) {
    try {
        const lastPlayersObj = JSON.parse(lastPlayersJSON);

        lastPlayers = lastPlayersObj.players || [];
        
        if (lastPlayersObj.lang && lastPlayersObj.lang !== currentLanguage) {
            const prevLang = lastPlayersObj.lang;
            const prevSuggestedPlayerNames =
                TEXTS[prevLang] && TEXTS[prevLang].suggestedPlayerNames
                ? TEXTS[prevLang].suggestedPlayerNames
                : [];
            const currentSuggestedPlayerNames =
                TEXTS[currentLanguage] && TEXTS[currentLanguage].suggestedPlayerNames
                ? TEXTS[currentLanguage].suggestedPlayerNames
                : [];

            // Crear un mapa de traducción entre suggestedPlayerNames
            const translationMap = {};
            for (let i = 0; i < prevSuggestedPlayerNames.length; i++) {
                translationMap[prevSuggestedPlayerNames[i]] = currentSuggestedPlayerNames[i];
            }

            for (let i = 0; i < lastPlayers.length; i++) {
                const player = lastPlayers[i];
                // Si el nombre actual es uno de los sugeridos en el idioma anterior, traducirlo
                if (player.name && translationMap[player.name]) {
                    player.name = translationMap[player.name];
                }
            }
        }
        return lastPlayers;        
    } catch {
      return lastPlayers;
    }
  }
  return lastPlayers;
}

function saveLastPlayers(players) {
  let lastPlayers = players || [];
  // Save only name and color, and ignore other properties
  lastPlayers = lastPlayers.map((p) => ({ name: p.name, color: p.color }));
  let lastPlayersObj = {
    lang: currentLanguage,
    players: lastPlayers
  };
  saveSetting("last_players", JSON.stringify(lastPlayersObj));
}

function loadNameHistory() {
  const namesJSON = loadSetting("name_history", []);
  try {
    return JSON.parse(namesJSON);
  } catch {
    return [];
  }
}
function saveNameHistory(arr) {
  arr = arr || [];
  // remove any name included in default names
  arr = arr.filter((name) => {
    return !TEXTS[currentLanguage].suggestedPlayerNames.includes(name);
  });
  // remove duplicates
  const uniqueNames = Array.from(new Set(arr || [])).slice(-15);
  saveSetting("name_history", JSON.stringify(uniqueNames));
}

// Nombres por defecto fijos: J1, J2... en español; P1, P2... en inglés
function getDefaultPlayerName(idx, lang) {
  return TEXTS[lang].playerPrefix + `${idx + 1}`;
}
function isDefaultName(name, idx, lang) {
  return name === getDefaultPlayerName(idx, lang);
}
// Utilidad: obtener el nombre visible de un jugador (añade sufijo visual si showSuffix)
function getDisplayName(player, bForceSuffix) {
  let baseName =
    player.name && player.name.trim() ? player.name.trim() : null;
  if (!baseName) {
    baseName = player.defaultName;
  } else if (player.showSuffix ||bForceSuffix) {
    return `${baseName} - ${player.defaultName}`;
  }
  return baseName;
}

function setSoundState(on) {
  isSoundOn = on;
  saveSetting("sound", isSoundOn);
  // Actualiza el icono
  const icon = `<span class="sound-icon-main"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
            <g>
                <rect x="3" y="10" width="7" height="8" rx="2" fill="currentColor" stroke="#bbb" stroke-width="1.5"/>
                <polygon points="10,10 18,5 18,23 10,18" fill="currentColor" stroke="#bbb" stroke-width="1.5"/>
                <path d="M20 9 Q23 14 20 19" stroke="currentColor" stroke-width="2.2" fill="none"/>
            </g>
        </svg></span>`;
  const overlay = isSoundOn
    ? ""
    : `<span class="sound-prohibited" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
                <circle cx="14" cy="14" r="12" stroke="currentColor" stroke-width="3" fill="none"/>
                <line x1="8" y1="8" x2="20" y2="20" stroke="currentColor" stroke-width="3"/>
            </svg>
        </span>`;
  const wrapperClass = isSoundOn
    ? "sound-icon-wrapper"
    : "sound-icon-wrapper sound-off";
  soundToggleBtn.innerHTML = `<span class="${wrapperClass}">${icon}${overlay}</span>`;
  // Actualiza el estado de Tone.Master.mute
  if (typeof window.Tone !== "undefined" && window.Tone.Master) {
    window.Tone.Master.mute = !isSoundOn;
  }
}

// ----------- Text Interpolation Helper -----------
function interpolate(str, vars = {}) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// ----------- DOM References -----------
const el = (id) => document.getElementById(id);
const playerCount = el("player-count");
const p1Time = el("p1-time");
const p2Time = el("p2-time");
const modality = el("modality");
const modalityValueLabel = el("modality-value-label");
const modalityValue = el("modality-value");
const scoreTrackingText = el("score-tracking-text");
const startGameBtn = el("start-game-btn");
const currentRoundLabel = el("current-round-label");
const currentRoundDealer = el("current-round-dealer");
const phaseLabel = el("phase-label");
const playerLabel = el("player-label");
const timerDisplay = el("timer-display");
const scoreboard = el("scoreboard");
const langToggleBtn = el("lang-toggle-btn");
const soundToggleBtn = el("sound-toggle-btn");
const modal = el("unified-modal");
const startTimerBtn = el("start-timer-btn");
const pauseTimerBtn = el("pause-timer-btn");
const toNextPhaseBtn = el('to-next-phase-btn');

// ----------- Game Controller Setup -----------
function setupGameController() {
  let playerCount = loadConfigSetting("playerCount", 4);
  players = normalizePlayers([], playerCount, true);
  const defaultConfig = {
    playerCount: playerCount,
    phase1Time: 1, // loadConfigSetting("phase1Time", 10),
    phase2Time: 2, // loadConfigSetting("phase2Time", 10),
    modality: loadConfigSetting("modality", MODALITY.ROUNDS),
    modalityValue: loadConfigSetting("modalityValue", 8),
    scoreTracking: loadConfigSetting("scoreTracking", SCORE_TRACKING.YES),
  };
  gameController = new GameController(defaultConfig, players);

  // --- Añadimos flag para distinguir si el timer ha sido iniciado en la fase actual ---
  gameController._timerHasStarted = false;
  let _lastPhase = null;

  gameController.onChange(() => {
    const state = gameController.getState();
    // Resetear flag al cambiar de fase
    if (_lastPhase !== state.phase) {
      gameController._timerHasStarted = false;
      _lastPhase = state.phase;
    }
    // Propagamos el flag al state para el render
    state.timerHasStarted = !!gameController._timerHasStarted;
    renderGameUI(state);
    // Render scoreboard if available
    if (typeof renderScoreboard === "function") {
      renderScoreboard();
    }
  });
}

function renderGameUI(state) {
  // Pantallas principales
  const setupScreen = document.getElementById("setup-screen");
  const gameScreen = document.getElementById("game-screen");
  const isGamePhase = (
    state.phase === PHASES.STRATEGY ||
    state.phase === PHASES.WORD_BUILDING ||
    state.phase === PHASES.SCORING ||
    state.phase === PHASES.TIE_BREAK ||
    state.phase === PHASES.PAUSED ||
    state.phase === PHASES.TIME_UP ||
    state.phase === PHASES.GAME_OVER
  );
  if (isGamePhase) {
    if (setupScreen) setupScreen.classList.add("hidden");
    if (gameScreen) gameScreen.classList.remove("hidden");
  } else {
    if (setupScreen) setupScreen.classList.remove("hidden");
    if (gameScreen) gameScreen.classList.add("hidden");
  }

  // Scoreboard
  if (scoreboard) {
    if (isGamePhase && state.config.scoreTracking === SCORE_TRACKING.YES) {
      scoreboard.classList.remove('hidden');
    } else {
      scoreboard.classList.add('hidden');
    }
  }

  // Ronda
  if (currentRoundLabel && typeof state.currentRound !== 'undefined' && state.currentRound !== null) {
    const roundTpl = TEXTS[currentLanguage]?.roundLabel;
    currentRoundLabel.textContent = interpolate(roundTpl, { n: state.currentRound });
  }



  // Dealer: show only the dealer, styled, in currentRoundDealer
  if (currentRoundDealer && typeof state.dealerIndex !== 'undefined' && state.dealerIndex !== null) {
    const dealerPlayer = state.players[state.dealerIndex];
    // Clear previous content
    currentRoundDealer.innerHTML = '';
    // Label and icon side by side above the row
    const labelRow = document.createElement('div');
    labelRow.className = 'dealer-label-row flex items-center justify-center gap-2 mb-1';
    // SVG icon (bigger, new)
    const icon = document.createElement('img');
    icon.src = 'assets/dealer-hand-card.svg';
    icon.alt = TEXTS[currentLanguage]?.dealerLabel || 'Reparte';
    icon.className = 'dealer-icon-large';
    icon.width = 64;
    icon.height = 64;
    labelRow.appendChild(icon);
    // Label
    const label = document.createElement('div');
    label.className = 'dealer-label';
    label.setAttribute('data-text-key', 'dealerLabel');
    label.textContent = TEXTS[currentLanguage]?.dealerLabel || 'Reparte';
    labelRow.appendChild(label);
    currentRoundDealer.appendChild(labelRow);
    // Row with player info only
    const row = document.createElement('div');
    row.className = 'player-row-main flex items-center gap-1 justify-center dealer-highlight';
    // Color preview
    const colorPreview = document.createElement('span');
    colorPreview.className = 'player-color-preview';
    colorPreview.style.background = dealerPlayer.color;
    row.appendChild(colorPreview);
    // Prefix (default name)
    const prefixHtml = document.createElement('span');
    prefixHtml.className = 'player-prefix-label';
    prefixHtml.textContent = dealerPlayer.defaultName;
    row.appendChild(prefixHtml);
    // Name (truncated if too long, all via class)
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name-main';
    nameSpan.textContent = getDisplayName(dealerPlayer);
    row.appendChild(nameSpan);
    currentRoundDealer.appendChild(row);
  }

  // Fase: traducir y mostrar el nombre de la fase
  if (phaseLabel) {
    let phaseKey = null;
    switch (state.phase) {
      case PHASES.STRATEGY:
        phaseKey = 'phaseStrategy'; break;
      case PHASES.WORD_BUILDING:
        phaseKey = 'phaseWordBuilding'; break;
      case PHASES.SCORING:
        phaseKey = 'phaseScoring'; break;
      case PHASES.TIE_BREAK:
        phaseKey = 'phaseTieBreak'; break;
      case PHASES.PAUSED:
        phaseKey = 'pause'; break;
      case PHASES.TIME_UP:
        phaseKey = 'timeUp'; break;
      case PHASES.GAME_OVER:
        phaseKey = 'phaseGameOver'; break;
      default:
        phaseKey = '';
    }
    if (phaseKey && TEXTS[currentLanguage][phaseKey]) {
      phaseLabel.setAttribute('data-text-key', phaseKey);
      phaseLabel.textContent = TEXTS[currentLanguage][phaseKey];
    } else {
      phaseLabel.removeAttribute('data-text-key');
      phaseLabel.textContent = '';
    }
  }

  // Render por fase
  switch (state.phase) {
    case PHASES.SETUP:
        updateSetupUI();
        break;
    case PHASES.STRATEGY:
      renderStrategyPhase(state);
      break;
    case PHASES.WORD_BUILDING:
      renderWordBuildingPhase(state);
      break;
    case PHASES.SCORING:
      renderScoringPhase(state);
      break;
    case PHASES.TIE_BREAK:
      renderTieBreakPhase(state);
      break;
    case PHASES.PAUSED:
      renderPausedPhase(state);
      break;
    case PHASES.TIME_UP:
      renderTimeUpPhase(state);
      break;
    case PHASES.GAME_OVER:
      renderGameOverPhase(state);
      break;
    default:
      renderDefaultPhase(state);
      break;
  }
}

// --- Renderizadores por fase ---

function renderPhaseWithTimer(state) {
  if (!timerDisplay) return;
  const phaseTime = state.config[state.phase === PHASES.STRATEGY ? 'phase1Time' : 'phase2Time'];
  const { running, timeLeft } = state.timer;

  // 1. Tiempo terminado (solo si el timer ya fue iniciado)
  if (!running && timeLeft === 0 && state.timerHasStarted) {
    timerDisplay.style.display = '';
    timerDisplay.textContent = TEXTS[currentLanguage]['timeUp'];
    if (startTimerBtn) startTimerBtn.style.display = 'none';
    if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
    let nextPhaseBtnKey = null;
    if (toNextPhaseBtn) {
      if (state.phase === PHASES.STRATEGY){
        nextPhaseBtnKey = 'phaseWordBuilding';
      } else if (state.phase === PHASES.WORD_BUILDING) {
        if (state.config.scoreTracking === SCORE_TRACKING.YES){
          nextPhaseBtnKey = 'phaseScoring';
        } else {
          nextPhaseBtnKey = 'nextRound';
        }
      }
      if (!nextPhaseBtnKey) {
        toNextPhaseBtn.classList.add('hidden');
      } else {
        toNextPhaseBtn.textContent = TEXTS[currentLanguage][nextPhaseBtnKey];
        toNextPhaseBtn.setAttribute('data-text-key', nextPhaseBtnKey);
        toNextPhaseBtn.classList.remove('hidden');
      }
    }
    timerDisplay.classList.add("time-up-flash");
    timerDisplay.classList.remove("timer-urgent", "timer-very-urgent");
    return;
  }

  // 2. Pausado
  if (!running && timeLeft > 0 && timeLeft < phaseTime) {
    timerDisplay.style.display = '';
    timerDisplay.textContent = getCurrentTimerValue(timeLeft);
    if (startTimerBtn) {
      startTimerBtn.style.display = '';
      startTimerBtn.classList.remove('hidden');
      startTimerBtn.setAttribute('data-text-key', 'resume');
      startTimerBtn.textContent = TEXTS[currentLanguage]['resume'] || 'Reanudar';
    }
    if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
    if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
    timerDisplay.classList.remove("timer-urgent", "timer-very-urgent", "time-up-flash");
    return;
  }

  // 3. Antes de iniciar
  if (!running && (timeLeft === phaseTime || (timeLeft === 0 && !state.timerHasStarted))) {
    timerDisplay.style.display = '';
    timerDisplay.textContent = getCurrentTimerValue(phaseTime);
    if (startTimerBtn) {
      startTimerBtn.style.display = '';
      startTimerBtn.classList.remove('hidden');
      startTimerBtn.setAttribute('data-text-key', 'go');
      startTimerBtn.textContent = TEXTS[currentLanguage]['go'];
    }
    if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
    if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
    timerDisplay.classList.remove("timer-urgent", "timer-very-urgent", "time-up-flash");
    return;
  }

  // 4. Corriendo
  if (running) {
    timerDisplay.style.display = '';
    timerDisplay.textContent = getCurrentTimerValue(timeLeft);
    if (startTimerBtn) {
      startTimerBtn.classList.add('hidden');
      startTimerBtn.style.display = '';
    }
    if (pauseTimerBtn) {
      pauseTimerBtn.classList.remove('hidden');
      pauseTimerBtn.style.display = '';
    }
    if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
    timerDisplay.classList.remove("time-up-flash");
    if (timeLeft <= 10 && timeLeft > 0) {
      timerDisplay.classList.add("timer-urgent");
      if (timeLeft <= 5) timerDisplay.classList.add("timer-very-urgent");
      else timerDisplay.classList.remove("timer-very-urgent");
    } else {
      timerDisplay.classList.remove("timer-urgent", "timer-very-urgent");
    }
    return;
  }
}

function renderStrategyPhase(state) {
  renderPhaseWithTimer(state);
}

function renderWordBuildingPhase(state) {
  renderPhaseWithTimer(state);
}

function renderScoringPhase(state) {
  // Aquí puedes personalizar la UI para la fase de puntuación
  if (timerDisplay) {
    timerDisplay.style.display = 'none';
  }
  if (startTimerBtn) startTimerBtn.style.display = 'none';
  if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
  if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
}

function renderTieBreakPhase(state) {
  // Personaliza según lógica de desempate
  if (timerDisplay) {
    timerDisplay.style.display = 'none';
  }
  if (startTimerBtn) startTimerBtn.style.display = 'none';
  if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
  if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
}

function renderPausedPhase(state) {
  // Puedes mostrar un overlay o mensaje de pausa
  if (timerDisplay) {
    timerDisplay.style.display = '';
    timerDisplay.textContent = TEXTS[currentLanguage]['paused'] || 'Pausado';
  }
  if (startTimerBtn) startTimerBtn.style.display = 'none';
  if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
  if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
}

function renderTimeUpPhase(state) {
  // Puedes mostrar mensaje de tiempo agotado
  if (timerDisplay) {
    timerDisplay.style.display = '';
    timerDisplay.textContent = TEXTS[currentLanguage]['timeUp'];
    timerDisplay.classList.add("time-up-flash");
  }
  if (startTimerBtn) startTimerBtn.style.display = 'none';
  if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
  if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
}

function renderGameOverPhase(state) {
  // Puedes mostrar mensaje de fin de juego
  if (timerDisplay) {
    timerDisplay.style.display = 'none';
  }
  if (startTimerBtn) startTimerBtn.style.display = 'none';
  if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
  if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
}

function renderDefaultPhase(state) {
  // Fallback para fases no contempladas
  if (timerDisplay) timerDisplay.style.display = 'none';
  if (startTimerBtn) startTimerBtn.style.display = 'none';
  if (pauseTimerBtn) pauseTimerBtn.style.display = 'none';
  if (toNextPhaseBtn) toNextPhaseBtn.classList.add('hidden');
}

// ----------- UI Render Functions -----------
function updateLangToggleBtn(currentLanguage) {
  if (!langToggleBtn) return;
  const altLang = currentLanguage === "es" ? "EN" : "ES";
  const currLang = currentLanguage.toUpperCase();
  langToggleBtn.innerHTML = `<span class="lng-current">${currLang}</span> <span class="lng-secondary">${altLang}</span>`;
}
function updateSetupUI() {
  const state = gameController.getState();
  playerCount.textContent = state.config.playerCount;
  p1Time.textContent = `${state.config.phase1Time}s`;
  p2Time.textContent = `${state.config.phase2Time}s`;
  const modalityKey =
    state.config.modality === MODALITY.ROUNDS ? "rounds" : "points";
  modality.textContent = TEXTS[currentLanguage][modalityKey];
  modalityValueLabel.textContent = TEXTS[currentLanguage][modalityKey];
  modalityValue.textContent = state.config.modalityValue;
  scoreTrackingText.textContent =
    TEXTS[currentLanguage][
      state.config.scoreTracking === SCORE_TRACKING.YES ? "yes" : "no"
    ];
}
function updateUIText() {
  document.querySelectorAll("[data-text-key]").forEach((el) => {
    const key = el.getAttribute("data-text-key");
    let text = TEXTS[currentLanguage][key];
    if (text) {
      if (el.getAttribute('data-text-var') === 'true') {
        // Recoge todos los data-text-var-*
        const vars = {};
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-text-var-')) {
            const varName = attr.name.slice('data-text-var-'.length);
            vars[varName] = attr.value;
          }
        }
        el.textContent = interpolate(text, vars);
      } else {
        el.textContent = text;
      }
    }
  });
  // Actualizar phase-label manualmente si no tiene data-text-key (por ejemplo, si la fase es desconocida)
  if (phaseLabel && !phaseLabel.getAttribute('data-text-key')) {
    phaseLabel.textContent = '';
  }
  gameController.emitChange();
}

// ----------- Timer Logic -----------
// (Timer UI y lógica global se implementarán en el siguiente paso)

// --- Timer UI: solo refleja el estado del controlador ---
// Sonidos de temporizador por síntesis: normal, urgencia y final
function playTimerSound(type = "normal") {
  if (!isSoundOn) return;
  try {
    if (type === "final") {
      // Gong sintético: tono grave, decaimiento largo, armónicos
      const ctx = window.AudioContext ? new window.AudioContext() : (window.webkitAudioContext ? new window.webkitAudioContext() : null);
      if (!ctx) return;
      const baseFreq = 220;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const o2 = ctx.createOscillator(); // armónico
      const g2 = ctx.createGain();
      o.type = "sine";
      o.frequency.value = baseFreq;
      o2.type = "triangle";
      o2.frequency.value = baseFreq * 2.7;
      g.gain.value = 0.22;
      g2.gain.value = 0.09;
      o.connect(g).connect(ctx.destination);
      o2.connect(g2).connect(ctx.destination);
      o.start();
      o2.start();
      // Decaimiento
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
      // Ligeros cambios de frecuencia para efecto metálico
      o.frequency.linearRampToValueAtTime(baseFreq * 0.7, ctx.currentTime + 1.2);
      o2.frequency.linearRampToValueAtTime(baseFreq * 2.2, ctx.currentTime + 1.1);
      o.stop(ctx.currentTime + 1.25);
      o2.stop(ctx.currentTime + 1.15);
      setTimeout(() => ctx.close(), 1400);
      return;
    }
    // Normal y urgente: beep único
    const ctx = window.AudioContext ? new window.AudioContext() : (window.webkitAudioContext ? new window.webkitAudioContext() : null);
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    if (type === "normal") {
      o.frequency.value = 700;
      g.gain.value = 0.07;
    } else if (type === "urgent") {
      o.frequency.value = 1200;
      g.gain.value = 0.13;
    }
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (type === "urgent" ? 0.11 : 0.09));
    setTimeout(() => ctx.close(), type === "urgent" ? 160 : 120);
  } catch {}
}
function getCurrentTimerValue(s) {
  s = Math.max(0, s);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ----------- UI Logic Helpers -----------
const scoreTrackingOptions = [SCORE_TRACKING.NONE, SCORE_TRACKING.YES];
function toggleModality() {
  gameController.config.modality =
    gameController.config.modality === MODALITY.ROUNDS
      ? MODALITY.POINTS
      : MODALITY.ROUNDS;
  if (gameController.config.modality === MODALITY.ROUNDS) { 
    gameController.config.modalityValue = gameController.config.playerCount < 5  ? gameController.config.playerCount * 2 : gameController.config.playerCount;
  } else {
    gameController.config.modalityValue = 100;
  }
  gameController.emitChange();
}
function toggleScoreTracking(direction) {
  let currentIndex = scoreTrackingOptions.indexOf(
    gameController.config.scoreTracking
  );
  currentIndex += direction;
  if (currentIndex < 0) currentIndex = scoreTrackingOptions.length - 1;
  if (currentIndex >= scoreTrackingOptions.length) currentIndex = 0;
  gameController.config.scoreTracking = scoreTrackingOptions[currentIndex];
  gameController.emitChange();
}

function normalizePlayers(arrPlayers, playerCount, bLoadLastPlayers) {
  const players = Array.isArray(arrPlayers) ? [...arrPlayers] : [];
  playerCount = playerCount || 2;
  // Agregar jugadores vacíos si faltan
  while (players.length < playerCount) {
    let idx = players.length;
    players.push({
      defaultName: getDefaultPlayerName(idx, currentLanguage),
      name: "",
      showSuffix: false,
      color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
      score: 0,
    });
  }
  while (players.length > playerCount) {
    players.pop();
  }  
  // Normalizar propiedades
  const lastPlayers = bLoadLastPlayers ? loadLastPlayers() : [];
  const usedNames = new Set();
  const duplicatedNames = new Set();
  const usedColors = new Set();
  for (let i = 0; i < players.length; i++) {
    const last = lastPlayers[i] || {};

    let lastColor =
      last.color && typeof last.color === "string" ? last.color : null;
    let color =
      lastColor && typeof lastColor === "string" ? lastColor : players[i].color;
    if (!color || usedColors.has(color) || !PLAYER_COLORS.includes(color)) {
      // Buscar el primer color libre
      color = PLAYER_COLORS.find((c) => !usedColors.has(c));
    }
    usedColors.add(color);
    players[i].color = color;

    let lastName =
      last.name && typeof last.name === "string" ? last.name : null;
    let name =
      lastName && typeof lastName === "string"
        ? lastName
        : players[i].name || "";
    name = name?.trim() || "";

    players[i].defaultName = getDefaultPlayerName(i, currentLanguage);

    players[i].showSuffix = false;
    const visibleName = name || players[i].defaultName;
    if (visibleName) {
        if (usedNames.has(visibleName)) {
            duplicatedNames.add(visibleName);
        }
        usedNames.add(visibleName);
    }
    players[i].name = name;


    players[i].score = 0;
  }
  // iterate the players to mark the used names with showSuffix = true if their name is in usedNames
  for (let i = 0; i < players.length; i++) {
    const visibleName = players[i].name || players[i].defaultName;
    players[i].showSuffix = !!(visibleName && duplicatedNames.has(visibleName));
  }
  return players;
}



// --- DEBUG BUTTON (solo visible en modo depuración) ---
const DEBUG_MODE = window.location.hash.includes("debug") || window.DEBUG_MODE;
if (DEBUG_MODE) {
  const debugBtn = document.createElement("button");
  debugBtn.textContent = "⚙️ Debug";
  debugBtn.id = "debug-btn";
  debugBtn.className = "debug-btn";
  document.body.appendChild(debugBtn);
  debugBtn.onclick = () => {
    showModal({
      title: "Herramientas de depuración",
      content: "Opciones rápidas para depuración:",
      buttons: [
        {
          id: "clear-storage",
          label: "Borrar datos almacenados",
          className: "btn-red w-full control-btn",
        },
        {
          id: "reload",
          label: "Recargar página",
          className: "btn-blue w-full control-btn",
        },
        {
          id: "reset-game",
          label: "Resetear juego",
          className: "btn-orange w-full control-btn",
        },
        {
          id: "cancel",
          label: "Cerrar",
          className: "btn-gray w-full control-btn",
        },
      ],
      closeOnEscape: true,
      buttonsContainerClass: "flex-col !gap-2 !items-stretch sm:!flex-col",
      onAction: (id) => {
        if (id === "clear-storage") {
          localStorage.clear();
          showModal({
            title: "Datos borrados",
            content: "Todos los datos almacenados han sido eliminados.",
            buttons: [
              { label: "OK", className: "btn-green w-full control-btn" },
            ],
            onAction: () => {
              window.location.reload();
            },
          });
        } else if (id === "reload") {
          window.location.reload();
        } else if (id === "reset-game") {
            setupGameController();
        }
      },
    });
  };
}

// ----------- Event Handlers -----------
function setupEventHandlers() {
  // Player count
  playerCount &&
    el("player-minus") &&
    (el("player-minus").onclick = () => {
      const state = gameController.getState();
      if (state.config.playerCount > 2) {
        gameController.config.playerCount--;
        gameController.emitChange();
      }
    });
  playerCount &&
    el("player-plus") &&
    (el("player-plus").onclick = () => {
      const state = gameController.getState();
      if (state.config.playerCount < 10) {
        gameController.config.playerCount++;
        gameController.emitChange();
      }
    });
  // Phase 1 time
  p1Time &&
    el("p1-time-minus") &&
    (el("p1-time-minus").onclick = () => {
      if (gameController.config.phase1Time > 5) {
        gameController.config.phase1Time -= 5;
        gameController.emitChange();
      }
    });
  p1Time &&
    el("p1-time-plus") &&
    (el("p1-time-plus").onclick = () => {
      gameController.config.phase1Time += 5;
      gameController.emitChange();
    });
  // Phase 2 time
  p2Time &&
    el("p2-time-minus") &&
    (el("p2-time-minus").onclick = () => {
      if (gameController.config.phase2Time > 5) {
        gameController.config.phase2Time -= 5;
        gameController.emitChange();
      }
    });
  p2Time &&
    el("p2-time-plus") &&
    (el("p2-time-plus").onclick = () => {
      gameController.config.phase2Time += 5;
      gameController.emitChange();
    });
  // Modality
  modality &&
    el("modality-minus") &&
    (el("modality-minus").onclick = toggleModality);
  modality &&
    el("modality-plus") &&
    (el("modality-plus").onclick = toggleModality);
  modalityValue &&
    el("modality-value-minus") &&
    (el("modality-value-minus").onclick = () => {
      if (
        gameController.config.modality === MODALITY.ROUNDS &&
        gameController.config.modalityValue > 1
      ) {
        gameController.config.modalityValue--;
      } else if (
        gameController.config.modality === MODALITY.POINTS &&
        gameController.config.modalityValue > 10
      ) {
        gameController.config.modalityValue -= 10;
      }
      gameController.emitChange();
    });
  modalityValue &&
    el("modality-value-plus") &&
    (el("modality-value-plus").onclick = () => {
      if (gameController.config.modality === MODALITY.ROUNDS) {
        gameController.config.modalityValue++;
      } else if (gameController.config.modality === MODALITY.POINTS) {
        gameController.config.modalityValue += 10;
      }
      gameController.emitChange();
    });
  // Score tracking
  scoreTrackingText &&
    el("score-tracking-minus") &&
    (el("score-tracking-minus").onclick = () => toggleScoreTracking(-1));
  scoreTrackingText &&
    el("score-tracking-plus") &&
    (el("score-tracking-plus").onclick = () => toggleScoreTracking(1));
  // Language toggle
  langToggleBtn &&
    langToggleBtn.addEventListener("click", () => {
      const newLang = currentLanguage === "en" ? "es" : "en";
      currentLanguage = newLang;
      saveSetting("lang", currentLanguage);
      updateLangToggleBtn(currentLanguage);
      // Si hay ronda actual, pásala como placeholder
      const state = gameController.getState();
      if (currentRoundLabel && typeof state.currentRound !== 'undefined' && state.currentRound !== null) {
        setTextVars(currentRoundLabel, { n: state.currentRound });
      }
      updateUIText();
      // updateSetupUI();
    });
  // Sound toggle
  soundToggleBtn &&
    soundToggleBtn.addEventListener("click", () => {
      setSoundState(!isSoundOn);
    });
  // Start game button
  startGameBtn &&
    (startGameBtn.onclick = (e) => {
      e.preventDefault();
      const state = gameController.getState();
      gameController.players = normalizePlayers(gameController.players, state.config.playerCount, true);

      const startGame = () => {
        // Guardar settings
        saveConfig(gameController.config);
        saveLastPlayers(gameController.players);
        // Mantener el historial anterior y añadir los nuevos personalizados
        const prevHistory = loadNameHistory();
        const newNames = gameController.players
          .map((p) => p.name && p.name.trim())
          .filter((n) => n && n.length > 0);
        saveNameHistory([...newNames, ...prevHistory]);
        // Iniciar el juego
        if (gameController && gameController.setPhase) {
          gameController.setPhase(PHASES.STRATEGY);
          // NO iniciar el timer aquí, solo cambiar de fase
        } else {
          gameController.emitChange();
        }
      };

      if (state.config.scoreTracking === SCORE_TRACKING.YES) {
        showPlayerCustomizationModal({
          gameController,
          TEXTS,
          currentLanguage,
          getDefaultPlayerName,
          getDisplayName,
          loadNameHistory,
          saveNameHistory,
          PLAYER_COLORS,
          MAX_PLAYERS,
          onSave: (updatedPlayers) => {
            // Actualiza jugadores y config
            gameController.players = normalizePlayers(updatedPlayers, state.config.playerCount, false);
            startGame();
          },
          onCancel: () => {
            // Lógica opcional al cancelar
          },
        });
      } else {
        startGame();
      }
    });

  // Start timer button (en game screen)
  if (startTimerBtn) {
      startTimerBtn.onclick = () => {
        const state = gameController.getState();
        if (!state.timer.running && (state.phase === PHASES.STRATEGY || state.phase === PHASES.WORD_BUILDING)) {
          const phaseTime = state.phase === PHASES.STRATEGY ? state.config.phase1Time : state.config.phase2Time;
          // Permitir iniciar si el tiempo es igual al inicial o si hay tiempo restante
          if (state.timer.timeLeft > 0 && state.timer.timeLeft < phaseTime) {
            gameController._timerHasStarted = true;
            gameController.resumeTimer();
          } else {
            gameController._timerHasStarted = true;
            if (state.phase === PHASES.STRATEGY) {
              gameController.startTimer(gameController.config.phase1Time);
            } else if (state.phase === PHASES.WORD_BUILDING) {
              gameController.startTimer(gameController.config.phase2Time);
            }
          }
        }
      };
  }
  // Pause timer button
  if (pauseTimerBtn) {
    pauseTimerBtn.onclick = () => {
      const state = gameController.getState();
      if (state.timer.running) {
        gameController.pauseTimer();
      }
    };
  }
  if (toNextPhaseBtn) {
    toNextPhaseBtn.addEventListener('click', () => {
      const state = gameController.getState();
      toNextPhaseBtn.classList.add('hidden');
      if (state.phase === PHASES.STRATEGY && state.timer.timeLeft === 0) {
        gameController._timerHasStarted = false;
        gameController.setPhase(PHASES.WORD_BUILDING);
        // Iniciar automáticamente el timer de la fase de word building
        setTimeout(() => {
          gameController._timerHasStarted = true;
          gameController.startTimer(gameController.config.phase2Time);
        }, 0);
      } else if (state.phase === PHASES.WORD_BUILDING && state.timer.timeLeft === 0) {
        gameController._timerHasStarted = false;
        if (state.config.scoreTracking === SCORE_TRACKING.YES){
          gameController.setPhase(PHASES.SCORING);
        } else {
          // Pasar a la siguiente ronda o finalizar el juego
          const isGameOver = gameController.isGameOver();
          if (isGameOver) {
            gameController.setPhase(PHASES.GAME_OVER);
          } else {
            gameController.startNextRound();
          }
        }        
      }
    });
  }

}

// ----------- Main Initialization -----------
function initUI(...args) {
  setupGameController();
  setupEventHandlers();
  updateLangToggleBtn(currentLanguage);
  updateUIText();
  setSoundState(isSoundOn);
  showAppVersion();
  // ...cualquier otra lógica de inicio...
}


// Mostrar versión en la UI
function showAppVersion() {
  const versionDiv = document.getElementById("app-version");
  if (versionDiv) {
    const isPreview = /preview/i.test(window.location.hostname) || /preview/i.test(window.location.href);
    versionDiv.textContent = `${APP_VERSION}`;
    if (isPreview || true) {
      versionDiv.textContent += "  [PREVIEW]";
      versionDiv.classList.add("preview-version-highlight");
    } else {
      versionDiv.classList.remove("preview-version-highlight");
    }
  }
}

export { initUI };
