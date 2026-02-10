import { loadState, updateState } from "../core/stateStore.js";

export const BULLET_CHAR = "\u25CF";

export const TEXTS = {
  es: {
    languageName: "Español",
    appTitle: "The Letter Loom",
    appShortName: "Letter Loom",
    appDescription: "El juego de cartas mas divertido de todos los tiempos!",
    splashTitle: "Empezar partida",
    splashSubtitle: "Controla los cronos y la puntuación del juego de cartas.",
    splashContinue: "Jugar",
    splashResume: "Reanudar partida guardada",
    splashHelp: "Ver instrucciones",
    splashLoadingLabel: "Cargando...",
    helpTitle: "Ayuda",
    helpQuickGuide: "Guía rápida",
    helpVideo: "Vídeo explicativo",
    helpManual: "Manual de instrucciones",
    quickGuideTitle: "Guía rápida",
    quickGuideIndexTitle: "Índice",
    quickGuideIndexIntro: "Elige una sección y salta directo.",
    quickGuideIndexButton: "Índice",
    quickGuideManualNote: "¿Quieres el manual completo? Lo tienes en PDF.",
    quickGuideManualBtn: "Manual completo",
    quickGuideManualLink: "Abrir PDF",
    quickGuideSections: [
      {
        id: "intro",
        title: "Arranque rápido",
        body: [
          "Configura la partida (bazas o puntos) y listo.",
          "La app lleva cronos, orden y marcador."
        ],
        bullets: [
          "De 2 a 8 jugadores.",
          "Duración típica: 20-40 minutos."
        ]
      },
      {
        id: "strategy",
        title: "Fase de estrategia",
        body: [
          "Aquí se preparan las jugadas."
        ],
        bullets: [
          "Coloca el Tablero Central con 5 letras boca arriba.",
          "Reparte 3 letras + 3 cartas de estrategia a cada jugador.",
          "Activa el cronómetro de estrategia.",
          "Cada jugador juega una carta de estrategia para cambiar letras, puntos o tablero."
        ]
      },
      {
        id: "creation",
        title: "Fase de creación",
        body: [
          "Ahora toca formar palabra."
        ],
        bullets: [
          "Activa el cronómetro de creación.",
          "Forma tu palabra con letras del Tablero Central y tus letras.",
          "Suma los valores, aplica color y efectos de estrategia.",
          "Muestra la palabra y tu puntuación."
        ]
      },
      {
        id: "scoring",
        title: "Puntuación y siguiente ronda",
        body: [
          "Se anotan los puntos y se pasa el reparto."
        ],
        bullets: [
          "Anota las puntuaciones en la app.",
          "El reparto pasa al jugador de la derecha.",
          "Repite hasta llegar a la meta de bazas o puntos."
        ]
      },
      {
        id: "strategy-cards",
        title: "Cartas de estrategia",
        body: [
          "Sirven para cambiar letras o puntuación."
        ],
        bullets: [
          "Intercambia cartas con otros jugadores.",
          "Roba o devuelve cartas al tablero.",
          "Multiplica, suma o resta puntos.",
          "Cambia el Tablero Central."
        ]
      },
      {
        id: "valid-words",
        title: "Palabras válidas",
        body: [
          "Acordadlo al empezar, o usad el validador."
        ],
        bullets: [
          "Valen palabras del diccionario y nombres propios comunes.",
          "No valen abreviaturas ni faltas de ortografía.",
          "Extranjerismos solo si los aceptáis."
        ]
      },
      {
        id: "records",
        title: "Récords",
        body: [
          "Si una puntuación entra en récord, la app te avisa."
        ],
        bullets: [
          "Si usas extras (x2, comodín, + o - puntos), márcalos.",
          "La media de partida se calcula al finalizar."
        ]
      },
      {
        id: "faq",
        title: "Preguntas frecuentes",
        faq: [
          {
            q: "¿Puedo repetir una palabra?",
            a: "Se puede, pero suele restar puntos. Acordad la regla antes de jugar."
          },
          {
            q: "¿Qué pasa si no puedo formar palabra?",
            a: "Puedes pasar y anotar 0, o la penalización que acordéis."
          },
          {
            q: "¿Debo usar letras del Tablero Central?",
            a: "Sí, al menos una, si jugáis con esa regla."
          },
          {
            q: "¿Cuándo se usan las cartas de estrategia?",
            a: "Solo en la fase de estrategia, antes de crear palabra."
          },
          {
            q: "¿Los nombres propios valen?",
            a: "Solo los comunes o los que acordéis."
          },
          {
            q: "¿Cómo funciona el x2?",
            a: "Si todas las letras son del mismo color, se multiplica la puntuación por 2."
          }
        ]
      }
    ],
    helpInstagram: "Instagram",
    helpTiktok: "TikTok",
    helpEmail: "Contacto",
    helpWeb: "Web",
    helpInstagramShort: "IG",
    helpTiktokShort: "TT",
    helpEmailShort: "@",
    helpWebShort: "WWW",
    matchScoreboardEditHint: "Puedes editar cualquier puntuación con un toque.",
    scoreboardRecordDate: "Partida del {date}",
    matchScoreboardEdit: "Editar",
    helpFooter: "© {year} The Letter Loom\nVersión {version}",
    setupTitle: "Configurar partida",
    setupSubtitle: "Ajusta jugadores, tiempos y modo de juego.",
    playersTitle: "Jugadores",
    playerLabel: "Jugador",
    addPlayer: "Anadir jugador",
    timersTitle: "Cronómetros",
    strategyTimerLabel: "Estrategia (segundos)",
    creationTimerLabel: "Creación (segundos)",
    startGame: "Comenzar partida",
    liveTitle: "Partida en curso",
    phaseTitle: "Fases y cronos",
    strategyPhaseLabel: "Fase de estrategia",
    creationPhaseLabel: "Fase de creación",
    startStrategy: "Iniciar estrategia",
    startCreation: "Iniciar creación",
    goToScoring: "Ir a puntuación",
    scoringTitle: "Puntuación de la baza",
    scoringNote: "Introduce la palabra y los puntos de cada jugador.",
    saveBaza: "Guardar baza",
    editHistory: "Editar historial",
    historyTitle: "Histórico y correcciones",
    backToLive: "Volver a partida",
    soundOn: "Sonido activado",
    soundOff: "Sonido silenciado",
    apply: "Aceptar",
    cancel: "Cancelar",
    save: "Guardar",
    ok: "OK",
    unexpectedErrortitle: "Error inesperado",
    unexpectedErrorBody: "Ha ocurrido un error inesperado",
    settingsTitle: "Ajustes",
    settingsSound: "Sonido",
    settingsMusic: "Música",
    settingsLanguage: "Idioma",
    footer: "© {year} The Letter Loom",
    installPromptTitle: "Instalar Letter Loom",
    installPromptDescription: "Instala el juego para acceder mas rápido y jugar a pantalla completa incluso sin conexión.",
    installButtonText: "Instalar",
    installCancelText: "Ahora no",
    prototypeEnableWakeLock: "Mantener pantalla activa",
    prototypeDisableWakeLock: "Permitir bloqueo automático",
    wakeLockStatusActiveStandard: "Pantalla activa (API estándar).",
    wakeLockStatusReleased: "Pantalla puede bloquearse (liberado por el sistema).",
    wakeLockStatusActiveFallback: "Pantalla activa (vídeo de respaldo).",
    wakeLockStatusFallbackFailed: "No se pudo mantener la pantalla activa (vídeo).",
    wakeLockStatusInactive: "Pantalla puede bloquearse.",
    orientationMessage: "Pon tu dispositivo en VERTICAL para jugar",
    prototypeVideoFallback: "Tu navegador no soporta el elemento de vídeo.",
    supportTitle: "Apóyanos",
    supportBody: "Ayúdanos a lanzar The Letter Loom. Tu apoyo nos permite producir la baraja y mejorar el juego.",
    supportCta: "Quiero el juego",    
    confirmTitle: "Confirmar",
    confirmTitleDeleteRecord: "Borrar récord",
    confirmBodyExit: "¿Seguro que quieres salir a la pantalla inicial?",
    confirmBodyDeleteRecord: "¿Borrar este récord?",
    confirmTitlePhaseChange: "Cambiar fase",
    confirmBodyPhaseChange: "¿Seguro que quieres cambiar de fase?",
    confirmTitleFinish: "Finalizar cronómetro",
    confirmBodyFinish: "¿Seguro que quieres terminar esta fase?",
    debugLogTitle: "Registro de depuración",
    debugLogFilterLabel: "Filtro",
    debugLogFilterDebug: "Debug",
    debugLogFilterInfo: "Info",
    debugLogFilterWarn: "Avisos",
    debugLogFilterError: "Errores",
    debugLogEmpty: "Sin entradas",
    confirmTitleResumeStale: "Reanudar partida",
    confirmBodyResumeStale:
      "Se encontró una partida a medias del {date} con {players}. ¿Quieres reanudarla?",
    confirmAccept: "Aceptar",
    confirmDelete: "Borrar",
    confirmCancel: "Cancelar",
    matchTitle: "Partida",
    matchConfigTitle: "Nueva partida",
    matchStrategyLabel: "Fase estrategia",
    matchCreationLabel: "Fase creación",
    matchPhaseStrategy: "Estrategia",
    matchPhaseCreation: "Creación",
    matchPlayersLabel: "Jugadores / Orden",
    matchPlayersCaption:
      "Indica cuántos sois y vuestra posición en la mesa para repartir",
    matchModeLabel: "Modalidad",
    matchModeRounds: "Bazas",
    matchModePoints: "Puntos",
    matchDealerLabel: "Reparte",
    matchScoreboardTitle: "Marcador",
    matchScoreboardGoalRounds: "Objetivo: {rounds} bazas",
    matchScoreboardGoalPoints: "Objetivo: {points} puntos",
    recordsTitle: "Records",
    recordsOpen: "Records",
    recordsTabWords: "Palabras",
    recordsTabMatches: "Partidas",
    recordsWordPill: "Las mejores palabras del telar",
    recordsMatchPill: "Las mejores puntuaciones medias de un jugador durante una partida. Se favorecen las partidas con más rondas.",
    recordsFeatureSameColor: "Mismo color",
    recordsFeatureWildcard: "Con comodín",
    recordsFeatureDouble: "x2",
    recordsFeaturePlus: "+ puntos",
    recordsFeatureMinus: "- puntos",
    recordWordTitle: "Record de palabra",
    recordWordIntro: "¡Ojo! Esta puntuación entra en los récords",
    recordWordCaption: "Palabra",
    recordWordCaptionValidationRequired: "Valida la palabra para guardar el récord",
    recordWordPlaceholder: "Escribe la palabra...",
    recordWordClear: "Borrar palabra",
    recordWordSameColor: "Mismo color",
    recordWordWildcard: "Con comodín",
    recordWordDouble: "x2",
    recordWordPlus: "+ puntos",
    recordWordMinus: "- puntos",
    recordWordFeaturesHint: "Si usaste extras para puntuar, anótalos",
    recordWordSkip: "Ahora no",
    recordWordSave: "Guardar",
    recordsViewMatch: "Ver partida",
    recordsPlayerHeader: "Jugador",
    recordsPointsHeader: "Puntos",
    recordsWordHeader: "Palabra",
    recordsRoundHeader: "Ronda",
    recordsRoundsHeader: "Rondas",
    recordsDateHeader: "Fecha",
    recordsEmptyWord: "Aún no hay récords de palabra",
    recordsEmptyMatch: "Aún no hay récords de partida",
    recordsEmpty: "Aún no hay récords",
    matchScoreboardOrderTitle: "Orden",
    matchScoreboardOpen: "Marcador",
    matchScoreboardPlayerHeader: "Jugador",
    matchScoreboardRoundShort: "B{round}",
    matchScoreboardOdd: "Puntuación impar en {player} (ronda {round})",
    matchScoreboardEmpty: "Aún no hay puntuaciones",
    matchRoundsLabel: "Bazas objetivo",
    matchPointsLabel: "Puntos objetivo",
    matchPlayerDefault: "Jugador {index}",
    matchPlayerNameClear: "Borrar nombre",
    matchPlayerColor: "Color del jugador",
    matchPlayerNameTitle: "Histórico de nombres",
    matchPlayerNameSelect: "Elegir nombre",
    matchPlayerNameHintMain: "Elige el nombre del jugador actual.",
    matchPlayerNameHintDelete: "Para borrar un nombre del histórico, toca la papelera.",
    matchPlayerNameRemove: "Quitar nombre",
    matchPlayerNameEmpty: "Sin nombres guardados",
    matchPlayerDrag: "Arrastrar jugador",
    matchMinuteAbbrev: "m",
    matchSecondAbbrev: "s",
    matchScoringLabel: "Anotar puntos con la app",
    matchScoringOn: "Sí",
    matchScoringOff: "No",
    matchScoringCaptionOn: "Los puntos se anotan usando esta aplicación",
    matchScoringCaptionOff: "Los puntos se anotan manualmente, con lápiz y papel, sin usar esta aplicación",
    matchRecordValidationLabel: "Validación obligatoria para récord",
    matchRecordValidationCaptionOn: "Para registrar un récord, la palabra debe validarse",
    matchRecordValidationCaptionDisabled: "No es necesario validar la palabra para registrar un récord",
    matchRecordValidationCaptionOff: "Activa la puntuación en la app para usar esta opción",
    matchWinnerByRounds: "Gana el jugador con mas puntos al finalizar {rounds} bazas",
    matchWinnerByPoints: "Gana el primer jugador en alcanzar {points} puntos",
    matchConfigSummaryDetails: "Estrategia {strategy} · Creación {creation} · {scoring}",
    matchConfigSummaryScoringOn: "Puntuación en app",
    matchConfigSummaryScoringOff: "Puntuación manual",
    matchConfigCustomize: "Editar",
    matchStartMatch: "Iniciar partida",
    matchStartDisabledMissingName: "Faltan nombres de jugadores",
    matchStartDisabledDuplicateName: "Hay nombres repetidos",
    matchRound: "Baza {round}",
    matchStartStrategy: "▶ Iniciar",
    matchStartCreation: "▶ Iniciar",
    matchStrategyReset: "↺ Reiniciar",
    matchCreationReset: "↺ Reiniciar",
    matchSkipToCreation: "→ A creación",
    matchStartCreationCTA: "Siguiente fase",
    matchTimeUp: "Tiempo!",
    matchNextRound: "Siguiente baza",
    matchEndRound: "Fin de ronda",
    matchRoundEndTitle: "Fin de ronda",
    matchRoundValidationSubtitle: "Validaci¢n",
    matchRoundScoringSubtitle: "Puntuaci¢n de la ronda",
    matchRoundSelectTop: "Selecciona al jugador con mayor puntuaci¢n",
    matchRoundSelectReached: "Selecciona a los jugadores que hayan alcanzado {points} puntos",
    matchRoundTiePrompt: "Empate en la puntuaci¢n",
    matchRoundContinue: "Continuar",
    matchRoundKeypadPrev: "Anterior",
    matchRoundKeypadNext: "Siguiente",
    matchRoundKeypadFinish: "Fin",
    matchRoundAllWin: "Todos ganan",
    matchRoundTieBreak: "Desempate",
    matchRoundScorePlaceholder: "--",
    matchRoundPlayerPrefix: "J",
    matchRoundScoresMissing: "Faltan puntuaciones por registrar",
    matchScoreboardScoresMissing: "Faltan puntuaciones por registrar (ronda {round}, {player})",
    matchScoreboardScoresOutOfRange: "Puntuación fuera de rango en {player} (ronda {round}, mínimo {min}, máximo {max})",
    matchRoundScoresOutOfRange: "Puntuación fuera de rango en {player} (mínimo {min}, máximo {max})",
    matchRoundScoresOdd: "Puntuación impar en {player}",
    matchWinnerTitleSingle: "Ganador",
    matchWinnerTitleMulti: "Ganadores",
    matchWinnerSubtitleSingle: "¡Enhorabuena!",
    matchWinnerSubtitleMulti: "¡Enhorabuena!",
    matchWinnersRecordsNote: "Y aplausos para {names} por sus récords.",
    matchWinnerOk: "Continuar",
    matchPlayAgainTitle: "¿Otra partida?",
    matchPlayAgainBody: "¿Quieres jugar otra partida con la misma configuración?",
    matchPlayAgainYes: "Sí",
    matchPlayAgainNo: "No",
    matchRoundOrderWarningTitle: "Orden de anotaci¢n",
    matchRoundOrderWarningBody: "Antes debes anotar a {player}.",
    matchTieBreakTitle: "Desempate {index}",
    matchValidateTitle: "Validar palabra",
    matchValidatePlaceholder: "Escribe la palabra...",
    matchValidateAction: "Validar",
    matchValidateOk: "Palabra válida",
    matchValidateFail: "Palabra no válida",
    matchValidateError: "Ha ocurrido un error inesperado al validar la palabra",
    matchValidateEmpty: "Introduce una palabra",
    matchRulesTitle: "Reglas de palabras válidas",
    matchRulesInfo: "Puedes cambiar las reglas para jugar como más te guste",
    matchRulesConfigure: "Configurar",
    matchRulesRestore: "Restaurar",
    matchRulesRestoreConfirm: "¿Restaurar las reglas por defecto?",
    matchValidateDefaultRules: [
      'PALABRAS VÁLIDAS',
      '---------------------------------',
      `${BULLET_CHAR} Todas las que recoge la RAE`,
      `${BULLET_CHAR} Nombres propios de personas, países, ciudades en castellano (ej: Londres, sí; London, no)`,
      `${BULLET_CHAR} Extranjerismos ampliamente utilizados (ej: software, fútbol, wasabi)`,
      '',
      'PALABRAS NO VÁLIDAS',
      '---------------------------------',
      `${BULLET_CHAR} Abreviaturas (ej: EEUU)`,
      `${BULLET_CHAR} Palabras con errores ortográficos`,
      `${BULLET_CHAR} Palabras extranjeras con traducción al castellano (ej: football, cool), salvo que se esté jugando la baza en inglés`,
      `${BULLET_CHAR} Acrónimos (ej: Mercosur = Mercado Común del Sur)`,
      `${BULLET_CHAR} Marcas (ej: Joma, Netflix)`,
      `${BULLET_CHAR} Nombres de empresas (ej: Amazon)`
    ].join('\n'),
    matchExit: "Atrás",
    matchPause: "⏸",
    matchResume: "▶ Continuar",
    matchFinish: "⏹",
    matchEndMatch: "Finalizar partida",
  },
  en: {
    languageName: "English",
    appTitle: "The Letter Loom",
    appShortName: "Letter Loom",
    appDescription: "The most fun card game of all time!",
    splashTitle: "Start a match",
    splashSubtitle: "Run timers and scoring for the card game.",
    splashContinue: "Play",
    splashResume: "Resume saved match",
    splashHelp: "View instructions",
    splashLoadingLabel: "Loading...",
    helpTitle: "Help",
    helpQuickGuide: "Quick guide",
    helpVideo: "How-to video",
    helpManual: "Instruction manual",
    quickGuideTitle: "Quick guide",
    quickGuideIndexTitle: "Index",
    quickGuideIndexIntro: "Pick a section and jump right in.",
    quickGuideIndexButton: "Index",
    quickGuideManualNote: "Want the full manual? Open the PDF.",
    quickGuideManualBtn: "Full manual",
    quickGuideManualLink: "Open PDF",
    quickGuideSections: [
      {
        id: "intro",
        title: "Quick start",
        body: [
          "Set the match (rounds or points) and go.",
          "The app runs timers, order and scoreboard."
        ],
        bullets: [
          "2 to 8 players.",
          "Typical length: 20-40 minutes."
        ]
      },
      {
        id: "strategy",
        title: "Strategy phase",
        body: [
          "This is where you set up your play."
        ],
        bullets: [
          "Place the Central Board with 5 letters face up.",
          "Deal 3 letters + 3 strategy cards to each player.",
          "Start the strategy timer.",
          "Each player plays a strategy card to change letters, points or the board."
        ]
      },
      {
        id: "creation",
        title: "Creation phase",
        body: [
          "Now build your word."
        ],
        bullets: [
          "Start the creation timer.",
          "Form a word using the Central Board and your letters.",
          "Add the values, apply color and strategy effects.",
          "Show the word and your score."
        ]
      },
      {
        id: "scoring",
        title: "Scoring and next round",
        body: [
          "Log the points and pass the deal."
        ],
        bullets: [
          "Enter the scores in the app.",
          "The deal moves to the player on the right.",
          "Repeat until you reach the rounds/points goal."
        ]
      },
      {
        id: "strategy-cards",
        title: "Strategy cards",
        body: [
          "They change letters or scoring."
        ],
        bullets: [
          "Swap cards with other players.",
          "Draw or return cards to the board.",
          "Multiply, add or subtract points.",
          "Change the Central Board."
        ]
      },
      {
        id: "valid-words",
        title: "Valid words",
        body: [
          "Agree the rules up front, or use the validator."
        ],
        bullets: [
          "Dictionary words and common proper nouns are ok.",
          "No abbreviations or misspellings.",
          "Loanwords only if everyone accepts them."
        ]
      },
      {
        id: "records",
        title: "Records",
        body: [
          "If a score is a record, the app will tell you."
        ],
        bullets: [
          "If you used extras (x2, wildcard, + or - points), mark them.",
          "Match averages are calculated at the end."
        ]
      },
      {
        id: "faq",
        title: "FAQ",
        faq: [
          {
            q: "Can I repeat a word?",
            a: "You can, but it usually costs points. Agree the rule first."
          },
          {
            q: "What if I can’t form a word?",
            a: "You can pass and score 0, or use your agreed penalty."
          },
          {
            q: "Do I have to use the Central Board?",
            a: "Yes, at least one letter, if you play with that rule."
          },
          {
            q: "When do I use strategy cards?",
            a: "Only in the strategy phase, before creating."
          },
          {
            q: "Are proper names allowed?",
            a: "Only common ones, or whatever you all agree on."
          },
          {
            q: "How does x2 work?",
            a: "If all letters are the same color, the score is multiplied by 2."
          }
        ]
      }
    ],
    helpInstagram: "Instagram",
    helpTiktok: "TikTok",
    helpEmail: "Contact",
    helpWeb: "Website",
    helpInstagramShort: "IG",
    helpTiktokShort: "TT",
    helpEmailShort: "@",
    helpWebShort: "WWW",
    matchScoreboardEditHint: "You can edit any score with a tap.",
    scoreboardRecordDate: "Match from {date}",
    matchScoreboardEdit: "Edit",
    helpFooter: "© {year} The Letter Loom\nVersion {version}",
    setupTitle: "Set up the game",
    setupSubtitle: "Configure players, timers, and mode.",
    playersTitle: "Players",
    playerLabel: "Player",
    addPlayer: "Add player",
    timersTitle: "Timers",
    strategyTimerLabel: "Strategy (seconds)",
    creationTimerLabel: "Creation (seconds)",
    startGame: "Start game",
    liveTitle: "Live game",
    phaseTitle: "Phases and timers",
    strategyPhaseLabel: "Strategy phase",
    creationPhaseLabel: "Creation phase",
    startStrategy: "Start strategy",
    startCreation: "Start creation",
    goToScoring: "Go to scoring",
    scoringTitle: "Baza scoring",
    scoringNote: "Enter each player's word and points.",
    saveBaza: "Save baza",
    editHistory: "Edit history",
    historyTitle: "History and corrections",
    backToLive: "Back to game",
    soundOn: "Sound on",
    soundOff: "Sound muted",
    apply: "Apply",
    cancel: "Cancel",
    save: "Save",
    ok: "OK",
    unexpectedErrortitle: "Unexpected error",
    unexpectedErrorBody: "An unexpected error occurred",    
    settingsTitle: "Settings",
    settingsSound: "Sound",
    settingsMusic: "Music",
    settingsLanguage: "Language",
    footer: "© {year} The Letter Loom",
    installPromptTitle: "Install Letter Loom",
    installPromptDescription: "Add the game for quick access and full-screen play, even offline.",
    installButtonText: "Install",
    installCancelText: "Not now",
    prototypeEnableWakeLock: "Keep screen on",
    prototypeDisableWakeLock: "Allow screen to sleep",
    wakeLockStatusActiveStandard: "Screen on (standard API).",
    wakeLockStatusReleased: "Screen may sleep (released by system).",
    wakeLockStatusActiveFallback: "Screen on (video fallback).",
    wakeLockStatusFallbackFailed: "Could not keep screen on (video error).",
    wakeLockStatusInactive: "Screen may sleep.",
    orientationMessage: "Put your device in PORTRAIT to play",
    prototypeVideoFallback: "Your browser does not support the video element.",
    supportTitle: "Support us",
    supportBody: "Help us launch The Letter Loom. Your support lets us produce the deck and improve the game.",
    supportCta: "I want the game",
    confirmTitle: "Confirm",
    confirmTitleDeleteRecord: "Delete record",
    confirmBodyExit: "Are you sure you want to go back to the home screen?",
    confirmBodyDeleteRecord: "Delete this record?",
    confirmTitlePhaseChange: "Change phase",
    confirmBodyPhaseChange: "Are you sure you want to switch phases?",
    confirmTitleFinish: "Finish timer",
    confirmBodyFinish: "Are you sure you want to finish this phase?",
    debugLogTitle: "Debug Log",
    debugLogFilterLabel: "Filter",
    debugLogFilterDebug: "Debug",
    debugLogFilterInfo: "Info",
    debugLogFilterWarn: "Warnings",
    debugLogFilterError: "Errors",
    debugLogEmpty: "No entries",
    confirmTitleResumeStale: "Resume match",
    confirmBodyResumeStale:
      "We found an unfinished match from {date} with {players}. Do you want to resume it?",
    confirmAccept: "OK",
    confirmDelete: "Delete",
    confirmCancel: "Cancel",
    matchTitle: "Game",
    matchConfigTitle: "New match",
    matchStrategyLabel: "Strategy phase",
    matchCreationLabel: "Creation phase",
    matchPhaseStrategy: "Strategy",
    matchPhaseCreation: "Creation",
    matchPlayersLabel: "Players / Order",
    matchPlayersCaption:
      "Indicate how many players you are and your position at the table for dealing order",
    matchModeLabel: "Mode",
    matchModeRounds: "Rounds",
    matchModePoints: "Points",
    matchDealerLabel: "Dealer",
    matchScoreboardTitle: "Scoreboard",
    matchScoreboardGoalRounds: "Goal: {rounds} rounds",
    matchScoreboardGoalPoints: "Goal: {points} points",
    recordsTitle: "Records",
    recordsOpen: "Records",
    recordsTabWords: "Words",
    recordsTabMatches: "Matches",
    recordsWordPill: "Best words in the loom",
    recordsMatchPill: "Best average player scores in a match. Matches with more rounds are favored.",
    recordsFeatureSameColor: "Same color",
    recordsFeatureWildcard: "Wildcard",
    recordsFeatureDouble: "x2",
    recordsFeaturePlus: "+ points",
    recordsFeatureMinus: "- points",
    recordWordTitle: "Word record",
    recordWordIntro: "Nice! This score is record-worthy",
    recordWordCaption: "Word",
    recordWordCaptionValidationRequired: "Validate the word to save the record",
    recordWordPlaceholder: "Type the word...",
    recordWordClear: "Clear word",
    recordWordSameColor: "Same color",
    recordWordWildcard: "Wildcard",
    recordWordDouble: "x2",
    recordWordPlus: "+ points",
    recordWordMinus: "- points",
    recordWordFeaturesHint: "If you used scoring extras, note them",
    recordWordSkip: "Not now",
    recordWordSave: "Save",
    recordsViewMatch: "View match",
    recordsPlayerHeader: "Player",
    recordsPointsHeader: "Points",
    recordsWordHeader: "Word",
    recordsRoundHeader: "Round",
    recordsRoundsHeader: "Rounds",
    recordsDateHeader: "Date",
    recordsEmptyWord: "No word records yet",
    recordsEmptyMatch: "No match records yet",
    recordsEmpty: "No records yet",
    matchScoreboardOrderTitle: "Order",
    matchScoreboardOpen: "Scoreboard",
    matchScoreboardPlayerHeader: "Player",
    matchScoreboardRoundShort: "R{round}",
    matchScoreboardOdd: "Odd score in {player} (round {round})",
    matchScoreboardEmpty: "No scores yet",
    matchRoundsLabel: "Rounds target",
    matchPointsLabel: "Points target",
    matchPlayerDefault: "Player {index}",
    matchPlayerNameClear: "Clear name",
    matchPlayerColor: "Player color",
    matchPlayerNameTitle: "Name history",
    matchPlayerNameSelect: "Choose name",
    matchPlayerNameHintMain: "Pick the current player name.",
    matchPlayerNameHintDelete: "To delete a name from the history, tap the trash icon.",
    matchPlayerNameRemove: "Remove name",
    matchPlayerNameEmpty: "No saved names",
    matchPlayerDrag: "Drag player",
    matchMinuteAbbrev: "m",
    matchSecondAbbrev: "s",
    matchScoringLabel: "Score tracking with app",
    matchScoringOn: "Yes",
    matchScoringOff: "No",
    matchScoringCaptionOn: "Points are tracked using this app",
    matchScoringCaptionOff: "Points are tracked manually, with pencil and paper, without using this app",
    matchRecordValidationLabel: "Mandatory validation for record",
    matchRecordValidationCaptionOn: "To register a record, the word must be validated",
    matchRecordValidationCaptionDisabled: "Word validation is not required to register a record",
    matchRecordValidationCaptionOff: "Enable app scoring to use this option",
    matchWinnerByRounds: "The winner is the player with the most points after {rounds} rounds",    
    matchWinnerByPoints: "The winner is the first player to reach {points} points",
    matchConfigSummaryDetails: "Strategy {strategy} · Creation {creation} · {scoring}",
    matchConfigSummaryScoringOn: "Scoring in app",
    matchConfigSummaryScoringOff: "Manual scoring",
    matchConfigCustomize: "Edit",
    matchStartMatch: "Start match",
    matchStartDisabledMissingName: "Missing player names",
    matchStartDisabledDuplicateName: "Duplicate player names",
    matchRound: "Round {round}",
    matchStartStrategy: "▶ Start",
    matchStartCreation: "▶ Start",
    matchStrategyReset: "↺ Reset",
    matchCreationReset: "↺ Reset",
    matchSkipToCreation: "→ To creation",
    matchStartCreationCTA: "Next phase",
    matchTimeUp: "Time!",
    matchNextRound: "Next round",
    matchEndRound: "End round",
    matchRoundEndTitle: "End of round",
    matchRoundValidationSubtitle: "Validation",
    matchRoundScoringSubtitle: "Round scoring",
    matchRoundSelectTop: "Select the player(s) with the highest score",
    matchRoundSelectReached: "Select the players who reached {points} points",
    matchRoundTiePrompt: "Tie at the top",
    matchRoundContinue: "Continue",
    matchRoundKeypadPrev: "Prev",
    matchRoundKeypadNext: "Next",
    matchRoundKeypadFinish: "Finish",
    matchRoundAllWin: "All win",
    matchRoundTieBreak: "Tie-break",
    matchRoundScorePlaceholder: "--",
    matchRoundPlayerPrefix: "P",
    matchRoundScoresMissing: "Scores still missing",
    matchScoreboardScoresMissing: "Scores still missing (round {round}, {player})",
    matchScoreboardScoresOutOfRange: "Score out of range for {player} (round {round}, min {min}, max {max})",
    matchRoundScoresOutOfRange: "Score out of range for {player} (min {min}, max {max})",
    matchRoundScoresOdd: "Odd score in {player}",
    matchWinnerTitleSingle: "Winner",
    matchWinnerTitleMulti: "Winners",
    matchWinnerSubtitleSingle: "Congratulations!",
    matchWinnerSubtitleMulti: "Congratulations!",
    matchWinnersRecordsNote: "And a shout-out to {names} for their records.",
    matchWinnerOk: "Continue",
    matchPlayAgainTitle: "Play again?",
    matchPlayAgainBody: "Start a new match with the same settings?",
    matchPlayAgainYes: "Yes",
    matchPlayAgainNo: "No",
    matchRoundOrderWarningTitle: "Scoring order",
    matchRoundOrderWarningBody: "You must score {player} first.",
    matchTieBreakTitle: "Tie-break {index}",
    matchValidateTitle: "Validate word",
    matchValidatePlaceholder: "Type the word...",
    matchValidateAction: "Validate",
    matchValidateOk: "Valid word",
    matchValidateFail: "Invalid word",
    matchValidateError: "An unexpected error occurred while validating the word",
    matchValidateEmpty: "Enter a word",
    matchRulesTitle: "Valid word rules",
    matchRulesInfo: "You can change the rules to play as you like",
    matchRulesConfigure: "Configure",
    matchRulesRestore: "Restore",
    matchRulesRestoreConfirm: "Restore default rules?",
    matchValidateDefaultRules: [
      'VALID WORDS',
      '---------------------------------',
      `${BULLET_CHAR} Any word found in a standard English dictionary`,
      `${BULLET_CHAR} Proper names of people, countries, or cities commonly used in English (e.g., London, John, Canada)`,
      `${BULLET_CHAR} Loanwords or foreign words widely accepted in English (e.g., sushi, café, kindergarten)`,
      '',
      'INVALID WORDS',
      '---------------------------------',
      `${BULLET_CHAR} Abbreviations (e.g., USA, UK)`,
      `${BULLET_CHAR} Misspelled words`,
      `${BULLET_CHAR} Foreign words with a common English equivalent (e.g., futbol for soccer, unless playing a Spanish round)`,
      `${BULLET_CHAR} Acronyms (e.g., NASA, FIFA)`,
      `${BULLET_CHAR} Brand names (e.g., Nike, Netflix)`,
      `${BULLET_CHAR} Company names (e.g., Amazon, Google)`
    ].join('\n'), 
    matchExit: "Exit",
    matchPause: "⏸",
    matchResume: "▶ Resume",
    matchFinish: "⏹",
    matchEndMatch: "End match",
  },
};

