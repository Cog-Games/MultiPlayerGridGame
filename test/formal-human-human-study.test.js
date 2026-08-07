import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../client/src/config/gameConfig.js';
import {
  DIRECT_HUMAN_VLM_2P3G_TEST_ID,
  FORMAL_HUMAN_HUMAN_STUDY_ID,
  TEST_HUMAN_HUMAN_STUDY_ID,
  applyDirectHumanVlm2P3GTest,
  applyFormalHumanHumanStudy,
  applyTestHumanHumanStudy,
  isDirectHumanVlm2P3GTest,
  isFormalHumanHumanStudy,
  isTestHumanHumanStudy
} from '../client/src/config/formalHumanHumanStudy.js';
import { NewGoalGenerator } from '../client/src/utils/NewGoalGenerator.js';
import { GameRoomManager } from '../server/gameRoomManager.js';
import {
  VLM_BASE_PROMPT_VERSION,
  __debug_buildBasePrompt,
  __debug_parseBaseVlmAction,
  getVlmConfigInfo
} from '../server/ai/gptAgent.js';
import { WaitingMinigame } from '../client/src/timeline/WaitingMinigame.js';
import { VlmAgentClient } from '../client/src/ai/VlmAgentClient.js';

test('formal Human-Human preset locks the four-stage design and fallback', () => {
  const config = structuredClone(CONFIG);
  applyFormalHumanHumanStudy(config);

  assert.equal(isFormalHumanHumanStudy(`?study=${FORMAL_HUMAN_HUMAN_STUDY_ID}`), true);
  assert.deepEqual(config.game.experiments.order, ['1P1G', '1P2G', '2P2G', '2P3G']);
  assert.deepEqual(config.game.experiments.numTrials, {
    '1P1G': 3,
    '1P2G': 12,
    '2P2G': 8,
    '2P3G': 12
  });
  assert.equal(config.game.timing.waitingForPartnerMaxDuration, 300_000);
  assert.equal(config.multiplayer.allowWaitingSkip, false);
  assert.equal(config.multiplayer.waitingMinigame.enabled, true);
  assert.equal(config.multiplayer.waitingMinigame.designSource, 'kids-branch-space-hop-v1');
  assert.equal(config.multiplayer.fallbackAIType, 'vlm');
  assert.equal(config.game.agent.vlm.model, 'gpt-5.6-luna');
  assert.equal(config.game.agent.vlm.profile, 'human-human-fallback-luna-fast');
  assert.equal(config.game.agent.vlm.serviceTier, 'fast');
  assert.equal(config.game.agent.vlm.reasoningEffort, 'none');
});

test('short Human-Human QA preset has one trial per game and ENTER fallback', () => {
  const config = structuredClone(CONFIG);
  applyTestHumanHumanStudy(config);

  assert.equal(isTestHumanHumanStudy(`?study=${TEST_HUMAN_HUMAN_STUDY_ID}`), true);
  assert.equal(config.study.formal, false);
  assert.equal(config.study.test, true);
  assert.equal(config.study.requiresRealMatchmaking, true);
  assert.deepEqual(config.game.experiments.numTrials, {
    '1P1G': 1,
    '1P2G': 1,
    '2P2G': 1,
    '2P3G': 1
  });
  assert.equal(config.game.fullscreen.defaultEnabled, false);
  assert.equal(config.game.timing.waitingForPartnerMinDuration, 0);
  assert.equal(config.multiplayer.allowWaitingSkip, true);
  assert.equal(config.multiplayer.waitingSkipKey, 'Enter');
  assert.equal(config.multiplayer.matchPool, TEST_HUMAN_HUMAN_STUDY_ID);
});

test('direct Human–VLM QA preset runs one windowed 2P3G trial with the current prompt', () => {
  const config = structuredClone(CONFIG);
  applyDirectHumanVlm2P3GTest(config);

  assert.equal(isDirectHumanVlm2P3GTest(`?study=${DIRECT_HUMAN_VLM_2P3G_TEST_ID}`), true);
  assert.deepEqual(config.game.experiments.order, ['2P3G']);
  assert.equal(config.game.experiments.numTrials['2P3G'], 1);
  assert.equal(config.game.players.player1.type, 'human');
  assert.equal(config.game.players.player2.type, 'vlm');
  assert.equal(config.game.fullscreen.defaultEnabled, false);
  assert.equal(config.game.successThreshold.enabled, false);
  assert.equal(config.study.promptVersion, VLM_BASE_PROMPT_VERSION);
  assert.equal(config.game.agent.vlm.model, 'gpt-5.6-luna');
  assert.equal(config.game.agent.vlm.profile, 'human-human-fallback-luna-fast');
});

test('formal Luna profile resolves independently of server defaults', () => {
  const info = getVlmConfigInfo('human-human-fallback-luna-fast');
  assert.equal(info.model, 'gpt-5.6-luna');
  assert.equal(info.serviceTier, 'fast');
  assert.equal(info.reasoningEffort, 'none');
  assert.equal(info.basePromptVersion, VLM_BASE_PROMPT_VERSION);
  assert.equal(info.profile, 'human-human-fallback-luna-fast');
  assert.throws(() => getVlmConfigInfo('unknown-profile'), /Unknown VLM execution profile/);
});

