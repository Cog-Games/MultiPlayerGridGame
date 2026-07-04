// Configuration for the local two-human Dynamic Stag Hunt game.

export const CONFIG = {
  game: {
    name: 'DynamicStagHunt',
    version: '1.0.0',
    matrixSize: 7,
    maxGameLength: 30,
    numRounds: 10,
    defaultCondition: 'baseline',
    conditions: {
      baseline: {
        label: 'Baseline',
        signalEnabled: false,
      },
      signaling: {
        label: 'Signaling',
        signalEnabled: true,
      },
    },

    rewards: {
      initialScore: 10,
      stagCapture: 10,
      rabbitCapture: 3,
      stepCost: -0.5,
      signalCost: -0.1,
    },

    groupPhase: {
      enabled: true,
      matrixSize: 19,
      collectionActionLimit: 80,
      stagCount: 3,
      rabbitCount: 6,
      publicGoodMultiplier: 1.5,
      dyadShareMultiplier: 1,
      dyads: {
        player1: 'player2',
        player2: 'player1',
        player3: 'player4',
        player4: 'player3',
      },
    },

    timing: {
      humanMoveThrottle: 120,
      stagTurnDelay: 250,
      llmActionDelay: 400,
      signalDisplayDuration: 2000,
      roundFeedbackDelay: 1500,
    },
  },

  // Retained for the moving stag policy.
  rl: {
    gridSize: 7,
    gamma: 0.9,
  },

  visual: {
    canvasSize: 578,
    cellSize: 80,
    padding: 2,
    colors: {
      background: '#ffffff',
      grid: '#333333',
      player1: '#00bcd4',
      player2: '#ff9800',
      player3: '#9b59b6',
      player4: '#e74c3c',
      rabbit: '#27ae60',
      stag: '#27ae60',
      stagOutline: '#1e8449',
      signal: '#27ae60',
      signalOutline: '#ffffff',
      obstacle: '#000000',
    },
  },
};

export const GAME_OBJECTS = {
  blank: 0,
  player1: 1,
  player2: 2,
  rabbit: 3,
  stag: 4,
  obstacle: 5,
};

export const PLAYER_CONTROLS = {
  w: { player: 'player1', type: 'move', movement: [-1, 0], name: 'up' },
  s: { player: 'player1', type: 'move', movement: [1, 0], name: 'down' },
  a: { player: 'player1', type: 'move', movement: [0, -1], name: 'left' },
  d: { player: 'player1', type: 'move', movement: [0, 1], name: 'right' },

  arrowup: { player: 'player2', type: 'move', movement: [-1, 0], name: 'up' },
  arrowdown: { player: 'player2', type: 'move', movement: [1, 0], name: 'down' },
  arrowleft: { player: 'player2', type: 'move', movement: [0, -1], name: 'left' },
  arrowright: { player: 'player2', type: 'move', movement: [0, 1], name: 'right' },
};