function placeholderSet(str) {
  if (typeof str !== "string") return new Set();
  const matches = [...str.matchAll(/{([^}]+)}/g)];
  return new Set(matches.map((m) => m[1]));
}

export function validateTexts(allTexts = TEXTS) {
  const langs = Object.keys(allTexts || {});
  if (langs.length === 0) return [];
  const refLang = langs[0];
  const ref = allTexts[refLang] || {};
  const refKeys = new Set(Object.keys(ref));
  const errors = [];

  langs.forEach((code) => {
    const txt = allTexts[code] || {};
    const keys = new Set(Object.keys(txt));
    const missing = [...refKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !refKeys.has(k));
    if (missing.length) errors.push(`Lang "${code}" missing keys: ${missing.join(", ")}`);
    if (extra.length) errors.push(`Lang "${code}" extra keys: ${extra.join(", ")}`);

    refKeys.forEach((k) => {
      const refP = placeholderSet(ref[k]);
      const curP = placeholderSet(txt[k]);
      if (refP.size !== curP.size || [...refP].some((p) => !curP.has(p)) || [...curP].some((p) => !refP.has(p))) {
        errors.push(
          `Lang "${code}" key "${k}" placeholders differ (expected ${[...refP].join(", ")}, got ${[...curP].join(", ")})`
        );
      }
    });
  });

  if (errors.length) {
    const msg = `Translation validation failed:\n${errors.join("\n")}`;
    console.error(msg);
  }
  return errors;
}

const languageListeners = new Set();

export function getAvailableLanguages() {
  return Object.keys(TEXTS);
}

export function getShellLanguage() {
  const state = loadState();
  const saved = state.settings?.language;
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  if (saved && TEXTS[saved]) return saved;
  if (TEXTS[nav]) return nav;
  return "en";
}

export function setShellLanguage(lang) {
  if (!TEXTS[lang]) return;
  updateState({ settings: { language: lang } });
  languageListeners.forEach((fn) => {
    try {
      fn(lang);
    } catch (e) {}
  });
}

export function onShellLanguageChange(callback) {
  if (typeof callback === "function") {
    languageListeners.add(callback);
    return () => languageListeners.delete(callback);
  }
  return () => {};
}

