#!/usr/bin/env node
/**
 * Joint-RL validation harness.
 *
 * Loads the revised JointBFSPlanner from the client source, validates core
 * reward semantics, and runs map-backed rollouts on the 18-map Stag Hunt set.
 * The checks focus on:
 *   - exact terminal-reward semantics
 *   - no fake `[0, 0]` actions in off-goal planning
 *   - action distributions using only valid cardinal moves
 *   - preference for hare vs. stag matching each map's published utility
 *
 * Run with:
 *   node test-joint-rl.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Minimal browser globals so gameConfig.js and friends load cleanly in Node.
global.window = global.window || { location: { origin: 'http://localhost:3001' } };

const __dirname = dirname(fileURLToPath(import.meta.url));

const { CONFIG, GAME_OBJECTS } = await import('./client/src/config/gameConfig.js');
const { JointBFSPlanner, RL_AGENT_CONFIG } = await import('./client/src/ai/RLAgent.js');

// ---------------------------------------------------------------------------
// Load raw map files (plain JS assigns to a var — evaluate them in a sandbox).
// ---------------------------------------------------------------------------
function loadMapVar(relPath, varName) {
  const src = readFileSync(resolve(__dirname, relPath), 'utf8');
  const fn = new Function(`${src}; return ${varName};`);
  return fn();
}

const MapsForStagHunt = loadMapVar('config/MapsForStagHunt.js', 'MapsForStagHunt');
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeDesign(design) {
  const hasDual = Array.isArray(design.bigGoals) || Array.isArray(design.smallGoals);
  if (hasDual) return design;
  return {
    ...design,
    bigGoals: Array.isArray(design.stag) ? [design.stag] : [],
    smallGoals: Array.isArray(design.rabbits) ? design.rabbits.map(p => [...p]) : [],
    initAIGrid: design.initAIGrid || design.orange,
    initPlayerGrid: design.initPlayerGrid || design.red,
    utility_summary: design.utility_summary || null
  };
}

function goalsAndTypes(design) {
  const goals = [];
  const types = [];
  (design.smallGoals || []).forEach(p => { goals.push([p[0], p[1]]); types.push('small'); });
  (design.bigGoals || []).forEach(p => { goals.push([p[0], p[1]]); types.push('big'); });
  return { goals, types };
}

function whichGoalIdx(pos, goals) {
  for (let i = 0; i < goals.length; i++) {
    if (goals[i][0] === pos[0] && goals[i][1] === pos[1]) return i;
  }
  return null;
}

function classifyOutcome(result) {
  if (!result.bothReached) return 'timeout';
  if (result.sameGoal && result.aiType === 'big') return 'stag';
  if (result.aiType === 'small' && result.plType === 'small') return 'hare';
  return 'mixed';
}

function isCardinal(delta) {
  return Array.isArray(delta) && delta.length === 2 &&
    ((Math.abs(delta[0]) === 1 && delta[1] === 0) || (Math.abs(delta[1]) === 1 && delta[0] === 0));
}

// ---------------------------------------------------------------------------
// Simulate a trial with both players driven by the joint planner
// (centralized cooperative control — the "ideal" team rollout).
// ---------------------------------------------------------------------------
function simulateTrial(design, { maxSteps = 60, seed = 42, beta = RL_AGENT_CONFIG.softmaxBeta } = {}) {
  const norm = normalizeDesign(design);
  const { goals, types } = goalsAndTypes(norm);
  const obstacles = (norm.obstacles || []).map(p => [p[0], p[1]]);
  const context = {
    goalTypes: types,
    utilitySummary: norm.utility_summary || null,
    experimentType: 'StagHunt'
  };

  // Temporarily lock gridSize to this map's grid size.
  const originalGridSize = RL_AGENT_CONFIG.gridSize;
  RL_AGENT_CONFIG.gridSize = norm.grid_size || norm.gridSize || originalGridSize;

  // Deterministic seed for softmax tie-breaking.
  const origRandom = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  // Fresh planner cache to avoid pollution across tests.
  JointBFSPlanner.clear();

  let aiPos = [...norm.initAIGrid];
  let plPos = [...norm.initPlayerGrid];
  const trajAI = [ [...aiPos] ];
  const trajPL = [ [...plPos] ];
  let steps = 0;
  let aiMoveCount = 0;
  let plMoveCount = 0;
  let invalidOffGoalAction = false;

  const inGrid = (r, c) => r >= 0 && r < RL_AGENT_CONFIG.gridSize && c >= 0 && c < RL_AGENT_CONFIG.gridSize;
  const obstacleSet = new Set(obstacles.map(([r, c]) => `${r},${c}`));
  const isBlocked = (r, c) => !inGrid(r, c) || obstacleSet.has(`${r},${c}`);
  const goalSet = new Set(goals.map(([r, c]) => `${r},${c}`));
  const onGoal = ([r, c]) => goalSet.has(`${r},${c}`);

  while (steps < maxSteps) {
    if (onGoal(aiPos) && onGoal(plPos)) break;

    // AI (orange) move via the joint planner
    let aiDelta = null;
    if (!onGoal(aiPos)) {
      aiDelta = JointBFSPlanner.getAction(aiPos, plPos, goals, beta, obstacles, context);
      if (!isCardinal(aiDelta)) invalidOffGoalAction = true;
    }
    // Partner (red) move: symmetrically use the planner but with arguments
    // swapped so the partner's "AI" input is itself.
    let plDelta = null;
    if (!onGoal(plPos)) {
      plDelta = JointBFSPlanner.getAction(plPos, aiPos, goals, beta, obstacles, context);
      if (!isCardinal(plDelta)) invalidOffGoalAction = true;
    }

    const nextAI = aiDelta ? [aiPos[0] + aiDelta[0], aiPos[1] + aiDelta[1]] : [...aiPos];
    const nextPL = plDelta ? [plPos[0] + plDelta[0], plPos[1] + plDelta[1]] : [...plPos];

    if (aiDelta && !isBlocked(nextAI[0], nextAI[1])) {
      if (nextAI[0] !== aiPos[0] || nextAI[1] !== aiPos[1]) aiMoveCount++;
      aiPos = nextAI;
    }
    if (plDelta && !isBlocked(nextPL[0], nextPL[1])) {
      if (nextPL[0] !== plPos[0] || nextPL[1] !== plPos[1]) plMoveCount++;
      plPos = nextPL;
    }
    trajAI.push([...aiPos]);
    trajPL.push([...plPos]);
    steps++;
  }

  Math.random = origRandom;
  RL_AGENT_CONFIG.gridSize = originalGridSize;

  const aiGoalIdx = whichGoalIdx(aiPos, goals);
  const plGoalIdx = whichGoalIdx(plPos, goals);
  const aiType = aiGoalIdx != null ? types[aiGoalIdx] : null;
  const plType = plGoalIdx != null ? types[plGoalIdx] : null;

  // Team reward using same math as JointBFSPlanner.resolveRewards
  const rew = JointBFSPlanner.resolveRewards(norm.utility_summary);
  const teamTerminal = JointBFSPlanner.terminalTeamReward(aiGoalIdx, plGoalIdx, types, rew);
  const teamUtility = teamTerminal + rew.stepCost * (aiMoveCount + plMoveCount);

  return {
    steps,
    aiPos, plPos,
    aiGoalIdx, plGoalIdx,
    aiType, plType,
    sameGoal: aiGoalIdx != null && plGoalIdx != null && aiGoalIdx === plGoalIdx,
    bothReached: aiGoalIdx != null && plGoalIdx != null,
    teamUtility,
    invalidOffGoalAction,
    aiMoveCount, plMoveCount,
    trajAI, trajPL
  };
}

function simulateMany(design, numRuns = 200) {
  const counts = { hare: 0, stag: 0, mixed: 0, timeout: 0, invalid: 0 };
  for (let i = 0; i < numRuns; i++) {
    const result = simulateTrial(design, { seed: 1000 + i });
    if (result.invalidOffGoalAction) counts.invalid++;
    counts[classifyOutcome(result)]++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  const mark = cond ? '✔' : '✘';
  console.log(`  ${mark} ${name}${detail ? '  ' + detail : ''}`);
  if (cond) passed++; else failed++;
}

console.log('--- Terminal reward semantics ---');
{
  const rewards = JointBFSPlanner.resolveRewards({
    step_cost_per_move: -1,
    hare_reward_each: 5,
    stag_reward_each: 10
  });

  check('Same stag pays both players', JointBFSPlanner.terminalTeamReward(0, 0, ['big'], rewards) === 20);
  check('Different stags pay zero', JointBFSPlanner.terminalTeamReward(0, 1, ['big', 'big'], rewards) === 0);
  check('Different rabbits pay both', JointBFSPlanner.terminalTeamReward(0, 1, ['small', 'small'], rewards) === 10);
  check('Same rabbit pays once', JointBFSPlanner.terminalTeamReward(0, 0, ['small'], rewards) === 5);
}

console.log('\n--- Action distribution and no-[0,0] contract ---');
{
  const map = normalizeDesign(MapsForStagHunt['1'][0]);
  const { goals, types } = goalsAndTypes(map);
  const dist = JointBFSPlanner.getActionDistribution(
    map.initAIGrid,
    map.initPlayerGrid,
    goals,
    RL_AGENT_CONFIG.softmaxBeta,
    map.obstacles,
    { goalTypes: types, utilitySummary: map.utility_summary, experimentType: 'StagHunt' }
  );
  const probabilitySum = dist.probabilities.reduce((sum, p) => sum + p, 0);

  check('Distribution exists for off-goal state', !!dist);
  check('All sampled AI deltas are cardinal', dist.actionDeltas.every(isCardinal));
  check('Distribution normalizes to 1', Math.abs(probabilitySum - 1) < 1e-6, `sum=${probabilitySum}`);

  const rollout = simulateTrial(map, { seed: 1234 });
  check('Off-goal rollout never emits [0,0] or null', !rollout.invalidOffGoalAction);
}

console.log('\n--- Map-backed utility preference checks ---');
{
  const map1 = MapsForStagHunt['1'][0];
  const map2 = MapsForStagHunt['2'][0];
  const map7 = MapsForStagHunt['7'][0];

  const counts1 = simulateMany(map1, 200);
  check('Map 1 prefers hare over stag', counts1.hare > counts1.stag, JSON.stringify(counts1));
  check('Map 1 never uses invalid off-goal action', counts1.invalid === 0, JSON.stringify(counts1));

  const counts2 = simulateMany(map2, 200);
  check('Map 2 prefers stag over hare', counts2.stag > counts2.hare, JSON.stringify(counts2));
  check('Map 2 never uses invalid off-goal action', counts2.invalid === 0, JSON.stringify(counts2));

  const tieSample = simulateTrial(map7, { seed: 2024 });
  check('Tie map reaches a valid terminal outcome', ['hare', 'stag', 'mixed'].includes(classifyOutcome(tieSample)), JSON.stringify({
    outcome: classifyOutcome(tieSample),
    utility: tieSample.teamUtility,
    invalidOffGoalAction: tieSample.invalidOffGoalAction
  }));
}

console.log(`\n=== joint-RL test summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
