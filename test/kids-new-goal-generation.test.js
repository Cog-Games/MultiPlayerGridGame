import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../client/src/config/gameConfig.js';
import { NewGoalGenerator as G } from '../client/src/utils/NewGoalGenerator.js';
import { GameStateManager } from '../client/src/game/GameStateManager.js';

// MapLoader initializes on import. These tests never request a live server.
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 503 });
const { ExperimentManager } = await import('../client/src/experiments/ExperimentManager.js');
globalThis.fetch = oldFetch;
const EQUAL = 'equal_to_both';
const CLOSER = 'closer_to_player1';
const generator = (p1,p2,goals,condition,balance={}) => G.generateNewGoal(p2,p1,goals,0,condition,
  {allowTolerance:true,balance});

function fixture(condition=EQUAL) {
  const gsm = new GameStateManager();
  gsm.currentState = { experimentType:'2P3G', trialIndex:0, player1:[0,0], player2:[2,0],
    currentGoals:[[1,2],[14,14]], gridMatrix:Array.from({length:15},()=>Array(15).fill(0)), distanceCondition:condition };
  Object.assign(gsm.trialData,{experimentType:'2P3G',trialIndex:0,trialStartTime:10,distanceCondition:condition,
    newGoalAllocationPolicy:'fixed-schedule',
    firstDetectedSharedGoal:0,player1CurrentGoal:[0],player2CurrentGoal:[0]});
  gsm.stepCount=1;
  const manager=Object.create(ExperimentManager.prototype);
  Object.assign(manager,{gameStateManager:gsm,timelineManager:{playerIndex:0},uiManager:{updateGameDisplay(){}},rlAgent:null});
  return {gsm,manager};
}

test('strict rules match vlm: unequal old distances allowed, minimum improvement is inclusive',()=>{
  assert(G.meetsDistanceCondition(EQUAL,6,6,4,8,12,12));
  assert(!G.meetsDistanceCondition(EQUAL,5,7,4,8,12,12));
  assert(G.meetsDistanceCondition(CLOSER,3,7,5,5,10,10));
  assert(!G.meetsDistanceCondition(CLOSER,4,6,5,5,10,10));
  assert(!G.meetsDistanceCondition(CLOSER,3,8,5,5,11,10));
});

test('strict candidate always wins over repaying an earlier tolerance debt',()=>{
  const g=generator([0,0],[4,0],[[0,4],[14,14]],EQUAL,{meanDistanceDelta:1,equalDistanceGap:1});
  assert.equal(g.generationMode,'strict');
  assert.equal(g.meanDistanceDelta,0);
  assert.equal(g.distanceDifferenceBetweenPlayers,0);
  assert.equal(g.balanceAfter.meanDistanceDelta,1);
});

test('mean distance +/-1 errors cancel on the next feasible relaxed trial',()=>{
  const p1=[0,0],p2=[2,0],goals=[[1,2],[14,14]];
  // The only strict equidistant position is the occupied old goal.
  const a=generator(p1,p2,goals,EQUAL,{meanDistanceDelta:-1,equalDistanceGap:0});
  assert.equal(a.strictCandidateCount,0);
  assert.equal(a.meanDistanceDelta,1);
  assert.equal(a.jointDistanceDelta,2);
  assert.equal(a.balanceAfter.meanDistanceDelta,0);
  const b=generator(p1,p2,goals,EQUAL,{meanDistanceDelta:1,equalDistanceGap:0});
  assert.equal(b.meanDistanceDelta,-1);
  assert.equal(b.balanceAfter.meanDistanceDelta,0);
});

test('odd-parity equal-distance gaps +/-1 cancel when both signs are possible',()=>{
  const p1=[0,0],p2=[0,1],goals=[[7,7],[14,14]];
  const a=generator(p1,p2,goals,EQUAL,{meanDistanceDelta:0,equalDistanceGap:-1});
  assert.equal(a.generationMode,'bounded-tolerance');
  assert.equal(a.distanceDifferenceBetweenPlayers,1);
  assert.equal(a.balanceAfter.equalDistanceGap,0);
  const b=generator(p1,p2,goals,EQUAL,{meanDistanceDelta:0,equalDistanceGap:1});
  assert.equal(b.distanceDifferenceBetweenPlayers,-1);
  assert.equal(b.balanceAfter.equalDistanceGap,0);
});

