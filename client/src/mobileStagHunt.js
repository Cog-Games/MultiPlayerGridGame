import { CONFIG } from './config/gameConfig.js';
import { GameStateManager } from './game/GameStateManager.js';
import { GameHelpers } from './utils/GameHelpers.js';

const GRID_SIZE = CONFIG.game.matrixSize;
const TOTAL_ROUNDS = CONFIG.game.numRounds;
const MAX_PLAYER_STEPS = 20;

const ACTIONS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const ACTION_LABELS = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  signal: 'signal',
};

const BASE_MAP = {
  name: 'channel',
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

const MAPS = [
  BASE_MAP,
  transformMap(BASE_MAP, 'mirror-cols', ([row, col]) => [row, GRID_SIZE - 1 - col]),
  transformMap(BASE_MAP, 'mirror-rows', ([row, col]) => [GRID_SIZE - 1 - row, col]),
  transformMap(BASE_MAP, 'rotate-180', ([row, col]) => [GRID_SIZE - 1 - row, GRID_SIZE - 1 - col]),
];

const COLORS = {
  page: '#f4f7fb',
  board: '#ffffff',
  grid: '#cfd8e5',
  obstacle: '#233041',
  p1: '#03a9c9',
  p2: '#f58220',
  active: '#1264d8',
  stag: '#2ea95f',
  stagStroke: '#17683a',
  rabbit: '#5a42c9',
  text: '#172033',
  signal: '#f3c623',
  capture: '#12a150',
};

const els = {
  app: document.getElementById('mobile-stag-hunt'),
  roundLabel: document.getElementById('round-label'),
  stepLabel: document.getElementById('step-label'),
  p1Score: document.getElementById('p1-score'),
  p2Score: document.getElementById('p2-score'),
  status: document.getElementById('status'),
  topbar: document.querySelector('.topbar'),
  boardPanel: document.querySelector('.board-panel'),
  controlsPanel: document.querySelector('.controls-panel'),
  setupPanel: document.getElementById('setup-panel'),
  startBtn: document.getElementById('start-btn'),
  restartBtn: document.getElementById('restart-btn'),
  resultPanel: document.getElementById('result-panel'),
  resultSummary: document.getElementById('result-summary'),
  saveStatus: document.getElementById('save-status'),
  controls: document.getElementById('touch-controls'),
  canvas: document.getElementById('game-canvas'),
};

const ctx = els.canvas.getContext('2d');

let game = createSession();
let timers = [];

function transformMap(map, name, transform) {
  return {
    name,
    player1Start: transform(map.player1Start),
    player2Start: transform(map.player2Start),
    stagStart: transform(map.stagStart),
    rabbits: map.rabbits.map(transform),
    obstacles: map.obstacles.map(transform),
  };
}

function createSession() {
  return {
    runId: `mobile-staghunt-${new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '')}-${Math.random().toString(36).slice(2, 7)}`,
    manager: new GameStateManager(),
    mode: 'solo',
    condition: CONFIG.game.defaultCondition,
    active: false,
    locked: true,
    currentRoundIndex: 0,
    currentActor: null,
    startedAt: null,
    completedAt: null,
    rounds: [],
    lastOutcome: null,
    saveResult: null,
  };
}

function cloneMap(map) {
  return {
    name: map.name,
    player1Start: [...map.player1Start],
    player2Start: [...map.player2Start],
    stagStart: [...map.stagStart],
    rabbits: map.rabbits.map(pos => [...pos]),
    obstacles: map.obstacles.map(pos => [...pos]),
  };
}

function getPreviewState() {
  const map = MAPS[0];
  return {
    player1: [...map.player1Start],
    player2: [...map.player2Start],
    stag: [...map.stagStart],
    rabbits: map.rabbits.map(pos => [...pos]),
    obstacles: map.obstacles.map(pos => [...pos]),
    signals: { player1: false, player2: false },
  };
}

function formatScore(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function setTimer(callback, delay) {
  const timer = window.setTimeout(() => {
    timers = timers.filter(item => item !== timer);
    callback();
  }, delay);
  timers.push(timer);
  return timer;
}

function clearTimers() {
  for (const timer of timers) window.clearTimeout(timer);
  timers = [];
}

function getPlayerStepCounts() {
  const events = game.manager.roundData?.events || [];
  return events.reduce((counts, event) => {
    if (event.agent === 'player1' || event.agent === 'player2') counts[event.agent] += 1;
    return counts;
  }, { player1: 0, player2: 0 });
}

function isRunInProgress() {
  return Boolean(game.startedAt && !game.completedAt);
}

function syncLayoutMode() {
  const playing = isRunInProgress();
  els.app.classList.toggle('is-playing', playing);
  document.body.classList.toggle('is-playing', playing);
  els.setupPanel.hidden = playing;
}

function startGame() {
  clearTimers();
  const mode = game.mode;
  const condition = game.condition;
  game = createSession();
  game.mode = mode;
  game.condition = condition;
  game.active = true;
  game.locked = false;
  game.startedAt = new Date().toISOString();
  game.currentRoundIndex = 0;
  game.lastOutcome = null;
  els.resultPanel.hidden = true;
  els.saveStatus.textContent = '';
  window.scrollTo(0, 0);
  startRound(0);
}

function startRound(roundIndex) {
  const map = cloneMap(MAPS[roundIndex % MAPS.length]);
  game.currentRoundIndex = roundIndex;
  game.active = true;
  game.locked = false;
  game.currentActor = null;
  game.lastOutcome = null;
  game.manager.initializeRound(map);
  setStatus(`Round ${roundIndex + 1}: Player 1 turn`);
  beginPlayerTurn('player1');
}

function beginPlayerTurn(player) {
  if (!game.active) return;
  game.currentActor = player;

  if (game.mode === 'solo' && player === 'player2') {
    game.locked = true;
    setStatus('Partner turn');
    render();
    setTimer(runPartnerBotTurn, CONFIG.game.timing.llmActionDelay);
    return;
  }

  game.locked = false;
  setStatus(player === 'player1' ? 'Player 1 turn' : 'Player 2 turn');
  render();
}

function runPartnerBotTurn() {
  if (!game.active || game.currentActor !== 'player2') return;
  const action = choosePartnerAction();
  applyPlayerAction('player2', action, true);
}

function submitAction(actionName) {
  if (!game.active || game.locked) return;
  if (game.currentActor !== 'player1' && game.currentActor !== 'player2') return;
  if (game.mode === 'solo' && game.currentActor === 'player2') return;

  if (actionName === 'signal') {
    if (!CONFIG.game.conditions[game.condition]?.signalEnabled) return;
    applyPlayerAction(game.currentActor, { type: 'signal' }, false);
    return;
  }

  const movement = ACTIONS[actionName];
  if (!movement) return;
  applyPlayerAction(game.currentActor, movement, false);
}

function applyPlayerAction(player, action, automated) {
  if (!game.active || game.currentActor !== player) return;

  const didAct = game.manager.movePlayer(player, action);
  if (!didAct) return;

  game.locked = true;
  const label = action?.type === 'signal' ? ACTION_LABELS.signal : getMovementLabel(action);
  setStatus(`${getPlayerName(player, automated)}: ${label}`);
  render();

  if (action?.type === 'signal') {
    setTimer(() => {
      if (!game.active || game.currentActor !== player) return;
      game.manager.clearSignal(player);
      render();
      continueAfterPlayer(player);
    }, CONFIG.game.timing.signalDisplayDuration);
    return;
  }

  continueAfterPlayer(player);
}

function continueAfterPlayer(player) {
  if (finishRoundIfNeeded(player)) return;

  if (player === 'player1') {
    beginPlayerTurn('player2');
    return;
  }

  beginStagTurn();
}

function beginStagTurn() {
  if (!game.active) return;
  game.currentActor = 'stag';
  game.locked = true;
  setStatus('Stag turn');
  render();
  setTimer(() => {
    if (!game.active || game.currentActor !== 'stag') return;
    game.manager.moveStag();
    render();
    if (!finishRoundIfNeeded('stag')) beginPlayerTurn('player1');
  }, CONFIG.game.timing.stagTurnDelay);
}

function finishRoundIfNeeded(lastActor = null) {
  const outcome = game.manager.checkOutcome();
  if (outcome) {
    completeRound(outcome);
    return true;
  }

  const playerSteps = getPlayerStepCounts();
  const eachPlayerReachedLimit = playerSteps.player1 >= MAX_PLAYER_STEPS && playerSteps.player2 >= MAX_PLAYER_STEPS;
  const player2JustReachedLimit = lastActor === 'player2' && playerSteps.player2 >= MAX_PLAYER_STEPS;
  if (eachPlayerReachedLimit || player2JustReachedLimit) {
    completeRound({
      type: 'timeout',
      reward: 0,
      playerSteps,
      maxPlayerSteps: MAX_PLAYER_STEPS,
    });
    return true;
  }

  return false;
}

function completeRound(outcome) {
  if (!game.active) return;

  game.active = false;
  game.locked = true;
  clearTimers();

  const roundRecord = {
    roundIndex: game.currentRoundIndex,
    mapId: MAPS[game.currentRoundIndex % MAPS.length].name,
    condition: game.condition,
    mode: game.mode,
    outcome,
    totalSteps: game.manager.stepCount,
    playerSteps: getPlayerStepCounts(),
    maxPlayerSteps: MAX_PLAYER_STEPS,
    scores: game.manager.getScores(),
    completedAt: new Date().toISOString(),
  };

  game.manager.roundData.outcome = outcome;
  game.rounds.push(roundRecord);
  game.manager.finalizeRound();
  game.lastOutcome = outcome;
  setStatus(getOutcomeText(outcome));
  render();

  setTimer(() => {
    if (game.currentRoundIndex + 1 < TOTAL_ROUNDS) {
      startRound(game.currentRoundIndex + 1);
    } else {
      finishGame();
    }
  }, CONFIG.game.timing.roundFeedbackDelay);
}

async function finishGame() {
  game.completedAt = new Date().toISOString();
  game.active = false;
  game.locked = true;
  game.currentActor = null;

  const scores = game.manager.getScores();
  const stagCaptures = game.rounds.filter(round => round.outcome.type === 'stag_captured').length;
  const rabbitCaptures = game.rounds.filter(round => round.outcome.type.startsWith('rabbit_captured')).length;

  els.resultSummary.innerHTML = `
    <strong>Finished ${TOTAL_ROUNDS} rounds.</strong>
    Stag captures: ${stagCaptures}. Rabbit captures: ${rabbitCaptures}.
    Final score: P1 ${formatScore(scores.player1)}, P2 ${formatScore(scores.player2)}.
  `;
  els.resultPanel.hidden = false;
  setStatus('Game complete');
  render();

  const saveResult = await saveGame();
  game.saveResult = saveResult;
  els.saveStatus.textContent = saveResult.ok
    ? 'Saved on this device and server.'
    : `Saved on this device. Server save unavailable: ${saveResult.error}`;
}

function getOutcomeText(outcome) {
  if (outcome.type === 'stag_captured') return `Stag captured: both players +${CONFIG.game.rewards.stagCapture}`;
  if (outcome.type === 'rabbit_captured_p1') return `Player 1 captured a rabbit: +${CONFIG.game.rewards.rabbitCapture}`;
  if (outcome.type === 'rabbit_captured_p2') return `Player 2 captured a rabbit: +${CONFIG.game.rewards.rabbitCapture}`;
  return 'Round timed out';
}

function getMovementLabel(action) {
  for (const [label, movement] of Object.entries(ACTIONS)) {
    if (movement[0] === action[0] && movement[1] === action[1]) return ACTION_LABELS[label];
  }
  return 'move';
}

function getPlayerName(player, automated) {
  if (automated) return 'Partner';
  return player === 'player1' ? 'Player 1' : 'Player 2';
}

function choosePartnerAction() {
  const state = game.manager.state;
  const player1DistanceToStag = GameHelpers.manhattanDistance(state.player1, state.stag);
  const player1NearestRabbitDistance = Math.min(
    ...state.rabbits.filter(Boolean).map(rabbit => GameHelpers.manhattanDistance(state.player1, rabbit)),
    99,
  );
  const stagFocus = state.signals.player1 || player1DistanceToStag <= player1NearestRabbitDistance + 1;

  return Object.values(ACTIONS)
    .map(action => {
      const next = game.manager.resolveIntendedPosition('player2', state.player2, action);
      const blocked = next[0] === state.player2[0] && next[1] === state.player2[1];
      const stagCapture = GameHelpers.getStagCaptureState(state.player1, next, state.stag).captured;
      const rabbitIndex = GameHelpers.isRabbitReached(next, state.rabbits);
      const distanceToStag = GameHelpers.manhattanDistance(next, state.stag);
      const distanceToPlayer1 = GameHelpers.manhattanDistance(next, state.player1);

      let score = 0;
      if (stagCapture) score += 1000;
      if (rabbitIndex >= 0 && !stagFocus) score += 120;
      if (rabbitIndex >= 0 && stagFocus) score += 12;
      score += (GRID_SIZE * 2 - distanceToStag) * (stagFocus ? 12 : 6);
      score += (GRID_SIZE * 2 - distanceToPlayer1) * 0.6;
      if (state.signals.player1) score += 18;
      if (blocked) score -= 30;

      return { action, score };
    })
    .sort((left, right) => right.score - left.score)[0].action;
}

async function saveGame() {
  const payload = {
    runId: game.runId,
    stage: 'complete',
    completed: true,
    phase: 'mobile-stag-hunt',
    condition: game.condition,
    conditionLabel: CONFIG.game.conditions[game.condition]?.label || game.condition,
    playerMode: game.mode === 'solo' ? 'human-scripted-partner' : 'local-hotseat',
    exportedAt: new Date().toISOString(),
    gameData: {
      gameType: 'DynamicStagHunt',
      gridSize: GRID_SIZE,
      totalRounds: TOTAL_ROUNDS,
      maxPlayerSteps: MAX_PLAYER_STEPS,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      rounds: game.rounds,
      exportData: game.manager.exportData(),
    },
  };

  localStorage.setItem(`mobile-staghunt-${game.runId}`, JSON.stringify(payload));

  try {
    const response = await fetch('/api/save-experiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function render() {
  updateLabels();
  syncLayoutMode();
  updateControls();
  fitActiveLayout();
  renderBoard();
}

function updateLabels() {
  const scores = game.manager.getScores();
  const roundNumber = game.active || game.rounds.length < TOTAL_ROUNDS
    ? Math.min(game.currentRoundIndex + 1, TOTAL_ROUNDS)
    : TOTAL_ROUNDS;
  const playerSteps = getPlayerStepCounts();

  els.roundLabel.textContent = `Round ${roundNumber} / ${TOTAL_ROUNDS}`;
  els.stepLabel.textContent = `Moves ${playerSteps.player1}-${playerSteps.player2} / ${MAX_PLAYER_STEPS}`;
  els.p1Score.textContent = `P1 ${formatScore(scores.player1)}`;
  els.p2Score.textContent = `P2 ${formatScore(scores.player2)}`;

  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === game.mode));
    button.disabled = game.active;
  });

  document.querySelectorAll('[data-condition]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.condition === game.condition));
    button.disabled = game.active;
  });
}

