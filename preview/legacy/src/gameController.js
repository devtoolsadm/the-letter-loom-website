// --- Timer global para la fase activa ---
  // (debe inicializarse en el constructor)

// GameController: lógica del juego Letter Loom separada de la UI
// Todas las fases, opciones y sonidos usan constantes

// Game phases for Letter Loom
export const PHASES = {
  SETUP: 'SETUP',
  STRATEGY: 'PHASE_1_STRATEGY',
  WORD_BUILDING: 'PHASE_2_WORD_BUILDING', // All players build words, shared timer
  SCORING: 'SCORING', // Score entry phase, one by one if enabled
  PAUSED: 'PAUSED',
  TIME_UP: 'TIME_UP',
  GAME_OVER: 'GAME_OVER',
  TIE_BREAK: 'TIE_BREAK', // Tie-breaker round
};

export const MODALITY = {
  ROUNDS: 'Rounds',
  POINTS: 'Points',
};

export const SCORE_TRACKING = {
  NONE: 'no',
  YES: 'yes',
};

export const SOUNDS = {
  MAIN: 'main',
  URGENT: 'urgent',
};

export class GameController {
  constructor(config, players) {
    this.config = { ...config };
    this.players = players.map(p => ({ ...p }));
    this.currentRound = 1;
    this.currentPlayerIndex = 0;
    this.phase = PHASES.SETUP;
    this.listeners = [];
    this.isPaused = false;
    this.tieBreakerActive = false;
    this.tieBreakerPlayers = [];
    // Dealer y mano
    this.dealerIndex = 0; // J1 reparte en la primera ronda
    this.starterIndex = 1; // J2 es mano en la primera ronda
    // Timer global para la fase activa
    this.timer = {
      running: false,
      timeLeft: 0,
      _intervalId: null,
      _endTime: null,
      _pausedAt: null
    };
    this.updateDealerAndStarter();
  }

  // Calcula los índices de repartidor y mano para la ronda actual
  updateDealerAndStarter() {
    if (this.tieBreakerActive) {
      const n = this.tieBreakerPlayers.length;
      if (n === 0) {
        this.dealerIndex = 0;
        this.starterIndex = 0;
        return;
      }
      this.dealerIndex = 0;
      this.starterIndex = n > 1 ? 1 : 0;
    } else {
      const n = this.players.length;
      this.dealerIndex = (this.currentRound - 1) % n;
      this.starterIndex = (this.dealerIndex + 1) % n;
    }
  }

  // Iniciar el timer para la fase actual
  startTimer(seconds) {
    this.stopTimer(); // Limpia cualquier timer previo
    this.timer.running = true;
    this.timer.timeLeft = seconds;
    this.timer._endTime = Date.now() + seconds * 1000;
    this.timer._pausedAt = null;
    this.emitChange();
    this.timer._intervalId = setInterval(() => {
      if (!this.timer.running) return;
      const now = Date.now();
      let timeLeft = Math.ceil((this.timer._endTime - now) / 1000);
      if (timeLeft < 0) timeLeft = 0;
      this.timer.timeLeft = timeLeft;
      this.emitChange();
      if (timeLeft <= 0) {
        this.stopTimer();
        // Ya no cambiamos de fase automáticamente, solo detenemos el timer y emitimos el cambio
        // La UI debe mostrar '¡Tiempo!' y esperar acción del usuario
      }
    }, 250); // 250ms para mayor precisión visual
  }

  // Pausar el timer
  pauseTimer() {
    if (this.timer.running) {
      this.timer.running = false;
      if (this.timer._intervalId) {
        clearInterval(this.timer._intervalId);
        this.timer._intervalId = null;
      }
      // Guarda el tiempo de pausa
      this.timer._pausedAt = Date.now();
      this.timer._remaining = Math.max(0, Math.ceil((this.timer._endTime - this.timer._pausedAt) / 1000));
      this.emitChange();
    }
  }

  // Reanudar el timer
  resumeTimer() {
    if (!this.timer.running && this.timer._pausedAt != null && this.timer._remaining > 0) {
      this.timer.running = true;
      this.timer._endTime = Date.now() + this.timer._remaining * 1000;
      this.timer._pausedAt = null;
      this.emitChange();
      this.timer._intervalId = setInterval(() => {
        if (!this.timer.running) return;
        const now = Date.now();
        let timeLeft = Math.ceil((this.timer._endTime - now) / 1000);
        if (timeLeft < 0) timeLeft = 0;
        this.timer.timeLeft = timeLeft;
        this.emitChange();
        if (timeLeft <= 0) {
          this.stopTimer();
          // Ya no cambiamos de fase automáticamente, solo detenemos el timer y emitimos el cambio
        }
      }, 250);
    }
  }

  // Terminar el timer
  stopTimer() {
    this.timer.running = false;
    this.timer.timeLeft = 0;
    if (this.timer._intervalId) {
      clearInterval(this.timer._intervalId);
      this.timer._intervalId = null;
    }
    this.timer._endTime = null;
    this.timer._pausedAt = null;
    this.emitChange();
  }

