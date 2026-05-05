#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

function parseArgs(argv) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const args = {
    runs: 5,
    trials: null,
    seedBase: 20260420,
    stepDelayMs: 0,
    /** null: derive from targetRpm via GameConfigUtils.applyModelExp */
    remoteAgentMinRequestSpacingMs: null,
    targetRpm: 400,
    targetTpm: 160000,
    maxOutputTokens: 8,
    maxStepsPerTrial: 100,
    outputDir: resolve(__dirname, 'dataAnalysis/generated/stag_hunt_vlm_vs_vlm_n5'),
    serverUrl: 'http://localhost:3011'
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--runs' && next) {
      args.runs = Number(next);
      i++;
    } else if (arg === '--trials' && next) {
      args.trials = Number(next);
      i++;
    } else if (arg === '--seed-base' && next) {
      args.seedBase = Number(next);
      i++;
    } else if (arg === '--step-delay-ms' && next) {
      args.stepDelayMs = Number(next);
      i++;
    } else if (arg === '--remote-agent-min-request-spacing-ms' && next) {
      args.remoteAgentMinRequestSpacingMs = Number(next);
      i++;
    } else if (arg === '--target-rpm' && next) {
      args.targetRpm = Number(next);
      i++;
    } else if (arg === '--target-tpm' && next) {
      args.targetTpm = Number(next);
      i++;
    } else if (arg === '--max-output-tokens' && next) {
      args.maxOutputTokens = Number(next);
      i++;
    } else if (arg === '--max-steps' && next) {
      args.maxStepsPerTrial = Number(next);
      i++;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = resolve(__dirname, next);
      i++;
    } else if (arg === '--server-url' && next) {
      args.serverUrl = String(next);
      i++;
    }
  }

  if (!Number.isInteger(args.runs) || args.runs <= 0) {
    throw new Error(`Invalid --runs value: ${args.runs}`);
  }
  if (args.trials != null && (!Number.isInteger(args.trials) || args.trials <= 0)) {
    throw new Error(`Invalid --trials value: ${args.trials}`);
  }
  if (!Number.isInteger(args.seedBase)) {
    throw new Error(`Invalid --seed-base value: ${args.seedBase}`);
  }
  if (!Number.isFinite(args.stepDelayMs) || args.stepDelayMs < 0) {
    throw new Error(`Invalid --step-delay-ms value: ${args.stepDelayMs}`);
  }
  if (args.remoteAgentMinRequestSpacingMs != null &&
    (!Number.isFinite(args.remoteAgentMinRequestSpacingMs) || args.remoteAgentMinRequestSpacingMs < 0)) {
    throw new Error(`Invalid --remote-agent-min-request-spacing-ms value: ${args.remoteAgentMinRequestSpacingMs}`);
  }
  if (!Number.isFinite(args.targetRpm) || args.targetRpm <= 0) {
    throw new Error(`Invalid --target-rpm value: ${args.targetRpm}`);
  }
  if (!Number.isFinite(args.targetTpm) || args.targetTpm <= 0) {
    throw new Error(`Invalid --target-tpm value: ${args.targetTpm}`);
  }
  if (!Number.isFinite(args.maxOutputTokens) || args.maxOutputTokens <= 0) {
    throw new Error(`Invalid --max-output-tokens value: ${args.maxOutputTokens}`);
  }
  if (!Number.isInteger(args.maxStepsPerTrial) || args.maxStepsPerTrial <= 0) {
    throw new Error(`Invalid --max-steps value: ${args.maxStepsPerTrial}`);
  }

  return args;
}

const args = parseArgs(process.argv);

process.env.VLM_TARGET_RPM = String(args.targetRpm);
process.env.VLM_TARGET_TPM = String(args.targetTpm);
process.env.VLM_MAX_OUTPUT_TOKENS = String(args.maxOutputTokens);

const originalFetch = global.fetch.bind(globalThis);

global.window = global.window || { location: { origin: args.serverUrl } };
global.fetch = async (input, init) => {
  if (typeof input === 'string' && input.startsWith('/')) {
    return originalFetch(`${args.serverUrl}${input}`, init);
  }
  if (input instanceof URL && input.protocol === '' && String(input).startsWith('/')) {
    return originalFetch(`${args.serverUrl}${String(input)}`, init);
  }
  return originalFetch(input, init);
};

