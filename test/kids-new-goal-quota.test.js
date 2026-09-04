import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../client/src/config/gameConfig.js';
import { GameStateManager } from '../client/src/game/GameStateManager.js';
import { NewGoalGenerator as G } from '../client/src/utils/NewGoalGenerator.js';
import { NewGoalQuotaScheduler as Q } from '../client/src/utils/NewGoalQuotaScheduler.js';

const oldFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 503 });
const { ExperimentManager } = await import('../client/src/experiments/ExperimentManager.js');
globalThis.fetch = oldFetch;
const [C1, C2, EQ] = Q.CONDITIONS;
const NO = 'no_new_goal';
const schedule = [C1, NO, EQ, C2, EQ, NO, C1, C2];
const design = { initPlayerGrid:[0,7], initAIGrid:[14,7], target1:[7,1], target2:[14,14] };
const bank = (count, mean = 0, gap = 0) => ({ generatedCount:count, relaxedCount:0,
  meanDistanceDelta:mean, equalDistanceGap:gap });
const select = (balances = {}, options = {}) => Q.select({ player1:[0,7], player2:[14,7],
  goals:[[7,1],[14,14]], referenceGoal:0, balances, random:()=>0, ...options });

function ready(gsm = new GameStateManager(), index = 0, planned = schedule[index], map = design) {
  gsm.conditionSequences['2P3G'] ||= [...schedule];
  gsm.conditionSequences['2P3G'][index] = planned;
  gsm.initializeTrial(index, '2P3G', map);
  gsm.trialData.player1CurrentGoal = [0];
  gsm.trialData.player2CurrentGoal = [0];
  gsm.trialData.firstDetectedSharedGoal = 0;
  gsm.stepCount = 1;
  const manager = Object.create(ExperimentManager.prototype);
  Object.assign(manager, { gameStateManager:gsm, timelineManager:{playerIndex:0},
    uiManager:{updateGameDisplay(){}}, rlAgent:null });
  return { gsm, manager };
}

test('default stays at eight trials with exactly two preassigned control slots', t => {
  t.mock.method(console, 'log', () => {});
  assert.equal(CONFIG.game.experiments.numTrials['2P3G'], 8);
  assert.equal(CONFIG.twoP3G.conditionQuota.enabled, true);
  const gsm = new GameStateManager();
  for (let seed = 0; seed < 100; seed++) {
    const sequence = gsm.generateBalancedConditionSequence([...Q.CONDITIONS, NO], 8, seed);
    assert.equal(sequence.length, 8);
    for (const condition of [...Q.CONDITIONS, NO]) assert.equal(sequence.filter(c => c === condition).length, 2);
  }
  CONFIG.game.experiments.numTrials['2P3G'] = 12;
  try { assert.throws(() => gsm.getRandomDistanceConditionFor2P3G(0), /trial count must match/); }
  finally { CONFIG.game.experiments.numTrials['2P3G'] = 8; }
});

test('a real eight-trial session fills 2/2/2/2 using presentation counts regardless of collaboration success', t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const gsm = new GameStateManager();
  for (let index = 0; index < 8; index++) {
    const { manager } = ready(gsm, index);
    manager.tryPresentNewGoal2P3G();
    manager.tryPresentNewGoal2P3G();
    assert.equal(gsm.trialData.newGoalPresented, schedule[index] !== NO);
    gsm.finalizeTrial(false);
    gsm.finalizeTrial(false);
    for (const count of Object.values(Q.counts(gsm.goalGenerationBalance))) assert(count <= 2);
  }
  const trials = gsm.experimentData.allTrialsData;
  assert.equal(trials.length, 8);
  assert(trials.every(t => !t.collaborationSucceeded));
  assert.equal(trials.filter(t => t.newGoalPresented).length, 6);
  const summary = trials.at(-1).newGoalQuotaSummary;
  assert.deepEqual(summary.realized, { [C1]:2, [C2]:2, [EQ]:2, [NO]:2 });
  assert.equal(summary.failedNewGoalTrials, 0);
  assert.equal(summary.targetReached, true);
  assert.equal(summary.completedTrials, summary.trialLimit);
});