test('100 repeated opportunities stay bounded; failed searches and previews do not consume balance',()=>{
  let balance=G.emptyBalance();
  for(let i=0;i<100;i++){
    const before=structuredClone(balance);
    const g=generator([0,0],[0,1],[[7,7],[14,14]],EQUAL,balance);
    assert.deepEqual(balance,before);
    balance=g.balanceAfter;
    assert(Math.abs(balance.equalDistanceGap)<=1);
    assert(Math.abs(balance.meanDistanceDelta)<=1);
  }
  assert.equal(balance.equalDistanceGap,0);
  assert.equal(generator([6,7],[6,7],[[1,7],[13,7]],CLOSER,balance),null);
  assert.equal(balance.generatedCount,100);
});

test('all generated candidates respect bounded geometry, occupancy and signed closer condition',()=>{
  for(let a=0;a<7;a++) for(let b=0;b<7;b++) for(const cond of [EQUAL,CLOSER,'closer_to_player2']){
    const p1=[a,2],p2=[b,12],goals=[[1,7],[13,7]],g=generator(p1,p2,goals,cond);
    if(!g) continue;
    assert(Math.abs(g.meanDistanceDelta)<=1);
    assert(![...goals,p1,p2].some(p=>JSON.stringify(p)===JSON.stringify(g.position)));
    if(cond===EQUAL) assert(Math.abs(g.distanceDifferenceBetweenPlayers)<=1);
    else {
      assert(g.targetedDistanceImprovement>=1);
      const other=cond===CLOSER ? g.distanceToPlayer2-g.oldDistanceToPlayer2 : g.distanceToPlayer1-g.oldDistanceToPlayer1;
      assert(other>=0);
    }
  }
  assert.equal(G.generateNewGoal([2,0],[0,0],[[1,2],[14,14]],-1,EQUAL),null);
  assert.equal(generator([0,0],[2,0],[[1,2],[14,14]],'no_new_goal'),null);
});

test('actual synchronous move methods never latch a cross-round shared goal',()=>{
  for(const mapped of [false,true]){
    const {gsm}=fixture(CLOSER);
    gsm.trialData.firstDetectedSharedGoal=null;
    gsm.trialData.player1CurrentGoal=[1];gsm.trialData.player2CurrentGoal=[0];
    // Control only per-actor inference to isolate scheduling of the real shared check.
    const real=gsm.detectAndRecordGoals.bind(gsm);
    gsm.detectAndRecordGoals=(p,action,defer)=>{
      assert.equal(defer,true);
      gsm.trialData[`player${p}CurrentGoal`].push(p===1 ? 0 : 1);
      if(!defer) gsm.detectSharedGoal();
    };
    let callbackCount=0;
    gsm.afterMove=()=>{callbackCount++;assert.deepEqual([gsm.trialData.player1CurrentGoal.at(-1),gsm.trialData.player2CurrentGoal.at(-1)],[0,1]);};
    if(mapped) gsm.processSynchronizedMovesMapped(2,'right','right');
    else gsm.processSynchronizedMoves('right','right');
    assert.equal(gsm.trialData.firstDetectedSharedGoal,null);
    assert.equal(callbackCount,1);
    gsm.detectAndRecordGoals=real;
    gsm.trialData.player1CurrentGoal.push(1);gsm.detectSharedGoal();
    assert.equal(gsm.trialData.firstDetectedSharedGoal,1);
  }
});

