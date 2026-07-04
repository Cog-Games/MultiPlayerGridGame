import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';
import { GameHelpers } from '../utils/GameHelpers.js';
import { StagRLAgent } from '../ai/RLAgent.js';

export class GameStateManager {
  constructor() {
    this.state = null;
    this.roundData = null;
    this.stepCount = 0;
    this.scores = {
      player1: CONFIG.game.rewards.initialScore,
      player2: CONFIG.game.rewards.initialScore,
    };
    this.roundIndex = 0;
    this.roundHistory = [];
    this.llmCalls = [];
    this.stagAgent = new StagRLAgent();
  }

  initializeRound(mapConfig) {
    this.stepCount = 0;
    this.state = {
      player1: [...mapConfig.player1Start],
      player2: [...mapConfig.player2Start],
      stag: [...mapConfig.stagStart],
      rabbits: mapConfig.rabbits.map(r => [...r]),
      obstacles: mapConfig.obstacles ? mapConfig.obstacles.map(o => [...o]) : [],
      signals: { player1: false, player2: false },
      gridMatrix: null,
    };
    this.state.gridMatrix = GameHelpers.buildGridMatrix(this.state);

    this.roundData = {
      roundIndex: this.roundIndex,
      startTime: Date.now(),
      events: [],
      llmCalls: [],
      outcome: null,
      totalSteps: 0,
    };

    return this.state;
  }

  normalizeAction(action) {
    if (!Array.isArray(action) || action.length !== 2) return [0, 0];
    const [dr, dc] = action;
    if (!Number.isInteger(dr) || !Number.isInteger(dc)) return [0, 0];
    return Math.abs(dr) + Math.abs(dc) <= 1 ? [dr, dc] : [0, 0];
  }

  canPlayerMove(agent, action) {
    if (agent !== 'player1' && agent !== 'player2') return false;
    if (!this.state?.[agent]) return false;

    const normalizedAction = this.normalizeAction(action);
    if (normalizedAction[0] === 0 && normalizedAction[1] === 0) return false;

    const newPos = GameHelpers.transition(this.state[agent], normalizedAction);
    return GameHelpers.isValidPosition(newPos) && !this.isObstacle(newPos);
  }

  // Move one hunter on that hunter's turn. Blocked directional moves still consume the action.
  movePlayer(agent, action) {
    if (agent !== 'player1' && agent !== 'player2') return false;

    const s = this.state;

    if (action?.type === 'signal') {
      s.signals[agent] = true;
      this.stepCount++;
      this.applyPlayerStepCost(agent, CONFIG.game.rewards.signalCost);
      this.recordEvent(agent, { type: 'signal', target: 'stag' });
      s.gridMatrix = GameHelpers.buildGridMatrix(s);
      return true;
    }

    const pos = s[agent];
    const normalizedAction = this.normalizeAction(action?.movement ?? action);
    if (normalizedAction[0] === 0 && normalizedAction[1] === 0) return false;

    const newPos = this.resolveIntendedPosition(agent, pos, normalizedAction);

    s[agent] = [...newPos];
    this.stepCount++;
    this.applyPlayerStepCost(agent);
    this.recordEvent(agent, normalizedAction);
    s.gridMatrix = GameHelpers.buildGridMatrix(s);
    return true;
  }

  applyPlayerStepCost(agent, cost = CONFIG.game.rewards.stepCost) {
    if (agent !== 'player1' && agent !== 'player2') return;
    this.scores[agent] += cost;
  }

  clearSignal(agent) {
    if (agent !== 'player1' && agent !== 'player2') return false;
    if (!this.state?.signals?.[agent]) return false;

    this.state.signals[agent] = false;
    this.state.gridMatrix = GameHelpers.buildGridMatrix(this.state);
    return true;
  }

  getStagAction() {
    const s = this.state;
    return this.stagAgent.getAction(
      s.stag,
      s.player1,
      s.player2,
      s.obstacles,
      s.rabbits.filter(Boolean),
    );
  }

  // Move the stag on its turn using the retained policy.
  moveStag() {
    const s = this.state;
    const action = this.normalizeAction(this.getStagAction());
    const newPos = this.resolveIntendedPosition('stag', s.stag, action);

    s.stag = [...newPos];
    this.stepCount++;
    this.recordEvent('stag', action);
    s.gridMatrix = GameHelpers.buildGridMatrix(s);
    return action;
  }

  resolveIntendedPosition(agent, startPos, action) {
    if (action[0] === 0 && action[1] === 0) return [...startPos];

    const newPos = GameHelpers.transition(startPos, action);
    if (!GameHelpers.isValidPosition(newPos) || this.isObstacle(newPos)) {
      return [...startPos];
    }

    if (agent === 'stag' && (this.isOccupiedByRabbit(newPos) || this.isOccupiedByPlayer(newPos))) {
      return [...startPos];
    }

    return newPos;
  }