const { CONFIG, GameConfigUtils } = await import('./client/src/config/gameConfig.js');
const { GameStateManager } = await import('./client/src/game/GameStateManager.js');
const { ExperimentManager } = await import('./client/src/experiments/ExperimentManager.js');
const { AiVsAiOrchestrator } = await import('./client/src/ai/AiVsAiOrchestrator.js');
const { VlmAgentClient } = await import('./client/src/ai/VlmAgentClient.js');
const { GameHelpers } = await import('./client/src/utils/GameHelpers.js');

function hexToRgba(hex) {
  const normalized = String(hex || '#000000').replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map(ch => ch + ch).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    255
  ];
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const payload = data || Buffer.alloc(0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
  return Buffer.concat([length, typeBuffer, payload, crc]);
}

function rgbaToPngDataUrl(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

VlmAgentClient.matrixToImageDataURL = function matrixToImageDataURL(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return null;
  const palette = {
    background: hexToRgba(CONFIG.visual.colors.background || '#ffffff'),
    grid: hexToRgba(CONFIG.visual.colors.grid || '#cccccc'),
    player1: hexToRgba(CONFIG.visual.colors.player1 || '#ff0000'),
    player2: hexToRgba(CONFIG.visual.colors.player2 || '#ff8800'),
    goal: hexToRgba(CONFIG.visual.colors.goal || '#0066ff'),
    obstacle: hexToRgba(CONFIG.visual.colors.obstacle || '#333333'),
    empty: hexToRgba('#f9f9f9')
  };
  const cell = 18;
  const gap = 1;
  const size = matrix.length;
  const width = size * cell + (size + 1) * gap;
  const rgba = Buffer.alloc(width * width * 4);

  const paintPixel = (x, y, color) => {
    const offset = (y * width + x) * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = color[3];
  };

  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      paintPixel(x, y, palette.background);
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = gap + c * (cell + gap);
      const y = gap + r * (cell + gap);
      let fill = palette.empty;
      switch (matrix[r][c]) {
        case 1: fill = palette.player1; break;
        case 2: fill = palette.player2; break;
        case 3: fill = palette.goal; break;
        case 4: fill = palette.obstacle; break;
        default: fill = palette.empty; break;
      }

      for (let yy = y; yy < y + cell; yy++) {
        for (let xx = x; xx < x + cell; xx++) {
          paintPixel(xx, yy, fill);
        }
      }

      if (gap > 0) {
        for (let yy = y - gap; yy < y + cell + gap; yy++) {
          if (yy < 0 || yy >= width) continue;
          for (let gg = 0; gg < gap; gg++) {
            const left = x - gap + gg;
            const right = x + cell + gg;
            if (left >= 0 && left < width) paintPixel(left, yy, palette.grid);
            if (right >= 0 && right < width) paintPixel(right, yy, palette.grid);
          }
        }
        for (let xx = x - gap; xx < x + cell + gap; xx++) {
          if (xx < 0 || xx >= width) continue;
          for (let gg = 0; gg < gap; gg++) {
            const top = y - gap + gg;
            const bottom = y + cell + gg;
            if (top >= 0 && top < width) paintPixel(xx, top, palette.grid);
            if (bottom >= 0 && bottom < width) paintPixel(xx, bottom, palette.grid);
          }
        }
      }
    }
  }

  return rgbaToPngDataUrl(width, width, rgba);
};

VlmAgentClient.stateToImageDataURL = function stateToImageDataURL(state) {
  return VlmAgentClient.matrixToImageDataURL(state?.gridMatrix);
};

