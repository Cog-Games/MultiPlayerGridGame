const GRID_SIZE = 9;
const TOTAL_ROUNDS = 4;
const MAX_STEPS = 40;

const COLORS = {
  background: '#f9fafb',
  grid: '#d1d5db',
  you: '#06b6d4',
  partner: '#f97316',
  goal: '#2563eb',
  newGoal: '#22c55e',
  text: '#111827',
  finishRing: '#16a34a',
};

const MAPS = [
  {
    id: 'mobile-2p3g-01',
    playerStart: [8, 0],
    partnerStart: [8, 8],
    goals: [[1, 1], [1, 7]],
    newGoal: [4, 4],
  },
  {
    id: 'mobile-2p3g-02',
    playerStart: [0, 0],
    partnerStart: [8, 0],
    goals: [[2, 7], [7, 7]],
    newGoal: [4, 4],
  },
  {
    id: 'mobile-2p3g-03',
    playerStart: [8, 4],
    partnerStart: [0, 4],
    goals: [[4, 1], [4, 7]],
    newGoal: [2, 2],
  },
  {
    id: 'mobile-2p3g-04',
    playerStart: [0, 8],
    partnerStart: [8, 8],
    goals: [[1, 1], [7, 1]],
    newGoal: [4, 5],
  },
];

const ACTIONS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const KEY_TO_ACTION = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const els = {
  intro: document.getElementById('intro-screen'),
  startBtn: document.getElementById('start-btn'),
  game: document.getElementById('game-screen'),
  controls: document.getElementById('touch-controls'),
  roundLabel: document.getElementById('round-label'),
  stepLabel: document.getElementById('step-label'),
  scoreLabel: document.getElementById('score-label'),
  status: document.getElementById('status'),
  canvas: document.getElementById('game-canvas'),
  feedback: document.getElementById('feedback'),
  survey: document.getElementById('survey-screen'),
  surveyForm: document.getElementById('survey-form'),
  done: document.getElementById('done-screen'),
  saveStatus: document.getElementById('save-status'),
};

const ctx = els.canvas.getContext('2d');

let game = createInitialGame();

function createInitialGame() {
  return {
    runId: `mobile-2p3g-${new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '')}-${Math.random().toString(36).slice(2, 7)}`,
    currentRoundIndex: 0,
    successCount: 0,
    active: false,
    current: null,
    rounds: [],
    startedAt: null,
    completedAt: null,
  };
}

function clonePos(pos) {
  return [pos[0], pos[1]];
}