test('controller applies once, logs metadata, synchronizes guest round/balance, and persists across trials',()=>{
  const oldTypes=[CONFIG.game.players.player1.type,CONFIG.game.players.player2.type];
  CONFIG.game.players.player1.type=CONFIG.game.players.player2.type='human';
  try {
    const {gsm,manager}=fixture();
    manager.tryPresentNewGoal2P3G();manager.tryPresentNewGoal2P3G();
    assert.equal(gsm.currentState.currentGoals.length,3);
    assert.equal(gsm.goalGenerationBalance[EQUAL].generatedCount,1);
    assert.equal(gsm.trialData.newGoalStatus,'presented');
    assert.equal(gsm.trialData.newGoalGenerationAttempts.length,1);
    const metadata=structuredClone(gsm.currentState.newGoalMetadata);
    gsm.syncState({ ...gsm.getCurrentState(), currentGoals:[[1,2],[14,14]], newGoalMetadata:null });
    assert.deepEqual(gsm.currentState.newGoalMetadata,metadata);
    const guest=fixture().gsm;
    guest.stepCount=0;
    guest.syncState(structuredClone(gsm.getCurrentState()));
    guest.syncState(structuredClone(gsm.getCurrentState()));
    assert.equal(guest.trialData.newGoalPresentedTime,1);
    assert.deepEqual(guest.goalGenerationBalance,gsm.goalGenerationBalance);
    const bankBefore=structuredClone(gsm.goalGenerationBalance);
    gsm.adoptGoalGenerationBalance(EQUAL,{meanDistanceDelta:99,equalDistanceGap:99,generatedCount:0,relaxedCount:0});
    assert.deepEqual(gsm.goalGenerationBalance,bankBefore);
    gsm.adoptGoalGenerationBalance(CLOSER,{meanDistanceDelta:1,equalDistanceGap:0,generatedCount:1,relaxedCount:1});
    assert.deepEqual(gsm.goalGenerationBalance[EQUAL],bankBefore[EQUAL]);
    const fields=JSON.parse(JSON.stringify(gsm.trialData));
    assert.equal(fields.newGoalMetadata.geometryRuleVersion,G.GOAL_GEOMETRY_RULE_VERSION);
    assert.equal(fields.newGoalBalanceAfter.generatedCount,1);
    const debt=structuredClone(gsm.goalGenerationBalance);
    gsm.initializeTrial(1,'2P3G',{initPlayerGrid:[0,0],initAIGrid:[2,0],target1:[1,2],target2:[14,14]});
    assert.deepEqual(gsm.goalGenerationBalance,debt);
    assert.equal(gsm.trialData.newGoalBalanceAfter,null);
    assert.equal(gsm.trialData.newGoalMetadata,null);
    assert.equal(gsm.trialData.newGoalGenerationAttempts.length,0);
    gsm.reset();assert.deepEqual(gsm.goalGenerationBalance,{});
  } finally {[CONFIG.game.players.player1.type,CONFIG.game.players.player2.type]=oldTypes;}
});

test('controller distinguishes missing opportunities, does not generate late, and blocks guest generation',()=>{
  const oldTypes=[CONFIG.game.players.player1.type,CONFIG.game.players.player2.type];
  CONFIG.game.players.player1.type=CONFIG.game.players.player2.type='human';
  try {
    let {gsm,manager}=fixture();
    manager.timelineManager.playerIndex=1;manager.tryPresentNewGoal2P3G();
    assert.equal(gsm.trialData.newGoalPresented,false);
    manager.timelineManager.playerIndex=0;gsm.currentState.player1=[1,2];manager.tryPresentNewGoal2P3G();
    assert.equal(gsm.trialData.newGoalStatus,'player_already_finished');
    assert.equal(gsm.trialData.newGoalPresented,false);
    ({gsm,manager}=fixture(CLOSER));
    gsm.currentState.player1=[6,7];gsm.currentState.player2=[6,7];gsm.currentState.currentGoals=[[1,7],[13,7]];
    manager.tryPresentNewGoal2P3G();manager.tryPresentNewGoal2P3G();
    assert.equal(gsm.trialData.newGoalStatus,'no_candidate_within_tolerance');
    assert.equal(gsm.trialData.newGoalGenerationAttempts.length,1);
    assert.deepEqual(gsm.goalGenerationBalance,{});
    ({gsm,manager}=fixture('no_new_goal'));manager.tryPresentNewGoal2P3G();
    assert.equal(gsm.trialData.newGoalStatus,'planned_no_new_goal');
    assert.equal(gsm.currentState.currentGoals.length,2);
  } finally {[CONFIG.game.players.player1.type,CONFIG.game.players.player2.type]=oldTypes;}
});

test('round callback lifecycle installs, cleans up, and does not leak to another game',()=>{
  const {gsm,manager}=fixture();
  manager.setupNewGoalCheck2P3G();assert.equal(typeof gsm.afterMove,'function');
  manager.clearGameIntervals();assert.equal(gsm.afterMove,null);assert.equal(manager.newGoalIntervalId,null);
});
