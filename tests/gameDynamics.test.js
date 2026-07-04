import assert from 'node:assert/strict';
import { GameStateManager } from '../client/src/game/GameStateManager.js';

function runScenario(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createManager(mapOverrides = {}) {
  const manager = new GameStateManager();
  manager.initializeRound({
    player1Start: [5, 2],
    player2Start: [1, 5],
    stagStart: [3, 3],
    rabbits: [[3, 0], [3, 6]],
    obstacles: [],
    ...mapOverrides,
  });
  return manager;
}

runScenario('player1, player2, then stag move as separate ordered actions', () => {
  const manager = createManager();
  manager.stagAgent = { getAction: () => [0, 1] };

  manager.movePlayer('player1', [-1, 0]);
  assert.deepEqual(manager.state.player1, [4, 2]);
  assert.equal(manager.stepCount, 1);
  assert.equal(manager.roundData.events[0].agent, 'player1');

  manager.movePlayer('player2', [1, 0]);
  assert.deepEqual(manager.state.player2, [2, 5]);
  assert.equal(manager.stepCount, 2);
  assert.equal(manager.roundData.events[1].agent, 'player2');

  manager.moveStag();
  assert.deepEqual(manager.state.stag, [3, 4]);
  assert.equal(manager.stepCount, 3);
  assert.equal(manager.roundData.events[2].agent, 'stag');
});

runScenario('blocked hunter move consumes the active turn', () => {
  const manager = createManager({
    player1Start: [1, 1],
    obstacles: [[0, 1]],
  });

  manager.movePlayer('player1', [-1, 0]);

  assert.deepEqual(manager.state.player1, [1, 1]);
  assert.equal(manager.stepCount, 1);
  assert.deepEqual(manager.roundData.events[0].action, [-1, 0]);
});

runScenario('players start with points and pay an action cost on their turns', () => {
  const manager = createManager();

  assert.equal(manager.getScores().player1, 10);
  assert.equal(manager.getScores().player2, 10);

  manager.movePlayer('player1', [-1, 0]);
  manager.movePlayer('player2', { type: 'signal' });

  assert.equal(manager.getScores().player1, 9.5);
  assert.equal(manager.getScores().player2, 9.9);
});

runScenario('explicit no-op hunter action is ignored', () => {
  const manager = createManager();

  const didAct = manager.movePlayer('player1', [0, 0]);

  assert.equal(didAct, false);
  assert.deepEqual(manager.state.player1, [5, 2]);
  assert.equal(manager.stepCount, 0);
  assert.equal(manager.roundData.events.length, 0);
});

runScenario('available player moves exclude blocked directions', () => {
  const manager = createManager({
    player1Start: [1, 1],
    obstacles: [[0, 1], [1, 0]],
  });

  assert.equal(manager.canPlayerMove('player1', [-1, 0]), false);
  assert.equal(manager.canPlayerMove('player1', [0, -1]), false);
  assert.equal(manager.canPlayerMove('player1', [1, 0]), true);
  assert.equal(manager.canPlayerMove('player1', [0, 1]), true);
});

runScenario('signaling stag intent consumes a hunter action and marks that player', () => {
  const manager = createManager();

  manager.movePlayer('player1', { type: 'signal' });

  assert.deepEqual(manager.state.player1, [5, 2]);
  assert.equal(manager.state.signals.player1, true);
  assert.equal(manager.state.signals.player2, false);
  assert.equal(manager.stepCount, 1);
  assert.deepEqual(manager.roundData.events[0].action, { type: 'signal', target: 'stag' });
});

runScenario('signal can be cleared and used again later', () => {
  const manager = createManager();

  const firstSignal = manager.movePlayer('player1', { type: 'signal' });
  const cleared = manager.clearSignal('player1');
  const secondSignal = manager.movePlayer('player1', { type: 'signal' });

  assert.equal(firstSignal, true);
  assert.equal(cleared, true);
  assert.equal(secondSignal, true);
  assert.equal(manager.state.signals.player1, true);
  assert.equal(manager.stepCount, 2);
  assert.equal(manager.roundData.events.length, 2);
});

runScenario('symbolic state includes recent action history', () => {
  const manager = createManager();

  manager.movePlayer('player1', { type: 'signal' });
  manager.clearSignal('player1');
  manager.movePlayer('player2', [1, 0]);

  const symbolicState = manager.getSymbolicState({ currentActor: 'player1', condition: 'signaling' });

  assert.deepEqual(symbolicState.recentActions.map(event => event.action), ['signal', 'down']);
  assert.equal(symbolicState.recentActions[0].agent, 'player1');
  assert.equal(symbolicState.recentActions[1].agent, 'player2');
});

runScenario('LLM token usage is saved per call and summarized in export data', () => {
  const manager = createManager();

  manager.recordLlmCall({
    player: 'player1',
    condition: 'baseline',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    retryCount: 1,
    action: 'up',
    parsedAction: 'up',
    usage: {
      inputTokens: 1200,
      outputTokens: 18,
      totalTokens: 1218,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 200,
    },
  });
  manager.recordLlmCall({
    player: 'player2',
    condition: 'baseline',
    success: false,
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    retryCount: 2,
    error: 'rate limited',
  });

  const data = manager.exportData();

  assert.equal(manager.roundData.llmCalls.length, 2);
  assert.equal(data.llmCalls.length, 2);
  assert.equal(data.llmUsageSummary.calls, 2);
  assert.equal(data.llmUsageSummary.successfulCalls, 1);
  assert.equal(data.llmUsageSummary.failedCalls, 1);
  assert.equal(data.llmUsageSummary.retryCount, 3);
  assert.equal(data.llmUsageSummary.inputTokens, 1200);
  assert.equal(data.llmUsageSummary.outputTokens, 18);
  assert.equal(data.llmUsageSummary.totalTokens, 1218);
  assert.equal(data.llmUsageSummary.cacheCreationInputTokens, 100);
  assert.equal(data.llmUsageSummary.cacheReadInputTokens, 200);
});

runScenario('stag cannot move onto a rabbit during its turn', () => {
  const manager = createManager({
    stagStart: [3, 5],
  });
  manager.stagAgent = { getAction: () => [0, 1] };

  manager.moveStag();

  assert.deepEqual(manager.state.stag, [3, 5]);
  assert.equal(manager.stepCount, 1);
  assert.equal(manager.roundData.events[0].agent, 'stag');
});