function updateControls() {
  const humanTurn = game.active
    && !game.locked
    && (game.currentActor === 'player1' || (game.currentActor === 'player2' && game.mode === 'hotseat'));
  const signalEnabled = CONFIG.game.conditions[game.condition]?.signalEnabled;

  els.controls.querySelectorAll('[data-action]').forEach(button => {
    if (button.dataset.action === 'signal') {
      button.hidden = !signalEnabled;
      button.disabled = !humanTurn || !signalEnabled;
      return;
    }
    button.disabled = !humanTurn;
  });

  els.startBtn.textContent = game.rounds.length || game.active ? 'Restart' : 'Start';
}

function getViewportSize() {
  return {
    width: Math.floor(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 390),
    height: Math.floor(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 700),
  };
}

function fitActiveLayout() {
  if (!isRunInProgress()) {
    els.app.style.removeProperty('--key-size');
    els.app.style.removeProperty('--key-gap');
    els.canvas.style.removeProperty('width');
    els.canvas.style.removeProperty('height');
    return;
  }

  const viewport = getViewportSize();
  const keySize = viewport.height < 640
    ? 44
    : viewport.height < 710
      ? 49
      : viewport.height < 790
        ? 54
        : 60;
  const keyGap = viewport.height < 700 ? 5 : 6;

  els.app.style.setProperty('--key-size', `${keySize}px`);
  els.app.style.setProperty('--key-gap', `${keyGap}px`);

  const appStyle = window.getComputedStyle(els.app);
  const boardStyle = window.getComputedStyle(els.boardPanel);
  const appGap = parseFloat(appStyle.rowGap || appStyle.gap || '0') || 0;
  const appPaddingY = getVerticalPadding(appStyle);
  const boardPaddingX = getHorizontalPadding(boardStyle);
  const boardPaddingY = getVerticalPadding(boardStyle);
  const fixedHeight =
    appPaddingY
    + (appGap * 2)
    + els.topbar.offsetHeight
    + els.controlsPanel.offsetHeight
    + boardPaddingY;
  const widthLimit = Math.max(220, Math.floor(els.boardPanel.clientWidth - boardPaddingX));
  const heightLimit = Math.max(220, Math.floor(viewport.height - fixedHeight));
  const boardSize = Math.floor(Math.min(widthLimit, heightLimit, 460));

  els.canvas.style.width = `${boardSize}px`;
  els.canvas.style.height = `${boardSize}px`;
}