  recordEvent(agent, action) {
    this.roundData.events.push({
      agent,
      action,
      actionLabel: this.getActionLabel(action),
      time: Date.now(),
      positions: {
        player1: [...this.state.player1],
        player2: [...this.state.player2],
        stag: [...this.state.stag],
        signals: { ...this.state.signals },
      },
    });
  }

  recordLlmCall(call = {}) {
    const usage = call.usage || {};
    const record = {
      time: Date.now(),
      roundIndex: this.roundIndex,
      actionCount: this.stepCount,
      success: call.success !== false,
      phase: call.phase || 'dyadic',
      condition: call.condition || null,
      player: call.player || null,
      provider: call.provider || null,
      model: call.model || null,
      retryCount: Number.isFinite(Number(call.retryCount)) ? Number(call.retryCount) : 0,
      status: call.status ?? null,
      action: call.action || null,
      parsedAction: call.parsedAction || null,
      error: call.error || null,
      usage: {
        inputTokens: this.toTokenCount(usage.inputTokens),
        outputTokens: this.toTokenCount(usage.outputTokens),
        totalTokens: this.toTokenCount(usage.totalTokens),
        cacheCreationInputTokens: this.toTokenCount(usage.cacheCreationInputTokens),
        cacheReadInputTokens: this.toTokenCount(usage.cacheReadInputTokens),
        outputReasoningTokens: this.toTokenCount(usage.outputReasoningTokens),
      },
    };

    this.llmCalls.push(record);
    if (this.roundData?.llmCalls) this.roundData.llmCalls.push(record);
    return record;
  }

  toTokenCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  getLlmUsageSummary() {
    return this.llmCalls.reduce((summary, call) => {
      const usage = call.usage || {};
      summary.calls++;
      if (call.success) summary.successfulCalls++;
      else summary.failedCalls++;
      summary.retryCount += this.toTokenCount(call.retryCount);
      summary.inputTokens += this.toTokenCount(usage.inputTokens);
      summary.outputTokens += this.toTokenCount(usage.outputTokens);
      summary.totalTokens += this.toTokenCount(usage.totalTokens);
      summary.cacheCreationInputTokens += this.toTokenCount(usage.cacheCreationInputTokens);
      summary.cacheReadInputTokens += this.toTokenCount(usage.cacheReadInputTokens);
      summary.outputReasoningTokens += this.toTokenCount(usage.outputReasoningTokens);
      return summary;
    }, {
      calls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      retryCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputReasoningTokens: 0,
    });
  }

  getActionLabel(action) {
    if (action?.type === 'signal') return 'signal';
    if (!Array.isArray(action)) return 'unknown';

    const [dr, dc] = action;
    if (dr === -1 && dc === 0) return 'up';
    if (dr === 1 && dc === 0) return 'down';
    if (dr === 0 && dc === -1) return 'left';
    if (dr === 0 && dc === 1) return 'right';
    if (dr === 0 && dc === 0) return 'stay';
    return 'unknown';
  }

  checkOutcome() {
    const s = this.state;
    const stagCaptureState = s.stag
      ? GameHelpers.getStagCaptureState(s.player1, s.player2, s.stag)
      : { captured: false };

    if (stagCaptureState.captured) {
      const reward = CONFIG.game.rewards.stagCapture;
      this.scores.player1 += reward;
      this.scores.player2 += reward;
      this.applyOutcomeVisualState({ type: 'stag_captured', captureState: stagCaptureState });
      return { type: 'stag_captured', reward };
    }

    const r1 = GameHelpers.isRabbitReached(s.player1, s.rabbits);
    if (r1 >= 0) {
      const reward = CONFIG.game.rewards.rabbitCapture;
      this.scores.player1 += reward;
      this.applyOutcomeVisualState({ type: 'rabbit_captured_p1', rabbitIndex: r1 });
      return { type: 'rabbit_captured_p1', reward, rabbitIndex: r1 };
    }

    const r2 = GameHelpers.isRabbitReached(s.player2, s.rabbits);
    if (r2 >= 0) {
      const reward = CONFIG.game.rewards.rabbitCapture;
      this.scores.player2 += reward;
      this.applyOutcomeVisualState({ type: 'rabbit_captured_p2', rabbitIndex: r2 });
      return { type: 'rabbit_captured_p2', reward, rabbitIndex: r2 };
    }

    return null;
  }