function samePos(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function clampToGrid(value) {
  return Math.max(0, Math.min(GRID_SIZE - 1, value));
}

function applyAction(pos, action) {
  const delta = ACTIONS[action];
  if (!delta) return clonePos(pos);
  return [clampToGrid(pos[0] + delta[0]), clampToGrid(pos[1] + delta[1])];
}

function getGoalReached(pos, goals) {
  for (let i = 0; i < goals.length; i += 1) {
    if (samePos(pos, goals[i])) return i;
  }
  return null;
}

function inferInitialGoal(from, to, goals) {
  let bestGoal = null;
  let bestDistance = Infinity;
  goals.slice(0, 2).forEach((goal, index) => {
    const before = manhattan(from, goal);
    const after = manhattan(to, goal);
    if (after < before && after < bestDistance) {
      bestGoal = index;
      bestDistance = after;
    }
  });
  return bestGoal;
}

function greedyActionToward(from, target) {
  const options = Object.entries(ACTIONS)
    .map(([name]) => {
      const to = applyAction(from, name);
      return { name, to, distance: manhattan(to, target) };
    })
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return options[0].name;
}

function currentRound() {
  return game.current;
}

function startGame() {
  game = createInitialGame();
  game.startedAt = new Date().toISOString();
  els.intro.hidden = true;
  els.game.hidden = false;
  els.controls.hidden = false;
  startRound(0);
}

function startRound(roundIndex) {
  const map = MAPS[roundIndex % MAPS.length];
  game.currentRoundIndex = roundIndex;
  game.active = true;
  game.current = {
    roundIndex,
    mapId: map.id,
    map,
    player: clonePos(map.playerStart),
    partner: clonePos(map.partnerStart),
    goals: map.goals.map(clonePos),
    newGoal: clonePos(map.newGoal),
    newGoalPresented: false,
    stepCount: 0,
    playerFinished: false,
    partnerFinished: false,
    playerGoal: null,
    partnerGoal: null,
    playerFirstIntendedGoal: null,
    partnerFirstIntendedGoal: null,
    partnerTargetGoal: null,
    startedAt: new Date().toISOString(),
    moves: [],
    events: [],
  };
  setFeedback('', '');
  setStatus('Use the arrows to move your cyan player. Your partner moves after you.');
  render();
}

function setStatus(text) {
  els.status.textContent = text;
}

function setFeedback(text, className = '') {
  els.feedback.textContent = text;
  els.feedback.className = className;
}

function updateControls() {
  const enabled = Boolean(game.active && currentRound() && !currentRound().playerFinished);
  document.querySelectorAll('[data-action]').forEach(button => {
    button.disabled = !enabled;
  });
}

function submitHumanMove(action) {
  const round = currentRound();
  if (!game.active || !round || round.playerFinished || !ACTIONS[action]) return;

  const from = clonePos(round.player);
  const to = applyAction(round.player, action);
  if (samePos(from, to)) return;

  round.player = to;
  round.stepCount += 1;
  const intended = inferInitialGoal(from, to, round.goals);
  if (round.playerFirstIntendedGoal === null && intended !== null) {
    round.playerFirstIntendedGoal = intended;
    if (round.partnerTargetGoal === null) round.partnerTargetGoal = intended;
    round.events.push({ type: 'player_intention_inferred', intendedGoal: intended, step: round.stepCount, timestamp: Date.now() });
  }

  round.moves.push({ actor: 'player', action, from, to: clonePos(to), intendedInitialGoal: intended, step: round.stepCount, timestamp: Date.now() });
  updateReachedGoal('player');
  revealNewGoalIfNeeded();
  render();

  if (checkRoundEnd()) return;

  window.setTimeout(() => {
    movePartner();
    if (!checkRoundEnd()) render();
  }, 170);
}

function updateReachedGoal(actor) {
  const round = currentRound();
  const position = actor === 'player' ? round.player : round.partner;
  const goalIndex = getGoalReached(position, round.goals);
  if (goalIndex === null) return;

  if (actor === 'player' && !round.playerFinished) {
    round.playerFinished = true;
    round.playerGoal = goalIndex;
    round.events.push({ type: 'goal_reached', actor, goalIndex, step: round.stepCount, timestamp: Date.now() });
    setStatus('You reached a goal. Waiting for your partner.');
  }
  if (actor === 'partner' && !round.partnerFinished) {
    round.partnerFinished = true;
    round.partnerGoal = goalIndex;
    round.events.push({ type: 'goal_reached', actor, goalIndex, step: round.stepCount, timestamp: Date.now() });
  }
}

function movePartner() {
  const round = currentRound();
  if (!game.active || !round || round.partnerFinished) return;

  if (round.partnerTargetGoal === null) {
    round.partnerTargetGoal = nearestInitialGoal(round.partner, round.goals);
  }

  const target = round.goals[round.partnerTargetGoal] || round.goals[0];
  const action = greedyActionToward(round.partner, target);
  const from = clonePos(round.partner);
  const to = applyAction(round.partner, action);
  round.partner = to;
  round.stepCount += 1;

  const intended = inferInitialGoal(from, to, round.goals);
  if (round.partnerFirstIntendedGoal === null && intended !== null) {
    round.partnerFirstIntendedGoal = intended;
    round.events.push({ type: 'partner_intention_inferred', intendedGoal: intended, step: round.stepCount, timestamp: Date.now() });
  }

  round.moves.push({ actor: 'partner', action, from, to: clonePos(to), intendedInitialGoal: intended, step: round.stepCount, timestamp: Date.now() });
  updateReachedGoal('partner');
  revealNewGoalIfNeeded();
}

function nearestInitialGoal(pos, goals) {
  return manhattan(pos, goals[0]) <= manhattan(pos, goals[1]) ? 0 : 1;
}

function revealNewGoalIfNeeded() {
  const round = currentRound();
  if (!round || round.newGoalPresented) return;
  if (round.playerFirstIntendedGoal === null || round.partnerFirstIntendedGoal === null) return;
  if (round.playerFirstIntendedGoal !== round.partnerFirstIntendedGoal) return;

  round.goals.push(clonePos(round.newGoal));
  round.newGoalPresented = true;
  round.events.push({ type: 'new_goal_presented', newGoal: clonePos(round.newGoal), sharedInitialGoal: round.playerFirstIntendedGoal, step: round.stepCount, timestamp: Date.now() });
  setFeedback('A new green goal appeared.', 'info');
  window.setTimeout(() => setFeedback('', ''), 1100);
}

function checkRoundEnd() {
  const round = currentRound();
  if (!round) return true;

  if (round.stepCount >= MAX_STEPS && (!round.playerFinished || !round.partnerFinished)) {
    if (!round.playerFinished) round.playerGoal = null;
    if (!round.partnerFinished) round.partnerGoal = null;
    completeRound('timeout');
    return true;
  }

  if (round.playerFinished && round.partnerFinished) {
    completeRound('completed');
    return true;
  }

  return false;
}

function completeRound(reason) {
  const round = currentRound();
  if (!round) return;
  game.active = false;
  const success = round.playerGoal !== null && round.playerGoal === round.partnerGoal;
  if (success) game.successCount += 1;

  const record = {
    roundIndex: round.roundIndex,
    mapId: round.mapId,
    reason,
    success,
    playerGoal: round.playerGoal,
    partnerGoal: round.partnerGoal,
    newGoalPresented: round.newGoalPresented,
    stepCount: round.stepCount,
    startedAt: round.startedAt,
    completedAt: new Date().toISOString(),
    moves: round.moves,
    events: round.events,
  };
  game.rounds.push(record);

  setFeedback(success ? 'Success: you reached the same goal.' : 'This round ended with different goals.', success ? 'good' : 'warn');
  setStatus(round.roundIndex + 1 < TOTAL_ROUNDS ? 'Next round starts automatically.' : 'Game complete. Please answer the questions.');
  render();

  window.setTimeout(() => {
    if (round.roundIndex + 1 < TOTAL_ROUNDS) {
      startRound(round.roundIndex + 1);
    } else {
      showSurvey();
    }
  }, 1300);
}

function showSurvey() {
  game.completedAt = new Date().toISOString();
  els.controls.hidden = true;
  els.survey.hidden = false;
  updateControls();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function getExportPayload(surveyResponses = null) {
  return {
    runId: game.runId,
    stage: surveyResponses ? 'complete' : 'game-complete',
    completed: Boolean(surveyResponses),
    phase: 'mobile-2p3g',
    condition: 'mobile-touch-2p3g-scripted-partner',
    conditionLabel: 'Mobile touch 2P3G with scripted partner',
    playerMode: 'human-scripted-partner',
    exportedAt: new Date().toISOString(),
    gameData: {
      gameType: '2P3G',
      gridSize: GRID_SIZE,
      totalRounds: TOTAL_ROUNDS,
      maxSteps: MAX_STEPS,
      successCount: game.successCount,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      rounds: game.rounds,
      surveyResponses,
    },
  };
}

async function saveExperiment(surveyResponses) {
  const payload = getExportPayload(surveyResponses);
  localStorage.setItem(`mobile-2p3g-${game.runId}`, JSON.stringify(payload));

  try {
    const response = await fetch('/api/save-experiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return { ok: true };
  } catch (error) {
    console.warn('Could not save to server; data kept in localStorage.', error);
    return { ok: false, error: error.message };
  }
}

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function render() {
  const cssSize = Math.min(440, Math.floor(els.canvas.clientWidth || 360));
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.floor(cssSize * dpr);
  els.canvas.height = Math.floor(cssSize * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.fillStyle = COLORS.background;
  drawRoundedRect(0, 0, cssSize, cssSize, 16);
  ctx.fill();

  const cell = cssSize / GRID_SIZE;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_SIZE; i += 1) {
    const p = i * cell;
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(cssSize, p);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, cssSize);
    ctx.stroke();
  }

  const round = currentRound();
  els.roundLabel.textContent = `Round ${game.currentRoundIndex + 1} / ${TOTAL_ROUNDS}`;
  els.stepLabel.textContent = `Steps: ${round ? round.stepCount : 0}`;
  els.scoreLabel.textContent = `Success: ${game.successCount}`;

  if (!round) {
    updateControls();
    return;
  }

  round.goals.forEach((goal, index) => {
    const [r, c] = goal;
    const cx = c * cell + cell / 2;
    const cy = r * cell + cell / 2;
    ctx.fillStyle = index < 2 ? COLORS.goal : COLORS.newGoal;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = `800 ${Math.max(11, cell * 0.28)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`G${index + 1}`, cx, cy);
  });

  drawPlayer(round.partner, COLORS.partner, 'P', round.partnerFinished, cell);
  drawPlayer(round.player, COLORS.you, 'You', round.playerFinished, cell);
  updateControls();
}

function drawPlayer(pos, color, label, finished, cell) {
  const [r, c] = pos;
  const cx = c * cell + cell / 2;
  const cy = r * cell + cell / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.max(11, cell * 0.26)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy);

  if (finished) {
    ctx.strokeStyle = COLORS.finishRing;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.44, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function buildScale(name) {
  const host = document.querySelector(`[data-scale="${name}"]`);
  host.innerHTML = '';
  for (let i = 1; i <= 7; i += 1) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(i);
    input.required = true;
    label.appendChild(input);
    label.append(String(i));
    host.appendChild(label);
  }
}

function collectSurvey(form) {
  const data = new FormData(form);
  return {
    sharedGoalFeeling: Number(data.get('sharedGoal')),
    partnerUnderstanding: Number(data.get('partnerUnderstanding')),
    strategy: String(data.get('strategy') || '').trim(),
  };
}

els.startBtn.addEventListener('click', startGame);

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    submitHumanMove(button.dataset.action);
  });
}

document.addEventListener('keydown', event => {
  const action = KEY_TO_ACTION[event.code];
  if (!action) return;
  event.preventDefault();
  submitHumanMove(action);
});

els.surveyForm.addEventListener('submit', async event => {
  event.preventDefault();
  const responses = collectSurvey(els.surveyForm);
  els.surveyForm.querySelector('button[type="submit"]').disabled = true;
  els.saveStatus.textContent = 'Saving...';
  els.survey.hidden = true;
  els.done.hidden = false;
  const result = await saveExperiment(responses);
  els.saveStatus.textContent = result.ok
    ? 'Your answers were saved on the server.'
    : `Your answers were saved in this browser, but not on the server: ${result.error}`;
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
});

window.addEventListener('resize', render);
buildScale('sharedGoal');
buildScale('partnerUnderstanding');
render();