function getVerticalPadding(style) {
  return (parseFloat(style.paddingTop || '0') || 0) + (parseFloat(style.paddingBottom || '0') || 0);
}

function getHorizontalPadding(style) {
  return (parseFloat(style.paddingLeft || '0') || 0) + (parseFloat(style.paddingRight || '0') || 0);
}

function renderBoard() {
  const state = game.manager.getRenderState() || getPreviewState();
  const cssSize = Math.floor(els.canvas.getBoundingClientRect().width || 360);
  const dpr = window.devicePixelRatio || 1;

  els.canvas.width = Math.floor(cssSize * dpr);
  els.canvas.height = Math.floor(cssSize * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(0, 0, cssSize, cssSize);

  const cell = cssSize / GRID_SIZE;

  drawGrid(cssSize, cell);
  drawObstacles(state, cell);
  drawRabbits(state, cell);
  drawStag(state.stag, cell);
  drawPlayers(state, cell);
}

function drawGrid(size, cell) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let index = 0; index <= GRID_SIZE; index += 1) {
    const position = index * cell;
    ctx.beginPath();
    ctx.moveTo(0, position);
    ctx.lineTo(size, position);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, size);
    ctx.stroke();
  }
}

function drawObstacles(state, cell) {
  ctx.fillStyle = COLORS.obstacle;
  for (const [row, col] of state.obstacles || []) {
    roundRect(col * cell + 2, row * cell + 2, cell - 4, cell - 4, Math.max(3, cell * 0.08));
    ctx.fill();
  }
}

