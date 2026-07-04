import { CONFIG } from '../config/gameConfig.js';
import { GameStateManager } from '../game/GameStateManager.js';
import { GroupForagingStateManager } from '../game/GroupForagingStateManager.js';
import { UIManager } from '../ui/UIManager.js';
const HUMAN_PLAYERS = ['player1', 'player2'];
const GROUP_PLAYERS = ['player1', 'player2', 'player3', 'player4'];
const MOVEMENT_BY_ACTION = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
const PLAYER_MODES = {
  humanHuman: {
    key: 'human-human',
    label: 'Human-Human',
  },
  humanLlm: {
    key: 'human-llm',
    label: 'Human-LLM',
  },
  llmLlm: {
    key: 'llm-llm',
    label: 'LLM-LLM',
  },
};
const NEXT_HUMAN_PLAYER = {
  player1: 'player2',
  player2: null,
};
const NEXT_GROUP_PLAYER = {
  player1: 'player2',
  player2: 'player3',
  player3: 'player4',
  player4: null,
};

const DEFAULT_MAPS = [
  {
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
  },
];

const GROUP_PHASE_MAP = {
  size: CONFIG.game.groupPhase.matrixSize,
  playerStarts: {
    player1: [1, 1],
    player2: [17, 17],
    player3: [1, 17],
    player4: [17, 1],
  },
  stags: [[5, 9], [9, 9], [13, 9]],
  rabbits: [[3, 3], [3, 15], [7, 5], [11, 13], [15, 3], [15, 15]],
  obstacles: createGroupPhaseObstacles(CONFIG.game.groupPhase.matrixSize),
};

function createGroupPhaseObstacles(size) {
  const obstacles = [];
  for (let index = 0; index < size; index++) {
    obstacles.push([0, index], [size - 1, index], [index, 0], [index, size - 1]);
  }

  const mid = Math.floor(size / 2);
  const gaps = new Set([5, mid - 1, mid, mid + 1, size - 6]);
  for (let index = 2; index < size - 2; index++) {
    if (!gaps.has(index)) obstacles.push([index, mid], [mid, index]);
  }

  return obstacles;
}

export class GameApplication {
  constructor(container) {
    this.container = container;
    this.gameState = new GameStateManager();
    this.groupGameState = new GroupForagingStateManager();
    this.ui = new UIManager(container);
    this.isRunning = false;
    this.roundActive = false;
    this.currentPhase = 'dyadic';
    this.startPhase = this.getInitialStartPhase();
    this.currentRound = 0;
    this.totalRounds = CONFIG.game.numRounds;
    this.maps = DEFAULT_MAPS;
    this.playerMode = this.getInitialPlayerMode();
    this.conditionKey = this.getInitialConditionKey();
    this.condition = CONFIG.game.conditions[this.conditionKey];

    this.currentActor = null;
    this.llmStatus = '';
    this.llmRequestId = 0;
    this.lastHumanMoveTimeByPlayer = { player1: 0, player2: 0 };
    this.stagTurnTimerId = null;
    this.signalTimerId = null;
    this.roundResolve = null;
    this.groupTurnResolve = null;
    this.sharingOutcome = null;
    this.phaseOneOnly = new URLSearchParams(window.location.search).get('phase1Only') === '1';
    this.experimentExportEnabled = new URLSearchParams(window.location.search).get('experimentExport') === '1';
    this.experimentRunId = null;
    this.lastExperimentSave = null;
  }

  async start() {
    await this.showWelcome();
    await this.runGameLoop();
  }

  getInitialConditionKey() {
    const params = new URLSearchParams(window.location.search);
    const condition = params.get('condition');
    return CONFIG.game.conditions[condition] ? condition : CONFIG.game.defaultCondition;
  }

