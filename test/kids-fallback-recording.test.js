import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, GameConfigUtils } from '../client/src/config/gameConfig.js';
import { GameStateManager } from '../client/src/game/GameStateManager.js';
import { DataSyncManager } from '../client/src/utils/DataSyncManager.js';

const design = { initPlayerGrid: [0, 0], initAIGrid: [0, 2], target1: [4, 4], target2: [8, 8] };
const human = () => { GameConfigUtils.setPlayerType(1, 'human'); GameConfigUtils.setPlayerType(2, 'human'); };

test('waiting fallback persists in subsequent games without contaminating warmup or saved trials', () => {
  human();
  const gsm = new GameStateManager();
  gsm.initializeTrial(0, '1P2G', design);
  gsm.finalizeTrial(true);
  const warmup = structuredClone(gsm.experimentData.allTrialsData[0]);
  const type = GameConfigUtils.configureKidCommittedAgent('sa-model');
  GameConfigUtils.setPlayerType(2, type);
  gsm.recordPartnerFallback({ reason: 'waiting-timeout', stage: 'kid-teammate-wait', fallbackAIType: type, aiPlayerNumber: 2 });
  assert.deepEqual(gsm.experimentData.allTrialsData[0], warmup);
  assert.equal(warmup.partnerFallbackOccurred, false);
  for (const game of ['2P2G', '2P3G']) {
    gsm.initializeTrial(0, game, design);
    assert.equal(gsm.trialData.partnerFallbackOccurred, true);
    assert.equal(gsm.trialData.partnerFallbackAIType, 'SA-model');
    assert.equal(gsm.trialData.partnerFallbackFirstStep, 0);
    assert.equal(gsm.trialData.aiPlayerIndex, 1);
  }
  human();
});

test('mid-trial fallback to AI player 1 preserves human segment and records exact boundary', () => {
  human();
  const gsm = new GameStateManager();
  gsm.initializeTrial(0, '2P3G', design);
  gsm.processSynchronizedMoves('down', 'down');
  GameConfigUtils.setPlayerType(1, 'alwaysSignalAgent');
  gsm.recordPartnerFallback({ reason: 'partner-inactivity', fallbackAIType: 'alwaysSignalAgent', aiPlayerNumber: 1 });
  assert.equal(gsm.trialData.partnerFallbackFirstStep, 1);
  assert.equal(gsm.trialData.partnerFallbackEvents[0].eventIndex, 2);
  assert.equal(gsm.trialData.humanPlayerIndex, 1);
  assert.equal(gsm.trialData.mixedPartnerTrial, true);
  assert.equal(gsm.trialData.partnerAgentTypeAtTrialStart, 'human');
  gsm.isMoving = false;
  gsm.processSynchronizedMovesMapped(2, 'down', 'down');
  assert.deepEqual(gsm.trialData.moveEvents.map(e => e.actorType), ['human', 'human', 'alwaysSignalAgent', 'human']);
  gsm.initializeTrial(1, '2P3G', design);
  assert.equal(gsm.trialData.partnerFallbackFirstStep, 0);
  assert.equal(gsm.trialData.aiPlayerIndex, 0);
  assert.equal(gsm.trialData.mixedPartnerTrial, false);
  human();
});

test('each trial owns independent decision histories, geometry and action arrays', () => {
  human();
  const gsm = new GameStateManager();
  gsm.initializeTrial(0, '2P3G', design);
  gsm.trialData.alwaysSignalAgentPlayer2SampledJointGoalHistory = [{ posterior: [.4, .6] }];
  gsm.trialData.sharedAgencyModelParameters = { alpha: .5 };
  gsm.processSynchronizedMoves('down', 'down');
  gsm.markNewGoalPresented([2, 2], 'equal_to_both');
  gsm.finalizeTrial(false);
  const saved = structuredClone(gsm.experimentData.allTrialsData[0]);
  gsm.trialData.alwaysSignalAgentPlayer2SampledJointGoalHistory[0].posterior[0] = 1;
  assert.deepEqual(gsm.experimentData.allTrialsData[0], saved);
  assert.equal(saved.newGoalPresentedAfterEventIndex, 2);
  assert.deepEqual(saved.player1PositionAtNewGoal, [1, 0]);
  gsm.initializeTrial(1, '2P2G', design);
  assert.equal(gsm.trialData.sharedAgencyModelParameters, undefined);
  assert.equal(gsm.trialData.alwaysSignalAgentPlayer2SampledJointGoalHistory, undefined);
  assert.equal(gsm.trialData.newGoalPresentedAtMs, undefined);
  assert.deepEqual(gsm.trialData.moveEvents, []);
});

test('long trials keep a single RT origin; invalid moves and paired rounds remain reconstructable', () => {
  human();
  const gsm = new GameStateManager();
  gsm.initializeTrial(0, '2P2G', design);
  gsm.gameStartTime = Date.now() - 61000;
  gsm.processPlayerMove(1, 'up');
  assert(gsm.trialData.player1RT[0] >= 61000);
  const e = gsm.trialData.moveEvents[0];
  assert.deepEqual(e.before, e.after);
  assert.deepEqual(e.actualAction, [0, 0]);
  gsm.isMoving = false;
  gsm.processSynchronizedMoves('down', 'down');
  assert.deepEqual(gsm.trialData.moveEvents.map(e => e.round), [1, 2, 2]);
  for (const p of [1, 2]) {
    assert.equal(gsm.trialData[`player${p}Actions`].length, gsm.trialData[`player${p}Trajectory`].length);
    assert.equal(gsm.trialData[`player${p}Actions`].length, gsm.trialData[`player${p}RT`].length);
  }
});

test('queued checkpoints snapshot nested trial data before asynchronous persistence', async () => {
  const sync = new DataSyncManager({ uploadEnabled: false });
  let saved;
  sync.putRecord = async record => { await Promise.resolve(); saved = record; };
  const payload = { trialData: { player1Actions: [[1, 0]] } };
  const pending = sync.enqueue('trial_completed', payload);
  payload.trialData.player1Actions.push([0, 1]);
  await pending;
  assert.equal(saved.payload.trialData.player1Actions.length, 1);
});