function safePoint(value) {
  return Array.isArray(value) && value.length >= 2 ? [Number(value[0]), Number(value[1])] : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function pointsEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length >= 2 && b.length >= 2 &&
    Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function addDelta(point, delta) {
  if (!Array.isArray(point) || !Array.isArray(delta) || point.length < 2 || delta.length < 2) return null;
  return [Number(point[0]) + Number(delta[0]), Number(point[1]) + Number(delta[1])];
}

function actionToDelta(action) {
  if (Array.isArray(action) && action.length >= 2) return [Number(action[0]), Number(action[1])];
  switch (String(action || '').toLowerCase()) {
    case 'up': return [-1, 0];
    case 'down': return [1, 0];
    case 'left': return [0, -1];
    case 'right': return [0, 1];
    default: return null;
  }
}

function actionToDirection(action) {
  if (typeof action === 'string') return action.toLowerCase();
  const delta = actionToDelta(action);
  if (!delta) return null;
  if (delta[0] === -1 && delta[1] === 0) return 'up';
  if (delta[0] === 1 && delta[1] === 0) return 'down';
  if (delta[0] === 0 && delta[1] === -1) return 'left';
  if (delta[0] === 0 && delta[1] === 1) return 'right';
  return null;
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function countPositionChanges(trajectory, finalPosition) {
  const points = safeArray(trajectory).map(safePoint).filter(Boolean);
  const finalPos = safePoint(finalPosition);
  let count = 0;
  let invalid = false;

  for (let i = 0; i < points.length; i++) {
    const before = points[i];
    const after = (i + 1 < points.length) ? points[i + 1] : finalPos;
    if (!after) continue;
    if (pointsEqual(before, after)) invalid = true;
    else count++;
  }

  return { count, invalid };
}

function buildGoalState(trial) {
  const rabbits = safeArray(trial?.rabbitPositions).map(safePoint).filter(Boolean);
  const stag = safePoint(trial?.stagPosition);
  const currentGoals = [...rabbits];
  const currentGoalTypes = rabbits.map(() => 'small');
  if (stag) {
    currentGoals.push(stag);
    currentGoalTypes.push('big');
  }
  return { currentGoals, currentGoalTypes };
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

function estimateOpenAICostUsd(modelName, promptTokens, completionTokens) {
  const model = String(modelName || '').trim();
  const pricing = {
    'gpt-4.1': { input: 2.00, output: 8.00 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 }
  };
  const rates = pricing[model] || pricing['gpt-4o-mini'];
  return ((toFiniteNumber(promptTokens) / 1_000_000) * rates.input) +
    ((toFiniteNumber(completionTokens) / 1_000_000) * rates.output);
}

function buildTrialArtifacts(trial) {
  const goalState = buildGoalState(trial);
  const outcome = GameHelpers.evaluateStagHuntOutcome({
    ...goalState,
    player1: null,
    player2: null
  }, trial || {});

  const player1StartPosition = safePoint(trial?.player1StartPosition);
  const player2StartPosition = safePoint(trial?.player2StartPosition);
  const player1Actions = safeArray(trial?.player1Actions);
  const player2Actions = safeArray(trial?.player2Actions);
  const player1Trajectory = safeArray(trial?.player1Trajectory);
  const player2Trajectory = safeArray(trial?.player2Trajectory);

  const player1FinalGoalIndex = Number.isInteger(trial?.player1FinalReachedGoal) ? Number(trial.player1FinalReachedGoal) : -1;
  const player2FinalGoalIndex = Number.isInteger(trial?.player2FinalReachedGoal) ? Number(trial.player2FinalReachedGoal) : -1;
  const player1FinalPosition = player1FinalGoalIndex >= 0 ? safePoint(goalState.currentGoals[player1FinalGoalIndex]) : (safePoint(player1Trajectory[player1Trajectory.length - 1]) || player1StartPosition);
  const player2FinalPosition = player2FinalGoalIndex >= 0 ? safePoint(goalState.currentGoals[player2FinalGoalIndex]) : (safePoint(player2Trajectory[player2Trajectory.length - 1]) || player2StartPosition);

  const player1MoveInfo = countPositionChanges(player1Trajectory, player1FinalPosition);
  const player2MoveInfo = countPositionChanges(player2Trajectory, player2FinalPosition);

  const signaling = trial?.signaling || {};
  const signalerPlayer =
    String(trial?.player1Role || '').toLowerCase() === 'signaler' ? 'player1' :
    (String(trial?.player2Role || '').toLowerCase() === 'signaler' ? 'player2' : '');
  const signalerPlayerNumber = signalerPlayer === 'player1' ? 1 : (signalerPlayer === 'player2' ? 2 : null);
  const signalerActions = signalerPlayerNumber === 1 ? player1Actions : (signalerPlayerNumber === 2 ? player2Actions : []);
  const signalerFirstActionRaw = signalerActions.length > 0 ? signalerActions[0] : null;
  const signalerFirstAction = actionToDirection(signalerFirstActionRaw) || '';
  const signalerStartPosition = signalerPlayerNumber === 1 ? player1StartPosition : (signalerPlayerNumber === 2 ? player2StartPosition : null);
  const signalerFirstPositionAfterMove = addDelta(signalerStartPosition, actionToDelta(signalerFirstActionRaw));
  const signalingExpectedPosition = safePoint(signaling?.indicate_position);
  const signalerChoseSignalingPath = Boolean(
    signalerFirstAction &&
    signalerFirstAction === signaling?.indicate_action &&
    pointsEqual(signalerFirstPositionAfterMove, signalingExpectedPosition)
  );

  const utilitySummary = trial?.utilitySummary || {};
  const hareFinalUtility = Number(utilitySummary?.hare_final_utility);
  const stagFinalUtility = Number(utilitySummary?.stag_final_utility);
  const utilityDeltaStagMinusHare = stagFinalUtility - hareFinalUtility;

  const player1OutcomeReward = toFiniteNumber(trial?.player1OutcomeBonus);
  const player2OutcomeReward = toFiniteNumber(trial?.player2OutcomeBonus);
  const teamOutcomeReward = player1OutcomeReward + player2OutcomeReward;
  const initialPoints = toFiniteNumber(trial?.initialPointsPerTrial, Number(CONFIG?.game?.rewards?.initialPointsPerTrial ?? 15));
  const player1CurrentPointsBeforeOutcome = toFiniteNumber(trial?.player1CurrentPoints);
  const player2CurrentPointsBeforeOutcome = toFiniteNumber(trial?.player2CurrentPoints);
  const player1StepPenaltyPaid = initialPoints - player1CurrentPointsBeforeOutcome;
  const player2StepPenaltyPaid = initialPoints - player2CurrentPointsBeforeOutcome;
  const stepCost = toFiniteNumber(utilitySummary?.step_cost_per_move, -1);
  const chargedMoves = stepCost !== 0
    ? (player1StepPenaltyPaid / Math.abs(stepCost)) + (player2StepPenaltyPaid / Math.abs(stepCost))
    : 0;
  const teamUtility = teamOutcomeReward + stepCost * chargedMoves;

  const player1PromptTokens = toFiniteNumber(trial?.player1PromptTokens);
  const player1CompletionTokens = toFiniteNumber(trial?.player1CompletionTokens);
  const player2PromptTokens = toFiniteNumber(trial?.player2PromptTokens);
  const player2CompletionTokens = toFiniteNumber(trial?.player2CompletionTokens);
  const trialTotalPromptTokens = player1PromptTokens + player2PromptTokens;
  const trialTotalCompletionTokens = player1CompletionTokens + player2CompletionTokens;
  const pricingModel = trial?.player1BaseModel || trial?.player2BaseModel || trial?.player1Model || trial?.player2Model || CONFIG?.game?.agent?.vlm?.model;

  const row = {
    runId: Number(trial?.runId ?? trial?.repetitionIndex ?? 0) || 0,
    trialIndexWithinRun: Number(trial?.trialIndexWithinRun ?? trial?.trialIndex ?? 0) + (trial?.trialIndexWithinRun ? 0 : 1),
    mapId: trial?.mapId ?? '',
    seed: trial?.seed ?? '',
    agentTypePlayer1: trial?.player1AgentType || 'vlm',
    agentTypePlayer2: trial?.player2AgentType || 'vlm',
    temperature: CONFIG?.game?.agent?.vlm?.temperature ?? 0,
    experimentType: trial?.experimentType ?? '',
    player1Role: trial?.player1Role ?? '',
    player2Role: trial?.player2Role ?? '',
    signalingPathType: signaling?.path_type ?? '',
    signalingExpectedAction: signaling?.indicate_action ?? '',
    signalingExpectedPosition,
    outcomeCategory: classifyOutcomeCategory(outcome),
    stagHuntSuccess: outcome.sameBigGoal === true,
    collaborationSucceeded: trial?.collaborationSucceeded === true,
    player1FinalGoalType: outcome.player1GoalType || '',
    player2FinalGoalType: outcome.player2GoalType || '',
    player1RoundPoints: toFiniteNumber(trial?.player1RoundPoints),
    player2RoundPoints: toFiniteNumber(trial?.player2RoundPoints),
    teamRoundPoints: toFiniteNumber(trial?.player1RoundPoints) + toFiniteNumber(trial?.player2RoundPoints),
    player1TotalPoints: toFiniteNumber(trial?.player1TotalPoints),
    player2TotalPoints: toFiniteNumber(trial?.player2TotalPoints),
    teamTotalPoints: toFiniteNumber(trial?.player1TotalPoints) + toFiniteNumber(trial?.player2TotalPoints),
    teamUtility,
    player1PlannerTerminalReward: player1OutcomeReward,
    player2PlannerTerminalReward: player2OutcomeReward,
    plannerTerminalReward: teamOutcomeReward,
    hareFinalUtility,
    stagFinalUtility,
    utilityDeltaStagMinusHare,
    utilityStructure: utilityStructure(utilityDeltaStagMinusHare),
    signalerPlayer,
    signalerFirstAction,
    signalerFirstPositionAfterMove,
    signalerChoseSignalingPath,
    steps: toFiniteNumber(trial?.totalSteps),
    player1MoveCount: player1MoveInfo.count,
    player2MoveCount: player2MoveInfo.count,
    invalidOffGoalAction: player1MoveInfo.invalid || player2MoveInfo.invalid,
    player1FinalGoalIndex,
    player2FinalGoalIndex,
    player1FinalPosition,
    player2FinalPosition,
    player1StartPosition,
    player2StartPosition,
    player1CurrentPointsBeforeOutcome,
    player2CurrentPointsBeforeOutcome,
    player1OutcomeReward,
    player2OutcomeReward,
    teamOutcomeReward,
    player1StepPenaltyPaid,
    player2StepPenaltyPaid,
    initialPointsPerTrial: initialPoints,
    mapAscii: safeArray(trial?.mapAscii).join('\n'),
    player1PromptTokens,
    player1CompletionTokens,
    player2PromptTokens,
    player2CompletionTokens,
    trialTotalPromptTokens,
    trialTotalCompletionTokens,
    trialEstimatedCostUsd: Number((trial?.trialEstimatedCostUsd ?? estimateOpenAICostUsd(pricingModel, trialTotalPromptTokens, trialTotalCompletionTokens)).toFixed(6)),
    pricingModel: pricingModel || '',
    player1BaseModel: trial?.player1BaseModel || '',
    player2BaseModel: trial?.player2BaseModel || '',
    player1VlmCalls: toFiniteNumber(trial?.player1VlmCalls),
    player2VlmCalls: toFiniteNumber(trial?.player2VlmCalls),
    vlmMinRemainingRequests: trial?.vlmMinRemainingRequests ?? '',
    vlmMinRemainingTokens: trial?.vlmMinRemainingTokens ?? '',
    vlmRemoteApiCalls: toFiniteNumber(trial?.vlmRemoteApiCalls)
  };

  const raw = {
    runId: row.runId,
    trialIndexWithinRun: row.trialIndexWithinRun,
    mapId: row.mapId,
    seed: row.seed,
    player1StartPosition,
    player2StartPosition,
    player1FinalPosition,
    player2FinalPosition,
    player1Actions,
    player2Actions,
    player1Trajectory,
    player2Trajectory,
    goals: goalState.currentGoals,
    goalTypes: goalState.currentGoalTypes,
    signaling,
    utilitySummary,
    distanceSummary: trial?.distanceSummary || null,
    obstacles: trial?.obstacles || [],
    outcomeCategory: row.outcomeCategory,
    stagHuntSuccess: row.stagHuntSuccess,
    collaborationSucceeded: row.collaborationSucceeded,
    teamRoundPoints: row.teamRoundPoints,
    teamUtility: row.teamUtility,
    player1PromptTokens,
    player1CompletionTokens,
    player2PromptTokens,
    player2CompletionTokens,
    trialTotalPromptTokens,
    trialTotalCompletionTokens,
    trialEstimatedCostUsd: row.trialEstimatedCostUsd,
    pricingModel: row.pricingModel
  };

  return { row, raw };
}

function makeRunSummary(runRows) {
  const trialCount = runRows.length;
  const signalingRows = runRows.filter(row => row.signalerChoseSignalingPath === true);
  const nonSignalingRows = runRows.filter(row => row.signalerChoseSignalingPath === false);
  const successCount = runRows.filter(row => row.stagHuntSuccess === true).length;
  const totalTeamRoundPoints = runRows.reduce((sum, row) => sum + row.teamRoundPoints, 0);
  const totalTeamUtility = runRows.reduce((sum, row) => sum + row.teamUtility, 0);
  const totalPromptTokens = runRows.reduce((sum, row) => sum + toFiniteNumber(row.trialTotalPromptTokens), 0);
  const totalCompletionTokens = runRows.reduce((sum, row) => sum + toFiniteNumber(row.trialTotalCompletionTokens), 0);
  const totalEstimatedCostUsd = runRows.reduce((sum, row) => sum + toFiniteNumber(row.trialEstimatedCostUsd), 0);
  const last = runRows[runRows.length - 1];
  const vlmDebug = process.env.ENABLE_VLM_DEBUG === 'true';

  const summary = {
    runId: last?.runId ?? '',
    trialCount,
    stagHuntSuccessCount: successCount,
    stagHuntSuccessRate: trialCount > 0 ? successCount / trialCount : 0,
    signalingCount: signalingRows.length,
    signalingRate: trialCount > 0 ? signalingRows.length / trialCount : 0,
    meanTeamRoundPoints: trialCount > 0 ? totalTeamRoundPoints / trialCount : 0,
    finalTeamTotalPoints: last?.teamTotalPoints ?? 0,
    meanTeamUtility: trialCount > 0 ? totalTeamUtility / trialCount : 0,
    meanTeamPointsWhenSignaling: signalingRows.length > 0
      ? signalingRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / signalingRows.length
      : '',
    meanTeamPointsWhenNotSignaling: nonSignalingRows.length > 0
      ? nonSignalingRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / nonSignalingRows.length
      : '',
    stagSuccessWhenSignaling: signalingRows.length > 0
      ? signalingRows.filter(row => row.stagHuntSuccess).length / signalingRows.length
      : '',
    stagSuccessWhenNotSignaling: nonSignalingRows.length > 0
      ? nonSignalingRows.filter(row => row.stagHuntSuccess).length / nonSignalingRows.length
      : '',
    totalPromptTokens,
    totalCompletionTokens,
    totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6)),
    pricingModel: last?.pricingModel || ''
  };

  if (vlmDebug) {
    const reqMins = runRows
      .map((row) => row.vlmMinRemainingRequests)
      .filter((x) => x !== '' && x != null && Number.isFinite(Number(x)));
    const tokMins = runRows
      .map((row) => row.vlmMinRemainingTokens)
      .filter((x) => x !== '' && x != null && Number.isFinite(Number(x)));
    summary.vlmRunMinRemainingRequests = reqMins.length > 0 ? Math.min(...reqMins.map(Number)) : '';
    summary.vlmRunMinRemainingTokens = tokMins.length > 0 ? Math.min(...tokMins.map(Number)) : '';
    summary.vlmRunTotalRemoteApiCalls = runRows.reduce((sum, row) => sum + toFiniteNumber(row.vlmRemoteApiCalls), 0);
  }

  return summary;
}

function makeAnalysisSummary(rows) {
  const pathTypes = ['equal-optimal', 'costly-suboptimal'];
  const utilityStructures = ['favor_hare', 'tie', 'favor_stag'];
  const out = [];

  pathTypes.forEach((pathType) => {
    utilityStructures.forEach((structure) => {
      const subsetRows = rows.filter(
        row => row.signalingPathType === pathType && row.utilityStructure === structure
      );
      const trialCount = subsetRows.length;
      out.push({
        signalingPathType: pathType,
        utilityStructure: structure,
        trialCount,
        signalingRate: trialCount > 0
          ? subsetRows.filter(row => row.signalerChoseSignalingPath).length / trialCount
          : '',
        stagSuccessRate: trialCount > 0
          ? subsetRows.filter(row => row.stagHuntSuccess).length / trialCount
          : '',
        meanTeamRoundPoints: trialCount > 0
          ? subsetRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / trialCount
          : '',
        meanTeamUtility: trialCount > 0
          ? subsetRows.reduce((sum, row) => sum + row.teamUtility, 0) / trialCount
          : '',
        meanSteps: trialCount > 0
          ? subsetRows.reduce((sum, row) => sum + row.steps, 0) / trialCount
          : '',
        totalEstimatedCostUsd: trialCount > 0
          ? Number(subsetRows.reduce((sum, row) => sum + toFiniteNumber(row.trialEstimatedCostUsd), 0).toFixed(6))
          : 0
      });
    });
  });

  return out;
}

function makeSignalComparisonSummary(rows) {
  const pathTypes = ['equal-optimal', 'costly-suboptimal'];
  const utilityStructures = ['favor_hare', 'tie', 'favor_stag'];
  const signalingLabels = [
    { key: 'non_signaling', predicate: row => row.signalerChoseSignalingPath === false },
    { key: 'signaling', predicate: row => row.signalerChoseSignalingPath === true }
  ];
  const out = [];

  pathTypes.forEach((pathType) => {
    utilityStructures.forEach((structure) => {
      signalingLabels.forEach(({ key, predicate }) => {
        const subsetRows = rows.filter(
          row => row.signalingPathType === pathType &&
            row.utilityStructure === structure &&
            predicate(row)
        );
        const trialCount = subsetRows.length;
        out.push({
          signalingPathType: pathType,
          utilityStructure: structure,
          signalingLabel: key,
          trialCount,
          meanTeamRoundPoints: trialCount > 0
            ? subsetRows.reduce((sum, row) => sum + row.teamRoundPoints, 0) / trialCount
            : '',
          stagSuccessRate: trialCount > 0
            ? subsetRows.filter(row => row.stagHuntSuccess).length / trialCount
            : '',
          meanTeamUtility: trialCount > 0
            ? subsetRows.reduce((sum, row) => sum + row.teamUtility, 0) / trialCount
            : '',
          totalEstimatedCostUsd: trialCount > 0
            ? Number(subsetRows.reduce((sum, row) => sum + toFiniteNumber(row.trialEstimatedCostUsd), 0).toFixed(6))
            : 0
        });
      });
    });
  });

  return out;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return String(value);
}

function writeCsv(filePath, rows) {
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => {
      const cell = csvCell(row[header]).replace(/"/g, '""');
      return /[",\n]/.test(cell) ? `"${cell}"` : cell;
    }).join(','))
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function verifyServer(serverUrl) {
  const healthResp = await originalFetch(`${serverUrl}/health`);
  if (!healthResp.ok) {
    throw new Error(`Server healthcheck failed: ${healthResp.status}`);
  }
  const vlmResp = await originalFetch(`${serverUrl}/api/ai/vlm/config`);
  if (!vlmResp.ok) {
    throw new Error(`VLM config request failed: ${vlmResp.status}`);
  }
  return vlmResp.json();
}

async function main() {
  mkdirSync(args.outputDir, { recursive: true });

  const vlmConfig = await verifyServer(args.serverUrl);
  console.log(`Using server ${args.serverUrl}`);
  console.log(`VLM config: ${JSON.stringify(vlmConfig)}`);
  console.log(
    `[vlm-sim] provider=${vlmConfig.provider || 'openai'} model=${vlmConfig.model || vlmConfig.apiModel} ` +
    `hasOpenAIKey=${Boolean(vlmConfig.hasOpenAIKey ?? vlmConfig.hasApiKey)} hasGoogleKey=${Boolean(vlmConfig.hasGoogleKey)}`
  );

  if (Number(vlmConfig.targetRpm) !== Number(args.targetRpm) ||
    Number(vlmConfig.targetTpm) !== Number(args.targetTpm)) {
    console.warn(
      '[vlm-sim] Server VLM_TARGET_RPM / VLM_TARGET_TPM do not match this run. ' +
      'Restart the server from the same shell after exporting those env vars, or expect client-side spacing only. ' +
      `Server reports rpm=${vlmConfig.targetRpm} tpm=${vlmConfig.targetTpm}; run uses rpm=${args.targetRpm} tpm=${args.targetTpm}.`
    );
  }

  CONFIG.server.url = args.serverUrl;
  CONFIG.maps.source = 'server';
  CONFIG.modelExp.enabled = true;
  CONFIG.modelExp.player1Agent = 'vlm';
  CONFIG.modelExp.player2Agent = 'vlm';
  CONFIG.modelExp.repetitionsPerMap = args.runs;
  CONFIG.modelExp.seed = args.seedBase;
  CONFIG.modelExp.stepDelayMs = args.stepDelayMs;
  CONFIG.modelExp.serializeRemoteAgentCalls = true;
  CONFIG.modelExp.targetRpm = args.targetRpm;
  CONFIG.modelExp.targetTpm = args.targetTpm;
  CONFIG.modelExp.vlmMaxOutputTokens = args.maxOutputTokens;
  CONFIG.modelExp.vlmTomMaxOutputTokens = 80;
  CONFIG.modelExp.maxStepsPerTrial = args.maxStepsPerTrial;
  CONFIG.modelExp.exportPrefix = 'vlm-vlm';
  CONFIG.game.experiments.order = ['StagHunt'];
  if (args.trials != null) {
    CONFIG.game.experiments.numTrials.StagHunt = args.trials;
  }
  GameConfigUtils.applyModelExp();
  if (args.remoteAgentMinRequestSpacingMs != null) {
    CONFIG.modelExp.remoteAgentMinRequestSpacingMs = args.remoteAgentMinRequestSpacingMs;
  }

  CONFIG.game.agent.vlm.memory.enabled = false;

  const uiManager = {
    updateGameDisplay() {},
    updateGameInfo() {}
  };
  const gameStateManager = new GameStateManager();
  const experimentManager = new ExperimentManager(gameStateManager, uiManager, null);
  const orchestrator = new AiVsAiOrchestrator({
    gameStateManager,
    experimentManager,
    rlAgent: experimentManager.rlAgent,
    gptClient: experimentManager.gptClient,
    vlmClient: experimentManager.vlmClient,
    weIntentAgent: experimentManager.weIntentAgent,
    uiManager: null
  });

  await orchestrator.run();

  const trials = safeArray(gameStateManager.experimentData?.allTrialsData);
  const trialArtifacts = trials
    .filter(trial => String(trial?.experimentType || '') === 'StagHunt')
    .map(buildTrialArtifacts)
    .sort((a, b) => (a.row.runId - b.row.runId) || (a.row.trialIndexWithinRun - b.row.trialIndexWithinRun));

  const trialRows = trialArtifacts.map(item => item.row);
  const rawRows = trialArtifacts.map(item => item.raw);

  const runRowsMap = new Map();
  trialRows.forEach((row) => {
    if (!runRowsMap.has(row.runId)) runRowsMap.set(row.runId, []);
    runRowsMap.get(row.runId).push(row);
  });

  const runSummaryRows = [...runRowsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, rows]) => makeRunSummary(rows));

  const analysisSummaryRows = makeAnalysisSummary(trialRows);
  const signalComparisonSummaryRows = makeSignalComparisonSummary(trialRows);

  writeCsv(resolve(args.outputDir, 'trial_level.csv'), trialRows);
  writeCsv(resolve(args.outputDir, 'run_summary.csv'), runSummaryRows);
  writeCsv(resolve(args.outputDir, 'analysis_summary.csv'), analysisSummaryRows);
  writeCsv(resolve(args.outputDir, 'signal_comparison_summary.csv'), signalComparisonSummaryRows);
  writeFileSync(resolve(args.outputDir, 'trial_level.json'), JSON.stringify(rawRows, null, 2), 'utf8');

  const totalCost = trialRows.reduce((sum, row) => sum + toFiniteNumber(row.trialEstimatedCostUsd), 0);
  console.log(`Generated ${trialRows.length} trial rows across ${runSummaryRows.length} runs.`);
  console.log(`Estimated total VLM cost: $${totalCost.toFixed(6)}`);
  console.log(`Output directory: ${args.outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
