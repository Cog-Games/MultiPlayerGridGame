// Modern configuration system combining all original configs
export const CONFIG = {
  // Server configuration
  server: {
    url: import.meta.env.VITE_SERVER_URL || 'http://localhost:3001',
    reconnectAttempts: 3,
    reconnectDelay: 1000
  },

  // Game settings (from original NODEGAME_CONFIG)
  game: {
    name: 'GridWorldExperiment',
    version: '2.0.0',
    matrixSize: 15,
    maxGameLength: 50,
    
    // Player configuration
    players: {
      player1: {
        type: 'human',
        color: 'red',
        description: 'Human player (you)'
      },
      player2: {
        type: 'ai', // Can be 'ai' or 'human'
        color: 'orange',
        description: 'AI agent or human partner'
      }
    },

    // Experiment configuration
    experiments: {
      order: ['2P2G', '2P3G'], // Default experiment order
      numTrials: {
        '1P1G': 3,
        '1P2G': 12,
        '2P2G': 12,
        '2P3G': 12
      }
    },

    // Success threshold for collaboration games
    successThreshold: {
      enabled: true,
      consecutiveSuccessesRequired: 5,
      minTrialsBeforeCheck: 12,
      maxTrials: 24,
      randomSamplingAfterTrial: 12
    },

    // Timing configurations
    timing: {
      trialToFeedbackDelay: 500,
      feedbackDisplayDuration: 2000,
      preTrialDisplayDuration: 2000,
      fixationDuration: 1000,
      newGoalMessageDuration: 0,
      waitingForPartnerDuration: 1000
    },

    // AI agent settings
    agent: {
      type: 'joint',
      delay: 500,
      independentDelay: 300
    }
  },

  // Visual settings
  visual: {
    canvasSize: 600,
    cellSize: 40,
    colors: {
      background: '#ffffff',
      grid: '#cccccc',
      player1: '#ff0000',
      player2: '#ff8800',
      goal: '#00ff00',
      obstacle: '#333333'
    }
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

  // Multiplayer settings for human-human mode
  multiplayer: {
    maxWaitTime: 60000,
    roomTimeout: 300000,
    reconnectAttempts: 3,
    syncInterval: 100,
    moveTimeout: 10000
  }
};

// Game objects (from original setup.js)
export const GAME_OBJECTS = {
  blank: 0,
  player: 1,
  ai_player: 2,
  goal: 3,
  obstacle: 4
};

// Movement directions (from original setup.js)
export const DIRECTIONS = {
  arrowup: { movement: [-1, 0], name: 'up' },
  arrowdown: { movement: [1, 0], name: 'down' },
  arrowleft: { movement: [0, -1], name: 'left' },
  arrowright: { movement: [0, 1], name: 'right' }
};

// Export utility functions
export const GameConfigUtils = {
  setPlayerType(playerIndex, type) {
    if (type === 'ai' || type === 'human') {
      CONFIG.game.players[`player${playerIndex}`].type = type;
    }
  },

  getPlayerType(playerIndex) {
    return CONFIG.game.players[`player${playerIndex}`].type;
  },

  isHumanAIMode() {
    return CONFIG.game.players.player2.type === 'ai';
  },

  isHumanHumanMode() {
    return CONFIG.game.players.player2.type === 'human';
  },

  setExperimentOrder(order) {
    CONFIG.game.experiments.order = order;
  },

  getNumTrials(experimentType) {
    return CONFIG.game.experiments.numTrials[experimentType] || 12;
  }
};