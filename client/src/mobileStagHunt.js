import { CONFIG } from './config/gameConfig.js';
import { GameStateManager } from './game/GameStateManager.js';
import { GameHelpers } from './utils/GameHelpers.js';

const GRID_SIZE = CONFIG.game.matrixSize;
const TOTAL_ROUNDS = 3;
const MAX_PLAYER_STEPS = 20;
const ONLINE_MATCHING_STAGE_MS = 10000;
const MATCHING_TEXT = 'Matching your partner...';
const MATCH_READY_TEXT = "Partner found! Let's play.";
const MATCH_READY_ACTION_TEXT = 'Ready to start';
const MATCH_WAITING_TEXT = 'Waiting for your partner to be ready';
const PARTICIPANT_CONDITIONS = {
  human: 'Condition A',
  bot: 'Condition B',
};

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
  matchingPanel: document.getElementById('matching-panel'),
  matchingStatus: document.getElementById('matching-status'),
  matchingCondition: document.getElementById('matching-condition'),
  matchingDemoCanvas: document.getElementById('matching-demo-canvas'),
  matchStartBtn: document.getElementById('match-start-btn'),
  roundFeedback: document.getElementById('round-feedback'),
  roundFeedbackLabel: document.getElementById('round-feedback-label'),
  roundFeedbackTitle: document.getElementById('round-feedback-title'),
  roundFeedbackMessage: document.getElementById('round-feedback-message'),
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
const demoCtx = els.matchingDemoCanvas.getContext('2d');

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
    mode: 'online',
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
    online: {
      socket: null,
      type: null,
      matchSessionId: getMatchSessionId(),
      conditionCode: null,
      matchingStartedAt: null,
      matchingSequence: 0,
      matchingStage: 'idle',
      localReady: false,
      remoteReady: false,
      roomId: null,
      localPlayer: 'player1',
      remotePlayer: 'player2',
      localParticipantLabel: null,
      remoteParticipantLabel: null,
      waiting: false,
      pendingActions: [],
    },
  };
}

function getMatchSessionId() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session') || params.get('class') || 'default';
  const safe = String(sessionId)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return safe || 'default';
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

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
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

