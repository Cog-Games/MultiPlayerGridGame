import { CONFIG } from './config/gameConfig.js';
import { GameStateManager } from './game/GameStateManager.js';
import { GameRenderer } from './ui/GameRenderer.js';

const MOVEMENT_BY_ACTION = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const DEFAULT_MAP = {
  name: 'original',
  player1Start: [5, 2],
  player2Start: [1, 5],
  stagStart: [3, 3],
  rabbits: [[3, 0], [3, 6]],
  obstacles: [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
    [1, 0], [1, 6],
    [2, 0], [2, 3], [2, 6],
    [4, 0], [4, 2], [4, 4], [4, 6],
    [5, 0], [5, 6],
    [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6],
  ],
};

const PLAYER_LABELS = {
  player1: 'Player 1',
  player2: 'Player 2',
};

const state = {
  stopRequested: false,
  totalRuns: 0,
  currentRun: 0,
  currentRound: 0,
  currentCalls: 0,
};

const elements = {
  status: document.getElementById('status'),
  runCount: document.getElementById('run-count'),
  roundCount: document.getElementById('round-count'),
  callCount: document.getElementById('call-count'),
  log: document.getElementById('log'),
  startButton: document.getElementById('start-btn'),
  stopButton: document.getElementById('stop-btn'),
  canvasHost: document.getElementById('canvas-host'),
};

const params = new URLSearchParams(window.location.search);
const pairCount = Number(params.get('pairs') || 4);
const roundCount = Number(params.get('rounds') || CONFIG.game.numRounds);
const conditions = (params.get('conditions') || 'baseline,signaling')
  .split(',')
  .map(condition => condition.trim())
  .filter(condition => CONFIG.game.conditions[condition]);
const autoStart = params.get('autoStart') === '1';

function updateStatus(label) {
  elements.status.textContent = label;
  elements.runCount.textContent = `${state.currentRun} / ${state.totalRuns}`;
  elements.roundCount.textContent = `${state.currentRound} / ${roundCount}`;
  elements.callCount.textContent = String(state.currentCalls);
}