test('coincident players can reallocate a closer slot to equal, but never exceed the equal quota', t => {
  t.mock.method(console, 'log', () => {});
  const gsm = new GameStateManager();
  const coincident = { ...design, initPlayerGrid:[6,7], initAIGrid:[6,7], target1:[1,7], target2:[13,7] };
  for (let i = 0; i < 3; i++) {
    const { manager } = ready(gsm, i, C1, coincident);
    manager.tryPresentNewGoal2P3G();
    manager.tryPresentNewGoal2P3G();
    if (i < 2) {
      assert.equal(gsm.trialData.newGoalScheduledCondition, C1);
      assert.equal(gsm.trialData.distanceCondition, EQ);
      assert.equal(gsm.trialData.newGoalRealizedCondition, EQ);
      assert.equal(gsm.trialData.newGoalConditionReassigned, true);
      assert.equal(gsm.trialData.newGoalQuotaBefore[EQ], i);
      assert.equal(gsm.trialData.newGoalQuotaAfter[EQ], i + 1);
      assert.equal(gsm.currentState.currentGoals.length, 3);
    } else {
      assert.equal(gsm.trialData.newGoalPresented, false);
      assert.equal(gsm.trialData.newGoalRealizedCondition, null);
      assert.equal(gsm.trialData.newGoalStatus, 'no_candidate_for_remaining_quota');
      assert.equal(gsm.trialData.newGoalGenerationAttempts.length, 1);
      assert.equal(gsm.trialData.newGoalGenerationAttempts[0].conditionCandidates[EQ].status, 'quota_filled');
    }
    gsm.finalizeTrial(false);
  }
  assert.deepEqual(Q.counts(gsm.goalGenerationBalance), { [C1]:0, [C2]:0, [EQ]:2 });
  assert.equal(gsm.trialData.newGoalQuotaSummary.realized[NO], 0);
  assert.equal(gsm.trialData.newGoalQuotaSummary.failedNewGoalTrials, 1);
});

test('selection prioritizes remaining quota, reserves equal when deficits tie, and searches without mutation', () => {
  const balances = { [C1]:bank(1), [C2]:bank(2) };
  const before = structuredClone(balances);
  const result = select(balances);
  assert.equal(result.goal.conditionType, EQ);
  assert.deepEqual(balances, before);
  assert.equal(result.diagnostics.conditionCandidates[C2].status, 'quota_filled');
  const tied = select();
  assert.equal(tied.goal.conditionType, C1);
  assert(!tied.diagnostics.selectionPool.includes(EQ));
  assert.equal(select({}, {random:()=>0.999}).goal.conditionType, C2);
  const full = select({ [C1]:bank(2), [C2]:bank(2), [EQ]:bank(2) });
  assert.equal(full.goal, null);
  assert.equal(full.reason, 'new_goal_quota_filled');
});

test('dynamic quota retains signed tolerance compensation within the selected condition', () => {
  const balances = { [C1]:bank(2), [C2]:bank(2), [EQ]:bank(1, -1) };
  const { goal } = select(balances, { player1:[0,0], player2:[2,0], goals:[[1,2],[14,14]] });
  assert.equal(goal.conditionType, EQ);
  assert.equal(goal.generationMode, 'bounded-tolerance');
  assert.equal(goal.meanDistanceDelta, 1);
  assert.equal(goal.balanceAfter.meanDistanceDelta, 0);
  assert.deepEqual(goal.quotaAfter, { [C1]:2, [C2]:2, [EQ]:2 });
  assert.equal(balances[EQ].meanDistanceDelta, -1);
});

test('controls and missing shared intention neither consume new-goal quota nor become substitute controls', t => {
  t.mock.method(console, 'log', () => {});
  const gsm = new GameStateManager();
  let { manager } = ready(gsm, 0, NO);
  manager.tryPresentNewGoal2P3G();
  gsm.finalizeTrial(false);
  assert.equal(gsm.trialData.newGoalRealizedCondition, NO);
  assert.deepEqual(Q.counts(gsm.goalGenerationBalance), { [C1]:0, [C2]:0, [EQ]:0 });
  ({ manager } = ready(gsm, 1, C1));
  gsm.trialData.player1CurrentGoal = [0];
  gsm.trialData.player2CurrentGoal = [1];
  gsm.trialData.firstDetectedSharedGoal = null;
  manager.tryPresentNewGoal2P3G();
  assert.equal(gsm.trialData.newGoalStatus, 'no_shared_goal_yet');
  gsm.finalizeTrial(false);
  assert.equal(gsm.trialData.newGoalRealizedCondition, null);
  assert.equal(gsm.trialData.newGoalQuotaSummary.realized[NO], 1);
  assert.equal(gsm.trialData.newGoalQuotaSummary.failedNewGoalTrials, 1);
});

