#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Minimal browser globals so config modules load in Node.
global.window = global.window || { location: { origin: 'http://localhost:3001' } };

const __dirname = dirname(fileURLToPath(import.meta.url));

const { CONFIG } = await import('./client/src/config/gameConfig.js');
const { JointBFSPlanner, RL_AGENT_CONFIG } = await import('./client/src/ai/RLAgent.js');
const { GameHelpers } = await import('./client/src/utils/GameHelpers.js');

function loadMapVar(relPath, varName) {
  const src = readFileSync(resolve(__dirname, relPath), 'utf8');
  const fn = new Function(`${src}; return ${varName};`);
  return fn();
}

const MapsForStagHunt = loadMapVar('config/MapsForStagHunt.js', 'MapsForStagHunt');

function parseArgs(argv) {
  const args = {
    runs: 30,
    seedBase: 20260418,
    outputDir: resolve(__dirname, 'dataAnalysis/generated/stag_hunt_joint_rl_vs_joint_rl_n30')
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--runs' && next) {
      args.runs = Number(next);
      i++;
    } else if (arg === '--seed-base' && next) {
      args.seedBase = Number(next);
      i++;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = resolve(__dirname, next);
      i++;
    }
  }

  if (!Number.isInteger(args.runs) || args.runs <= 0) {
    throw new Error(`Invalid --runs value: ${args.runs}`);
  }
  if (!Number.isInteger(args.seedBase)) {
    throw new Error(`Invalid --seed-base value: ${args.seedBase}`);
  }

  return args;
}

function normalizeDesign(design) {
  if (!design || typeof design !== 'object') {
    throw new Error('Invalid map design');
  }

  return {
    ...design,
    map_id: design.map_id ?? null,
    grid_size: design.grid_size ?? design.gridSize ?? 9,
    initPlayerGrid: Array.isArray(design.initPlayerGrid) ? [...design.initPlayerGrid] : [...design.red],
    initAIGrid: Array.isArray(design.initAIGrid) ? [...design.initAIGrid] : [...design.orange],
    bigGoals: Array.isArray(design.bigGoals) ? design.bigGoals.map(goal => [...goal]) : (Array.isArray(design.stag) ? [[...design.stag]] : []),
    smallGoals: Array.isArray(design.smallGoals) ? design.smallGoals.map(goal => [...goal]) : (Array.isArray(design.rabbits) ? design.rabbits.map(goal => [...goal]) : []),
    utility_summary: design.utility_summary || null,
    signaling: design.signaling || null,
    distance_summary: design.distance_summary || null,
    obstacles: Array.isArray(design.obstacles) ? design.obstacles.map(ob => [...ob]) : [],
    ascii: Array.isArray(design.ascii) ? design.ascii.slice() : []
  };
}

function goalsAndTypes(design) {
  const goals = [];
  const goalTypes = [];

  (design.smallGoals || []).forEach(goal => {
    goals.push([goal[0], goal[1]]);
    goalTypes.push('small');
  });
  (design.bigGoals || []).forEach(goal => {
    goals.push([goal[0], goal[1]]);
    goalTypes.push('big');
  });

  return { goals, goalTypes };
}

function pointKey(point) {
  return `${point[0]},${point[1]}`;
}

function samePoint(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length >= 2 && b.length >= 2 &&
    a[0] === b[0] && a[1] === b[1];
}

function addDelta(point, delta) {
  if (!Array.isArray(point) || !Array.isArray(delta)) return null;
  return [point[0] + delta[0], point[1] + delta[1]];
}

function toDirection(delta) {
  if (!Array.isArray(delta) || delta.length !== 2) return null;
  if (delta[0] === -1 && delta[1] === 0) return 'up';
  if (delta[0] === 1 && delta[1] === 0) return 'down';
  if (delta[0] === 0 && delta[1] === -1) return 'left';
  if (delta[0] === 0 && delta[1] === 1) return 'right';
  return null;
}

function isCardinal(delta) {
  return Array.isArray(delta) && delta.length === 2 &&
    ((Math.abs(delta[0]) === 1 && delta[1] === 0) || (Math.abs(delta[1]) === 1 && delta[0] === 0));
}

function whichGoalIdx(pos, goals) {
  for (let i = 0; i < goals.length; i++) {
    if (samePoint(pos, goals[i])) return i;
  }
  return null;
}