function closeOnlineSocket() {
  const socket = game.online?.socket;
  if (!socket) return;

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

function getPlayerStepCounts() {
  const events = game.manager.roundData?.events || [];
  return events.reduce((counts, event) => {
    if (event.agent === 'player1' || event.agent === 'player2') counts[event.agent] += 1;
    return counts;
  }, { player1: 0, player2: 0 });
}

function areAllRoundsResolved() {
  return game.rounds.length >= TOTAL_ROUNDS;
}

function isRunInProgress() {
  return Boolean(game.startedAt && !game.completedAt);
}

function isOnlineLobbyActive() {
  return game.online.matchingStage !== 'idle'
    && !isRunInProgress()
    && !game.completedAt;
}

function syncLayoutMode() {
  const playing = isRunInProgress();
  const lobby = isOnlineLobbyActive();
  const complete = Boolean(game.completedAt);
  els.app.classList.toggle('is-playing', playing);
  els.app.classList.toggle('is-lobby', lobby);
  els.app.classList.toggle('is-complete', complete);
  document.body.classList.toggle('is-playing', playing);
  document.body.classList.toggle('is-lobby', lobby);
  document.body.classList.toggle('is-complete', complete);
  els.setupPanel.hidden = playing || lobby || complete;
  els.matchingPanel.hidden = !lobby;
}

function beginOnlineMatching() {
  clearTimers();
  closeOnlineSocket();
  hideRoundFeedback();
  game = createSession();
  game.mode = 'online';
  game.condition = CONFIG.game.defaultCondition;
  game.active = false;
  game.locked = true;
  game.online.matchingStartedAt = Date.now();
  game.online.matchingSequence += 1;
  game.online.matchingStage = 'matching';
  els.resultPanel.hidden = true;
  els.saveStatus.textContent = '';
  window.scrollTo(0, 0);
  setMatchingMessage(MATCHING_TEXT);
  setStatus(MATCHING_TEXT);
  render();
  connectOnlineMatch();
}

function startGame() {
  if (game.mode === 'online') {
    beginOnlineMatching();
    return;
  }

  clearTimers();
  closeOnlineSocket();
  const mode = game.mode;
  const condition = game.condition;
  game = createSession();
  game.mode = mode;
  game.condition = condition;
  els.resultPanel.hidden = true;
  els.saveStatus.textContent = '';
  window.scrollTo(0, 0);
  startPreparedGame();
}

function startPreparedGame() {
  game.active = true;
  game.locked = false;
  game.startedAt = new Date().toISOString();
  game.currentRoundIndex = 0;
  game.lastOutcome = null;
  game.online.matchingStage = 'idle';
  startRound(0);
}

function startRound(roundIndex) {
  hideRoundFeedback();
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

function getOnlineSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function connectOnlineMatch() {
  let socket;
  try {
    socket = new WebSocket(getOnlineSocketUrl());
  } catch {
    fallbackOnlineToBot('connection-error');
    return;
  }

  game.online.socket = socket;
  game.online.waiting = true;

  socket.onopen = () => {
    sendSocketMessage({
      type: 'join-mobile-stag-hunt',
      runId: game.runId,
      sessionId: game.online.matchSessionId,
    });
  };

  socket.onmessage = event => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleOnlineMessage(message);
  };

  socket.onerror = () => {
    if (!game.manager.state) fallbackOnlineToBot('connection-error');
  };

  socket.onclose = () => {
    if (game.completedAt || areAllRoundsResolved()) return;
    if (game.online.type === 'human') {
      fallbackOnlineToBot('opponent-left');
    } else if (!game.manager.state) {
      fallbackOnlineToBot('connection-closed');
    }
  };
}

function handleOnlineMessage(message) {
  if (message.type === 'waiting-for-human') {
    game.online.matchSessionId = message.sessionId || game.online.matchSessionId;
    game.online.waiting = true;
    setMatchingMessage(MATCHING_TEXT);
    setStatus(MATCHING_TEXT);
    render();
    return;
  }

  if (message.type === 'human-match') {
    game.mode = 'online';
    game.condition = message.condition || 'baseline';
    game.online.type = 'human';
    game.online.matchSessionId = message.sessionId || game.online.matchSessionId;
    game.online.roomId = message.roomId;
    game.online.localPlayer = message.localPlayer;
    game.online.remotePlayer = message.remotePlayer;
    game.online.localParticipantLabel = message.localParticipantLabel || null;
    game.online.remoteParticipantLabel = message.remoteParticipantLabel || null;
    game.online.waiting = false;
    finishOnlineMatching(PARTICIPANT_CONDITIONS.human);
    return;
  }

  if (message.type === 'bot-match') {
    game.online.matchSessionId = message.sessionId || game.online.matchSessionId;
    fallbackOnlineToBot(message.reason || 'assigned-bot');
    return;
  }

  if (message.type === 'opponent-action') {
    if (message.roomId !== game.online.roomId) return;
    if (!game.manager.state || message.player !== game.currentActor) {
      game.online.pendingActions.push(message);
      return;
    }
    applyPlayerAction(message.player, message.action, false, { remote: true });
    return;
  }

  if (message.type === 'opponent-left') {
    if (areAllRoundsResolved()) {
      closeOnlineSocket();
      return;
    }
    fallbackOnlineToBot('opponent-left');
    return;
  }

  if (message.type === 'ready-status') {
    if (message.roomId !== game.online.roomId) return;
    game.online.remoteReady = Boolean(message.remoteReady);
    return;
  }

  if (message.type === 'start-game') {
    if (message.roomId !== game.online.roomId) return;
    startPreparedGame();
  }
}

function fallbackOnlineToBot(reason) {
  const needsRoundStart = !game.manager.state;
  game.mode = 'solo';
  game.condition = 'baseline';
  game.online.type = 'bot';
  game.online.matchSessionId = game.online.matchSessionId || getMatchSessionId();
  game.online.roomId = null;
  game.online.localPlayer = 'player1';
  game.online.remotePlayer = 'player2';
  game.online.localParticipantLabel = null;
  game.online.remoteParticipantLabel = null;
  game.online.waiting = false;

  if (needsRoundStart) {
    game.online.matchingSequence += 1;
    finishOnlineMatching(PARTICIPANT_CONDITIONS.bot);
    return;
  }

  assignParticipantCondition(PARTICIPANT_CONDITIONS.bot);
  setStatus('Session ready: Player 1');
  render();
  if (game.active && game.currentActor === 'player2') {
    setTimer(runPartnerBotTurn, CONFIG.game.timing.llmActionDelay);
  }
}

function finishOnlineMatching(conditionCode) {
  const startedAt = game.online.matchingStartedAt || Date.now();
  const elapsed = Date.now() - startedAt;
  const delay = Math.max(0, ONLINE_MATCHING_STAGE_MS - elapsed);
  const sequence = game.online.matchingSequence;

  setTimer(() => {
    if (sequence !== game.online.matchingSequence || game.completedAt || game.manager.state) return;
    assignParticipantCondition(conditionCode);
    game.online.matchingStage = 'ready';
    game.online.localReady = false;
    game.online.remoteReady = false;
    setMatchingMessage(MATCH_READY_TEXT);
    setStatus(MATCH_READY_TEXT);
    render();
  }, delay);
}

function assignParticipantCondition(conditionCode) {
  if (!game.online.conditionCode) {
    game.online.conditionCode = conditionCode;
  }
  return game.online.conditionCode;
}

function setMatchingMessage(text) {
  els.matchingStatus.textContent = text;
  els.matchStartBtn.textContent = text;
  const conditionCode = game.online.conditionCode;
  els.matchingCondition.textContent = getConditionBadgeText(conditionCode);
  els.matchingCondition.hidden = !conditionCode;
}

function requestMatchedStart() {
  if (game.online.matchingStage !== 'ready') return;

  if (game.online.type === 'human') {
    const readySent = sendSocketMessage({
      type: 'mobile-ready',
      roomId: game.online.roomId,
    });
    if (!readySent) {
      fallbackOnlineToBot('connection-closed');
      return;
    }

    game.online.localReady = true;
    game.online.matchingStage = 'waiting';
    setMatchingMessage(MATCH_WAITING_TEXT);
    setStatus(MATCH_WAITING_TEXT);
    render();
    return;
  }

  startPreparedGame();
}

function sendSocketMessage(message) {
  const socket = game.online?.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function sendOnlineAction(player, action) {
  if (game.online.type !== 'human') return;
  sendSocketMessage({
    type: 'mobile-action',
    roomId: game.online.roomId,
    player,
    action,
  });
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

  if (game.mode === 'online' && game.online.localPlayer !== player) {
    game.locked = true;
    setStatus(`Waiting for ${player === 'player1' ? 'Player 1' : 'Player 2'}`);
    render();
    drainPendingOnlineActions();
    return;
  }

  game.locked = false;
  setStatus(game.mode === 'online' ? `Your turn (${getPlayerName(player)})` : `${getPlayerName(player)} turn`);
  render();
}

function drainPendingOnlineActions() {
  if (game.mode !== 'online' || !game.online.pendingActions.length) return;

  const actionIndex = game.online.pendingActions.findIndex(message => (
    message.roomId === game.online.roomId && message.player === game.currentActor
  ));
  if (actionIndex < 0) return;

  const [message] = game.online.pendingActions.splice(actionIndex, 1);
  applyPlayerAction(message.player, message.action, false, { remote: true });
}

function runPartnerBotTurn() {
  if (!game.active || game.currentActor !== 'player2') return;
  const action = choosePartnerAction();
  applyPlayerAction('player2', action, true);
}

function submitAction(actionName) {
  if (!game.active || game.locked) return;
  if (game.currentActor !== 'player1' && game.currentActor !== 'player2') return;
  if (!isHumanControlledActor(game.currentActor)) return;

  if (actionName === 'signal') {
    if (!CONFIG.game.conditions[game.condition]?.signalEnabled) return;
    applyPlayerAction(game.currentActor, { type: 'signal' }, false, { broadcast: game.mode === 'online' });
    return;
  }

  const movement = ACTIONS[actionName];
  if (!movement) return;
  applyPlayerAction(game.currentActor, movement, false, { broadcast: game.mode === 'online' });
}

function applyPlayerAction(player, action, automated, options = {}) {
  if (!game.active || game.currentActor !== player) return;

  const didAct = game.manager.movePlayer(player, action);
  if (!didAct) return;

  if (options.broadcast) {
    sendOnlineAction(player, action);
  }

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

  const completedAt = new Date().toISOString();
  const map = MAPS[game.currentRoundIndex % MAPS.length];
  game.manager.roundData.outcome = outcome;
  game.manager.roundData.completedAt = completedAt;
  game.manager.roundData.totalSteps = game.manager.stepCount;
  const rawRoundData = clonePlainData(game.manager.roundData);
  const movementData = createMovementData(rawRoundData);
  const roundRecord = {
    roundIndex: game.currentRoundIndex,
    roundNumber: game.currentRoundIndex + 1,
    mapId: map.name,
    map: clonePlainData(map),
    condition: game.condition,
    participantCondition: game.online.conditionCode,
    mode: game.mode,
    matchType: game.online.type,
    matchSessionId: game.online.matchSessionId,
    localPlayer: game.online.localPlayer,
    localParticipantLabel: game.online.localParticipantLabel,
    remoteParticipantLabel: game.online.remoteParticipantLabel,
    roomId: game.online.roomId,
    outcome,
    events: rawRoundData.events || [],
    movementData,
    roundData: rawRoundData,
    totalSteps: game.manager.stepCount,
    playerSteps: getPlayerStepCounts(),
    maxPlayerSteps: MAX_PLAYER_STEPS,
    scores: game.manager.getScores(),
    completedAt,
  };
  roundRecord.dyadicTrialData = createDyadicTrialData(roundRecord);

  game.rounds.push(roundRecord);
  game.manager.finalizeRound();
  void saveRoundData(roundRecord);
  game.lastOutcome = outcome;
  setStatus(getOutcomeText(outcome));
  showRoundFeedback(outcome);
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
  hideRoundFeedback();
  closeOnlineSocket();

  const scores = game.manager.getScores();
  const localPlayer = getLocalPlayer();
  const partnerPlayer = localPlayer === 'player1' ? 'player2' : 'player1';
  const partnerLine = getFinalPartnerLine();

  els.resultSummary.innerHTML = `
    <strong>Game complete.</strong>
    You earned ${formatScore(scores[localPlayer])} points.
    Your partner earned ${formatScore(scores[partnerPlayer])} points.
    ${partnerLine}
  `;
  els.resultPanel.hidden = false;
  setStatus('Game complete');
  render();

  const saveResult = await saveGame();
  game.saveResult = saveResult;
  els.saveStatus.textContent = '';
}

function getLocalPlayer() {
  if (game.mode === 'online' && game.online.localPlayer === 'player2') return 'player2';
  return 'player1';
}

function getFinalPartnerLine() {
  if (game.online.type === 'human') {
    const localLabel = game.online.localParticipantLabel || 'player';
    const remoteLabel = game.online.remoteParticipantLabel || 'player';
    return `You are ${localLabel}. Your partner is a human ${remoteLabel}!`;
  }

  if (game.mode === 'hotseat') {
    return 'Your partner was a human.';
  }

  return 'Your partner was an AI.';
}

function getOutcomeText(outcome) {
  const feedback = getRoundFeedback(outcome);
  return `${feedback.title} ${feedback.message}`;
}

function showRoundFeedback(outcome) {
  const feedback = getRoundFeedback(outcome);
  els.roundFeedbackLabel.textContent = `Round ${game.currentRoundIndex + 1} result`;
  els.roundFeedbackTitle.textContent = feedback.title;
  els.roundFeedbackMessage.textContent = feedback.message;
  els.roundFeedback.hidden = false;
}

function hideRoundFeedback() {
  if (!els.roundFeedback) return;
  els.roundFeedback.hidden = true;
}

function getRoundFeedback(outcome) {
  if (outcome.type === 'stag_captured') {
    return {
      title: 'Stag captured!',
      message: `You both got ${CONFIG.game.rewards.stagCapture} points.`,
    };
  }

  if (outcome.type === 'rabbit_captured_p1') {
    return getRabbitFeedback('player1');
  }

  if (outcome.type === 'rabbit_captured_p2') {
    return getRabbitFeedback('player2');
  }

  return {
    title: 'Round timed out.',
    message: 'No points this round.',
  };
}

function getRabbitFeedback(player) {
  let message;
  if (game.mode === 'online' && game.online.localPlayer === player) {
    message = `You got ${CONFIG.game.rewards.rabbitCapture} points.`;
  } else if (game.mode === 'online') {
    message = `Your partner got ${CONFIG.game.rewards.rabbitCapture} points.`;
  } else if (game.mode === 'solo' && player === 'player1') {
    message = `You got ${CONFIG.game.rewards.rabbitCapture} points.`;
  } else if (game.mode === 'solo') {
    message = `Your partner got ${CONFIG.game.rewards.rabbitCapture} points.`;
  } else {
    message = `${getPlayerName(player)} got ${CONFIG.game.rewards.rabbitCapture} points.`;
  }

  return {
    title: 'Rabbit captured!',
    message,
  };
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

function createMobileRoundPayload(roundRecord) {
  const roundNumber = roundRecord.roundNumber || roundRecord.roundIndex + 1;
  const exportedAt = new Date().toISOString();
  const localPlayer = game.online.localPlayer || 'player';
  const dyadicTrialData = roundRecord.dyadicTrialData || createDyadicTrialData(roundRecord);
  const fileName = [
    'cellPhoneStagHunt',
    sanitizeFilePart(game.runId),
    `round-${String(roundNumber).padStart(2, '0')}`,
    sanitizeFilePart(localPlayer),
    exportedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, ''),
  ].join('-') + '.json';

  return {
    fileName,
    runId: game.runId,
    stage: 'round-end',
    completed: false,
    phase: 'mobile-stag-hunt',
    exportedAt,
    roundIndex: roundRecord.roundIndex,
    roundNumber,
    condition: game.condition,
    conditionLabel: CONFIG.game.conditions[game.condition]?.label || game.condition,
    participantCondition: game.online.conditionCode,
    playerMode: getPlayerModeLabel(),
    matchSessionId: game.online.matchSessionId,
    localParticipantLabel: game.online.localParticipantLabel,
    remoteParticipantLabel: game.online.remoteParticipantLabel,
    localPlayer,
    roomId: game.online.roomId,
    matchType: game.online.type,
    dyadicTrialData,
    movementData: clonePlainData(roundRecord.movementData || []),
    round: clonePlainData(roundRecord),
    gameData: {
      gameType: 'DynamicStagHunt',
      gridSize: GRID_SIZE,
      totalRounds: TOTAL_ROUNDS,
      maxPlayerSteps: MAX_PLAYER_STEPS,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      roundsCompleted: game.rounds.length,
      rounds: clonePlainData(game.rounds),
      dyadicTrialData: clonePlainData(game.rounds.map(round => round.dyadicTrialData || createDyadicTrialData(round))),
      onlineMatch: {
        type: game.online.type,
        sessionId: game.online.matchSessionId,
        participantCondition: game.online.conditionCode,
        roomId: game.online.roomId,
        localPlayer,
        localParticipantLabel: game.online.localParticipantLabel,
        remoteParticipantLabel: game.online.remoteParticipantLabel,
      },
    },
  };
}

async function saveRoundData(roundRecord) {
  const payload = createMobileRoundPayload(roundRecord);
  localStorage.setItem(
    `cellPhoneStagHunt-${payload.runId}-round-${String(payload.roundNumber).padStart(2, '0')}-${payload.localPlayer}`,
    JSON.stringify(payload),
  );

  try {
    const response = await fetch('/api/save-mobile-round', {
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
    console.error('[mobile-stag-hunt] round save failed', error);
    return { ok: false, error: error.message };
  }
}

function sanitizeFilePart(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'unknown';
}

function createMovementData(roundData = {}) {
  const startTime = Number(roundData.startTime) || null;
  return (roundData.events || []).map((event, index) => ({
    stepIndex: index + 1,
    agent: event.agent,
    action: event.action,
    actionLabel: event.actionLabel,
    time: event.time,
    elapsedMs: startTime && event.time ? event.time - startTime : null,
    player1Position: event.positions?.player1 || null,
    player2Position: event.positions?.player2 || null,
    stagPosition: event.positions?.stag || null,
    player1Signal: Boolean(event.positions?.signals?.player1),
    player2Signal: Boolean(event.positions?.signals?.player2),
  }));
}

function createDyadicTrialData(roundRecord) {
  const movementData = Array.isArray(roundRecord.movementData) ? roundRecord.movementData : [];
  const outcome = roundRecord.outcome || {};
  const playerSteps = roundRecord.playerSteps || {};
  const scores = roundRecord.scores || {};
  const map = roundRecord.map || {};
  const actionHistory = movementData.map(row => ({
    step: row.stepIndex,
    agent: row.agent,
    action: row.actionLabel || row.action,
    actionVector: row.action,
    elapsedMs: row.elapsedMs,
  }));

  return {
    runId: game.runId,
    trialIndex: roundRecord.roundIndex,
    trialNumber: roundRecord.roundNumber,
    roundNumber: roundRecord.roundNumber,
    mapId: roundRecord.mapId,
    condition: roundRecord.condition,
    conditionLabel: CONFIG.game.conditions[roundRecord.condition]?.label || roundRecord.condition,
    participantCondition: roundRecord.participantCondition,
    matchType: roundRecord.matchType,
    playerMode: getPlayerModeLabel(),
    dyadId: roundRecord.roomId || roundRecord.matchSessionId || game.runId,
    roomId: roundRecord.roomId,
    matchSessionId: roundRecord.matchSessionId,
    localPlayer: roundRecord.localPlayer,
    localParticipantLabel: roundRecord.localParticipantLabel,
    remoteParticipantLabel: roundRecord.remoteParticipantLabel,
    player1StartPosition: map.player1Start || null,
    player2StartPosition: map.player2Start || null,
    stagStartPosition: map.stagStart || null,
    rabbitPositions: map.rabbits || [],
    wallPositions: map.obstacles || [],
    outcomeType: outcome.type || null,
    outcomeReward: outcome.reward ?? 0,
    rabbitIndex: outcome.rabbitIndex ?? null,
    totalSteps: roundRecord.totalSteps,
    player1Steps: playerSteps.player1 ?? null,
    player2Steps: playerSteps.player2 ?? null,
    maxPlayerSteps: roundRecord.maxPlayerSteps,
    player1Score: scores.player1 ?? null,
    player2Score: scores.player2 ?? null,
    completedAt: roundRecord.completedAt,
    actionHistory,
    player1Actions: movementData.filter(row => row.agent === 'player1').map(row => row.actionLabel || row.action),
    player2Actions: movementData.filter(row => row.agent === 'player2').map(row => row.actionLabel || row.action),
    stagActions: movementData.filter(row => row.agent === 'stag').map(row => row.actionLabel || row.action),
    player1Trajectory: movementData.map(row => row.player1Position),
    player2Trajectory: movementData.map(row => row.player2Position),
    stagTrajectory: movementData.map(row => row.stagPosition),
    player1Signals: movementData.map(row => row.player1Signal),
    player2Signals: movementData.map(row => row.player2Signal),
  };
}

async function saveGame() {
  const payload = {
    runId: game.runId,
    stage: 'complete',
    completed: true,
    phase: 'mobile-stag-hunt',
    condition: game.condition,
    conditionLabel: CONFIG.game.conditions[game.condition]?.label || game.condition,
    participantCondition: game.online.conditionCode,
    playerMode: getPlayerModeLabel(),
    matchSessionId: game.online.matchSessionId,
    localParticipantLabel: game.online.localParticipantLabel,
    remoteParticipantLabel: game.online.remoteParticipantLabel,
    exportedAt: new Date().toISOString(),
    gameData: {
      gameType: 'DynamicStagHunt',
      gridSize: GRID_SIZE,
      totalRounds: TOTAL_ROUNDS,
      maxPlayerSteps: MAX_PLAYER_STEPS,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      rounds: game.rounds,
      dyadicTrialData: clonePlainData(game.rounds.map(round => round.dyadicTrialData || createDyadicTrialData(round))),
      onlineMatch: {
        type: game.online.type,
        sessionId: game.online.matchSessionId,
        participantCondition: game.online.conditionCode,
        roomId: game.online.roomId,
        localPlayer: game.online.localPlayer,
        localParticipantLabel: game.online.localParticipantLabel,
        remoteParticipantLabel: game.online.remoteParticipantLabel,
      },
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
  const conditionCode = game.online?.conditionCode;
  els.matchingCondition.textContent = getConditionBadgeText(conditionCode);
  els.matchingCondition.hidden = !conditionCode || Boolean(game.completedAt);
}

function getConditionBadgeText(conditionCode) {
  if (conditionCode === PARTICIPANT_CONDITIONS.human) return 'A';
  if (conditionCode === PARTICIPANT_CONDITIONS.bot) return 'B';
  return '';
}

function render() {
  updateLabels();
  syncLayoutMode();
  updateControls();
  fitActiveLayout();
  renderBoard();
  renderMatchingDemo();
}

function updateLabels() {
  const scores = game.manager.getScores();
  const roundNumber = game.active || game.rounds.length < TOTAL_ROUNDS
    ? Math.min(game.currentRoundIndex + 1, TOTAL_ROUNDS)
    : TOTAL_ROUNDS;
  const playerSteps = getPlayerStepCounts();

  els.roundLabel.textContent = `Round ${roundNumber} / ${TOTAL_ROUNDS}`;
  els.stepLabel.textContent = `Moves ${playerSteps.player1}-${playerSteps.player2} / ${MAX_PLAYER_STEPS}`;
  els.p1Score.textContent = `P1 score: ${formatScore(scores.player1)}`;
  els.p2Score.textContent = `P2 score: ${formatScore(scores.player2)}`;

  const lockedForLobby = isOnlineLobbyActive();
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === game.mode));
    button.disabled = game.active || lockedForLobby;
  });

  document.querySelectorAll('[data-condition]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.condition === game.condition));
    button.disabled = game.active || lockedForLobby;
  });
}

function updateControls() {
  const humanTurn = game.active
    && !game.locked
    && isHumanControlledActor(game.currentActor);
  const signalEnabled = CONFIG.game.conditions[game.condition]?.signalEnabled;

  els.controls.querySelectorAll('[data-action]').forEach(button => {
    if (button.dataset.action === 'signal') {
      button.hidden = !signalEnabled;
      button.disabled = !humanTurn || !signalEnabled;
      return;
    }
    button.disabled = !humanTurn;
  });

  const canStartMatchedSession = game.online.matchingStage === 'ready';
  const lobbyActive = isOnlineLobbyActive();
  els.matchStartBtn.hidden = !lobbyActive;
  els.matchStartBtn.disabled = !canStartMatchedSession;
  els.matchStartBtn.classList.toggle('is-status', !canStartMatchedSession);
  els.matchStartBtn.textContent = getMatchStartButtonText();
  els.startBtn.textContent = game.rounds.length || game.active ? 'Restart' : 'Start';
}

function getMatchStartButtonText() {
  if (game.online.matchingStage === 'ready') return MATCH_READY_ACTION_TEXT;
  if (game.online.matchingStage === 'waiting') return MATCH_WAITING_TEXT;
  if (game.online.matchingStage === 'matching') return MATCHING_TEXT;
  return MATCHING_TEXT;
}

function isHumanControlledActor(player) {
  if (player !== 'player1' && player !== 'player2') return false;
  if (game.mode === 'hotseat') return true;
  if (game.mode === 'solo') return player === 'player1';
  if (game.mode === 'online') return game.online.type === 'human' && game.online.localPlayer === player;
  return false;
}

function getPlayerModeLabel() {
  if (game.online.type === 'human') return `online-human-${game.online.localPlayer}`;
  if (game.online.type === 'bot') return 'online-assigned-bot';
  if (game.mode === 'solo') return 'human-scripted-partner';
  if (game.mode === 'hotseat') return 'local-hotseat';
  return game.mode;
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

function renderMatchingDemo() {
  const cssSize = Math.floor(els.matchingDemoCanvas.getBoundingClientRect().width || 220);
  const dpr = window.devicePixelRatio || 1;
  const state = getPreviewState();

  els.matchingDemoCanvas.width = Math.floor(cssSize * dpr);
  els.matchingDemoCanvas.height = Math.floor(cssSize * dpr);
  demoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  demoCtx.clearRect(0, 0, cssSize, cssSize);
  demoCtx.fillStyle = COLORS.board;
  demoCtx.fillRect(0, 0, cssSize, cssSize);

  const cell = cssSize / GRID_SIZE;
  drawDemoGrid(cssSize, cell);
  drawDemoObstacles(state, cell);
  drawDemoRabbits(state, cell);
  drawDemoStag(state.stag, cell);
  drawDemoPlayer(state.player1, COLORS.p1, '1', cell);
  drawDemoPlayer(state.player2, COLORS.p2, '2', cell);
}

function drawDemoGrid(size, cell) {
  demoCtx.strokeStyle = COLORS.grid;
  demoCtx.lineWidth = 1;
  for (let index = 0; index <= GRID_SIZE; index += 1) {
    const position = index * cell;
    demoCtx.beginPath();
    demoCtx.moveTo(0, position);
    demoCtx.lineTo(size, position);
    demoCtx.stroke();
    demoCtx.beginPath();
    demoCtx.moveTo(position, 0);
    demoCtx.lineTo(position, size);
    demoCtx.stroke();
  }
}

function drawDemoObstacles(state, cell) {
  demoCtx.fillStyle = COLORS.obstacle;
  for (const [row, col] of state.obstacles || []) {
    roundRectOn(demoCtx, col * cell + 2, row * cell + 2, cell - 4, cell - 4, Math.max(3, cell * 0.08));
    demoCtx.fill();
  }
}

function drawDemoRabbits(state, cell) {
  for (const rabbit of state.rabbits || []) {
    if (!rabbit) continue;
    const [row, col] = rabbit;
    const size = cell * 0.44;
    const x = col * cell + (cell - size) / 2;
    const y = row * cell + (cell - size) / 2;
    demoCtx.fillStyle = COLORS.rabbit;
    roundRectOn(demoCtx, x, y, size, size, Math.max(2, size * 0.12));
    demoCtx.fill();
  }
}

function drawDemoStag(stag, cell) {
  const [row, col] = stag;
  const cx = col * cell + cell / 2;
  const cy = row * cell + cell / 2;
  const size = cell * 0.31;

  demoCtx.save();
  demoCtx.fillStyle = COLORS.stag;
  demoCtx.strokeStyle = COLORS.stagStroke;
  demoCtx.lineWidth = Math.max(2, cell * 0.035);
  demoCtx.beginPath();
  demoCtx.moveTo(cx, cy - size);
  demoCtx.lineTo(cx - size * 0.9, cy + size * 0.78);
  demoCtx.lineTo(cx + size * 0.9, cy + size * 0.78);
  demoCtx.closePath();
  demoCtx.fill();
  demoCtx.stroke();
  demoCtx.restore();
}

function drawDemoPlayer(pos, color, label, cell) {
  const [row, col] = pos;
  const cx = col * cell + cell / 2;
  const cy = row * cell + cell / 2;
  const radius = cell * 0.31;

  demoCtx.fillStyle = color;
  demoCtx.beginPath();
  demoCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  demoCtx.fill();
  demoCtx.strokeStyle = 'rgba(23,32,51,0.28)';
  demoCtx.lineWidth = Math.max(1, cell * 0.025);
  demoCtx.stroke();
  drawCenteredTextOn(demoCtx, label, cx, cy, cell * 0.32, '#ffffff');
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
  drawCenteredTextOn(ctx, text, x, y, size, color);
}

function drawCenteredTextOn(context, text, x, y, size, color) {
  context.save();
  context.fillStyle = color;
  context.font = `850 ${Math.max(10, size)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, x, y);
  context.restore();
}

function roundRect(x, y, width, height, radius) {
  roundRectOn(ctx, x, y, width, height, radius);
}

function roundRectOn(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

els.startBtn.addEventListener('click', startGame);
els.matchStartBtn.addEventListener('click', requestMatchedStart);
els.restartBtn.addEventListener('click', beginOnlineMatching);

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    if (game.active || isOnlineLobbyActive()) return;
    game.mode = button.dataset.mode;
    render();
  });
});

document.querySelectorAll('[data-condition]').forEach(button => {
  button.addEventListener('click', () => {
    if (game.active || isOnlineLobbyActive()) return;
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
beginOnlineMatching();
