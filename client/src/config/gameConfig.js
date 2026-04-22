
// Helper function to safely get environment variables
const getEnvVar = (key, defaultValue) => {
  try {
    return import.meta.env?.[key] || defaultValue;
  } catch (error) {
    // Fallback for when import.meta.env is not available (e.g., direct HTML loading)
    console.warn(`Environment variable ${key} not available, using default: ${defaultValue}`);
    return defaultValue;
  }
};

const defaultServerUrl = (typeof window !== 'undefined' && window.location && window.location.origin)
  ? window.location.origin
  : 'http://localhost:3001';

export const CONFIG = {
  // Debug / logging configuration
  debug: {
    // When true, mutes console.log/info/debug in the browser
    // Can also be toggled via env var VITE_DISABLE_DEBUG_LOGS
    disableConsoleLogs: getEnvVar('VITE_DISABLE_DEBUG_LOGS', 'false') === 'true'
  },

  // Server configuration
  server: {
    // Point to same-origin server by default (single-service deploy)
    url: getEnvVar('VITE_SERVER_URL', defaultServerUrl),
    reconnectAttempts: 3,
    reconnectDelay: 1000,
    // Optional: Google Apps Script endpoint for saving data to Google Drive (legacy-compatible)
    // Example: 'https://script.google.com/macros/s/AKfycb.../exec'
    // Default to the legacy Apps Script endpoint; override via VITE_GOOGLE_APPS_SCRIPT_URL
    googleAppsScriptUrl: getEnvVar(
      'VITE_GOOGLE_APPS_SCRIPT_URL',
      'https://script.google.com/macros/s/AKfycbyfQ-XKsoFbmQZGM7c741rEXh2ZUpVK-uUIu9ycooXKnaxM5-hRSzIUhQ-uWZ668Qql/exec'
    ),
    enableGoogleDriveSave: getEnvVar('VITE_ENABLE_GOOGLE_DRIVE_SAVE', 'true') === 'true'
  },

  // Game settings (from original NODEGAME_CONFIG)
  game: {
    name: 'GridWorldExperiment_StagHunt',
    version: '1.0.0',
    prolificCompletionCode: getEnvVar('VITE_PROLIFIC_COMPLETION_CODE', 'CTNDR8GV'),
    // Size of the square grid world (N x N)
    matrixSize: 9,
    maxGameLength: 60,

    // Two-player move mode (applies to both human-AI and human-human games):
    // - 'simultaneous': both players choose a move, then both apply together
    // - 'turn-taking': players alternate moves one at a time
    // - 'free': both players move independently in real time
    moveMode: 'simultaneous',
    turnTaking: {
      startingPlayer: 1 // which player (1 or 2) moves first
    },
    // Counterbalance two-player maps by swapping red/orange starting positions
    // on every other trial.
    swapPlayerStartPositionsHalfTime: true,

    // Player configuration
    players: {
      player1: {
        type: 'human',
        color: 'red',
        description: 'Human player (you)'
      },
      player2: {
        // Types: 'human' | 'gpt' | 'gpt-ToM' | 'vlm' | 'vlm-ToM' | 'rl_individual' | 'rl_joint' | 'we_intent_js'
        type: 'vlm',
        color: 'orange',
        description: 'Human, GPT, or RL partner'
      }
    },

    // Experiment configuration
    experiments: {
      // order: ['1P1G'],
      // order: ['1P2G'],
      // order: [ '2P3G'],
      // order: ['1P2G','2P3G'],
      order: [ 'StagHunt'],
      // order: ['StagHunt', 'StagHuntTwoStags'],
      // order: ['1P1G', '1P2G', '2P2G', '2P3G'], // Full experiment order

      numTrials: {
        '1P1G': 3, // 3
        '1P2G': 12, // 12
        '2P2G': 8, // 8
        '2P3G': 12, // 12
        'StagHunt': 18,
        'StagHuntTwoStags': 4
      },

      // Map ordering per experiment: 'fixed' (keys sorted numerically) or 'random' (shuffled).
      // Default 'fixed' for StagHunt so all 18 maps run in order 1..18 for testing.
      mapOrder: {
        '1P1G': 'random',
        '1P2G': 'random',
        '2P2G': 'random',
        '2P3G': 'random',
        'StagHunt': 'fixed',
        'StagHuntTwoStags': 'random'
      },

      // Optional per-experiment map filters for focused testing.
      // Set to null to use all maps, a string for one path type, or an array
      // to allow multiple path types.
      // Examples:
      //   'StagHunt': 'equal-optimal'
      //   'StagHunt': ['costly-suboptimal']
      signalingPathTypeFilter: {
        'StagHunt': null,
        'StagHuntTwoStags': null
      }
    },

    // Success threshold for collaboration games
    successThreshold: {
      enabled: false,
      consecutiveSuccessesRequired: 5,
      minTrialsBeforeCheck: 12,
      maxTrials: 24,
      randomSamplingAfterTrial: 12
    },

    // Reward configuration (points paid by different goal types)
    // These are read by the game logic but can be tuned per experiment.
    rewards: {
      // Each player's round score starts here and loses points per move
      initialPointsPerTrial: 15,
      stepPenalty: 1,
      // Reward for any small (solo-collectable) goal
      smallGoalReward: 3,
      // Reward per player when BOTH players reach the same big joint goal
      bigGoalJointReward: 10
    },

    // Dual-goal mechanic configuration
    // When enabled for an experiment type, maps may contain both small and big goals.
    dualGoals: {
      // Experiment types that use dual-goal maps and scoring
      // (others treat all goals as standard small goals)
      enabledExperiments: ['2P2G', 'StagHunt', 'StagHuntTwoStags']
    },

    // Timing configurations
  timing: {
      trialToFeedbackDelay: 500,
      feedbackDisplayDuration: 2500,
      preTrialDisplayDuration: 2000,
      fixationDuration: 1000,
      newGoalMessageDuration: 0,
      // Optional hard wall-clock cap for a trial (ms). 0 disables.
      // Legacy behavior had no time cap; only step-based via maxGameLength.
      maxTrialDurationMs: 60 * 1000,
      // Minimum and maximum time to wait for partner (ms)
      waitingForPartnerMinDuration: 1 * 1000, // 9*1000, 9s
      waitingForPartnerMaxDuration: 1 * 1000 // 300*1000, 5mins
    },

    // AI agent settings
    agent: {
      // RL mode for player2 when using RL: 'individual' or 'joint'
      type: 'joint',
      delay: 500,
      independentDelay: 300,
      // Optional GPT/VLM client behavior defaults (non-sensitive).
      // Runtime provider/model selection comes from the game server .env and
      // is cached onto CONFIG.game.agent.{gpt,vlm}.model during play.
      gpt: {
        temperature: 1,
        // Include past trajectories in GPT prompt
        memory: {
          enabled: true,
          // Limit steps appended to prompt per player to control token usage
          maxSteps: 50
        }
      },
      vlm: {
        temperature: 0,
        memory: {
          enabled: true,
          maxSteps: 3
        }
      },
      // WeAgent (collaborative agency model) parameters — maps to NSF proposal Eq 1-11
      weAgent: {
        betaUtility: 3.0,           // β: softmax weight for utility/intention sampling (Eq 6, 10)
        alphaSignal: 2.0,           // α: intention-signaling weight (Eq 7, 11)
        gammaWait: 1.0,             // γ: information-seeking weight for signal-waiter (Eq 8)
        thetaRole: 1.0,             // θ: role selection sensitivity to EIG (Eq 5)
        deltaCommit: 0.5,           // Δ: entropy threshold for we-intention commitment (Eq 9), in bits
        likelihoodScale: 1.5,       // scale for Bayesian likelihood updates
        continueSignalingAfterCommit: true,  // use Eq 11 vs Eq 10 after commitment
        stagUtilityBonus: 2.0       // extra weight for big goals in intention prior (Eq 6)
      }
    }
  },

  // Map source configuration for loading maps
  // - 'server' (default): use /api/maps endpoints
  // - 'python-json': load from JSON generated by python tools at CONFIG.maps.pythonJsonBasePath
  // - 'fallback': use built-in random generators
  maps: {
    source: getEnvVar('VITE_MAP_SOURCE', 'server'),
    pythonJsonBasePath: '/python/gameDesign/output'
  },

  // Visual settings
  visual: {
    // For matrixSize 9 with cellSize 40 and padding 2:
    // canvasSize = (cellSize + padding) * matrixSize + padding = (40 + 2) * 9 + 2 = 380
    canvasSize: 380,
    cellSize: 40,
    padding: 2,
    // Toggle the in-game scoreboard UI without affecting underlying point logic.
    showScoreboard: false,
    colors: {
      background: '#ffffff',
      grid: '#cccccc',
      player1: '#ff0000',
      player2: '#ff8800',
      goal: '#0066ff',
      obstacle: '#333333'
    }
  },

  // Fullscreen settings
  fullscreen: {
    // Master switch for fullscreen functionality
    enabled: false,
    // Enable fullscreen on spacebar press in welcome screen
    enableOnWelcome: true,
    // Auto-start game when entering fullscreen from welcome screen
    autoStartOnFullscreen: true,
    // Show fullscreen instructions in welcome screen
    showInstructions: true
  },

  // 1P2G specific configuration
  oneP2G: {
    minStepsBeforeNewGoal: 1,
    distanceConditions: {
      CLOSER_TO_PLAYER1: 'closer_to_player1',
      FARTHER_TO_PLAYER1: 'farther_to_player1',
      EQUAL_TO_PLAYER1: 'equal_to_player1',
      NO_NEW_GOAL: 'no_new_goal'
    },
    distanceConstraint: {
      closerThreshold: 2,
      fartherThreshold: 2,
      equalTolerance: false,
      allowEqualDistance: false
    },
    goalConstraints: {
      minDistanceFromHuman: 1,
      maxDistanceFromHuman: 12,
      minDistanceBetweenGoals: 3,
      avoidRectangleArea: false,
      blockPathCheck: false
    }
  },

  // 2P3G specific configuration
  twoP3G: {
    minStepsBeforeNewGoal: 1,
    newGoalMessageDuration: 5000,
    distanceConditions: {
      CLOSER_TO_PLAYER2: 'closer_to_player2',
      CLOSER_TO_PLAYER1: 'closer_to_player1',
      EQUAL_TO_BOTH: 'equal_to_both',
      NO_NEW_GOAL: 'no_new_goal'
    },
    distanceConstraint: {
      closerThreshold: 2,
      allowEqualDistance: false,
      maxDistanceIncrease: 5
    },
    goalConstraints: {
      minDistanceFromHuman: 1,
      maxDistanceFromHuman: 12,
      avoidRectangleArea: false,
      maintainDistanceSum: false,
      blockPathCheck: false
    }
  },

  // Model-vs-model (AI-vs-AI) simulation mode
  // When enabled, both players are driven by AI agents with no human input.
  // Enable via URL flag `?modelExp=1` or by setting `enabled: true` here.
  modelExp: {
    enabled: false,
    // Agent types for each side. Accepted values:
    //   'rl_individual' | 'rl_joint' | 'we_intent_js' | 'gpt' | 'gemini' | 'claude'
    player1Agent: 'gpt',
    player2Agent: 'gpt',
    // RL mode applied to CONFIG.game.agent.type when either side is an RL agent
    rlMode: 'joint',
    // How many times to repeat each map
    repetitionsPerMap: 1,
    seed: 42,
    // Pacing between joint steps in ms (0 = as fast as possible)
    stepDelayMs: 250,
    // Soft targets for API rate (server reads VLM_TARGET_RPM/TPM; client spacing derived here)
    targetRpm: 400,
    targetTpm: 160000,
    vlmMaxOutputTokens: 8,
    vlmTomMaxOutputTokens: 80,
    // When true, remote LLM/VLM agent calls are issued one at a time so
    // simultaneous-step simulations do not burst multiple API requests at once.
    serializeRemoteAgentCalls: false,
    // Minimum gap between dispatching remote LLM/VLM requests in ms.
    remoteAgentMinRequestSpacingMs: 0,
    // Safety cap on steps per trial to prevent runaway LLM calls
    maxStepsPerTrial: 100,
    // Filename prefix for the exported Excel/JSON
    exportPrefix: 'modelExp'
  },

  // Multiplayer networking settings for human-human mode
  multiplayer: {
    maxWaitTime: 60000,
    roomTimeout: 300000,
    reconnectAttempts: 3,
    syncInterval: 100,
    moveTimeout: 10000,
    // Max wait (ms) on the "Game is Ready! Press SPACE" screen for the other
    // human to press space before falling back to AI partner
    matchPlayReadyTimeout: 10000,
    // Fallback AI partner type when human-human matching fails
    // Allowed: 'gpt' | 'gpt-ToM' | 'vlm' | 'vlm-ToM' | 'rl_individual' | 'rl_joint' | 'rl_individual_python' | 'we_intent_js'
    fallbackAIType: 'vlm-ToM',
    // Partner inactivity settings
    inactivityFallback: {
      // Enable automatic fallback to AI when partner is inactive
      enabled: true,
      // Time in milliseconds after which partner is considered inactive
      timeoutMs: 40000, // 40s-1 minute
      // How often to check for partner inactivity (ms)
      checkIntervalMs: 5000 // 5 seconds
    },
    // Real-time movement stabilization settings
    realTimeMovement: {
      // Minimum delay between moves to prevent spam (ms)
      moveThrottleDelay: 100,
      // Enable immediate local updates for responsiveness
      immediateLocalUpdates: true,
      // Periodic state synchronization interval (ms) - increased to reduce conflicts
      stateSyncInterval: 300,
      // Move validation timeout (ms)
      moveValidationTimeout: 1000,
      // Time window to protect recent local moves from being overwritten (ms)
      localMoveProtectionWindow: 300
    }
  }
};