function classifyOutcomeCategory(outcome) {
  const p1 = outcome.player1GoalType;
  const p2 = outcome.player2GoalType;

  if (!outcome.bothPlayersReachedGoal) return 'nothing';
  if (outcome.sameBigGoal) return 'both_stag';
  if (outcome.differentBigGoals) return 'different_big_goals';
  if (p1 === 'small' && p2 === 'small') return 'both_rabbit';
  if (p1 === 'small' && p2 === 'big') return 'player1_rabbit';
  if (p1 === 'big' && p2 === 'small') return 'player2_rabbit';
  return 'nothing';
}

function utilityStructure(delta) {
  if (!Number.isFinite(delta)) return '';
  if (delta > 0) return 'favor_stag';
  if (delta < 0) return 'favor_hare';
  return 'tie';
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function simulateTrial(design, { seed, maxSteps = 60, trialIndexWithinRun }) {
  const norm = normalizeDesign(design);
  const { goals, goalTypes } = goalsAndTypes(norm);
  const context = {
    goalTypes,
    utilitySummary: norm.utility_summary,
    experimentType: 'StagHunt'
  };
  const rewards = JointBFSPlanner.resolveRewards(norm.utility_summary);
  const initialPoints = Number(CONFIG?.game?.rewards?.initialPointsPerTrial ?? 15);
  const stepPenalty = Math.abs(rewards.stepCost);

  const originalGridSize = RL_AGENT_CONFIG.gridSize;
  const originalRandom = Math.random;
  RL_AGENT_CONFIG.gridSize = norm.grid_size;
  Math.random = createSeededRandom(seed);
  JointBFSPlanner.clear();

  const obstacleSet = new Set((norm.obstacles || []).map(pointKey));
  const goalSet = new Set(goals.map(pointKey));
  const inGrid = (row, col) => row >= 0 && row < norm.grid_size && col >= 0 && col < norm.grid_size;
  const canOccupy = point => Array.isArray(point) && inGrid(point[0], point[1]) && !obstacleSet.has(pointKey(point));
  const onGoal = point => goalSet.has(pointKey(point));

  let player1Pos = [...norm.initPlayerGrid];
  let player2Pos = [...norm.initAIGrid];
  let player1CurrentPoints = initialPoints;
  let player2CurrentPoints = initialPoints;
  let player1MoveCount = 0;
  let player2MoveCount = 0;
  let invalidOffGoalAction = false;
  let steps = 0;

  const player1Actions = [];
  const player2Actions = [];
  const player1Trajectory = [[...player1Pos]];
  const player2Trajectory = [[...player2Pos]];

  try {
    while (steps < maxSteps) {
      const player1OnGoal = onGoal(player1Pos);
      const player2OnGoal = onGoal(player2Pos);
      if (player1OnGoal && player2OnGoal) break;

      let player1Delta = null;
      if (!player1OnGoal) {
        player1Delta = JointBFSPlanner.getAction(player1Pos, player2Pos, goals, RL_AGENT_CONFIG.softmaxBeta, norm.obstacles, context);
        if (!isCardinal(player1Delta)) invalidOffGoalAction = true;
      }

      let player2Delta = null;
      if (!player2OnGoal) {
        player2Delta = JointBFSPlanner.getAction(player2Pos, player1Pos, goals, RL_AGENT_CONFIG.softmaxBeta, norm.obstacles, context);
        if (!isCardinal(player2Delta)) invalidOffGoalAction = true;
      }

      if (player1Delta && !player1OnGoal) {
        player1Actions.push([...player1Delta]);
        player1CurrentPoints = Math.max(0, player1CurrentPoints - stepPenalty);
        const next = addDelta(player1Pos, player1Delta);
        if (canOccupy(next)) {
          if (!samePoint(next, player1Pos)) player1MoveCount++;
          player1Pos = next;
        }
      }

      if (player2Delta && !player2OnGoal) {
        player2Actions.push([...player2Delta]);
        player2CurrentPoints = Math.max(0, player2CurrentPoints - stepPenalty);
        const next = addDelta(player2Pos, player2Delta);
        if (canOccupy(next)) {
          if (!samePoint(next, player2Pos)) player2MoveCount++;
          player2Pos = next;
        }
      }

      player1Trajectory.push([...player1Pos]);
      player2Trajectory.push([...player2Pos]);
      steps++;
    }
  } finally {
    Math.random = originalRandom;
    RL_AGENT_CONFIG.gridSize = originalGridSize;
  }

  const player1GoalIdx = whichGoalIdx(player1Pos, goals);
  const player2GoalIdx = whichGoalIdx(player2Pos, goals);
  const player1GoalType = Number.isInteger(player1GoalIdx) ? goalTypes[player1GoalIdx] : null;
  const player2GoalType = Number.isInteger(player2GoalIdx) ? goalTypes[player2GoalIdx] : null;

  const outcome = GameHelpers.evaluateStagHuntOutcome({
    currentGoals: goals,
    currentGoalTypes: goalTypes,
    player1: player1Pos,
    player2: player2Pos
  }, {
    player1FinalReachedGoal: player1GoalIdx,
    player2FinalReachedGoal: player2GoalIdx
  });

  const hareRewardEach = Number(norm.utility_summary?.hare_reward_each ?? 0);
  const stagRewardEach = Number(norm.utility_summary?.stag_reward_each ?? 0);

  let player1OutcomeReward = 0;
  let player2OutcomeReward = 0;
  if (outcome.sameBigGoal) {
    player1OutcomeReward = stagRewardEach;
    player2OutcomeReward = stagRewardEach;
  } else {
    if (player1GoalType === 'small') player1OutcomeReward = hareRewardEach;
    if (player2GoalType === 'small') player2OutcomeReward = hareRewardEach;
  }

  const player1RoundPoints = player1CurrentPoints + player1OutcomeReward;
  const player2RoundPoints = player2CurrentPoints + player2OutcomeReward;
  const teamRoundPoints = player1RoundPoints + player2RoundPoints;

  const signalerFirstActionDelta = player2Actions[0] || null;
  const signalerFirstAction = toDirection(signalerFirstActionDelta);
  const signalerFirstPositionAfterMove = signalerFirstActionDelta ? addDelta(norm.initAIGrid, signalerFirstActionDelta) : null;
  const signalingExpectedPosition = Array.isArray(norm.signaling?.indicate_position)
    ? [...norm.signaling.indicate_position]
    : null;
  const signalerChoseSignalingPath = Boolean(
    signalerFirstAction &&
    signalerFirstAction === norm.signaling?.indicate_action &&
    samePoint(signalerFirstPositionAfterMove, signalingExpectedPosition)
  );

  const plannerTerminalReward = JointBFSPlanner.terminalTeamReward(
    player1GoalIdx,
    player2GoalIdx,
    goalTypes,
    rewards
  );
  const teamUtility = plannerTerminalReward + rewards.stepCost * (player1MoveCount + player2MoveCount);
  const hareFinalUtility = Number(norm.utility_summary?.hare_final_utility);
  const stagFinalUtility = Number(norm.utility_summary?.stag_final_utility);
  const utilityDeltaStagMinusHare = stagFinalUtility - hareFinalUtility;

  return {
    row: {
      runId: null,
      trialIndexWithinRun,
      mapId: norm.map_id,
      seed,
      agentTypePlayer1: 'joint-rl',
      agentTypePlayer2: 'joint-rl',
      temperature: RL_AGENT_CONFIG.softmaxBeta,
      experimentType: 'StagHunt',
      player1Role: 'Non-Signaler',
      player2Role: 'Signaler',
      signalingPathType: norm.signaling?.path_type ?? '',
      signalingExpectedAction: norm.signaling?.indicate_action ?? '',
      signalingExpectedPosition,
      outcomeCategory: classifyOutcomeCategory(outcome),
      stagHuntSuccess: outcome.sameBigGoal === true,
      collaborationSucceeded: outcome.collaborationSucceeded === true,
      player1FinalGoalType: player1GoalType || '',
      player2FinalGoalType: player2GoalType || '',
      player1RoundPoints,
      player2RoundPoints,
      teamRoundPoints,
      player1TotalPoints: null,
      player2TotalPoints: null,
      teamTotalPoints: null,
      teamUtility,
      player1PlannerTerminalReward: player1GoalType === 'big' && outcome.sameBigGoal ? stagRewardEach : (player1GoalType === 'small' ? hareRewardEach : 0),
      player2PlannerTerminalReward: player2GoalType === 'big' && outcome.sameBigGoal ? stagRewardEach : (player2GoalType === 'small' ? hareRewardEach : 0),
      plannerTerminalReward,
      hareFinalUtility,
      stagFinalUtility,
      utilityDeltaStagMinusHare,
      utilityStructure: utilityStructure(utilityDeltaStagMinusHare),
      signalerPlayer: 'player2',
      signalerFirstAction: signalerFirstAction || '',
      signalerFirstPositionAfterMove,
      signalerChoseSignalingPath,
      steps,
      player1MoveCount,
      player2MoveCount,
      invalidOffGoalAction,
      player1FinalGoalIndex: Number.isInteger(player1GoalIdx) ? player1GoalIdx : -1,
      player2FinalGoalIndex: Number.isInteger(player2GoalIdx) ? player2GoalIdx : -1,
      player1FinalPosition: [...player1Pos],
      player2FinalPosition: [...player2Pos],
      player1StartPosition: [...norm.initPlayerGrid],
      player2StartPosition: [...norm.initAIGrid],
      player1CurrentPointsBeforeOutcome: player1CurrentPoints,
      player2CurrentPointsBeforeOutcome: player2CurrentPoints,
      player1OutcomeReward,
      player2OutcomeReward,
      teamOutcomeReward: player1OutcomeReward + player2OutcomeReward,
      player1StepPenaltyPaid: initialPoints - player1CurrentPoints,
      player2StepPenaltyPaid: initialPoints - player2CurrentPoints,
      initialPointsPerTrial: initialPoints,
      mapAscii: norm.ascii.join('\n')
    },
    raw: {
      runId: null,
      trialIndexWithinRun,
      mapId: norm.map_id,
      seed,
      player1StartPosition: [...norm.initPlayerGrid],
      player2StartPosition: [...norm.initAIGrid],
      player1FinalPosition: [...player1Pos],
      player2FinalPosition: [...player2Pos],
      player1Actions,
      player2Actions,
      player1Trajectory,
      player2Trajectory,
      goals,
      goalTypes,
      signaling: norm.signaling,
      utilitySummary: norm.utility_summary,
      distanceSummary: norm.distance_summary,
      obstacles: norm.obstacles,
      outcomeCategory: classifyOutcomeCategory(outcome),
      stagHuntSuccess: outcome.sameBigGoal === true,
      collaborationSucceeded: outcome.collaborationSucceeded === true,
      teamRoundPoints,
      teamUtility
    }
  };
}

function makeRunSummary(runRows) {
  const trialCount = runRows.length;
  const signalingRows = runRows.filter(row => row.signalerChoseSignalingPath === true);
  const nonSignalingRows = runRows.filter(row => row.signalerChoseSignalingPath === false);
  const successCount = runRows.filter(row => row.stagHuntSuccess === true).length;
  const totalTeamRoundPoints = runRows.reduce((sum, row) => sum + row.teamRoundPoints, 0);
  const totalTeamUtility = runRows.reduce((sum, row) => sum + row.teamUtility, 0);
  const last = runRows[runRows.length - 1];

  return {
    runId: runRows[0]?.runId ?? '',
    trialCount,
    finalPlayer1TotalPoints: last?.player1TotalPoints ?? 0,
    finalPlayer2TotalPoints: last?.player2TotalPoints ?? 0,
    finalTeamTotalPoints: last?.teamTotalPoints ?? 0,
    totalTeamRoundPoints,
    meanTeamRoundPoints: trialCount > 0 ? totalTeamRoundPoints / trialCount : 0,
    totalTeamUtility,
    meanTeamUtility: trialCount > 0 ? totalTeamUtility / trialCount : 0,
    stagHuntSuccessCount: successCount,
    stagHuntSuccessRate: trialCount > 0 ? successCount / trialCount : 0,
    signalingCount: signalingRows.length,
    signalingRate: trialCount > 0 ? signalingRows.length / trialCount : 0,
    meanTeamPointsWhenSignaling: signalingRows.length > 0
      ? signalingRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / signalingRows.length
      : '',
    meanTeamPointsWhenNotSignaling: nonSignalingRows.length > 0
      ? nonSignalingRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / nonSignalingRows.length
      : '',
    stagSuccessRateWhenSignaling: signalingRows.length > 0
      ? signalingRows.filter(row => row.stagHuntSuccess === true).length / signalingRows.length
      : '',
    stagSuccessRateWhenNotSignaling: nonSignalingRows.length > 0
      ? nonSignalingRows.filter(row => row.stagHuntSuccess === true).length / nonSignalingRows.length
      : ''
  };
}

function makeAnalysisSummary(rows) {
  const pathTypes = ['equal-optimal', 'costly-suboptimal'];
  const utilityStructures = ['favor_hare', 'tie', 'favor_stag'];
  const outcomeCategories = ['both_stag', 'both_rabbit', 'different_big_goals', 'player1_rabbit', 'player2_rabbit', 'nothing'];

  return pathTypes.flatMap(pathType =>
    utilityStructures.map(utilityBucket => {
      const subsetRows = rows.filter(row =>
        row.signalingPathType === pathType &&
        row.utilityStructure === utilityBucket
      );
      const trialCount = subsetRows.length;
      const successCount = subsetRows.filter(row => row.stagHuntSuccess === true).length;
      const signalingCount = subsetRows.filter(row => row.signalerChoseSignalingPath === true).length;
      const outcomeCounts = Object.fromEntries(
        outcomeCategories.map(category => [
          `${category}Count`,
          subsetRows.filter(row => row.outcomeCategory === category).length
        ])
      );

      return {
        signalingPathType: pathType,
        utilityStructure: utilityBucket,
        trialCount,
        signalingRate: trialCount > 0 ? signalingCount / trialCount : '',
        stagSuccessRate: trialCount > 0 ? successCount / trialCount : '',
        meanTeamRoundPoints: trialCount > 0
          ? subsetRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / trialCount
          : '',
        meanTeamUtility: trialCount > 0
          ? subsetRows.reduce((sum, row) => sum + row.teamUtility, 0) / trialCount
          : '',
        meanSteps: trialCount > 0
          ? subsetRows.reduce((sum, row) => sum + row.steps, 0) / trialCount
          : '',
        ...outcomeCounts
      };
    })
  );
}

function makeSignalComparisonSummary(rows) {
  const pathTypes = ['equal-optimal', 'costly-suboptimal'];
  const utilityStructures = ['favor_hare', 'tie', 'favor_stag'];
  const signalingConditions = [
    { label: 'signaling', predicate: row => row.signalerChoseSignalingPath === true },
    { label: 'non_signaling', predicate: row => row.signalerChoseSignalingPath === false }
  ];

  return pathTypes.flatMap(pathType =>
    utilityStructures.flatMap(utilityBucket =>
      signalingConditions.map(({ label, predicate }) => {
        const subsetRows = rows.filter(row =>
          row.signalingPathType === pathType &&
          row.utilityStructure === utilityBucket &&
          predicate(row)
        );
        const trialCount = subsetRows.length;
        return {
          signalingPathType: pathType,
          utilityStructure: utilityBucket,
          signalingCondition: label,
          trialCount,
          stagSuccessRate: trialCount > 0
            ? subsetRows.filter(row => row.stagHuntSuccess === true).length / trialCount
            : '',
          meanTeamRoundPoints: trialCount > 0
            ? subsetRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / trialCount
            : '',
          meanTeamUtility: trialCount > 0
            ? subsetRows.reduce((sum, row) => sum + row.teamUtility, 0) / trialCount
            : ''
        };
      })
    )
  );
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function writeCsv(filePath, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    writeFileSync(filePath, 'No data\n');
    return;
  }

  const headerSet = new Set();
  rows.forEach(row => Object.keys(row).forEach(key => headerSet.add(key)));
  const headers = Array.from(headerSet);
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(header => escapeCsvValue(row[header])).join(','))
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  mkdirSync(args.outputDir, { recursive: true });

  const mapIds = Object.keys(MapsForStagHunt)
    .map(Number)
    .sort((a, b) => a - b);

  const trialRows = [];
  const rawRows = [];
  const runSummaryRows = [];

  for (let runId = 1; runId <= args.runs; runId++) {
    let player1TotalPoints = 0;
    let player2TotalPoints = 0;
    const runRows = [];

    mapIds.forEach((mapId, index) => {
      const design = MapsForStagHunt[String(mapId)]?.[0];
      if (!design) {
        throw new Error(`Missing StagHunt map ${mapId}`);
      }

      const seed = args.seedBase + runId * 1000 + mapId;
      const result = simulateTrial(design, {
        seed,
        trialIndexWithinRun: index + 1
      });

      result.row.runId = runId;
      result.raw.runId = runId;

      player1TotalPoints += result.row.player1RoundPoints;
      player2TotalPoints += result.row.player2RoundPoints;
      result.row.player1TotalPoints = player1TotalPoints;
      result.row.player2TotalPoints = player2TotalPoints;
      result.row.teamTotalPoints = player1TotalPoints + player2TotalPoints;

      trialRows.push(result.row);
      rawRows.push(result.raw);
      runRows.push(result.row);
    });

    runSummaryRows.push(makeRunSummary(runRows));
  }

  const analysisSummaryRows = makeAnalysisSummary(trialRows);
  const signalComparisonSummaryRows = makeSignalComparisonSummary(trialRows);

  writeCsv(resolve(args.outputDir, 'trial_level.csv'), trialRows);
  writeCsv(resolve(args.outputDir, 'run_summary.csv'), runSummaryRows);
  writeCsv(resolve(args.outputDir, 'analysis_summary.csv'), analysisSummaryRows);
  writeCsv(resolve(args.outputDir, 'signal_comparison_summary.csv'), signalComparisonSummaryRows);
  writeFileSync(resolve(args.outputDir, 'trial_level.json'), JSON.stringify(rawRows, null, 2), 'utf8');

  console.log(`Generated ${trialRows.length} trial rows across ${runSummaryRows.length} runs.`);
  console.log(`Output directory: ${args.outputDir}`);
}

main();