  getInitialPlayerMode() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    return Object.values(PLAYER_MODES).some(playerMode => playerMode.key === mode)
      ? mode
      : PLAYER_MODES.humanHuman.key;
  }

  getInitialStartPhase() {
    const params = new URLSearchParams(window.location.search);
    const phase = params.get('phase');
    return phase === 'group' || phase === 'phase2' ? 'group' : 'dyadic';
  }

  showWelcome() {
    return new Promise(resolve => {
      this.ui.showScreen(`
        <h1 style="font-size:32px;margin-bottom:16px;">Dynamic Stag Hunt</h1>
        <div style="max-width:560px;line-height:1.6;margin-bottom:24px;">
          <p>
            Two local human hunters cooperate on the same keyboard.
            <span style="color:${CONFIG.visual.colors.player1};font-weight:bold;">Player 1</span>
            uses <strong>WASD</strong>, and
            <span style="color:${CONFIG.visual.colors.player2};font-weight:bold;">Player 2</span>
            uses <strong>arrow keys</strong>.
          </p>
          <p>Actions happen in order: Player 1 moves, then Player 2 moves, then the stag moves using the retained stag policy.</p>
          <p>Choose Human-Human for local two-player play, Human-LLM for a human Player 1 with an LLM-controlled Player 2, or LLM-LLM for two LLM-controlled hunters.</p>
          <p>The baseline condition is movement-only. The signaling condition adds <strong>Space</strong> as a fifth action to signal stag intent.</p>
          <ul style="text-align:left;margin:12px auto;max-width:420px;">
            <li><span style="color:${CONFIG.visual.colors.stag};">&#9650; Stag</span> - high reward for cooperative capture</li>
            <li><span style="color:${CONFIG.visual.colors.rabbit};">&#9632; Rabbits</span> - lower reward for individual capture</li>
          </ul>
          <p>The active hunter must choose a movement action, or signal in the signaling condition.</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(190px,1fr));gap:12px;max-width:440px;width:100%;">
          <button id="hh-baseline-btn" style="${this.getWelcomeButtonStyle('#3498db')}">Human-Human<br><span style="font-size:13px;">Baseline</span></button>
          <button id="hh-signaling-btn" style="${this.getWelcomeButtonStyle('#27ae60')}">Human-Human<br><span style="font-size:13px;">Signaling</span></button>
          <button id="llm-baseline-btn" style="${this.getWelcomeButtonStyle('#8e44ad')}">Human-LLM<br><span style="font-size:13px;">Baseline</span></button>
          <button id="llm-signaling-btn" style="${this.getWelcomeButtonStyle('#16a085')}">Human-LLM<br><span style="font-size:13px;">Signaling</span></button>
          <button id="llm-llm-baseline-btn" style="${this.getWelcomeButtonStyle('#c0392b')}">LLM-LLM<br><span style="font-size:13px;">Baseline</span></button>
          <button id="llm-llm-signaling-btn" style="${this.getWelcomeButtonStyle('#d35400')}">LLM-LLM<br><span style="font-size:13px;">Signaling</span></button>
        </div>
        <button id="phase-two-direct-btn" style="${this.getWelcomeButtonStyle('#f39c12')};margin-top:18px;max-width:440px;width:100%;">
          Start Phase 2 Directly<br><span style="font-size:13px;">four-agent group foraging and sharing</span>
        </button>
      `);
      document.getElementById('hh-baseline-btn').addEventListener('click', () => {
        this.setModeAndCondition(PLAYER_MODES.humanHuman.key, 'baseline');
        resolve();
      });
      document.getElementById('hh-signaling-btn').addEventListener('click', () => {
        this.setModeAndCondition(PLAYER_MODES.humanHuman.key, 'signaling');
        resolve();
      });
      document.getElementById('llm-baseline-btn').addEventListener('click', () => {
        this.setModeAndCondition(PLAYER_MODES.humanLlm.key, 'baseline');
        resolve();
      });
      document.getElementById('llm-signaling-btn').addEventListener('click', () => {
        this.setModeAndCondition(PLAYER_MODES.humanLlm.key, 'signaling');
        resolve();
      });
      document.getElementById('llm-llm-baseline-btn').addEventListener('click', () => {
        this.setModeAndCondition(PLAYER_MODES.llmLlm.key, 'baseline');
        resolve();
      });
      document.getElementById('llm-llm-signaling-btn').addEventListener('click', () => {
        this.setModeAndCondition(PLAYER_MODES.llmLlm.key, 'signaling');
        resolve();
      });
      document.getElementById('phase-two-direct-btn').addEventListener('click', () => {
        this.startPhase = 'group';
        this.setModeAndCondition(PLAYER_MODES.humanHuman.key, 'baseline');
        resolve();
      });
    });
  }

  getWelcomeButtonStyle(background) {
    return [
      'padding:14px 16px',
      'font-size:16px',
      'line-height:1.35',
      'cursor:pointer',
      `background:${background}`,
      'color:white',
      'border:none',
      'border-radius:8px',
    ].join(';');
  }

  setModeAndCondition(playerMode, conditionKey) {
    this.playerMode = Object.values(PLAYER_MODES).some(mode => mode.key === playerMode)
      ? playerMode
      : PLAYER_MODES.humanHuman.key;
    this.conditionKey = CONFIG.game.conditions[conditionKey] ? conditionKey : CONFIG.game.defaultCondition;
    this.condition = CONFIG.game.conditions[this.conditionKey];
  }

  async runGameLoop() {
    this.isRunning = true;
    this.currentPhase = this.startPhase;

    if (this.startPhase === 'group') {
      await this.runGroupPhase();
      await this.showGameOver();
      return;
    }

    this.currentPhase = 'dyadic';

    for (let round = 0; round < this.totalRounds; round++) {
      this.currentRound = round;
      const mapConfig = this.maps[round % this.maps.length];

      this.ui.initialize({ signalEnabled: this.condition.signalEnabled });
      this.gameState.initializeRound(mapConfig);
      this.render();
      this.updateInfoPanel();

      const outcome = await this.runRound();

      this.gameState.finalizeRound();
      await this.publishExperimentData('round');
      await this.showRoundFeedback(outcome);
    }

    if (CONFIG.game.groupPhase.enabled && !this.phaseOneOnly) {
      await this.showGroupPhaseIntro();
      await this.runGroupPhase();
    }

    await this.publishExperimentData('complete');
    await this.showGameOver();
  }

  runRound() {
    return new Promise(resolve => {
      this.roundActive = true;
      this.roundResolve = resolve;
      this.ui.onPlayerAction = action => this.submitPlayerAction(action);
      this.beginPlayerTurn('player1');
    });
  }

  showGroupPhaseIntro() {
    return new Promise(resolve => {
      this.ui.showScreen(`
        <h1 style="font-size:28px;margin-bottom:16px;">Phase 2: Group Foraging</h1>
        <div style="max-width:640px;line-height:1.6;margin-bottom:24px;">
          <p>Two more agents enter the game. The map becomes larger, with three large moving targets and six small fixed targets.</p>
          <p>The group has a fixed collection period to gather as much food as possible. After collection, each player chooses whether to keep their food, share within their dyad, or contribute to a group public pool.</p>
          <p>This phase models the transition from dyadic coordination to larger cooperation, where the group can benefit from sharing but individual players can also free ride.</p>
        </div>
        <button id="phase-two-btn" style="${this.getWelcomeButtonStyle('#27ae60')}">Start Phase 2</button>
      `);
      document.getElementById('phase-two-btn').addEventListener('click', resolve);
    });
  }

  async runGroupPhase() {
    this.currentPhase = 'group';
    this.currentRound = this.totalRounds;
    this.sharingOutcome = null;
    this.groupGameState.initializePhase(GROUP_PHASE_MAP, this.gameState.getScores());

    this.ui.initialize({ signalEnabled: false, phase: 'group' });
    this.render();
    this.updateInfoPanel();

    await this.runGroupCollection();
    const decisions = await this.collectSharingDecisions();
    this.sharingOutcome = this.groupGameState.resolveSharing(decisions);
    await this.showSharingFeedback(this.sharingOutcome);
  }

  runGroupCollection() {
    return new Promise(resolve => {
      this.roundActive = true;
      this.groupTurnResolve = resolve;
      this.ui.onPlayerAction = action => this.submitPlayerAction(action);
      this.beginGroupTurn('player1');
    });
  }

  beginGroupTurn(player) {
    if (!this.roundActive || this.currentPhase !== 'group') return;
    this.currentActor = player;
    this.updateInfoPanel();

    if (this.isLlmTurn(player)) {
      this.clearTurnTimers();
      this.runLlmTurn(player);
      return;
    }

    if (player === 'player3' || player === 'player4') {
      this.clearTurnTimers();
      window.setTimeout(() => this.advanceAutomatedGroupTurn(player), CONFIG.game.timing.llmActionDelay);
      return;
    }

    this.clearTurnTimers();
  }

  advanceAutomatedGroupTurn(player) {
    if (!this.roundActive || this.currentPhase !== 'group' || this.currentActor !== player) return;
    const action = this.groupGameState.getAutomatedPlayerAction(player);
    this.advanceGroupPlayerTurn(player, action);
  }

  submitGroupPlayerAction(action) {
    if (!this.roundActive || this.currentPhase !== 'group') return;
    if (!HUMAN_PLAYERS.includes(this.currentActor)) return;
    if (this.isLlmTurn(this.currentActor)) return;

    const actor = action?.player;
    if (this.currentActor !== actor) return;

    const now = Date.now();
    const lastMoveTime = this.lastHumanMoveTimeByPlayer[actor] || 0;
    if (now - lastMoveTime < CONFIG.game.timing.humanMoveThrottle) return;
    this.lastHumanMoveTimeByPlayer[actor] = now;

    this.advanceGroupPlayerTurn(actor, action.movement);
  }

  advanceGroupPlayerTurn(player, action) {
    if (!this.roundActive || this.currentPhase !== 'group' || this.currentActor !== player) return;

    const didAct = this.groupGameState.movePlayer(player, action);
    if (!didAct) return;

    this.clearTurnTimers();
    this.render();
    this.updateInfoPanel();
    this.continueAfterGroupTurn(player);
  }

  continueAfterGroupTurn(player) {
    if (this.groupGameState.stepCount >= CONFIG.game.groupPhase.collectionActionLimit) {
      this.endGroupCollection();
      return;
    }

    const nextPlayer = NEXT_GROUP_PLAYER[player];
    if (nextPlayer) {
      this.beginGroupTurn(nextPlayer);
      return;
    }

    this.groupGameState.moveStags();
    this.render();
    this.updateInfoPanel();

    window.setTimeout(() => {
      if (!this.roundActive || this.currentPhase !== 'group') return;
      this.beginGroupTurn('player1');
    }, CONFIG.game.timing.stagTurnDelay);
  }

  endGroupCollection() {
    this.roundActive = false;
    this.ui.onPlayerAction = null;
    this.currentActor = null;
    this.clearTurnTimers();

    if (this.groupTurnResolve) {
      this.groupTurnResolve();
      this.groupTurnResolve = null;
    }
  }

  beginPlayerTurn(player) {
    if (!this.roundActive) return;
    this.currentActor = player;
    this.updateInfoPanel();

    if (this.isLlmTurn(player)) {
      this.clearTurnTimers();
      this.runLlmTurn(player);
      return;
    }

    this.clearTurnTimers();
  }

  isLlmTurn(player) {
    if (this.playerMode === PLAYER_MODES.llmLlm.key) return player === 'player1' || player === 'player2';
    return this.playerMode === PLAYER_MODES.humanLlm.key && player === 'player2';
  }

  submitPlayerAction(action) {
    if (this.currentPhase === 'group') {
      this.submitGroupPlayerAction(action);
      return;
    }

    if (!this.roundActive || !HUMAN_PLAYERS.includes(this.currentActor)) return;
    if (this.isLlmTurn(this.currentActor)) return;
    if (this.signalTimerId !== null) return;

    const isSignal = action?.type === 'signal';
    if (isSignal && !this.condition.signalEnabled) return;

    const actor = isSignal ? this.currentActor : action?.player;
    if (this.currentActor !== actor || !HUMAN_PLAYERS.includes(actor)) return;

    const now = Date.now();
    const lastMoveTime = this.lastHumanMoveTimeByPlayer[actor] || 0;
    if (now - lastMoveTime < CONFIG.game.timing.humanMoveThrottle) return;
    this.lastHumanMoveTimeByPlayer[actor] = now;

    this.advanceHumanTurn(actor, isSignal ? { type: 'signal' } : action.movement);
  }

  advanceHumanTurn(player, action) {
    if (!this.roundActive || this.currentActor !== player) return;
    if (this.signalTimerId !== null) return;

    const didAct = this.gameState.movePlayer(player, action);
    if (!didAct) return;

    this.clearTurnTimers();
    this.render();
    this.updateInfoPanel();

    if (action?.type === 'signal') {
      this.signalTimerId = window.setTimeout(() => {
        this.signalTimerId = null;
        if (!this.roundActive || this.currentActor !== player) return;

        this.gameState.clearSignal(player);
        this.render();
        this.updateInfoPanel();
        this.continueAfterHumanTurn(player);
      }, CONFIG.game.timing.signalDisplayDuration);
      return;
    }

    this.continueAfterHumanTurn(player);
  }

  continueAfterHumanTurn(player) {
    this.checkAndContinue(() => {
      const nextPlayer = NEXT_HUMAN_PLAYER[player];
      if (nextPlayer) {
        this.beginPlayerTurn(nextPlayer);
      } else {
        this.beginStagTurn();
      }
    });
  }

  async runLlmTurn(player) {
    const requestId = ++this.llmRequestId;
    this.llmStatus = `${this.getPlayerLabel(player)} LLM is choosing an action...`;
    this.updateInfoPanel();

    try {
      const action = await this.requestLlmAction(player);
      if (!this.roundActive || this.currentActor !== player || requestId !== this.llmRequestId) return;
      this.llmStatus = `${this.getPlayerLabel(player)} LLM chose ${action.label}`;
      this.updateInfoPanel();
      window.setTimeout(() => {
        if (this.roundActive && this.currentActor === player && requestId === this.llmRequestId) {
          if (this.currentPhase === 'group') {
            this.advanceGroupPlayerTurn(player, action.payload);
          } else {
            this.advanceHumanTurn(player, action.payload);
          }
        }
      }, CONFIG.game.timing.llmActionDelay);
    } catch (error) {
      if (!this.roundActive || this.currentActor !== player || requestId !== this.llmRequestId) return;
      const fallbackAction = this.getFallbackLlmAction(player, error);
      this.llmStatus = `${this.getPlayerLabel(player)} LLM unavailable, forced ${fallbackAction.label}. ${error.message}`;
      this.updateInfoPanel();
      window.setTimeout(() => {
        if (this.roundActive && this.currentActor === player && requestId === this.llmRequestId) {
          if (this.currentPhase === 'group') {
            this.advanceGroupPlayerTurn(player, fallbackAction.payload);
          } else {
            this.advanceHumanTurn(player, fallbackAction.payload);
          }
        }
      }, CONFIG.game.timing.llmActionDelay);
    }
  }

  async requestLlmAction(player) {
    const stateManager = this.currentPhase === 'group' ? this.groupGameState : this.gameState;
    const legalActions = this.getLegalLlmActions(player);
    const payload = {
      player,
      playerLabel: this.getPlayerLabel(player),
      phase: this.currentPhase,
      condition: this.conditionKey,
      conditionLabel: this.condition.label,
      legalActions,
      rules: this.getLlmRules(),
      symbolicState: stateManager.getSymbolicState({
        currentActor: this.currentActor,
        condition: this.conditionKey,
      }),
      asciiGrid: stateManager.getAsciiGrid(),
      gridImage: this.ui.getBoardImageDataUrl(),
    };

    let response;
    try {
      response = await fetch('/api/llm-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      this.recordLlmCall(stateManager, {
        player,
        payload,
        success: false,
        error: error.message,
      });
      console.error('[LLM] API request failed before response', {
        player,
        legalActions,
        error: error.message,
      });
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || `HTTP ${response.status}`;
      this.recordLlmCall(stateManager, {
        player,
        payload,
        success: false,
        status: response.status,
        provider: data.provider,
        model: data.model,
        retryCount: data.retryCount || 0,
        usage: data.usage,
        error: message,
      });
      console.error('[LLM] API request failed', {
        player,
        legalActions,
        status: response.status,
        error: message,
      });
      throw new Error(message);
    }

    const parsedAction = this.parseLlmAction(data, legalActions);
    this.recordLlmCall(stateManager, {
      player,
      payload,
      success: true,
      status: response.status,
      provider: data.provider,
      model: data.model,
      retryCount: data.retryCount || 0,
      usage: data.usage,
      action: data.action,
      parsedAction: parsedAction.label,
    });
    console.log('[LLM] step output', {
      player,
      roundIndex: payload.symbolicState.roundIndex,
      actionCount: payload.symbolicState.actionCount,
      condition: payload.condition,
      legalActions,
      provider: data.provider,
      model: data.model,
      retryCount: data.retryCount || 0,
      rawAction: data.action,
      parsedAction: parsedAction.label,
      usage: data.usage || null,
    });

    return parsedAction;
  }

  recordLlmCall(stateManager, details) {
    if (typeof stateManager.recordLlmCall !== 'function') return;

    stateManager.recordLlmCall({
      phase: details.payload?.phase || this.currentPhase,
      condition: details.payload?.condition || this.conditionKey,
      player: details.player,
      success: details.success,
      status: details.status,
      provider: details.provider,
      model: details.model,
      retryCount: details.retryCount,
      usage: details.usage,
      action: details.action,
      parsedAction: details.parsedAction,
      error: details.error,
    });
  }

  getLegalLlmActions(player = this.currentActor) {
    const actions = Object.keys(MOVEMENT_BY_ACTION);

    if (this.currentPhase === 'group') return actions;

    if (this.condition.signalEnabled) actions.push('signal');
    return actions;
  }

  getLlmRules() {
    if (this.currentPhase === 'group') return this.getGroupLlmRules();

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

    if (this.condition.signalEnabled) {
      rules.push(
        'The signal action shows that you intend to capture the large moving target.',
        `Signal briefly places a green triangle inside the acting player for 2 seconds. It does not move the player, gives no points, costs ${CONFIG.game.rewards.signalCost} points, and still uses one action.`,
      );
    }

    return rules.join('\n');
  }

  getGroupLlmRules() {
    return [
      'There are four players, three large moving targets, and six small fixed target squares on a larger grid.',
      'Grid coordinates are [row, col] with row 0 at the top and col 0 at the left.',
      'Each action consumes one turn for the acting player. Stay is not an action.',
      'Turn order is Player 1, Player 2, Player 3, Player 4, then the large moving targets.',
      'A direction action attempts to move one cell. If blocked by an obstacle or edge, the action is still used and the player stays in place.',
      `Capture a small target square to add ${CONFIG.game.rewards.rabbitCapture} food to your inventory.`,
      `A large moving target is captured when at least two players are next to it. Each participating player adds ${CONFIG.game.rewards.stagCapture} food to their inventory.`,
      'Captured food disappears, and collection continues until the action limit is reached.',
      'After collection, each player can keep their own food, share within a dyad, or contribute to the group public pool.',
      `Food contributed to the group public pool is multiplied by ${CONFIG.game.groupPhase.publicGoodMultiplier} and divided equally among all four players.`,
      'Your goal is to finish with as many points as possible.',
    ].join('\n');
  }

  parseLlmAction(data, legalActions = this.getLegalLlmActions()) {
    const requestedAction = typeof data.action === 'string' ? data.action : '';
    const action = legalActions.includes(requestedAction) ? requestedAction : legalActions[0];

    if (action === 'signal' && this.currentPhase !== 'group' && this.condition.signalEnabled) {
      return {
        label: 'signal stag',
        payload: { type: 'signal' },
      };
    }

    return {
      label: action,
      payload: MOVEMENT_BY_ACTION[action] || MOVEMENT_BY_ACTION[legalActions[0]],
    };
  }

  getFallbackLlmAction(player, error) {
    const legalActions = this.getLegalLlmActions(player).filter(action => action !== 'signal');
    const action = legalActions[0] || this.getLegalLlmActions(player)[0];

    return this.parseLlmAction({
      action,
    }, this.getLegalLlmActions(player));
  }

  beginStagTurn() {
    if (!this.roundActive) return;
    this.currentActor = 'stag';
    this.updateInfoPanel();

    this.stagTurnTimerId = window.setTimeout(() => {
      this.advanceStagTurn();
    }, CONFIG.game.timing.stagTurnDelay);
  }

  advanceStagTurn() {
    if (!this.roundActive || this.currentActor !== 'stag') return;

    this.clearTurnTimers();
    this.gameState.moveStag();
    this.render();
    this.updateInfoPanel();

    this.checkAndContinue(() => {
      this.beginPlayerTurn('player1');
    });
  }

  clearTurnTimers() {
    if (this.stagTurnTimerId !== null) {
      window.clearTimeout(this.stagTurnTimerId);
      this.stagTurnTimerId = null;
    }

    if (this.signalTimerId !== null) {
      window.clearTimeout(this.signalTimerId);
      this.signalTimerId = null;
    }
  }

  checkAndContinue(next) {
    const outcome = this.gameState.checkOutcome();
    if (outcome) {
      this.render();
      this.endRound(outcome);
      return;
    }

    if (this.gameState.stepCount >= CONFIG.game.maxGameLength) {
      this.endRound({ type: 'timeout', reward: 0 });
      return;
    }

    next();
  }

  endRound(outcome) {
    this.roundActive = false;
    this.ui.onPlayerAction = null;
    this.currentActor = null;
    this.llmStatus = '';
    this.clearTurnTimers();
    if (this.gameState.roundData) this.gameState.roundData.outcome = outcome;

    if (this.roundResolve) {
      this.roundResolve(outcome);
      this.roundResolve = null;
    }
  }

  render() {
    const stateManager = this.currentPhase === 'group' ? this.groupGameState : this.gameState;
    this.ui.renderGame(stateManager.getRenderState());
  }

  updateInfoPanel() {
    if (this.currentPhase === 'group') {
      this.updateGroupInfoPanel();
      return;
    }

    const scores = this.gameState.getScores();
    const action = this.gameState.stepCount;
    const maxActions = CONFIG.game.maxGameLength;
    const turnStatus = this.getTurnStatus();

    this.ui.updateInfo(`
      Round ${this.currentRound + 1}/${this.totalRounds} &nbsp;|&nbsp;
      Mode: <strong>${this.getPlayerModeLabel()}</strong> &nbsp;|&nbsp;
      Condition: <strong>${this.condition.label}</strong> &nbsp;|&nbsp;
      Action ${action}/${maxActions} &nbsp;|&nbsp;
      Player 1: <strong style="color:${CONFIG.visual.colors.player1};">${this.formatScore(scores.player1)}</strong> &nbsp;|&nbsp;
      Player 2: <strong style="color:${CONFIG.visual.colors.player2};">${this.formatScore(scores.player2)}</strong><br>
      ${turnStatus}${this.llmStatus ? `<br><span style="color:#aaa;">${this.llmStatus}</span>` : ''}
    `);
  }

  updateGroupInfoPanel() {
    const scores = this.groupGameState.getScores();
    const inventories = this.groupGameState.getRenderState().inventories;
    const action = this.groupGameState.stepCount;
    const maxActions = CONFIG.game.groupPhase.collectionActionLimit;
    const turnStatus = this.getTurnStatus();

    this.ui.updateInfo(`
      Phase 2 Collection &nbsp;|&nbsp;
      Action ${action}/${maxActions} &nbsp;|&nbsp;
      P1: <strong style="color:${CONFIG.visual.colors.player1};">${scores.player1.toFixed(1)}</strong> food ${inventories.player1} &nbsp;|&nbsp;
      P2: <strong style="color:${CONFIG.visual.colors.player2};">${scores.player2.toFixed(1)}</strong> food ${inventories.player2} &nbsp;|&nbsp;
      P3: <strong style="color:${CONFIG.visual.colors.player3};">${scores.player3.toFixed(1)}</strong> food ${inventories.player3} &nbsp;|&nbsp;
      P4: <strong style="color:${CONFIG.visual.colors.player4};">${scores.player4.toFixed(1)}</strong> food ${inventories.player4}<br>
      ${turnStatus}${this.llmStatus ? `<br><span style="color:#aaa;">${this.llmStatus}</span>` : ''}
    `);
  }

  getPlayerModeLabel() {
    return Object.values(PLAYER_MODES).find(mode => mode.key === this.playerMode)?.label
      || PLAYER_MODES.humanHuman.label;
  }

  getPlayerLabel(player) {
    if (player === 'player1') return 'Player 1';
    if (player === 'player2') return 'Player 2';
    if (player === 'player3') return 'Player 3';
    if (player === 'player4') return 'Player 4';
    return 'Player';
  }

  formatScore(score) {
    const rounded = Math.round(Number(score) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  getTurnStatus() {
    if (this.currentPhase === 'group') {
      if (this.currentActor === 'player1') {
        return this.isLlmTurn('player1')
          ? `<strong style="color:${CONFIG.visual.colors.player1};">Player 1 LLM turn</strong>`
          : `<strong style="color:${CONFIG.visual.colors.player1};">Player 1 turn</strong> - use WASD`;
      }

      if (this.currentActor === 'player2') {
        return this.isLlmTurn('player2')
          ? `<strong style="color:${CONFIG.visual.colors.player2};">Player 2 LLM turn</strong>`
          : `<strong style="color:${CONFIG.visual.colors.player2};">Player 2 turn</strong> - use arrow keys`;
      }

      if (this.currentActor === 'player3' || this.currentActor === 'player4') {
        const color = CONFIG.visual.colors[this.currentActor];
        return `<strong style="color:${color};">${this.getPlayerLabel(this.currentActor)} automated turn</strong>`;
      }

      return 'Collection complete. Preparing sharing decisions.';
    }

    const signalText = this.condition.signalEnabled ? ' or Space to signal stag' : '';

    if (this.currentActor === 'player1') {
      if (this.isLlmTurn('player1')) {
        return `<strong style="color:${CONFIG.visual.colors.player1};">Player 1 LLM turn</strong>`;
      }

      return `<strong style="color:${CONFIG.visual.colors.player1};">Player 1 turn</strong> - use WASD${signalText}`;
    }

    if (this.currentActor === 'player2') {
      if (this.isLlmTurn('player2')) {
        return `<strong style="color:${CONFIG.visual.colors.player2};">Player 2 LLM turn</strong>`;
      }

      return `<strong style="color:${CONFIG.visual.colors.player2};">Player 2 turn</strong> - use arrow keys${signalText}`;
    }

    if (this.currentActor === 'stag') {
      return `<strong style="color:${CONFIG.visual.colors.stag};">Stag turn</strong>`;
    }

    return 'Waiting for next turn';
  }

  showRoundFeedback(outcome) {
    let message = '';
    let color = '#e0e0e0';
    switch (outcome.type) {
      case 'stag_captured':
        message = `Stag captured! Both hunters earn +${outcome.reward} points.`;
        color = '#27ae60';
        break;
      case 'rabbit_captured_p1':
        message = `Player 1 caught a rabbit! +${outcome.reward} points.`;
        color = CONFIG.visual.colors.player1;
        break;
      case 'rabbit_captured_p2':
        message = `Player 2 caught a rabbit! +${outcome.reward} points.`;
        color = CONFIG.visual.colors.player2;
        break;
      case 'timeout':
        message = 'Action limit reached. No capture this round.';
        color = '#e74c3c';
        break;
    }

    const scores = this.gameState.getScores();
    const autoAdvance = this.shouldAutoAdvanceRoundFeedback();
    this.ui.showOverlay(`
      <h2 style="margin:0 0 16px 0;font-size:22px;color:${color};">${message}</h2>
      <div style="font-size:16px;line-height:1.8;margin-bottom:20px;">
        <span>Player 1: <strong style="color:${CONFIG.visual.colors.player1};">${this.formatScore(scores.player1)}</strong></span>
        &nbsp;|&nbsp;
        <span>Player 2: <strong style="color:${CONFIG.visual.colors.player2};">${this.formatScore(scores.player2)}</strong></span>
      </div>
      <div style="color:#888;font-size:14px;">
        ${autoAdvance
          ? `Next round starts automatically. Press <strong>SPACE</strong> to continue now.`
          : `Press <strong>SPACE</strong> to continue`}
      </div>
    `);

    return new Promise(resolve => {
      let resolved = false;
      let timerId = null;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timerId !== null) window.clearTimeout(timerId);
        document.removeEventListener('keydown', handler);
        this.ui.removeOverlay();
        resolve();
      };
      const handler = (e) => {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          finish();
        }
      };
      document.addEventListener('keydown', handler);
      if (autoAdvance) {
        timerId = window.setTimeout(finish, CONFIG.game.timing.roundFeedbackDelay);
      }
    });
  }

  shouldAutoAdvanceRoundFeedback() {
    return this.playerMode === PLAYER_MODES.llmLlm.key;
  }

  async collectSharingDecisions() {
    const decisions = {};
    for (const player of GROUP_PLAYERS) {
      if (this.isHumanControlledSharingPlayer(player)) {
        decisions[player] = await this.showSharingChoice(player);
      } else {
        decisions[player] = this.getDefaultSharingChoice(player);
      }
    }
    return decisions;
  }

  isHumanControlledSharingPlayer(player) {
    if (player === 'player1') return this.playerMode !== PLAYER_MODES.llmLlm.key;
    if (player === 'player2') return this.playerMode === PLAYER_MODES.humanHuman.key;
    return false;
  }

  getDefaultSharingChoice(player) {
    if (player === 'player4') return 'keep';
    if (player === 'player3') return 'dyad';
    return 'group';
  }

  showSharingChoice(player) {
    const inventories = this.groupGameState.getRenderState().inventories;
    const partner = CONFIG.game.groupPhase.dyads[player];
    const playerColor = CONFIG.visual.colors[player];

    return new Promise(resolve => {
      this.ui.showScreen(`
        <h1 style="font-size:26px;margin-bottom:12px;">Sharing Decision</h1>
        <div style="max-width:680px;line-height:1.6;margin-bottom:22px;">
          <p><strong style="color:${playerColor};">${this.getPlayerLabel(player)}</strong> collected <strong>${inventories[player]}</strong> food.</p>
          <p>Choose how to allocate this food after the group collection phase.</p>
          <p style="color:#aaa;font-size:14px;">
            Keep protects your own food. Dyad-share splits it with ${this.getPlayerLabel(partner)}.
            Group-share contributes it to the public pool, which is multiplied by ${CONFIG.game.groupPhase.publicGoodMultiplier}
            and then divided equally among all four players.
          </p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:12px;max-width:620px;width:100%;">
          <button id="share-keep-btn" style="${this.getWelcomeButtonStyle('#7f8c8d')}">Keep<br><span style="font-size:13px;">private food</span></button>
          <button id="share-dyad-btn" style="${this.getWelcomeButtonStyle('#2980b9')}">Dyad<br><span style="font-size:13px;">share with partner</span></button>
          <button id="share-group-btn" style="${this.getWelcomeButtonStyle('#27ae60')}">Group<br><span style="font-size:13px;">public pool</span></button>
        </div>
      `);

      document.getElementById('share-keep-btn').addEventListener('click', () => resolve('keep'));
      document.getElementById('share-dyad-btn').addEventListener('click', () => resolve('dyad'));
      document.getElementById('share-group-btn').addEventListener('click', () => resolve('group'));
    });
  }

  showSharingFeedback(outcome) {
    const choiceLabel = {
      keep: 'keep',
      dyad: 'dyad',
      group: 'group',
    };
    const rows = GROUP_PLAYERS.map(player => `
      <tr>
        <td style="padding:6px 10px;color:${CONFIG.visual.colors[player]};font-weight:700;">${this.getPlayerLabel(player)}</td>
        <td style="padding:6px 10px;">${outcome.inventories[player]}</td>
        <td style="padding:6px 10px;">${choiceLabel[outcome.decisions[player]]}</td>
        <td style="padding:6px 10px;">+${outcome.phasePayoffs[player].toFixed(1)}</td>
        <td style="padding:6px 10px;">${outcome.finalScores[player].toFixed(1)}</td>
      </tr>
    `).join('');

    return new Promise(resolve => {
      this.ui.showScreen(`
        <h1 style="font-size:26px;margin-bottom:14px;">Phase 2 Sharing Result</h1>
        <div style="max-width:720px;line-height:1.6;margin-bottom:18px;">
          <p>Group public pool: <strong>${outcome.publicPool}</strong> food, multiplied and shared as <strong>${outcome.publicShare.toFixed(1)}</strong> points per player.</p>
        </div>
        <table style="border-collapse:collapse;color:#e0e0e0;margin-bottom:22px;background:#22243a;">
          <thead>
            <tr style="color:#aaa;">
              <th style="padding:6px 10px;text-align:left;">Player</th>
              <th style="padding:6px 10px;text-align:left;">Food</th>
              <th style="padding:6px 10px;text-align:left;">Choice</th>
              <th style="padding:6px 10px;text-align:left;">Phase Payoff</th>
              <th style="padding:6px 10px;text-align:left;">Final Score</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <button id="sharing-continue-btn" style="${this.getWelcomeButtonStyle('#3498db')}">Continue</button>
      `);
      document.getElementById('sharing-continue-btn').addEventListener('click', resolve);
    });
  }

  async showGameOver() {
    const scores = this.sharingOutcome ? this.groupGameState.getScores() : this.gameState.getScores();
    const groupRows = this.sharingOutcome
      ? `
        <p>Player 3: <strong style="color:${CONFIG.visual.colors.player3};">${scores.player3.toFixed(1)}</strong></p>
        <p>Player 4: <strong style="color:${CONFIG.visual.colors.player4};">${scores.player4.toFixed(1)}</strong></p>
      `
      : '';

    this.ui.showScreen(`
      <h1 style="font-size:28px;margin-bottom:16px;">Game Over</h1>
      <div style="font-size:18px;line-height:1.8;">
        <p>Player 1: <strong style="color:${CONFIG.visual.colors.player1};">${Number(scores.player1).toFixed(1)}</strong></p>
        <p>Player 2: <strong style="color:${CONFIG.visual.colors.player2};">${Number(scores.player2).toFixed(1)}</strong></p>
        ${groupRows}
        <p>Phase 1 Rounds: ${this.totalRounds}</p>
        ${this.sharingOutcome ? '<p>Phase 2: group collection and sharing complete</p>' : ''}
      </div>
      <button onclick="window.location.reload()" style="
        margin-top:20px; padding:12px 30px; font-size:16px; cursor:pointer;
        background:#3498db; color:white; border:none; border-radius:8px;
      ">Play Again</button>
    `);
  }

  createExperimentRunId() {
    const stamp = new Date().toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
      .replace(/[^0-9A-Za-z]+/g, '-')
      .replace(/-$/, '');
    const random = Math.random().toString(36).slice(2, 8);
    return `${stamp}-${this.playerMode}-${this.conditionKey}-${random}`;
  }

  getExperimentPayload(stage = 'round') {
    if (!this.experimentRunId) this.experimentRunId = this.createExperimentRunId();

    return {
      runId: this.experimentRunId,
      stage,
      completed: stage === 'complete',
      phase: this.currentPhase,
      condition: this.conditionKey,
      conditionLabel: this.condition.label,
      playerMode: this.playerMode,
      phaseOneOnly: this.phaseOneOnly,
      exportedAt: new Date().toISOString(),
      gameData: this.gameState.exportData(),
    };
  }

  async publishExperimentData(stage = 'round') {
    if (!this.experimentExportEnabled) return;

    const payload = this.getExperimentPayload(stage);
    let element = document.getElementById('experiment-data');
    if (!element) {
      element = document.createElement('script');
      element.id = 'experiment-data';
      element.type = 'application/json';
      document.body.appendChild(element);
    }

    element.textContent = JSON.stringify(payload);

    try {
      const response = await fetch('/api/save-experiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      this.lastExperimentSave = data;
      console.log('[experiment] data saved', {
        runId: data.runId,
        filePath: data.filePath,
        stage,
        totalRounds: payload.gameData.totalRounds,
      });
    } catch (error) {
      console.error('[experiment] data save failed', {
        runId: payload.runId,
        stage,
        totalRounds: payload.gameData.totalRounds,
        error: error.message,
      });
    }
  }
}