// Game objects (from original setup.js)
export const GAME_OBJECTS = {
  blank: 0,
  player: 1,
  ai_player: 2,
  // Default/legacy goal (treated as a small/solo goal)
  goal: 3,
  // Explicit small-goal code (solo-collectable, low reward)
  goal_small: 3,
  // Big joint goal (requires both players to collect, high reward)
  goal_big: 5,
  obstacle: 4
};

// Movement directions (from original setup.js)
export const DIRECTIONS = {
  arrowup: { movement: [-1, 0], name: 'up' },
  arrowdown: { movement: [1, 0], name: 'down' },
  arrowleft: { movement: [0, -1], name: 'left' },
  arrowright: { movement: [0, 1], name: 'right' }
};

// Apply debug logging configuration by silencing non-error console output if requested
(() => {
  try {
    const silent = CONFIG?.debug?.disableConsoleLogs;
    if (silent) {
      const noop = () => {};
      // Preserve warnings and errors, silence info/debug/log
      if (typeof console !== 'undefined') {
        console.log = noop;
        console.info = noop;
        console.debug = noop;
      }
    }
  } catch (_) {
    // Do nothing if configuration not yet available
  }
})();

// Export utility functions
export const GameConfigUtils = {
  isTwoPlayerExperiment(experimentType) {
    const exp = String(experimentType || '').toUpperCase();
    return exp.includes('2P') || this.isStagHuntExperiment(exp);
  },

  isStagHuntExperiment(experimentType) {
    const exp = String(experimentType || '').toUpperCase();
    return exp === 'STAGHUNT' || exp === 'STAGHUNTTWOSTAGS';
  },

  setPlayerType(playerIndex, type) {
    // Normalize legacy alias
    const normalized = (type === 'ai') ? 'rl_joint' : type;
    const allowed = [
      'human', 'gpt', 'gpt-ToM', 'vlm', 'vlm-ToM',
      'rl_individual', 'rl_joint', 'rl_individual_python', 'we_intent_js',
      // Provider aliases for model-exp mode
      'gemini', 'claude'
    ];
    if (!allowed.includes(normalized)) return;
    CONFIG.game.players[`player${playerIndex}`].type = normalized;

    // Keep RL agent mode consistent when setting either player to RL types
    if (normalized === 'rl_joint') CONFIG.game.agent.type = 'joint';
    if (normalized === 'rl_individual' || normalized === 'rl_individual_python') CONFIG.game.agent.type = 'individual';
  },

  isModelExpMode() {
    return !!CONFIG?.modelExp?.enabled;
  },

  /**
   * Apply the CONFIG.modelExp block to the rest of CONFIG so the existing
   * agent-dispatch code (ExperimentManager, AiVsAiOrchestrator) sees a
   * consistent player1/player2 type + agent.type + LLM model settings.
   */
  applyModelExp() {
    const cfg = CONFIG.modelExp;
    if (!cfg || !cfg.enabled) return;
    this.setPlayerType(1, cfg.player1Agent);
    this.setPlayerType(2, cfg.player2Agent);

    const usesRL = [cfg.player1Agent, cfg.player2Agent].some(
      t => t === 'rl_individual' || t === 'rl_joint' || t === 'rl_individual_python'
    );
    if (usesRL && (cfg.rlMode === 'joint' || cfg.rlMode === 'individual')) {
      CONFIG.game.agent.type = cfg.rlMode;
    }

    const rpm = Number(cfg.targetRpm);
    if (Number.isFinite(rpm) && rpm > 0) {
      CONFIG.modelExp.remoteAgentMinRequestSpacingMs = Math.max(0, Math.ceil(60000 / rpm));
    }
  },

  getPlayerType(playerIndex) {
    return CONFIG.game.players[`player${playerIndex}`].type;
  },

  isHumanAIMode() {
    const t = CONFIG.game.players.player2.type;
    return t !== 'human';
  },

  isHumanHumanMode() {
    return CONFIG.game.players.player2.type === 'human';
  },

  setExperimentOrder(order) {
    CONFIG.game.experiments.order = order;
  },

  getNumTrials(experimentType) {
    return CONFIG.game.experiments.numTrials[experimentType] || 12;
  },

  getMoveMode(experimentType) {
    try {
      const isTwoPlayer = this.isTwoPlayerExperiment(experimentType);
      if (!isTwoPlayer) return null;

      const mode = CONFIG?.game?.moveMode;
      if (mode === 'simultaneous' || mode === 'turn-taking' || mode === 'free') {
        return mode;
      }
      return 'simultaneous';
    } catch (_) {
      return null;
    }
  },

  isSynchronizedHumanTurnsEnabled(experimentType) {
    return this.getMoveMode(experimentType) === 'simultaneous';
  },

  isTurnTakingEnabled(experimentType) {
    return this.getMoveMode(experimentType) === 'turn-taking';
  },

  shouldSwapPlayerStartPositions(experimentType, trialIndex) {
    try {
      if (!this.isTwoPlayerExperiment(experimentType)) return false;
      if (!CONFIG?.game?.swapPlayerStartPositionsHalfTime) return false;
      return (Number(trialIndex) % 2) === 1;
    } catch (_) {
      return false;
    }
  }
};
