import assert from 'node:assert/strict';
import { StagRLAgent } from '../client/src/ai/RLAgent.js';

const agent = new StagRLAgent();

const DEFAULT_OBSTACLES = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6],
  [1, 0], [1, 6],
  [2, 0], [2, 6],
  [4, 0], [4, 6],
  [5, 0], [5, 6],
  [2, 3],
  [4, 2], [4, 4],
];

function applyAction(pos, action) {
  return [pos[0] + action[0], pos[1] + action[1]];
}

function runScenario(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runScenario('starting board snapshot does not default to stay', () => {
  const action = agent.getAction([3, 3], [5, 2], [1, 5], DEFAULT_OBSTACLES);
  assert.notDeepEqual(action, [0, 0]);
});

runScenario('policy never steps directly onto either terminal hunter cell', () => {
  const stag = [3, 3];
  const hunter1 = [3, 2];
  const hunter2 = [0, 0];
  const action = agent.getAction(stag, hunter1, hunter2, []);
  const nextPos = applyAction(stag, action);

  assert.notDeepEqual(nextPos, hunter1);
  assert.notDeepEqual(nextPos, hunter2);
});

runScenario('policy avoids stepping into cooperative trap capture state', () => {
  const stag = [3, 3];
  const hunter1 = [3, 1];
  const hunter2 = [2, 2];
  const action = agent.getAction(stag, hunter1, hunter2, []);
  const nextPos = applyAction(stag, action);

  assert.notDeepEqual(nextPos, [3, 2]);
});

runScenario('stag policy treats rabbit cells as blocked positions', () => {
  const stag = [3, 3];
  const hunter1 = [5, 2];
  const hunter2 = [1, 5];
  const rabbits = [[3, 4], [3, 0]];
  const action = agent.getAction(stag, hunter1, hunter2, DEFAULT_OBSTACLES, rabbits);
  const nextPos = applyAction(stag, action);

  assert.notDeepEqual(nextPos, rabbits[0]);
  assert.notDeepEqual(nextPos, rabbits[1]);
});

runScenario('symmetric states are deterministic', () => {
  const actions = Array.from({ length: 5 }, () => agent.getAction([3, 3], [3, 1], [3, 5], []));
  for (let i = 1; i < actions.length; i++) {
    assert.deepEqual(actions[i], actions[0]);
  }
});

runScenario('distance reward prefers the safe move with larger total distance to both hunters', () => {
  const action = agent.getAction([3, 3], [3, 1], [6, 6], []);
  assert.deepEqual(action, [-1, 0]);
});

runScenario('policy moves instead of staying when a move increases total distance reward', () => {
  const action = agent.getAction([3, 3], [3, 0], [6, 6], []);
  assert.deepEqual(action, [-1, 0]);
});

runScenario('total-distance reward breaks ties that nearest-hunter distance alone would not', () => {
  const action = agent.getAction([3, 3], [3, 1], [0, 6], []);
  assert.deepEqual(action, [1, 0]);
});

runScenario('mobility tie-break still prefers open branch when distance rewards are equal', () => {
  const stag = [3, 3];
  const hunter1 = [0, 0];
  const hunter2 = [6, 6];
  const obstacles = [[2, 2], [4, 2], [3, 1], [4, 3]];
  const action = agent.getAction(stag, hunter1, hunter2, obstacles);

  assert.deepEqual(action, [0, 1]);
});

runScenario('terminal stag state on a hunter cell has reward -10 and stay policy', () => {
  const snapshot = agent.getPolicySnapshot(DEFAULT_OBSTACLES);
  const stagId = snapshot.coordToId.get('5,2');
  const hunter1Id = snapshot.coordToId.get('5,2');
  const hunter2Id = snapshot.coordToId.get('1,5');
  const pairKey = `${hunter1Id}|${hunter2Id}`;
  const values = snapshot.valuesByHunterPair.get(pairKey);
  const policy = snapshot.policyByHunterPair.get(pairKey);

  assert.equal(values[stagId], -10);
  assert.deepEqual(agent.getAction([5, 2], [5, 2], [1, 5], DEFAULT_OBSTACLES), [0, 0]);
  assert.equal(policy[stagId], 4);
});
