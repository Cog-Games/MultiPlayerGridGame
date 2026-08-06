#!/usr/bin/env node

/**
 * Reproducible single-agent VLM control pilot for 1P1G and 1P2G.
 *
 * Uses the project's OpenAI credential/model, the same compact visual encoding as
 * VlmAgentClient, and a dedicated single-traveler prompt (the normal server prompt
 * assumes a two-player social task). Generated JSON/CSV files contain no API key.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const GRID_SIZE = 15;
const MAX_HISTORY = 50;
const DEFAULT_SEED = 4101;
const ACTIONS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1]
};
const ONE_P_TWO_G_CONDITIONS = [
  'closer_to_player1',
  'farther_to_player1',
  'equal_to_player1',
  'no_new_goal'
];
const GPT_4_1_MINI_PRICES_PER_MILLION = {
  input: 0.40,
  output: 1.60
};
const VLM_SYSTEM_PROMPT = 'You are a precise navigator. Consider the image and text; output only one token: up, down, left, or right.';
const GAME_RULES = {
  '1P1G': 'You will play alone. Each round, you can win if you go to the restaurant. Movement: You move one step at a time. For each round that you win, you earn an additional 10 points.',
  '1P2G': 'You will play alone. Each round, you can win if you go to one of the identical restaurants. Note that some restaurants are already open when the round starts. Others may appear later. For each round that you win, you earn an additional 10 points.'
};

function parseArgs(argv) {
  const args = {
    trialsPerAgent: 10,
    agents: 1,
    mapSelection: 'sequential',
    concurrency: 5,
    maxSteps: 60,
    seed: DEFAULT_SEED,
    types: ['1P1G', '1P2G'],
    outputDir: null,
    dryRun: false,
    smoke: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if ((arg === '--trials-per-agent' || arg === '--maps-per-condition') && value) {
      args.trialsPerAgent = Number(value);
      i += 1;
    } else if (arg === '--agents' && value) {
      args.agents = Number(value);
      i += 1;
    } else if (arg === '--map-selection' && value) {
      args.mapSelection = value;
      i += 1;
    } else if (arg === '--concurrency' && value) {
      args.concurrency = Number(value);
      i += 1;
    } else if (arg === '--max-steps' && value) {
      args.maxSteps = Number(value);
      i += 1;
    } else if (arg === '--seed' && value) {
      args.seed = Number(value);
      i += 1;
    } else if (arg === '--types' && value) {
      args.types = value.split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--output-dir' && value) {
      args.outputDir = path.resolve(value);
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--smoke') {
      args.smoke = true;
      args.trialsPerAgent = 1;
      args.agents = 1;
      args.concurrency = 1;
      args.types = ['1P1G'];
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: node dataAnalysis/scripts/run_vlm_single_agent_pilot.js [options]',
        '',
        '  --trials-per-agent N    Trials per experiment type and agent (default: 10)',
        '  --agents N              Independent agent sessions (default: 1)',
        '  --map-selection MODE    sequential or original-random (default: sequential)',
        '  --types LIST             Comma-separated 1P1G,1P2G (default: both)',
        '  --concurrency N           Concurrent agent sessions (default: 5)',
        '  --max-steps N             Step cap per trial (default: 60)',
        '  --seed N                  Condition/generator seed (default: 4101)',
        '  --output-dir PATH         Output directory',
        '  --dry-run                 Print schedule and first prompt; make no API calls',
        '  --smoke                   Run only the first 1P1G map'
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.trialsPerAgent) || args.trialsPerAgent < 1) {
    throw new Error('--trials-per-agent must be a positive integer');
  }
  if (!Number.isInteger(args.agents) || args.agents < 1) {
    throw new Error('--agents must be a positive integer');
  }
  if (!['sequential', 'original-random'].includes(args.mapSelection)) {
    throw new Error('--map-selection must be sequential or original-random');
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (!Number.isInteger(args.maxSteps) || args.maxSteps < 1) {
    throw new Error('--max-steps must be a positive integer');
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error('--seed must be an integer');
  }
  for (const type of args.types) {
    if (!['1P1G', '1P2G'].includes(type)) {
      throw new Error(`Unsupported experiment type: ${type}`);
    }
  }
  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function loadLegacyMapObject(fileName, variableName) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'config', fileName), 'utf8');
  return vm.runInNewContext(`${source}\n${variableName};`, Object.create(null), {
    filename: fileName,
    timeout: 1000
  });
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledBalancedConditions(count, seed) {
  const conditions = [];
  for (let i = 0; i < count; i += 1) {
    conditions.push(ONE_P_TWO_G_CONDITIONS[i % ONE_P_TWO_G_CONDITIONS.length]);
  }
  const random = mulberry32(seed);
  for (let i = conditions.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [conditions[i], conditions[j]] = [conditions[j], conditions[i]];
  }
  return conditions;
}

function selectMapKeys(keys, count, mode, seed) {
  if (!keys.length) return [];
  if (mode === 'original-random') {
    // Match legacy TimelineManager/selectRandomMaps: independent draws with replacement.
    const random = mulberry32(seed);
    return Array.from({ length: count }, () => keys[Math.floor(random() * keys.length)]);
  }
  // Match the current ExperimentManager: map key selected by trialIndex modulo count.
  return Array.from({ length: count }, (_, index) => keys[index % keys.length]);
}

function clonePosition(position) {
  return [position[0], position[1]];
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function samePosition(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function closestGoalAfterAction(currentPosition, actionVector, goals, history) {
  const projected = [
    currentPosition[0] + actionVector[0],
    currentPosition[1] + actionVector[1]
  ];
  let minDistance = Infinity;
  const tied = [];
  for (let i = 0; i < goals.length; i += 1) {
    const distance = manhattan(projected, goals[i]);
    if (distance < minDistance) {
      minDistance = distance;
      tied.length = 0;
      tied.push(i);
    } else if (distance === minDistance) {
      tied.push(i);
    }
  }
  if (tied.length > 1) return history.length ? history[history.length - 1] : null;
  return tied.length ? tied[0] : null;
}

function generateDynamicGoal(playerPosition, firstGoal, existingGoals, condition, random) {
  if (condition === 'no_new_goal') return null;

  const distanceToFirst = manhattan(playerPosition, firstGoal);
  const occupied = (candidate) => samePosition(candidate, playerPosition) ||
    existingGoals.some((goal) => samePosition(candidate, goal));
  const meetsCondition = (distance) => {
    const difference = Math.abs(distance - distanceToFirst);
    // Match legacyVersion/expDesign.js: closer/farther differ by exactly two
    // grid steps, and equal means exact equality.
    if (condition === 'closer_to_player1') {
      return distance < distanceToFirst && difference === 2;
    }
    if (condition === 'farther_to_player1') {
      return distance > distanceToFirst && difference === 2;
    }
    if (condition === 'equal_to_player1') return difference === 0;
    return false;
  };

  const findValid = (relaxed) => {
    const valid = [];
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let col = 0; col < GRID_SIZE; col += 1) {
        const candidate = [row, col];
        if (occupied(candidate)) continue;
        const fromPlayer = manhattan(playerPosition, candidate);
        const fromFirstGoal = manhattan(firstGoal, candidate);
        const minimumGoalSeparation = relaxed ? 2 : 3;
        if (fromPlayer < 1 || (!relaxed && fromPlayer > 12)) continue;
        if (fromFirstGoal < minimumGoalSeparation) continue;
        if (meetsCondition(fromPlayer)) valid.push(candidate);
      }
    }
    return valid;
  };

  let usedRelaxedFallback = false;
  let valid = findValid(false);
  if (!valid.length) {
    usedRelaxedFallback = true;
    valid = findValid(true);
  }

  if (!valid.length) return null;
  const position = clonePosition(valid[Math.floor(random() * valid.length)]);
  return {
    position,
    conditionType: condition,
    distanceToOriginalGoal: distanceToFirst,
    distanceToPlayer1: manhattan(playerPosition, position),
    distanceDifference: manhattan(playerPosition, position) - distanceToFirst,
    usedRelaxedFallback
  };
}

function makeGrid(playerPosition, goals) {
  const grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
  for (const goal of goals) grid[goal[0]][goal[1]] = 3;
  grid[playerPosition[0]][playerPosition[1]] = 1;
  return grid;
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      }
      return value >>> 0;
    });
  }
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function gridToPngDataUrl(grid) {
  const padding = 1;
  const cellSize = 12;
  const width = grid.length * cellSize + (grid.length + 1) * padding;
  const colors = {
    0: [249, 249, 249],
    1: [255, 0, 0],
    2: [255, 136, 0],
    3: [0, 102, 255],
    4: [51, 51, 51]
  };
  const gridColor = [204, 204, 204];
  const scanlines = Buffer.alloc((width * 3 + 1) * width);

  for (let y = 0; y < width; y += 1) {
    const rowOffset = y * (width * 3 + 1);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const gridLine = x % (cellSize + padding) === 0 || y % (cellSize + padding) === 0;
      let color = gridColor;
      if (!gridLine) {
        const row = Math.floor(y / (cellSize + padding));
        const col = Math.floor(x / (cellSize + padding));
        color = colors[grid[row]?.[col] ?? 0] || colors[0];
      }
      const pixelOffset = rowOffset + 1 + x * 3;
      scanlines[pixelOffset] = color[0];
      scanlines[pixelOffset + 1] = color[1];
      scanlines[pixelOffset + 2] = color[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function buildPrompt({ experimentType, grid, position, goals, trajectory }) {
  const gameRules = GAME_RULES[experimentType];
  const matrixText = grid.map((row) => row.join(' ')).join('\n');
  const goalsText = goals.map((goal) => `(${goal[0]}, ${goal[1]})`).join('; ');
  const recentTrajectory = trajectory.slice(-MAX_HISTORY);
  const trajectoryText = recentTrajectory.map((point) => `(${point[0]}, ${point[1]})`).join(' -> ');
  return [
    '=== GAME CONTEXT ===',
    'You are playing a navigation game in a 2D grid world. You are a hungry traveler who needs to reach restaurants as quickly as possible.',
    '',
    `GAME RULES: ${gameRules}`,
    '',
    '=== CURRENT STATE ===',
    'Grid map and legend:',
    'Legend: 0=blank, 1=traveler1, 3=restaurant',
    'Grid matrix:',
    matrixText,
    '',
    'Player positions:',
    `  Traveler1 (red): (${position[0]}, ${position[1]})`,
    `Restaurants (blue): ${goalsText || 'none'}`,
    '',
    'YOU ARE: Traveler 1 (red)',
    '',
    '=== ACTIONS ===',
    'Movement directions (coordinate deltas):',
    '  left = [0, -1]  (move left, column decreases)',
    '  right = [0, 1]  (move right, column increases)',
    '  up = [-1, 0]    (move up, row decreases)',
    '  down = [1, 0]   (move down, row increases)',
    '',
    '=== RECENT MOVEMENT HISTORY ===',
    `Traveler1 path: ${trajectoryText || 'n/a'}`,
    '',
    '=== YOUR TASK ===',
    'Choose the best single-step action.',
    '',
    '=== OUTPUT FORMAT ===',
    'Reply with exactly one action token:',
    '  up | down | left | right',
    '',
    'Do NOT include any explanations, reasoning, JSON, or additional text.'
  ].join('\n');
}

function parseAction(content) {
  const normalized = String(content || '').trim().toLowerCase();
  const exact = normalized.match(/^(up|down|left|right)[.!]?$/);
  if (exact) return exact[1];
  const matches = normalized.match(/\b(up|down|left|right)\b/g) || [];
  return matches.length === 1 ? matches[0] : null;
}

async function callVisionModel({ apiKey, model, prompt, imageDataUrl, temperature = 0, retries = 3 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature,
          messages: [
            { role: 'system', content: VLM_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } }
              ]
            }
          ]
        })
      });
      const responseText = await response.text();
      if (!response.ok) {
        const error = new Error(`OpenAI API ${response.status}: ${responseText.slice(0, 500)}`);
        error.status = response.status;
        throw error;
      }
      const data = JSON.parse(responseText);
      return {
        content: data?.choices?.[0]?.message?.content || '',
        usage: data?.usage || null,
        latencyMs: Date.now() - started,
        modelReturned: data?.model || model,
        requestId: response.headers.get('x-request-id'),
        attempt
      };
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status === 408 || error.status === 409 ||
        error.status === 429 || error.status >= 500;
      if (!retryable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function sumUsage(steps) {
  const usage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0
  };
  for (const step of steps) {
    const item = step.usage || {};
    usage.promptTokens += Number(item.prompt_tokens) || 0;
    usage.completionTokens += Number(item.completion_tokens) || 0;
    usage.totalTokens += Number(item.total_tokens) || 0;
    usage.cachedPromptTokens += Number(item.prompt_tokens_details?.cached_tokens) || 0;
  }
  return usage;
}

function estimateCostUsd(model, usage) {
  if (!String(model).startsWith('gpt-4.1-mini')) return null;
  const uncachedInput = Math.max(0, usage.promptTokens - usage.cachedPromptTokens);
  const cachedInput = usage.cachedPromptTokens;
  // GPT-4.1 mini cached input is one quarter of its standard input price.
  return (uncachedInput / 1_000_000) * GPT_4_1_MINI_PRICES_PER_MILLION.input +
    (cachedInput / 1_000_000) * (GPT_4_1_MINI_PRICES_PER_MILLION.input / 4) +
    (usage.completionTokens / 1_000_000) * GPT_4_1_MINI_PRICES_PER_MILLION.output;
}

async function runTrial(spec, runtime) {
  const {
    agentId, agentIndex, trialIndex, experimentType, mapKey, design,
    distanceCondition, trialSeed
  } = spec;
  const random = mulberry32(trialSeed);
  let position = clonePosition(design.initPlayerGrid);
  const initialPosition = clonePosition(position);
  const initialGoals = [clonePosition(design.target1)];
  if (experimentType === '1P2G') initialGoals.push(clonePosition(design.target2));
  const goals = initialGoals.map(clonePosition);
  const trajectory = [clonePosition(position)];
  const goalHistory = [];
  const stepRecords = [];
  let dynamicGoal = null;
  let invalidMoveCount = 0;
  let invalidResponseCount = 0;
  let repeatedStateCount = 0;
  const visited = new Set([position.join(',')]);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let error = null;

  for (let step = 0; step < runtime.maxSteps; step += 1) {
    if (goals.some((goal) => samePosition(position, goal))) break;
    const grid = makeGrid(position, goals);
    const prompt = buildPrompt({
      experimentType,
      grid,
      position,
      goals,
      trajectory
    });
    let response;
    try {
      response = await callVisionModel({
        apiKey: runtime.apiKey,
        model: runtime.model,
        prompt,
        imageDataUrl: gridToPngDataUrl(grid)
      });
    } catch (callError) {
      error = String(callError?.message || callError);
      break;
    }

    const requestedAction = parseAction(response.content);
    if (!requestedAction) {
      invalidResponseCount += 1;
      stepRecords.push({
        step: step + 1,
        positionBefore: clonePosition(position),
        positionAfter: clonePosition(position),
        requestedAction: null,
        rawResponse: response.content,
        validMove: false,
        inferredGoal: null,
        goals: goals.map(clonePosition),
        latencyMs: response.latencyMs,
        usage: response.usage,
        modelReturned: response.modelReturned,
        requestId: response.requestId,
        attempt: response.attempt
      });
      continue;
    }

    const vector = ACTIONS[requestedAction];
    const candidate = [position[0] + vector[0], position[1] + vector[1]];
    const validMove = candidate[0] >= 0 && candidate[0] < GRID_SIZE &&
      candidate[1] >= 0 && candidate[1] < GRID_SIZE;
    const positionBefore = clonePosition(position);
    if (validMove) position = candidate;
    else invalidMoveCount += 1;
    if (visited.has(position.join(','))) repeatedStateCount += 1;
    visited.add(position.join(','));
    trajectory.push(clonePosition(position));

    // Match GameStateManager: goal inference is performed after movement using the
    // requested action, so the helper projects once more from the updated position.
    const inferredGoal = closestGoalAfterAction(position, vector, goals, goalHistory);
    goalHistory.push(inferredGoal);

    let dynamicGoalAddedThisStep = null;
    if (experimentType === '1P2G' && !dynamicGoal && goals.length === 2 &&
        step + 1 >= 1 && inferredGoal !== null) {
      dynamicGoal = generateDynamicGoal(position, goals[0], goals, distanceCondition, random);
      if (dynamicGoal) {
        goals.push(clonePosition(dynamicGoal.position));
        dynamicGoal.stepPresented = step + 1;
        dynamicGoalAddedThisStep = { ...dynamicGoal, position: clonePosition(dynamicGoal.position) };
      }
    }

    stepRecords.push({
      step: step + 1,
      positionBefore,
      positionAfter: clonePosition(position),
      requestedAction,
      rawResponse: response.content,
      validMove,
      inferredGoal,
      goals: goals.map(clonePosition),
      dynamicGoalAdded: dynamicGoalAddedThisStep,
      latencyMs: response.latencyMs,
      usage: response.usage,
      modelReturned: response.modelReturned,
      requestId: response.requestId,
      attempt: response.attempt
    });

    if (goals.some((goal) => samePosition(position, goal))) break;
  }

  const reachedGoalIndex = goals.findIndex((goal) => samePosition(position, goal));
  const success = reachedGoalIndex >= 0;
  const usage = sumUsage(stepRecords);
  const shortestInitialDistance = Math.min(...initialGoals.map((goal) => manhattan(initialPosition, goal)));
  const movesMade = stepRecords.filter((record) => record.requestedAction).length;
  const latencyValues = stepRecords.map((record) => record.latencyMs).filter(Number.isFinite);
  const totalLatencyMs = latencyValues.reduce((sum, value) => sum + value, 0);
  let postChangeOptimalRemainingSteps = null;
  let postChangeActualRemainingSteps = null;
  let postChangeExcessSteps = null;
  let postChangePathEfficiency = null;
  if (dynamicGoal?.stepPresented) {
    const presentationRecord = stepRecords[dynamicGoal.stepPresented - 1];
    if (presentationRecord) {
      postChangeOptimalRemainingSteps = Math.min(
        ...goals.map((goal) => manhattan(presentationRecord.positionAfter, goal))
      );
      postChangeActualRemainingSteps = stepRecords
        .slice(dynamicGoal.stepPresented)
        .filter((record) => record.requestedAction)
        .length;
      postChangeExcessSteps = postChangeActualRemainingSteps - postChangeOptimalRemainingSteps;
      postChangePathEfficiency = postChangeActualRemainingSteps > 0
        ? Math.min(1, postChangeOptimalRemainingSteps / postChangeActualRemainingSteps)
        : null;
    }
  }

  let originalIntendedGoalIndex = null;
  let committedToOriginalGoal = null;
  let chosenGoalPathEfficiency = null;
  let opportunityAdjustedEfficiency = null;
  let opportunityOptimal = null;
  if (success) {
    if (dynamicGoal?.stepPresented) {
      const presentationIndex = dynamicGoal.stepPresented - 1;
      const presentationRecord = stepRecords[presentationIndex];
      originalIntendedGoalIndex = Number.isInteger(presentationRecord?.inferredGoal)
        ? presentationRecord.inferredGoal
        : null;
      committedToOriginalGoal = Number.isInteger(originalIntendedGoalIndex)
        ? reachedGoalIndex === originalIntendedGoalIndex
        : null;
      const prefixMoves = stepRecords
        .slice(0, dynamicGoal.stepPresented)
        .filter((record) => record.requestedAction)
        .length;
      const chosenOracleMoves = prefixMoves + manhattan(
        presentationRecord.positionAfter,
        goals[reachedGoalIndex]
      );
      const opportunityOracleMoves = prefixMoves + Math.min(
        ...goals.map((goal) => manhattan(presentationRecord.positionAfter, goal))
      );
      chosenGoalPathEfficiency = movesMade > 0
        ? Math.min(1, chosenOracleMoves / movesMade)
        : null;
      opportunityAdjustedEfficiency = movesMade > 0
        ? Math.min(1, opportunityOracleMoves / movesMade)
        : null;
      opportunityOptimal = opportunityOracleMoves === movesMade;
    } else {
      const chosenOracleMoves = manhattan(initialPosition, goals[reachedGoalIndex]);
      const opportunityOracleMoves = Math.min(
        ...initialGoals.map((goal) => manhattan(initialPosition, goal))
      );
      chosenGoalPathEfficiency = movesMade > 0
        ? Math.min(1, chosenOracleMoves / movesMade)
        : null;
      opportunityAdjustedEfficiency = movesMade > 0
        ? Math.min(1, opportunityOracleMoves / movesMade)
        : null;
      opportunityOptimal = opportunityOracleMoves === movesMade;
    }
  }

  return {
    agentId,
    agentIndex,
    trialIndex,
    experimentType,
    mapKey,
    distanceCondition: distanceCondition || null,
    trialSeed,
    startedAt,
    durationMs: Date.now() - startedMs,
    model: runtime.model,
    startPosition: initialPosition,
    initialGoals,
    finalGoals: goals.map(clonePosition),
    dynamicGoal,
    newGoalExpected: experimentType === '1P2G' && distanceCondition !== 'no_new_goal',
    newGoalGenerationFailed: experimentType === '1P2G' &&
      distanceCondition !== 'no_new_goal' && !dynamicGoal,
    success,
    reachedGoalIndex: success ? reachedGoalIndex : null,
    reachedDynamicGoal: success && reachedGoalIndex >= initialGoals.length,
    originalIntendedGoalIndex,
    committedToOriginalGoal,
    terminalReason: error ? 'api_error' : (success ? 'goal_reached' : 'max_steps'),
    error,
    steps: stepRecords.length,
    movesMade,
    shortestInitialDistance,
    excessStepsVsInitialOracle: success ? movesMade - shortestInitialDistance : null,
    pathEfficiencyVsInitialOracle: success && movesMade > 0
      ? Math.min(1, shortestInitialDistance / movesMade)
      : null,
    postChangeOptimalRemainingSteps,
    postChangeActualRemainingSteps,
    postChangeExcessSteps,
    postChangePathEfficiency,
    chosenGoalPathEfficiency,
    opportunityAdjustedEfficiency,
    opportunityOptimal,
    invalidMoveCount,
    invalidResponseCount,
    repeatedStateCount,
    uniquePositions: visited.size,
    finalPosition: clonePosition(position),
    trajectory,
    inferredGoalHistory: goalHistory,
    usage,
    estimatedCostUsd: estimateCostUsd(runtime.model, usage),
    meanApiLatencyMs: latencyValues.length ? totalLatencyMs / latencyValues.length : null,
    totalApiLatencyMs: totalLatencyMs,
    stepRecords
  };
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function sum(values) {
  return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

function aggregateTrials(trials) {
  const aggregateGroup = (items) => {
    const successes = items.filter((trial) => trial.success);
    const commitmentEligible = items.filter(
      (trial) => typeof trial.committedToOriginalGoal === 'boolean'
    );
    const usage = {
      promptTokens: sum(items.map((trial) => trial.usage.promptTokens)),
      completionTokens: sum(items.map((trial) => trial.usage.completionTokens)),
      totalTokens: sum(items.map((trial) => trial.usage.totalTokens)),
      cachedPromptTokens: sum(items.map((trial) => trial.usage.cachedPromptTokens))
    };
    return {
      n: items.length,
      successes: successes.length,
      successRate: items.length ? successes.length / items.length : null,
      meanStepsAll: mean(items.map((trial) => trial.steps)),
      meanStepsSuccessful: mean(successes.map((trial) => trial.steps)),
      meanPathEfficiencySuccessful: mean(successes.map((trial) => trial.pathEfficiencyVsInitialOracle)),
      meanChosenGoalPathEfficiency: mean(successes.map((trial) => trial.chosenGoalPathEfficiency)),
      meanOpportunityAdjustedEfficiency: mean(
        successes.map((trial) => trial.opportunityAdjustedEfficiency)
      ),
      opportunityOptimalTrials: successes.filter((trial) => trial.opportunityOptimal).length,
      newGoalGenerationFailures: items.filter((trial) => trial.newGoalGenerationFailed).length,
      commitmentEligibleTrials: commitmentEligible.length,
      committedToOriginalGoalTrials: commitmentEligible.filter(
        (trial) => trial.committedToOriginalGoal
      ).length,
      commitmentRate: commitmentEligible.length
        ? commitmentEligible.filter((trial) => trial.committedToOriginalGoal).length /
          commitmentEligible.length
        : null,
      dynamicGoalTrials: items.filter((trial) => Boolean(trial.dynamicGoal)).length,
      dynamicGoalsReached: items.filter((trial) => trial.reachedDynamicGoal).length,
      dynamicGoalReachRate: items.some((trial) => Boolean(trial.dynamicGoal))
        ? items.filter((trial) => trial.reachedDynamicGoal).length /
          items.filter((trial) => Boolean(trial.dynamicGoal)).length
        : null,
      meanPostChangePathEfficiency: mean(items.map((trial) => trial.postChangePathEfficiency)),
      totalPostChangeExcessSteps: sum(items.map((trial) => trial.postChangeExcessSteps)),
      totalInvalidMoves: sum(items.map((trial) => trial.invalidMoveCount)),
      totalInvalidResponses: sum(items.map((trial) => trial.invalidResponseCount)),
      totalRepeatedStates: sum(items.map((trial) => trial.repeatedStateCount)),
      meanApiLatencyMs: mean(items.map((trial) => trial.meanApiLatencyMs)),
      totalApiCalls: sum(items.map((trial) => trial.stepRecords.length)),
      usage,
      estimatedCostUsd: sum(items.map((trial) => trial.estimatedCostUsd))
    };
  };

  const byExperimentType = {};
  for (const type of ['1P1G', '1P2G']) {
    const items = trials.filter((trial) => trial.experimentType === type);
    if (items.length) byExperimentType[type] = aggregateGroup(items);
  }
  const byOneP2GCondition = {};
  for (const condition of ONE_P_TWO_G_CONDITIONS) {
    const items = trials.filter((trial) => trial.distanceCondition === condition);
    if (items.length) byOneP2GCondition[condition] = aggregateGroup(items);
  }
  const byAgent = {};
  for (const agentId of [...new Set(trials.map((trial) => trial.agentId).filter(Boolean))]) {
    byAgent[agentId] = aggregateGroup(trials.filter((trial) => trial.agentId === agentId));
  }
  return {
    overall: aggregateGroup(trials),
    byExperimentType,
    byOneP2GCondition,
    byAgent
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function trialsToCsv(trials) {
  const columns = [
    'agentId', 'agentIndex', 'trialIndex', 'experimentType', 'mapKey',
    'distanceCondition', 'success', 'terminalReason', 'reachedGoalIndex',
    'reachedDynamicGoal', 'originalIntendedGoalIndex', 'committedToOriginalGoal',
    'steps', 'movesMade',
    'shortestInitialDistance', 'excessStepsVsInitialOracle',
    'chosenGoalPathEfficiency', 'opportunityAdjustedEfficiency', 'opportunityOptimal',
    'pathEfficiencyVsInitialOracle', 'postChangePathEfficiency', 'postChangeExcessSteps',
    'invalidMoveCount', 'invalidResponseCount',
    'repeatedStateCount', 'uniquePositions', 'meanApiLatencyMs',
    'promptTokens', 'completionTokens', 'totalTokens', 'estimatedCostUsd', 'error'
  ];
  const rows = trials.map((trial) => ({
    ...trial,
    promptTokens: trial.usage.promptTokens,
    completionTokens: trial.usage.completionTokens,
    totalTokens: trial.usage.totalTokens
  }));
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))
  ].join('\n') + '\n';
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

async function runAgentSessions(specs, concurrency, worker) {
  const groups = [];
  const byAgent = new Map();
  for (const spec of specs) {
    if (!byAgent.has(spec.agentId)) {
      const group = [];
      byAgent.set(spec.agentId, group);
      groups.push(group);
    }
    byAgent.get(spec.agentId).push(spec);
  }
  const groupedResults = await mapWithConcurrency(groups, concurrency, async (group) => {
    const sessionResults = [];
    // Preserve within-agent trial order; separate agent sessions may run in parallel.
    for (const spec of group) sessionResults.push(await worker(spec));
    return sessionResults;
  });
  return groupedResults.flat();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(path.join(REPO_ROOT, '.env'));
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.VLM_API_MODEL || process.env.GPT_API_MODEL ||
    process.env.GPT_MODEL || 'gpt-4o-mini';
  if (!apiKey && !args.dryRun) {
    throw new Error('OPENAI_API_KEY is missing from the environment and .env');
  }

  const oneP1GMaps = loadLegacyMapObject('MapsFor1P1G.js', 'MapsFor1P1G');
  const oneP2GMaps = loadLegacyMapObject('MapsFor1P2G.js', 'MapsFor1P2G');
  const specs = [];

  for (let agentIndex = 0; agentIndex < args.agents; agentIndex += 1) {
    const agentId = `agent_${String(agentIndex + 1).padStart(2, '0')}`;
    const agentSeed = args.seed + agentIndex * 1_000_003;

    if (args.types.includes('1P1G')) {
      const selected = selectMapKeys(
        Object.keys(oneP1GMaps),
        args.trialsPerAgent,
        args.mapSelection,
        agentSeed + 101
      );
      selected.forEach((mapKey, trialIndex) => {
        specs.push({
          agentId,
          agentIndex,
          trialIndex,
          experimentType: '1P1G',
          mapKey,
          design: oneP1GMaps[mapKey][0],
          distanceCondition: null,
          trialSeed: agentSeed + trialIndex * 10_007 + Number(mapKey) * 1009
        });
      });
    }

    if (args.types.includes('1P2G')) {
      const selected = selectMapKeys(
        Object.keys(oneP2GMaps),
        args.trialsPerAgent,
        args.mapSelection,
        agentSeed + 211
      );
      const conditions = shuffledBalancedConditions(args.trialsPerAgent, agentSeed + 307);
      selected.forEach((mapKey, trialIndex) => {
        specs.push({
          agentId,
          agentIndex,
          trialIndex,
          experimentType: '1P2G',
          mapKey,
          design: oneP2GMaps[mapKey][0],
          distanceCondition: conditions[trialIndex],
          trialSeed: agentSeed + trialIndex * 10_007 + Number(mapKey) * 1009
        });
      });
    }
  }

  if (args.dryRun) {
    const schedule = {};
    for (const agentId of [...new Set(specs.map((spec) => spec.agentId))]) {
      const agentSpecs = specs.filter((spec) => spec.agentId === agentId);
      schedule[agentId] = {
        trials: agentSpecs.length,
        maps: agentSpecs.map((spec) => spec.mapKey),
        conditions: Object.fromEntries(ONE_P_TWO_G_CONDITIONS.map((condition) => [
          condition,
          agentSpecs.filter((spec) => spec.distanceCondition === condition).length
        ]))
      };
    }
    const firstSpec = specs[0];
    const firstGoals = [firstSpec.design.target1];
    if (firstSpec.experimentType === '1P2G') firstGoals.push(firstSpec.design.target2);
    const firstPosition = firstSpec.design.initPlayerGrid;
    console.log(JSON.stringify({
      model,
      totalTrials: specs.length,
      agents: args.agents,
      trialsPerAgent: args.trialsPerAgent,
      mapSelection: args.mapSelection,
      schedule
    }, null, 2));
    console.log('\n=== FIRST-DECISION USER PROMPT ===\n');
    console.log(buildPrompt({
      experimentType: firstSpec.experimentType,
      grid: makeGrid(firstPosition, firstGoals),
      position: firstPosition,
      goals: firstGoals,
      trajectory: [firstPosition]
    }));
    return;
  }

  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const outputDir = args.outputDir || path.join(REPO_ROOT, 'outputs', `vlm_single_agent_pilot_${stamp}`);
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Starting ${specs.length}-trial VLM pilot with ${model}; concurrency=${args.concurrency}`);
  console.log(`Output directory: ${outputDir}`);

  let completed = 0;
  const trials = await runAgentSessions(specs, args.concurrency, async (spec) => {
    const trial = await runTrial(spec, {
      apiKey,
      model,
      maxSteps: args.maxSteps
    });
    completed += 1;
    console.log(
      `[${completed}/${specs.length}] ${trial.agentId} ${trial.experimentType} ` +
      `trial ${trial.trialIndex + 1} map ${trial.mapKey}: ` +
      `${trial.terminalReason}, steps=${trial.steps}, cost=$${(trial.estimatedCostUsd || 0).toFixed(5)}`
    );
    return trial;
  });

  const aggregate = aggregateTrials(trials);
  const result = {
    metadata: {
      createdAt: new Date().toISOString(),
      runner: path.relative(REPO_ROOT, fileURLToPath(import.meta.url)),
      model,
      temperature: 0,
      visionDetail: 'low',
      agents: args.agents,
      trialsPerAgentPerExperimentType: args.trialsPerAgent,
      mapSelection: args.mapSelection,
      selectedMapKeysByAgent: Object.fromEntries(
        [...new Set(specs.map((item) => item.agentId))].map((agentId) => [
          agentId,
          specs.filter((item) => item.agentId === agentId).map((item) => ({
            trialIndex: item.trialIndex,
            experimentType: item.experimentType,
            mapKey: item.mapKey
          }))
        ])
      ),
      oneP2GConditionAssignment: specs
        .filter((item) => item.experimentType === '1P2G')
        .map((item) => ({
          agentId: item.agentId,
          trialIndex: item.trialIndex,
          mapKey: item.mapKey,
          condition: item.distanceCondition
        })),
      seed: args.seed,
      maxSteps: args.maxSteps,
      concurrency: args.concurrency,
      promptVariant: 'single-agent-original-scaffold-v3-blinded',
      systemPrompt: VLM_SYSTEM_PROMPT,
      gameRules: Object.fromEntries(args.types.map((type) => [type, GAME_RULES[type]])),
      dynamicGoalDesign: 'legacy-1P2G-exact-distance',
      internalConditionVisibleToAgent: false,
      pricingAssumption: model.startsWith('gpt-4.1-mini')
        ? GPT_4_1_MINI_PRICES_PER_MILLION
        : null
    },
    aggregate,
    trials
  };

  const jsonPath = path.join(outputDir, 'pilot_results.json');
  const csvPath = path.join(outputDir, 'pilot_trials.csv');
  const summaryPath = path.join(outputDir, 'pilot_summary.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(csvPath, trialsToCsv(trials));
  fs.writeFileSync(summaryPath, JSON.stringify({ metadata: result.metadata, aggregate }, null, 2) + '\n');
  console.log(JSON.stringify(aggregate, null, 2));
  console.log(`Saved: ${jsonPath}`);
  console.log(`Saved: ${csvPath}`);
  console.log(`Saved: ${summaryPath}`);
  if (trials.some((trial) => trial.terminalReason === 'api_error')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