function log(message, details = null) {
  const stamp = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  elements.log.textContent += `[${stamp}] ${message}${suffix}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function createRunId(condition, pairIndex) {
  const stamp = new Date().toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[^0-9A-Za-z]+/g, '-')
    .replace(/-$/, '');
  return `${stamp}-expanded-pilot-pair${String(pairIndex).padStart(2, '0')}-${condition}`;
}

function getLegalActions(condition) {
  const actions = Object.keys(MOVEMENT_BY_ACTION);
  if (CONFIG.game.conditions[condition]?.signalEnabled) actions.push('signal');
  return actions;
}

function getLlmRules(condition) {
  const rules = [
    'Grid coordinates are [row, col] with row 0 at the top and col 0 at the left.',
    `Each player starts with ${CONFIG.game.rewards.initialScore} points.`,
    `Each movement action costs the acting player ${CONFIG.game.rewards.stepCost} points.`,
    'Each action consumes one turn for the acting player. Stay is not an action.',
    'Turn order is Player 1, then Player 2, then the stag.',
    'A direction action attempts to move one cell. If blocked by an obstacle or edge, the action is still used and the player stays in place.',
    'The large moving target moves automatically after both players act.',
    `Capture a small target square to earn +${CONFIG.game.rewards.rabbitCapture} points.`,
    `Capture the large moving target and each player gets +${CONFIG.game.rewards.stagCapture} points.`,
    'A capture ends the round.',
  ];

  if (CONFIG.game.conditions[condition]?.signalEnabled) {
    rules.push(
      'The signal action shows that you intend to capture the large moving target.',
      `Signal briefly places a green triangle inside the acting player for 2 seconds. It does not move the player, gives no points, costs ${CONFIG.game.rewards.signalCost} points, and still uses one action.`,
    );
  }

  return rules.join('\n');
}

function parseAction(data, legalActions, condition) {
  const requestedAction = typeof data.action === 'string' ? data.action : '';
  const action = legalActions.includes(requestedAction) ? requestedAction : legalActions[0];

  if (action === 'signal' && CONFIG.game.conditions[condition]?.signalEnabled) {
    return {
      label: 'signal',
      payload: { type: 'signal' },
    };
  }

  return {
    label: action,
    payload: MOVEMENT_BY_ACTION[action] || MOVEMENT_BY_ACTION[legalActions[0]],
  };
}

function getFallbackAction(condition) {
  const legalActions = getLegalActions(condition).filter(action => action !== 'signal');
  return parseAction({ action: legalActions[0] || 'up' }, getLegalActions(condition), condition);
}

function renderImage(renderer, manager) {
  renderer.render(manager.getRenderState());
  return renderer.toDataURL();
}

async function requestLlmAction({ manager, renderer, condition, player }) {
  const legalActions = getLegalActions(condition);
  const payload = {
    player,
    playerLabel: PLAYER_LABELS[player],
    phase: 'dyadic',
    condition,
    conditionLabel: CONFIG.game.conditions[condition].label,
    legalActions,
    rules: getLlmRules(condition),
    symbolicState: manager.getSymbolicState({
      currentActor: player,
      condition,
    }),
    asciiGrid: manager.getAsciiGrid(),
    gridImage: renderImage(renderer, manager),
  };

  try {
    const response = await fetch('/api/llm-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error || `HTTP ${response.status}`;
      manager.recordLlmCall({
        phase: payload.phase,
        condition,
        player,
        success: false,
        status: response.status,
        provider: data.provider,
        model: data.model,
        retryCount: data.retryCount || 0,
        usage: data.usage,
        error: message,
      });
      log('LLM request failed; using fallback action', {
        condition,
        player,
        status: response.status,
        error: message,
      });
      return getFallbackAction(condition);
    }

    const parsedAction = parseAction(data, legalActions, condition);
    manager.recordLlmCall({
      phase: payload.phase,
      condition,
      player,
      success: true,
      status: response.status,
      provider: data.provider,
      model: data.model,
      retryCount: data.retryCount || 0,
      usage: data.usage,
      action: data.action,
      parsedAction: parsedAction.label,
    });
    state.currentCalls++;
    updateStatus('Running');
    log('LLM action', {
      condition,
      round: manager.roundIndex + 1,
      step: manager.stepCount,
      player,
      action: parsedAction.label,
      inputTokens: data.usage?.inputTokens || 0,
      outputTokens: data.usage?.outputTokens || 0,
      retryCount: data.retryCount || 0,
    });
    return parsedAction;
  } catch (error) {
    manager.recordLlmCall({
      phase: payload.phase,
      condition,
      player,
      success: false,
      error: error.message,
    });
    log('LLM request failed before response; using fallback action', {
      condition,
      player,
      error: error.message,
    });
    return getFallbackAction(condition);
  }
}

function applyPlayerAction(manager, player, action) {
  manager.movePlayer(player, action.payload);
  if (action.payload?.type === 'signal') manager.clearSignal(player);
}

function getTimeoutOutcome() {
  return { type: 'timeout', reward: 0 };
}

function savePayload({ runId, condition, manager, stage, pairIndex }) {
  return fetch('/api/save-experiment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      stage,
      completed: stage === 'complete',
      phase: 'dyadic',
      condition,
      conditionLabel: CONFIG.game.conditions[condition].label,
      playerMode: 'llm-llm',
      phaseOneOnly: true,
      pairIndex,
      runner: 'experiment-runner',
      exportedAt: new Date().toISOString(),
      gameData: manager.exportData(),
    }),
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  });
}

async function runSingleExperiment({ condition, pairIndex }) {
  const runId = createRunId(condition, pairIndex);
  const manager = new GameStateManager();
  const renderer = new GameRenderer();
  elements.canvasHost.appendChild(renderer.createCanvas());

  log('Run started', { runId, condition, pairIndex });

  for (let round = 0; round < roundCount; round++) {
    if (state.stopRequested) break;
    state.currentRound = round + 1;
    updateStatus('Running');

    manager.initializeRound(DEFAULT_MAP);
    let outcome = null;

    while (!outcome && manager.stepCount < CONFIG.game.maxGameLength && !state.stopRequested) {
      const player1Action = await requestLlmAction({ manager, renderer, condition, player: 'player1' });
      applyPlayerAction(manager, 'player1', player1Action);
      outcome = manager.checkOutcome();
      if (outcome || manager.stepCount >= CONFIG.game.maxGameLength || state.stopRequested) break;

      const player2Action = await requestLlmAction({ manager, renderer, condition, player: 'player2' });
      applyPlayerAction(manager, 'player2', player2Action);
      outcome = manager.checkOutcome();
      if (outcome || manager.stepCount >= CONFIG.game.maxGameLength || state.stopRequested) break;

      manager.moveStag();
      outcome = manager.checkOutcome();
    }

    if (!outcome) outcome = getTimeoutOutcome();
    manager.roundData.outcome = outcome;
    manager.finalizeRound();

    await savePayload({ runId, condition, manager, stage: 'round', pairIndex });
    log('Round saved', {
      runId,
      condition,
      round: round + 1,
      outcome: outcome.type,
      totalSteps: manager.roundHistory[manager.roundHistory.length - 1].totalSteps,
      scores: manager.getScores(),
    });
  }

  const saveResult = await savePayload({ runId, condition, manager, stage: 'complete', pairIndex });
  renderer.canvas?.remove();
  log('Run completed', {
    runId,
    condition,
    pairIndex,
    totalRounds: manager.roundIndex,
    scores: manager.getScores(),
    filePath: saveResult.filePath,
  });
  return { runId, condition, pairIndex, filePath: saveResult.filePath, data: manager.exportData() };
}

async function runAll() {
  state.stopRequested = false;
  state.totalRuns = pairCount * conditions.length;
  state.currentRun = 0;
  state.currentRound = 0;
  state.currentCalls = 0;
  updateStatus('Running');

  const results = [];
  for (let pairIndex = 1; pairIndex <= pairCount; pairIndex++) {
    for (const condition of conditions) {
      if (state.stopRequested) break;
      state.currentRun++;
      state.currentRound = 0;
      updateStatus('Running');
      results.push(await runSingleExperiment({ condition, pairIndex }));
    }
  }

  window.experimentRunnerResults = results;
  updateStatus(state.stopRequested ? 'Stopped' : 'Complete');
  log(state.stopRequested ? 'Experiment stopped' : 'All runs completed', {
    completedRuns: results.length,
    totalRuns: state.totalRuns,
  });
}

elements.startButton.addEventListener('click', () => {
  runAll().catch(error => {
    updateStatus('Error');
    console.error(error);
    log('Runner failed', { error: error.message });
  });
});

elements.stopButton.addEventListener('click', () => {
  state.stopRequested = true;
  log('Stop requested');
});

updateStatus('Idle');
log('Runner ready', { pairCount, roundCount, conditions });

if (autoStart) {
  elements.startButton.click();
}