  // Actualizar el tiempo restante (llamado desde la UI/intervalo)
  setTimerTimeLeft(seconds) {
    this.timer.timeLeft = seconds;
    this.emitChange();
  }

  // Set the current phase and reset player index if needed
  setPhase(phase) {
    this.phase = phase;
    if (phase === PHASES.STRATEGY || phase === PHASES.TIE_BREAK) {
      this.currentPlayerIndex = 0;
    }
    this.emitChange();
  }

  // Advance to the next player in scoring phase, or next round/game over as needed
  nextScoringTurn() {
    const scoringPlayers = this.tieBreakerActive ? this.tieBreakerPlayers : this.players;
    if (this.currentPlayerIndex < scoringPlayers.length - 1) {
      this.currentPlayerIndex++;
      this.emitChange();
    } else {
      if (this.isGameOver()) {
        const winners = this.getWinners();
        if (winners.length > 1) {
          this.startTieBreaker(winners);
        } else {
          this.setPhase(PHASES.GAME_OVER);
        }
      } else {
        this.currentRound++;
        this.updateDealerAndStarter();
        this.setPhase(this.tieBreakerActive ? PHASES.TIE_BREAK : PHASES.STRATEGY);
      }
    }
  }

  // Check if the game should end (rounds or points)
  isGameOver() {
    if (this.tieBreakerActive) return false; // Tie-breaker continues until resolved
    if (this.config.modality === MODALITY.ROUNDS) {
      return this.currentRound >= this.config.modalityValue;
    } else if (this.config.modality === MODALITY.POINTS) {
      // Game ends if any player reaches or exceeds the target, but only after scoring phase
      return this.players.some(p => p.score >= this.config.modalityValue);
    }
    return false;
  }

  // Get players with the highest score
  getWinners() {
    const maxScore = Math.max(...this.players.map(p => p.score));
    return this.players.filter(p => p.score === maxScore);
  }

  // Start a tie-breaker round with the tied players
  startTieBreaker(tiedPlayers) {
    this.tieBreakerActive = true;
    this.tieBreakerPlayers = tiedPlayers.map(p => ({ ...p }));
    this.tieBreakerPlayers.forEach(p => p.score = 0);
    this.currentPlayerIndex = 0;
    this.updateDealerAndStarter();
    this.setPhase(PHASES.TIE_BREAK);
  }

  // End tie-breaker and check for winner or another tie
  endTieBreaker() {
    const maxScore = Math.max(...this.tieBreakerPlayers.map(p => p.score));
    const winners = this.tieBreakerPlayers.filter(p => p.score === maxScore);
    if (winners.length === 1) {
      // Single winner found
      this.tieBreakerActive = false;
      this.tieBreakerPlayers = [];
      this.setPhase(PHASES.GAME_OVER);
    } else {
      // Another tie-breaker round needed
      this.startTieBreaker(winners);
    }
  }

  // Update score for a player (main or tie-breaker)
  updateScore(idx, delta) {
    if (this.tieBreakerActive) {
      this.tieBreakerPlayers[idx].score += delta;
    } else {
      this.players[idx].score += delta;
    }
    this.emitChange();
  }

  // Set the current player index (main or tie-breaker)
  setPlayerIndex(idx) {
    this.currentPlayerIndex = idx;
    this.emitChange();
  }

  // Reset all player scores (main and tie-breaker)
  resetScores() {
    this.players.forEach(p => p.score = 0);
    if (this.tieBreakerActive) {
      this.tieBreakerPlayers.forEach(p => p.score = 0);
    }
    this.emitChange();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  emitChange() {
    this.listeners.forEach(fn => fn(this));
  }

  // Get the current game state, including timer info
  getState() {
    return {
      config: { ...this.config },
      players: this.tieBreakerActive ? this.tieBreakerPlayers.map(p => ({ ...p })) : this.players.map(p => ({ ...p })),
      currentRound: this.currentRound,
      currentPlayerIndex: this.currentPlayerIndex,
      phase: this.phase,
      isPaused: this.isPaused,
      tieBreakerActive: this.tieBreakerActive,
      tieBreakerPlayers: this.tieBreakerPlayers.map(p => ({ ...p })),
      timer: { ...this.timer },
      dealerIndex: this.dealerIndex,
      starterIndex: this.starterIndex,
    };
  }
    // Avanza a la siguiente ronda, reinicia timer y fase
    startNextRound() {
      this.currentRound = (this.currentRound || 1) + 1;
      this.updateDealerAndStarter();
      this.phase = PHASES.STRATEGY;
      this.currentPlayerIndex = 0;
      this.timer = {
        running: false,
        timeLeft: this.config.phase1Time,
        _intervalId: null,
        _endTime: null,
        _pausedAt: null
      };
      // Si hay lógica extra para reiniciar palabras, respuestas, etc., agregar aquí
      this.emitChange();
    }
}