test('VLM prompt exposes human-visible mechanics without derived legal actions', () => {
  const prompt = __debug_buildBasePrompt({
    matrix: [
      [1, 0, 4],
      [0, 3, 0],
      [2, 0, 3]
    ],
    currentPlayer: { label: 'player1', pos: [0, 0] },
    goals: [[1, 1], [2, 2]],
    guidance: VlmAgentClient.guidanceFor('2P3G'),
    memory: {
      enabled: true,
      trajectories: {
        player1: [[0, 0]],
        player2: [[2, 0]]
      }
    }
  });

  assert.match(prompt, /4=obstacle \(cannot be entered\)/);
  assert.match(prompt, /Traveler1 \(red\): \(0, 0\)/);
  assert.match(prompt, /Traveler2 \(orange\): \(2, 0\)/);
  assert.match(prompt, /YOU ARE: Traveler 1 \(red\)/);
  assert.match(prompt, /same player as before/);
  assert.match(prompt, /Both players move one step at a time/);
  assert.match(prompt, /10 points/);
  assert.doesNotMatch(prompt, /as quickly as possible/);
  assert.doesNotMatch(prompt, /Legal actions/i);
  assert.doesNotMatch(prompt, /nearestGoal|manhattanDistance|deltaToNearest/);
  assert.equal(Object.hasOwn(VlmAgentClient, 'buildRelativeInfo'), false);
});

test('VLM output parser rejects prose instead of choosing a random action', () => {
  assert.equal(__debug_parseBaseVlmAction('up'), 'up');
  assert.equal(__debug_parseBaseVlmAction(' RIGHT '), 'right');
  assert.equal(__debug_parseBaseVlmAction('up because it is shorter'), null);
  assert.equal(__debug_parseBaseVlmAction(''), null);
});

test('matchmaking isolates formal participants by pool and game', () => {
  const rooms = new GameRoomManager();
  const formalRoom = rooms.joinRoom('formal-1', null, 'human-human', '2P2G', FORMAL_HUMAN_HUMAN_STUDY_ID);
  const defaultRoom = rooms.joinRoom('default-1', null, 'human-human', '2P2G', 'default');
  const formalPartnerRoom = rooms.joinRoom('formal-2', null, 'human-human', '2P2G', FORMAL_HUMAN_HUMAN_STUDY_ID);
  const laterGameRoom = rooms.joinRoom('formal-3', null, 'human-human', '2P3G', FORMAL_HUMAN_HUMAN_STUDY_ID);

  assert.equal(formalPartnerRoom.id, formalRoom.id);
  assert.equal(formalRoom.players.length, 2);
  assert.notEqual(defaultRoom.id, formalRoom.id);
  assert.notEqual(laterGameRoom.id, formalRoom.id);

  const staleRooms = new GameRoomManager();
  const abandoned = staleRooms.joinRoom('timed-out', null, 'human-human', '2P2G', FORMAL_HUMAN_HUMAN_STUDY_ID);
  staleRooms.leaveRoom('timed-out');
  const nextParticipant = staleRooms.joinRoom('next', null, 'human-human', '2P2G', FORMAL_HUMAN_HUMAN_STUDY_ID);
  assert.notEqual(nextParticipant.id, abandoned.id);
});

test('2P3G rule requires exact joint distance and correct condition geometry', () => {
  const closerP2 = NewGoalGenerator.meetsDistanceCondition(
    NewGoalGenerator.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2,
    7, 5, 5, 7, 12, 12
  );
  const wrongJointDistance = NewGoalGenerator.meetsDistanceCondition(
    NewGoalGenerator.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2,
    8, 5, 5, 7, 13, 12
  );
  const equalToBoth = NewGoalGenerator.meetsDistanceCondition(
    NewGoalGenerator.DISTANCE_CONDITIONS.EQUAL_TO_BOTH,
    6, 6, 4, 8, 12, 12
  );

  assert.equal(NewGoalGenerator.GOAL_GEOMETRY_RULE_VERSION, 'adult-rl-aligned-exact-joint-v1');
  assert.equal(closerP2, true);
  assert.equal(wrongJointDistance, false);
  assert.equal(equalToBoth, true);
});

test('waiting mini-game captures SPACE and removes every global listener on stop', () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  let cancelledFrame = null;
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    requestAnimationFrame() {
      return 17;
    },
    cancelAnimationFrame(frameId) {
      cancelledFrame = frameId;
    }
  };

  try {
    const canvas = {
      getContext: () => ({ setTransform() {} }),
      getBoundingClientRect: () => ({ width: 640, height: 240 }),
      width: 640,
      height: 240
    };
    const minigame = new WaitingMinigame(canvas);
    const startStats = minigame.start();
    let prevented = false;
    let stopped = false;
    minigame.handleKeyDown({
      code: 'Space',
      key: ' ',
      repeat: false,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; }
    });
    const endStats = minigame.stop();

    assert.equal(startStats.enabled, true);
    assert.equal(endStats.jumpCount, 1);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(cancelledFrame, 17);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});
