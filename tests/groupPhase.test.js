import assert from 'node:assert/strict';
import { GroupForagingStateManager } from '../client/src/game/GroupForagingStateManager.js';

function runScenario(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createManager(overrides = {}) {
  const manager = new GroupForagingStateManager();
  manager.initializePhase({
    size: 19,
    playerStarts: {
      player1: [1, 1],
      player2: [17, 17],
      player3: [1, 17],
      player4: [17, 1],
    },
    stags: [[9, 9]],
    rabbits: [[1, 2]],
    obstacles: [],
    ...overrides,
  });
  return manager;
}

runScenario('small target collection adds food and does not end the group phase', () => {
  const manager = createManager();

  manager.movePlayer('player1', [0, 1]);

  assert.equal(manager.stepCount, 1);
  assert.equal(manager.state.inventories.player1, 3);
  assert.equal(manager.state.rabbits[0], null);
  assert.equal(manager.events[0].captures[0].type, 'small');
});

runScenario('large target collection rewards all adjacent participants', () => {
  const manager = createManager({
    playerStarts: {
      player1: [9, 8],
      player2: [9, 10],
      player3: [1, 17],
      player4: [17, 1],
    },
    stags: [[9, 9]],
    rabbits: [],
  });

  const captures = manager.collectFood('player1');

  assert.equal(captures[0].type, 'large');
  assert.deepEqual(captures[0].players, ['player1', 'player2']);
  assert.equal(manager.state.inventories.player1, 10);
  assert.equal(manager.state.inventories.player2, 10);
  assert.equal(manager.state.stags[0], null);
});

runScenario('large moving target chooses a directional move when one is available', () => {
  const manager = createManager({
    playerStarts: {
      player1: [1, 1],
      player2: [17, 17],
      player3: [1, 17],
      player4: [17, 1],
    },
    stags: [[9, 9]],
    rabbits: [],
    obstacles: [],
  });

  const action = manager.getStagMovement([9, 9], 0);

  assert.notDeepEqual(action, [0, 0]);
});

runScenario('large moving targets do not move onto the same cell', () => {
  const manager = createManager({
    stags: [[9, 8], [9, 10]],
    rabbits: [],
    obstacles: [[8, 8], [10, 8], [9, 7], [8, 10], [10, 10], [9, 11]],
  });

  manager.moveStags();

  const occupied = manager.state.stags
    .filter(Boolean)
    .map(pos => `${pos[0]},${pos[1]}`);

  assert.equal(new Set(occupied).size, occupied.length);
  assert(occupied.includes('9,9'));
});

runScenario('sharing resolves keep, dyad, and group public-good choices', () => {
  const manager = createManager();
  manager.state.inventories = {
    player1: 10,
    player2: 0,
    player3: 6,
    player4: 6,
  };

  const outcome = manager.resolveSharing({
    player1: 'group',
    player2: 'keep',
    player3: 'dyad',
    player4: 'keep',
  });

  assert.equal(outcome.publicPool, 10);
  assert.equal(outcome.publicShare, 3.75);
  assert.equal(outcome.phasePayoffs.player1, 3.75);
  assert.equal(outcome.phasePayoffs.player2, 3.75);
  assert.equal(outcome.phasePayoffs.player3, 6.75);
  assert.equal(outcome.phasePayoffs.player4, 12.75);
});