function drawRabbits(state, cell) {
  for (const rabbit of state.rabbits || []) {
    if (!rabbit) continue;
    const [row, col] = rabbit;
    const size = cell * 0.44;
    const x = col * cell + (cell - size) / 2;
    const y = row * cell + (cell - size) / 2;
    ctx.fillStyle = COLORS.rabbit;
    roundRect(x, y, size, size, Math.max(2, size * 0.12));
    ctx.fill();
    drawCenteredText('R', col * cell + cell / 2, row * cell + cell / 2, cell * 0.24, '#ffffff');
  }
}

function drawStag(stag, cell) {
  if (!stag) return;
  const [row, col] = stag;
  const cx = col * cell + cell / 2;
  const cy = row * cell + cell / 2;
  const size = cell * 0.31;

  ctx.save();
  ctx.fillStyle = COLORS.stag;
  ctx.strokeStyle = COLORS.stagStroke;
  ctx.lineWidth = Math.max(2, cell * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx - size * 0.9, cy + size * 0.78);
  ctx.lineTo(cx + size * 0.9, cy + size * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlayers(state, cell) {
  const players = [
    ['player1', state.player1, COLORS.p1, '1'],
    ['player2', state.player2, COLORS.p2, '2'],
  ].filter(([, pos]) => Array.isArray(pos));

  const byCell = new Map();
  for (const player of players) {
    const [, pos] = player;
    const key = `${pos[0]},${pos[1]}`;
    const group = byCell.get(key) || [];
    group.push(player);
    byCell.set(key, group);
  }

  for (const group of byCell.values()) {
    group.forEach(([id, pos, color, label], index) => {
      const offset = (index - (group.length - 1) / 2) * cell * 0.18;
      drawPlayer(id, pos, color, label, offset, cell, Boolean(state.signals?.[id]));
    });
  }
}

function drawPlayer(id, pos, color, label, offset, cell, signaled) {
  const [row, col] = pos;
  const cx = col * cell + cell / 2 + offset;
  const cy = row * cell + cell / 2;
  const radius = cell * 0.31;
  const isActive = game.active && game.currentActor === id && !game.locked;

  if (isActive) {
    ctx.strokeStyle = COLORS.active;
    ctx.lineWidth = Math.max(3, cell * 0.055);
    ctx.beginPath();
    ctx.arc(cx, cy, radius + cell * 0.12, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(23,32,51,0.28)';
  ctx.lineWidth = Math.max(1, cell * 0.025);
  ctx.stroke();
  drawCenteredText(label, cx, cy, cell * 0.32, '#ffffff');

  if (signaled) {
    ctx.fillStyle = COLORS.signal;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, cell * 0.025);
    const size = cell * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius - size * 0.2);
    ctx.lineTo(cx - size, cy - radius + size * 1.5);
    ctx.lineTo(cx + size, cy - radius + size * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawCenteredText(text, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `850 ${Math.max(10, size)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

els.startBtn.addEventListener('click', startGame);
els.restartBtn.addEventListener('click', startGame);

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    if (game.active) return;
    game.mode = button.dataset.mode;
    render();
  });
});

document.querySelectorAll('[data-condition]').forEach(button => {
  button.addEventListener('click', () => {
    if (game.active) return;
    game.condition = button.dataset.condition;
    render();
  });
});

els.controls.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    submitAction(button.dataset.action);
  });
});

document.addEventListener('keydown', event => {
  const keyMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
    Space: 'signal',
  };
  const action = keyMap[event.code];
  if (!action) return;
  event.preventDefault();
  submitAction(action);
});

window.addEventListener('resize', render);
window.visualViewport?.addEventListener('resize', render);
render();