  applyOutcomeVisualState(outcome) {
    const s = this.state;

    if (outcome.type === 'stag_captured' && s.stag) {
      const capturedStagPos = [...s.stag];
      const hunterToOverlay = this.getVisualHunterForStagCapture(outcome.captureState);
      s[hunterToOverlay] = capturedStagPos;
    }

    if (outcome.type === 'rabbit_captured_p1' && s.rabbits[outcome.rabbitIndex]) {
      const rabbitPos = [...s.rabbits[outcome.rabbitIndex]];
      s.player1 = [...rabbitPos];
    }

    if (outcome.type === 'rabbit_captured_p2' && s.rabbits[outcome.rabbitIndex]) {
      const rabbitPos = [...s.rabbits[outcome.rabbitIndex]];
      s.player2 = [...rabbitPos];
    }

    s.gridMatrix = GameHelpers.buildGridMatrix(s);
  }

  getVisualHunterForStagCapture(captureState = {}) {
    if (captureState.player1OnStag) return 'player1';
    if (captureState.player2OnStag) return 'player2';

    const lastEvent = this.roundData?.events?.[this.roundData.events.length - 1];
    if (lastEvent?.agent === 'player1' || lastEvent?.agent === 'player2') {
      return lastEvent.agent;
    }

    if (this.roundData?.events) {
      for (let i = this.roundData.events.length - 1; i >= 0; i--) {
        const agent = this.roundData.events[i].agent;
        if (agent === 'player1' || agent === 'player2') return agent;
      }
    }

    return 'player1';
  }

  isOccupiedByPlayer(pos) {
    const s = this.state;
    return (s.player1[0] === pos[0] && s.player1[1] === pos[1]) ||
           (s.player2[0] === pos[0] && s.player2[1] === pos[1]);
  }

  isOccupiedByStag(pos) {
    const s = this.state;
    if (!s.stag) return false;
    return s.stag[0] === pos[0] && s.stag[1] === pos[1];
  }

  isOccupiedByRabbit(pos) {
    const rabbits = this.state?.rabbits || [];
    return rabbits.some(rabbit => rabbit && rabbit[0] === pos[0] && rabbit[1] === pos[1]);
  }

  isObstacle(pos) {
    if (!this.state.obstacles) return false;
    return this.state.obstacles.some(o => o[0] === pos[0] && o[1] === pos[1]);
  }

  finalizeRound() {
    this.roundData.totalSteps = this.stepCount;
    this.roundHistory.push({ ...this.roundData });
    this.roundIndex++;
  }

  getRenderState() { return this.state; }
  getScores() { return { ...this.scores }; }

  getSymbolicState({ currentActor = null, condition = null } = {}) {
    return {
      roundIndex: this.roundIndex,
      actionCount: this.stepCount,
      currentActor,
      condition,
      positions: {
        player1: [...this.state.player1],
        player2: [...this.state.player2],
        stag: [...this.state.stag],
        rabbits: this.state.rabbits.map(rabbit => rabbit ? [...rabbit] : null),
        obstacles: this.state.obstacles.map(obstacle => [...obstacle]),
      },
      signals: { ...this.state.signals },
      scores: this.getScores(),
      recentActions: this.roundData.events.slice(-8).map(event => ({
        agent: event.agent,
        action: event.actionLabel,
        positions: event.positions,
      })),
    };
  }

  getAsciiGrid() {
    const size = CONFIG.game.matrixSize;
    const grid = Array.from({ length: size }, () => Array(size).fill('.'));

    for (const [row, col] of this.state.obstacles) grid[row][col] = '#';
    for (const rabbit of this.state.rabbits) {
      if (rabbit) grid[rabbit[0]][rabbit[1]] = 'R';
    }

    if (this.state.stag) grid[this.state.stag[0]][this.state.stag[1]] = 'S';
    grid[this.state.player1[0]][this.state.player1[1]] = this.state.signals.player1 ? '1^' : '1';
    grid[this.state.player2[0]][this.state.player2[1]] = this.state.signals.player2 ? '2^' : '2';

    return [
      'Legend: 1=Player 1, 2=Player 2, ^=signaled stag intent, S=stag, R=small square target, #=obstacle, .=empty',
      ...grid.map((row, index) => `${index}: ${row.map(cell => cell.padEnd(2, ' ')).join(' ')}`),
      'Cols: 0  1  2  3  4  5  6',
    ].join('\n');
  }

  exportData() {
    return {
      rounds: this.roundHistory,
      finalScores: { ...this.scores },
      totalRounds: this.roundIndex,
      llmCalls: this.llmCalls.map(call => ({ ...call, usage: { ...call.usage } })),
      llmUsageSummary: this.getLlmUsageSummary(),
      timestamp: new Date().toISOString(),
    };
  }
}