test('host decision and all condition counts survive duplicate sync, stale schedule packets, and canonical completion', t => {
  t.mock.method(console, 'log', () => {});
  const types = [CONFIG.game.players.player1.type, CONFIG.game.players.player2.type];
  CONFIG.game.players.player1.type = CONFIG.game.players.player2.type = 'human';
  try {
    const map = { ...design, initPlayerGrid:[6,7], initAIGrid:[6,7], target1:[1,7], target2:[13,7] };
    const host = ready(undefined, 0, C1, map);
    host.gsm.adoptGoalGenerationBalance(C2, bank(1));
    const guest = ready(undefined, 0, C1, map);
    guest.manager.timelineManager.playerIndex = 1;
    guest.manager.tryPresentNewGoal2P3G();
    assert.equal(guest.gsm.trialData.newGoalPresented, false);
    host.manager.tryPresentNewGoal2P3G();
    guest.gsm.stepCount = 77;
    const state = structuredClone(host.gsm.getCurrentState());
    guest.gsm.syncState(state);
    guest.gsm.syncState(structuredClone(state));
    assert.deepEqual(guest.gsm.goalGenerationBalance, host.gsm.goalGenerationBalance);
    assert.equal(guest.gsm.trialData.newGoalPresentedTime, 1);
    assert.equal(guest.gsm.trialData.newGoalScheduledCondition, C1);
    assert.equal(guest.gsm.trialData.distanceCondition, EQ);
    guest.gsm.syncState({ ...state, distanceCondition:C1, newGoalConditionType:C1,
      currentGoals:[[1,7],[13,7]], newGoalMetadata:null });
    assert.equal(guest.gsm.currentState.distanceCondition, EQ);
    assert.equal(guest.gsm.currentState.newGoalMetadata.quotaAfter[EQ], 1);
    const canonicalOnly = ready(undefined, 0, C1, map).gsm;
    canonicalOnly.trialData = structuredClone(host.gsm.trialData);
    canonicalOnly.finalizeTrial(false);
    assert.deepEqual(canonicalOnly.goalGenerationBalance, host.gsm.goalGenerationBalance);
    ready(guest.gsm, 1, NO);
    assert.deepEqual(guest.gsm.trialData.newGoalQuotaAtTrialStart, Q.counts(host.gsm.goalGenerationBalance));
    const before = structuredClone(guest.gsm.goalGenerationBalance);
    guest.gsm.adoptGoalGenerationBalance(EQ, bank(1, 99));
    guest.gsm.adoptGoalGenerationBalance(EQ, bank(-1));
    assert.deepEqual(guest.gsm.goalGenerationBalance, before);
    guest.gsm.initializeTrial(0, '2P2G', design);
    guest.gsm.finalizeTrial(false);
    assert.deepEqual(guest.gsm.goalGenerationBalance, before);
    assert.equal(guest.gsm.trialData.newGoalQuotaSummary, null);
    guest.gsm.reset();
    assert.deepEqual(Q.counts(guest.gsm.goalGenerationBalance), { [C1]:0, [C2]:0, [EQ]:0 });
  } finally { [CONFIG.game.players.player1.type, CONFIG.game.players.player2.type] = types; }
});

test('a rejected board mutation never consumes a presentation or quota', t => {
  t.mock.method(console, 'log', () => {});
  const { gsm, manager } = ready();
  gsm.addGoal = () => {};
  manager.tryPresentNewGoal2P3G();
  assert.equal(gsm.trialData.newGoalStatus, 'goal_add_failed');
  assert.equal(gsm.trialData.newGoalPresented, false);
  assert.deepEqual(gsm.goalGenerationBalance, {});
});
