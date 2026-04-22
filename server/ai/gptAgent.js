// Simple GPT agent wrapper to decide next move based on grid state
// Outputs one of: up | down | left | right
// Server-side only. Reads config via process.env at call time.

import { vlmLimiter, estimateVlmPromptTokens, LOW_DETAIL_IMAGE_TOKENS_EST } from './rateLimiter.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitterMs() {
  return Math.floor(Math.random() * 500);
}

/**
 * @param {string} errorText
 * @param {number} attempt
 * @param {Headers|null} responseHeaders
 */
function parseRetryDelayMs(errorText, attempt, responseHeaders = null) {
  if (responseHeaders && typeof responseHeaders.get === 'function') {
    const ram = responseHeaders.get('retry-after-ms');
    if (ram) {
      const n = Number(ram);
      if (Number.isFinite(n) && n > 0) {
        return Math.min(60000, Math.ceil(n) + jitterMs());
      }
    }
    const ra = responseHeaders.get('retry-after');
    if (ra) {
      const n = Number(ra);
      if (Number.isFinite(n) && n > 0) {
        const ms = n < 1000 ? Math.ceil(n * 1000) : Math.ceil(n);
        return Math.min(60000, ms + jitterMs());
      }
    }
  }
  const text = String(errorText || '');
  const msMatch = text.match(/try again in\s+(\d+)ms/i);
  if (msMatch) return Math.min(60000, Number(msMatch[1]) + 150 + jitterMs());

  const secondsMatch = text.match(/try again in\s+([0-9.]+)s/i);
  if (secondsMatch) return Math.min(60000, Math.ceil(Number(secondsMatch[1]) * 1000) + 150 + jitterMs());

  return Math.min(60000, Math.min(5000, 500 * Math.max(1, attempt)) + jitterMs());
}

// Dedicated function to log the exact GPT prompt in a readable format
function logExactPrompt(prompt) {
  if (process.env.ENABLE_GPT_DEBUG === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[GPT PROMPT ${timestamp}] EXACT PROMPT SENT TO GPT:`);
    console.log(`${'='.repeat(80)}`);
    console.log(prompt);
    console.log(`${'='.repeat(80)}`);
    console.log(`[END OF PROMPT - Length: ${prompt.length} characters]\n`);
  }
}

// Log GPT output summary per step
function logGptOutput({ kind = 'base', modelLabel, baseModel, content, action, inferredGoal, usage, latencyMs, rate }) {
  if (process.env.ENABLE_GPT_DEBUG !== 'true') return;
  const timestamp = new Date().toISOString();
  const header = kind === 'tom' ? 'GPT-ToM OUTPUT' : 'GPT OUTPUT';
  console.log(`\n${'-'.repeat(80)}`);
  console.log(`[${header} ${timestamp}]`);
  if (modelLabel) console.log(`model: ${modelLabel}${baseModel ? ` (api: ${baseModel})` : ''}`);
  if (typeof action === 'string') console.log(`action: ${action}`);
  if (Array.isArray(inferredGoal)) console.log(`inferred_goal: (${inferredGoal[0]}, ${inferredGoal[1]})`);
  if (content) {
    const preview = String(content).slice(0, 500);
    console.log(`raw: ${preview}${content.length > 500 ? ' ...[truncated]' : ''}`);
  }
  if (typeof latencyMs === 'number') console.log(`latencyMs: ${latencyMs}`);
  if (usage && (usage.total_tokens || usage.prompt_tokens || usage.completion_tokens)) {
    console.log(`usage: ${JSON.stringify(usage)}`);
  }
  if (rate && (rate.remainingRequests || rate.remainingTokens)) {
    console.log(`rate: ${JSON.stringify(rate)}`);
  }
  console.log(`${'-'.repeat(80)}\n`);
}

// Build a compact matrix string for the prompt
function formatMatrix(matrix) {
  // Expect a 2D array of integers: 0 blank, 1 p1, 2 p2, 3 goal, 4 obstacle
  return matrix.map(row => row.join(' ')).join('\n');
}

// Helpers to infer coordinates from the matrix when not explicitly provided
function findFirstCoord(matrix, value) {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === value) return [r, c];
    }
  }
  return null;
}

function findAllCoords(matrix, value) {
  const coords = [];
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === value) coords.push([r, c]);
    }
  }
  return coords;
}

function isStagHuntExperiment(experimentType) {
  const t = String(experimentType || '').trim();
  return t === 'StagHunt' || t === 'StagHuntTwoStags';
}

function isTwoStagVariant(experimentType) {
  return String(experimentType || '').trim() === 'StagHuntTwoStags';
}

function formatCoord(coord) {
  return (Array.isArray(coord) && coord.length >= 2) ? `(${coord[0]}, ${coord[1]})` : 'unknown';
}

function formatCoordList(coords, emptyLabel = 'none') {
  if (!Array.isArray(coords) || coords.length === 0) return emptyLabel;
  return coords
    .filter(coord => Array.isArray(coord) && coord.length >= 2)
    .map(coord => `(${coord[0]}, ${coord[1]})`)
    .join('; ') || emptyLabel;
}

function normalizeValidActions(validActions) {
  const allowed = ['up', 'down', 'left', 'right'];
  if (!Array.isArray(validActions)) return allowed;
  const filtered = validActions.filter(action => allowed.includes(String(action)));
  return filtered.length > 0 ? filtered : allowed;
}

/**
 * Resolve traveler positions from matrix and/or explicit payload coordinates (VLM without matrix text).
 */
function resolveDualPlayerPositions({ matrix, currentPlayer, player1Pos, player2Pos } = {}) {
  let p1 = null;
  let p2 = null;
  if (Array.isArray(matrix) && matrix.length > 0) {
    p1 = findFirstCoord(matrix, 1);
    p2 = findFirstCoord(matrix, 2);
  }
  if (!p1 && Array.isArray(player1Pos) && player1Pos.length >= 2) {
    p1 = [Number(player1Pos[0]), Number(player1Pos[1])];
  }
  if (!p2 && Array.isArray(player2Pos) && player2Pos.length >= 2) {
    p2 = [Number(player2Pos[0]), Number(player2Pos[1])];
  }
  const label = currentPlayer?.label;
  const cpos = Array.isArray(currentPlayer?.pos) && currentPlayer.pos.length >= 2
    ? [Number(currentPlayer.pos[0]), Number(currentPlayer.pos[1])]
    : null;
  if (!p1 && cpos && label === 'player1') p1 = cpos;
  if (!p2 && cpos && label === 'player2') p2 = cpos;
  return { p1, p2, cpos, label };
}

function getVlmMaxOutputTokens() {
  const n = Number(process.env.VLM_MAX_OUTPUT_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.min(256, Math.floor(n)) : 8;
}

function getVlmTomMaxOutputTokens() {
  const n = Number(process.env.VLM_TOM_MAX_OUTPUT_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.min(512, Math.floor(n)) : 80;
}

function buildTrajectoryLines(memory, controlledLabel) {
  if (!(memory && memory.enabled && memory.trajectories)) return [];
  const p1t = Array.isArray(memory.trajectories.player1) ? memory.trajectories.player1 : [];
  const p2t = Array.isArray(memory.trajectories.player2) ? memory.trajectories.player2 : [];
  const fmt = (traj) => traj.map(c => `(${c[0]}, ${c[1]})`).join(' -> ');

  const lines = [
    'Recent trajectories (last few positions):',
    `Traveler1: ${fmt(p1t) || 'n/a'}`,
    `Traveler2: ${fmt(p2t) || 'n/a'}`,
  ];

  // Detect oscillation in the controlled player's trajectory and warn.
  const myTraj = controlledLabel === 'player1' ? p1t : p2t;
  if (myTraj.length >= 4) {
    const seen = new Map();
    for (const pos of myTraj) {
      const key = `${pos[0]},${pos[1]}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    const maxVisits = Math.max(...seen.values());
    if (maxVisits >= 2) {
      lines.push('⚠️ WARNING: You have revisited the same cell multiple times. You are stuck in a loop.');
      lines.push('You MUST choose a direction that moves you toward a goal you have NOT recently visited.');
      lines.push('Do NOT reverse your last move.');
    }
  }

  lines.push('');
  return lines;
}

// Build the shared StagHunt rules block, mirroring the human instructions
// shown via TimelineManager.getInstructionsForExperiment('StagHunt' /
// 'StagHuntTwoStags'). Reward numbers are sourced from the active map's
// `utility_summary` so the prompt matches the actual game scoring; starting
// points and step cost fall back to the human-UI literals (15 / -1) when the
// payload omits them.
function buildStagHuntRulesBlock({ experimentType, utilitySummary, stagPositions }) {
  const twoStag = isTwoStagVariant(experimentType);
  const hareReward = utilitySummary?.hare_reward_each;
  const stagReward = utilitySummary?.stag_reward_each;
  const stepCostRaw = utilitySummary?.step_cost_per_move;
  const stepCost = Number.isFinite(stepCostRaw) ? Math.abs(stepCostRaw) : 1;
  const startingPoints = Number.isFinite(utilitySummary?.starting_points)
    ? utilitySummary.starting_points
    : 15;

  const stagCount = twoStag
    ? (Array.isArray(stagPositions) && stagPositions.length > 0 ? stagPositions.length : 2)
    : 1;
  const stagNoun = stagCount > 1 ? `${stagCount} stags` : '1 stag';
  const rabbitCount = 2; // StagHunt maps ship with exactly two rabbits.

  const stagRewardLine = Number.isFinite(stagReward)
    ? (twoStag
      ? `If both players reach the **same stag**, you each earn **${stagReward} points**.`
      : `If both players reach the **stag**, you each earn **${stagReward} points**.`)
    : (twoStag
      ? 'If both players reach the **same stag**, you each earn the larger joint payoff.'
      : 'If both players reach the **stag**, you each earn the larger joint payoff.');

  const hareRewardLine = Number.isFinite(hareReward)
    ? `Any player can catch a **rabbit** alone for **${hareReward} points**.`
    : 'Any player can catch a **rabbit** alone for a smaller solo payoff.';

  return [
    '=== STAG HUNT RULES ===',
    twoStag
      ? 'In this game, you will collaborate with another player to hunt, but now there are two stags on the map.'
      : 'In this game, you will collaborate with another player to hunt.',
    `There ${stagCount > 1 ? 'are' : 'is'} ${stagNoun} (big blue goal${stagCount > 1 ? 's' : ''}) and ${rabbitCount} rabbits (small blue goals) on the map.`,
    `Each player starts the round with ${startingPoints} points and loses ${stepCost} point per step.`,
    stagRewardLine,
    hareRewardLine,
    'The round ends only after **both players** have reached a goal.',
    'Only **one** player can catch each rabbit — the first player to reach it claims it. The rabbit then disappears and the other player cannot collect it.',
    'Movement: Both players move one step at a time — the action takes effect only after both players have pressed their keys.'
  ];
}

function buildStagHuntPrompt({ matrix, currentPlayer, memory, guidance, utilitySummary, stagPosition, stagPositions, availableRabbitPositions, validActions, experimentType, player1Pos, player2Pos }) {
  const showMatrix = Array.isArray(matrix) && matrix.length > 0;
  const { p1, p2, cpos, label } = resolveDualPlayerPositions({ matrix, currentPlayer, player1Pos, player2Pos });
  const controlledPlayer = label === 'player1' ? 'Traveler 1' : 'Traveler 2';
  const controlledPos = cpos || (label === 'player1' ? p1 : p2);
  const partnerPos = label === 'player1' ? p2 : p1;
  const actions = normalizeValidActions(validActions);
  const stagList = Array.isArray(stagPositions) && stagPositions.length > 0
    ? stagPositions
    : (Array.isArray(stagPosition) ? [stagPosition] : []);

  const gridBlock = showMatrix
    ? ['Grid legend: 0=blank, 1=traveler1, 2=traveler2, 3=goal tile, 4=obstacle', 'Grid:', formatMatrix(matrix), '']
    : ['Grid legend: 0=blank, 1=traveler1, 2=traveler2, 3=goal tile, 4=obstacle', 'Use the attached image as the grid; coordinates below are ground truth.', ''];

  const lines = [
    ...buildStagHuntRulesBlock({ experimentType, utilitySummary, stagPositions: stagList }),
    '',
    '=== CURRENT STATE ===',
    ...gridBlock,
    `Traveler1 at ${formatCoord(p1)}`,
    `Traveler2 at ${formatCoord(p2)}`,
    `You control: ${controlledPlayer} at ${formatCoord(controlledPos)}`,
    `Partner position: ${formatCoord(partnerPos)}`,
    stagList.length > 1
      ? `Stag positions: ${formatCoordList(stagList)}`
      : `Stag position: ${formatCoord(stagList[0] || stagPosition)}`,
    `Available rabbits: ${formatCoordList(availableRabbitPositions)}`,
    ''
  ].filter(line => line !== null);

  const aiLabel = currentPlayer?.label || 'player2';
  lines.push(...buildTrajectoryLines(memory, aiLabel));
  lines.push(
    '=== AVAILABLE ACTIONS ===',
    `Valid actions from your current square: ${actions.join(', ')}`,
    '',
    '=== RESPONSE ===',
    `Reply with exactly one action token from this set: ${actions.join(' | ')}`
  );

  const finalPrompt = lines.join('\n');
  logExactPrompt(finalPrompt);
  return finalPrompt;
}

function buildStagHuntTomPrompt({ matrix, currentPlayer, memory, guidance, utilitySummary, stagPosition, stagPositions, availableRabbitPositions, validActions, experimentType, player1Pos, player2Pos }) {
  const showMatrix = Array.isArray(matrix) && matrix.length > 0;
  const { p1, p2, cpos, label } = resolveDualPlayerPositions({ matrix, currentPlayer, player1Pos, player2Pos });
  const controlledPlayer = label === 'player1' ? 'Traveler 1' : 'Traveler 2';
  const controlledPos = cpos || (label === 'player1' ? p1 : p2);
  const partnerPos = label === 'player1' ? p2 : p1;
  const actions = normalizeValidActions(validActions);
  const stagList = Array.isArray(stagPositions) && stagPositions.length > 0
    ? stagPositions
    : (Array.isArray(stagPosition) ? [stagPosition] : []);

  const gridBlock = showMatrix
    ? ['Grid legend: 0=blank, 1=traveler1, 2=traveler2, 3=goal tile, 4=obstacle', 'Grid:', formatMatrix(matrix), '']
    : ['Grid legend: 0=blank, 1=traveler1, 2=traveler2, 3=goal tile, 4=obstacle', 'Use the attached image as the grid; coordinates below are ground truth.', ''];

  const lines = [
    ...buildStagHuntRulesBlock({ experimentType, utilitySummary, stagPositions: stagList }),
    '',
    '=== CURRENT STATE ===',
    ...gridBlock,
    `Traveler1 at ${formatCoord(p1)}`,
    `Traveler2 at ${formatCoord(p2)}`,
    `You control: ${controlledPlayer} at ${formatCoord(controlledPos)}`,
    `Partner position: ${formatCoord(partnerPos)}`,
    stagList.length > 1
      ? `Stag positions: ${formatCoordList(stagList)}`
      : `Stag position: ${formatCoord(stagList[0] || stagPosition)}`,
    `Available rabbits: ${formatCoordList(availableRabbitPositions)}`,
    ''
  ].filter(line => line !== null);

  const aiLabel2 = currentPlayer?.label || 'player2';
  lines.push(...buildTrajectoryLines(memory, aiLabel2));
  lines.push(
    '=== AVAILABLE ACTIONS ===',
    `Valid actions from your current square: ${actions.join(', ')}`,
    '',
    '=== YOUR TASK ===',
    'STEP 1 - infer which goal the partner is most likely moving toward based on their position and recent trajectory.',
    'STEP 2 - choose the single best valid action for this turn.',
    'Coordinate on the stag when that is payoff-efficient and realistically achievable.',
    'Choose a rabbit when stag coordination is unlikely or a rabbit gives the better immediate outcome.',
    '',
    '=== OUTPUT FORMAT ===',
    'Reply with ONLY valid JSON in this exact format:',
    `{"inferred_goal": [row, col] or null, "action": "${actions[0]}"}`,
    `The action must be one of: ${actions.join(', ')}.`,
    'Do NOT include explanations, markdown, or extra text.'
  );

  const finalPrompt = lines.join('\n');
  logExactPrompt(finalPrompt);
  return finalPrompt;
}

function buildPrompt({ matrix, currentPlayer, goals, memory, guidance, player1Pos, player2Pos /*, relativeInfo */ }) {
  const legend = `Legend: 0=blank, 1=traveler1, 2=traveler2, 3=restaurant`;
  const showMatrix = Array.isArray(matrix) && matrix.length > 0;
  const { p1, p2 } = resolveDualPlayerPositions({ matrix, currentPlayer, player1Pos, player2Pos });
  const goalsList = (Array.isArray(goals) && goals.length > 0)
    ? goals
    : (showMatrix ? findAllCoords(matrix, 3) : []);
  const p1Str = p1 ? `(${p1[0]}, ${p1[1]})` : 'unknown';
  const p2Str = p2 ? `(${p2[0]}, ${p2[1]})` : 'unknown';
  const goalsStr = goalsList.length ? goalsList.map(g => `(${g[0]}, ${g[1]})`).join('; ') : 'none';

  const gridLines = showMatrix
    ? ['Here is current grid map and legend:', legend, 'Grid:', formatMatrix(matrix), '']
    : ['Here is current grid map and legend:', legend, 'Use the attached image as the grid; coordinates below are ground truth.', ''];

  const lines = [
    'You are playing a navigation game in a 2d grid world with another player where you are hungry travelers need to reach restaurants as quickly as possible.',
    (typeof guidance === 'string' && guidance.trim().length > 0)
      ? `Instructions for this game: ${guidance.trim()}`
      : 'Instructions for this game: Collaborate to choose the same restaurant as the other traveler.',
    ...gridLines,
    `Traveler1 at ${p1Str}`,
    `Traveler2 at ${p2Str}`,
    `Restaurants: ${goalsStr}`,
    // Identify which traveler the model controls based on the provided label
    (currentPlayer && currentPlayer.label === 'player1')
      ? 'You are traveler 1.'
      : 'You are traveler 2.',
    '',
  ];

  // Intentionally omit relative hints like nearest goal/distance/delta to keep prompt minimal

  lines.push(
    'Actions coordinate deltas:',
    'left = [0, -1]',
    'right = [0, 1]',
    'up = [-1, 0]',
    'down = [1, 0]',
    '',
  );

  // Append recent trajectories if provided and enabled
  if (memory && memory.enabled && memory.trajectories) {
    const p1t = Array.isArray(memory.trajectories.player1) ? memory.trajectories.player1 : [];
    const p2t = Array.isArray(memory.trajectories.player2) ? memory.trajectories.player2 : [];
    const fmt = (traj) => traj.map(c => `(${c[0]}, ${c[1]})`).join(' -> ');
    lines.push('Recent trajectories:');
    lines.push(`Traveler1: ${fmt(p1t) || 'n/a'}`);
    lines.push(`Traveler2: ${fmt(p2t) || 'n/a'}`);
    lines.push('');
  }

  // lines.push('Given the above information, infer the other player\'s current goal. Then choose the best action by replying with exactly one action token: up | down | left | right');

  lines.push('Given the above information, choose the best action by replying with exactly one action token: up | down | left | right');

  const finalPrompt = lines.join('\n');

  // Log the exact prompt in a prominent, readable format
  logExactPrompt(finalPrompt);

  return finalPrompt;
}

function getDefaultModel() {
  // Default display label mirrors the single OpenAI model env var.
  return process.env.GPT_API_MODEL || 'gpt-4o-mini';
}

function getApiModel() {
  // Single OpenAI model knob used by both GPT and OpenAI VLM routes.
  return process.env.GPT_API_MODEL || 'gpt-4o-mini';
}

function resolveGptApiModel(payload) {
  const explicit = String(payload?.apiModel || '').trim();
  if (explicit && !/^gpt-?tom$/i.test(explicit)) return explicit;

  const requested = String(payload?.model || '').trim();
  if (requested && !/^gpt($|-?tom$)/i.test(requested)) return requested;

  return getApiModel();
}

async function callOpenAIChat(prompt, { model = getApiModel(), temperature = 0, systemMessage } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set on the server');
  }

  // Use global fetch (Node >= 18)
  const t0 = Date.now();
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: systemMessage || 'You output only one token: up, down, left, or right.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const latencyMs = Date.now() - t0;
  const content = data?.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
  const usage = data?.usage || null; // {prompt_tokens, completion_tokens, total_tokens}
  const rate = {
    remainingRequests: resp.headers.get('x-ratelimit-remaining-requests'),
    remainingTokens: resp.headers.get('x-ratelimit-remaining-tokens'),
    limitRequests: resp.headers.get('x-ratelimit-limit-requests'),
    limitTokens: resp.headers.get('x-ratelimit-limit-tokens'),
    resetRequests: resp.headers.get('x-ratelimit-reset-requests'),
    resetTokens: resp.headers.get('x-ratelimit-reset-tokens')
  };


  return { content, usage, latencyMs, rate };
}

export async function decideGptAction(payload) {
  const prompt = buildPrompt(payload);
  // External label for logging and returning to client
  const externalModel = payload?.model || getDefaultModel();
  // Prefer an explicit per-request model override, but never treat labels like
  // "gpt" or "gpt-ToM" as real API model ids.
  const apiModel = resolveGptApiModel(payload);
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const result = await callOpenAIChat(prompt, { model: apiModel, temperature });
  const raw = (result && typeof result === 'object') ? result.content : result;

  // Sanitize to allowed actions only
  const allowed = new Set(['up', 'down', 'left', 'right']);
  const token = raw.split(/\s+/)[0];
  let action = token;
  if (!allowed.has(action)) {
    for (const a of allowed) {
      if (raw.includes(a)) { action = a; break; }
    }
  }
  // if the action is not allowed, choose a random action
  if (!allowed.has(action)) {
    const allowedArray = Array.from(allowed);
    action = allowedArray[Math.floor(Math.random() * allowedArray.length)];
  }

  // Debug log the output per step
  try {
    logGptOutput({
      kind: 'base',
      modelLabel: externalModel,
      baseModel: apiModel,
      content: String(raw || ''),
      action,
      usage: (result && result.usage) || null,
      latencyMs: (result && result.latencyMs) || null,
      rate: (result && result.rate) || null
    });
  } catch (_) { /* noop */ }

  return {
    action,
    // Return the external label if provided; also include apiModel for debugging/analysis
    model: externalModel,
    baseModel: apiModel,
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}

export function getGptConfigInfo() {
  return {
    // Expose the model actually used for API calls to the client
    model: getApiModel(),
    apiModel: getApiModel(),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY)
  };
}

// === Vision (VLM) variant ===

function getVlmModel() {
  // OpenAI VLM uses the same single model env var as GPT text routes.
  return process.env.GPT_API_MODEL || 'gpt-4o-mini';
}

function resolveVlmProvider(payload) {
  return String(payload?.provider || process.env.VLM_PROVIDER || 'openai').toLowerCase();
}

function isGoogleGenerativeModelId(id) {
  return /gemini|gemma|learnlm|imagen|text-bison|chat-bison/i.test(String(id || ''));
}

function resolveVlmModel(payload, provider) {
  if (provider === 'google') {
    const fromPayload = payload?.apiModel ? String(payload.apiModel) : '';
    if (fromPayload && isGoogleGenerativeModelId(fromPayload)) {
      return fromPayload;
    }
    return process.env.GOOGLE_VLM_MODEL || 'gemini-2.5-flash';
  }
  if (payload?.apiModel) return String(payload.apiModel);
  return getVlmModel();
}

export function getVlmConfigInfo() {
  const provider = String(process.env.VLM_PROVIDER || 'openai').toLowerCase();
  const model = provider === 'google'
    ? (process.env.GOOGLE_VLM_MODEL || 'gemini-2.5-flash')
    : getVlmModel();
  const targetRpm = provider === 'google'
    ? (Number(process.env.GOOGLE_VLM_TARGET_RPM) || 25)
    : (Number(process.env.VLM_TARGET_RPM) || 400);
  const targetTpm = provider === 'google'
    ? (Number(process.env.GOOGLE_VLM_TARGET_TPM) || 120000)
    : (Number(process.env.VLM_TARGET_TPM) || 160000);
  return {
    provider,
    model,
    apiModel: model,
    hasApiKey: provider === 'google'
      ? Boolean(process.env.GOOGLE_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasGoogleKey: Boolean(process.env.GOOGLE_API_KEY),
    targetRpm,
    targetTpm,
    maxOutputTokens: getVlmMaxOutputTokens(),
    tomMaxOutputTokens: getVlmTomMaxOutputTokens()
  };
}

async function callOpenAIChatVision({ text, imageDataUrl, model = getVlmModel(), temperature = 0, systemMessage, maxTokens = 8 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set on the server');

  const userContent = [];
  if (text) userContent.push({ type: 'text', text });
  if (imageDataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } });
  }

  const cap = Math.max(1, Math.min(1024, Math.floor(maxTokens ?? 8)));

  return vlmLimiter.runExclusive(async () => {
    const t0 = Date.now();
    let resp = null;
    let lastErrorText = '';
    const estBudget = estimateVlmPromptTokens(text) + LOW_DETAIL_IMAGE_TOKENS_EST + cap;

    for (let attempt = 1; attempt <= 6; attempt++) {
      await vlmLimiter.acquireBudget(estBudget);

      resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: cap,
          messages: [
            { role: 'system', content: systemMessage || 'You output only one token: up, down, left, or right.' },
            { role: 'user', content: userContent }
          ]
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const latencyMs = Date.now() - t0;
        const content = data?.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        const usage = data?.usage || null;
        const rate = {
          remainingRequests: resp.headers.get('x-ratelimit-remaining-requests'),
          remainingTokens: resp.headers.get('x-ratelimit-remaining-tokens'),
          limitRequests: resp.headers.get('x-ratelimit-limit-requests'),
          limitTokens: resp.headers.get('x-ratelimit-limit-tokens'),
          resetRequests: resp.headers.get('x-ratelimit-reset-requests'),
          resetTokens: resp.headers.get('x-ratelimit-reset-tokens')
        };
        vlmLimiter.recordSuccess(usage?.total_tokens, estBudget, resp.headers);
        return { content, usage, latencyMs, rate };
      }

      lastErrorText = await resp.text();
      if (resp.status === 429 && attempt < 6) {
        const delayMs = parseRetryDelayMs(lastErrorText, attempt, resp.headers);
        vlmLimiter.bumpFrom429(delayMs);
        if (process.env.ENABLE_GPT_DEBUG === 'true' || process.env.ENABLE_VLM_DEBUG === 'true') {
          console.log(`[VLM RETRY] rate limited on attempt ${attempt}; waiting ${delayMs}ms`);
        }
        await sleep(delayMs);
        continue;
      }

      throw new Error(`OpenAI API error: ${resp.status} ${lastErrorText}`);
    }

    throw new Error(`OpenAI API error: ${resp?.status || 'unknown'} ${lastErrorText}`);
  });
}

function parseGoogleRetryDelayMs(errorText, attempt, responseHeaders = null) {
  if (responseHeaders && typeof responseHeaders.get === 'function') {
    const ra = responseHeaders.get('retry-after');
    if (ra) {
      const n = Number(ra);
      if (Number.isFinite(n) && n > 0) return Math.ceil(n * 1000);
    }
  }
  try {
    const parsed = JSON.parse(errorText || '{}');
    const details = parsed?.error?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        const rd = d?.retryDelay;
        if (typeof rd === 'string') {
          const m = rd.match(/^(\d+(?:\.\d+)?)s$/);
          if (m) return Math.ceil(Number(m[1]) * 1000);
        }
      }
    }
  } catch (_) { /* ignore */ }
  const base = 500 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(30_000, base + Math.floor(Math.random() * 500));
}

function extractBase64FromDataUrl(imageDataUrl) {
  if (!imageDataUrl || typeof imageDataUrl !== 'string') return { data: '', mimeType: 'image/png' };
  const m = imageDataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (m) return { mimeType: m[1] || 'image/png', data: m[2] };
  return { mimeType: 'image/png', data: imageDataUrl };
}

function isGoogleImageProcessingError(status, errorText) {
  if (Number(status) !== 400) return false;
  return /unable to process input image/i.test(String(errorText || ''));
}

async function callGoogleGenAIVision({ text, imageDataUrl, model, temperature = 0, systemMessage, maxTokens = 8 } = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not set on the server');
  const modelId = model || process.env.GOOGLE_VLM_MODEL || 'gemini-2.5-flash';
  const isGemma = /^gemma/i.test(modelId);
  const cap = Math.max(1, Math.min(1024, Math.floor(maxTokens ?? 8)));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  return vlmLimiter.runExclusive(async () => {
    const t0 = Date.now();
    let resp = null;
    let lastErrorText = '';
    let activeImageDataUrl = imageDataUrl;
    let activeSystemMessage = systemMessage;

    for (let attempt = 1; attempt <= 6; attempt++) {
      const { data: imgB64, mimeType } = extractBase64FromDataUrl(activeImageDataUrl);
      const parts = [];
      // Gemma rejects systemInstruction — prepend system text to the user message instead.
      const firstText = isGemma && activeSystemMessage
        ? `${activeSystemMessage}\n\n${text || ''}`
        : (text || '');
      if (firstText) parts.push({ text: firstText });
      if (imgB64) parts.push({ inline_data: { mime_type: mimeType, data: imgB64 } });

      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature,
          maxOutputTokens: cap,
          candidateCount: 1
        }
      };
      if (!isGemma && activeSystemMessage) {
        body.systemInstruction = { parts: [{ text: activeSystemMessage }] };
      }

      const estBudget = estimateVlmPromptTokens(firstText) + (imgB64 ? LOW_DETAIL_IMAGE_TOKENS_EST : 0) + cap;
      await vlmLimiter.acquireBudget(estBudget);

      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (resp.ok) {
        const data = await resp.json();
        const latencyMs = Date.now() - t0;
        const candidate = data?.candidates?.[0];
        const partsOut = candidate?.content?.parts || [];
        const content = partsOut
          .map(p => (typeof p?.text === 'string' ? p.text : ''))
          .join('')
          .trim()
          .toLowerCase();
        const meta = data?.usageMetadata || {};
        const usage = {
          prompt_tokens: Number(meta.promptTokenCount) || null,
          completion_tokens: Number(meta.candidatesTokenCount) || null,
          total_tokens: Number(meta.totalTokenCount) || null
        };
        const rate = {
          remainingRequests: null,
          remainingTokens: null,
          limitRequests: null,
          limitTokens: null,
          resetRequests: null,
          resetTokens: null
        };
        vlmLimiter.recordSuccess(usage.total_tokens, estBudget, resp.headers);
        return { content, usage, latencyMs, rate };
      }

      lastErrorText = await resp.text();
      if (imgB64 && isGoogleImageProcessingError(resp.status, lastErrorText)) {
        if (process.env.ENABLE_GPT_DEBUG === 'true' || process.env.ENABLE_VLM_DEBUG === 'true') {
          console.log('[VLM RETRY][google] image rejected; retrying text-only prompt');
        }
        activeImageDataUrl = null;
        activeSystemMessage = systemMessage
          ? `${systemMessage}\nIf the image is unavailable, rely on the text description and coordinates only.`
          : 'If the image is unavailable, rely on the text description and coordinates only.';
        continue;
      }
      // Google AI Studio frequently returns transient 500 INTERNAL / 503 / 429
      // under load; retry with backoff. Treat 5xx as transient as well.
      if ((resp.status === 429 || resp.status >= 500) && attempt < 6) {
        const delayMs = parseGoogleRetryDelayMs(lastErrorText, attempt, resp.headers);
        vlmLimiter.bumpFrom429(delayMs);
        if (process.env.ENABLE_GPT_DEBUG === 'true' || process.env.ENABLE_VLM_DEBUG === 'true') {
          console.log(`[VLM RETRY][google] status=${resp.status} attempt=${attempt}; waiting ${delayMs}ms`);
        }
        await sleep(delayMs);
        continue;
      }

      throw new Error(`Google API error: ${resp.status} ${lastErrorText}`);
    }

    throw new Error(`Google API error: ${resp?.status || 'unknown'} ${lastErrorText}`);
  });
}

async function callVlmVision(args, provider) {
  vlmLimiter.setProviderHint(provider);
  if (provider === 'google') return callGoogleGenAIVision(args);
  return callOpenAIChatVision(args);
}

function buildSharedNavigationSystemMessage() {
  return [
    'You are playing a grid navigation game. You receive (1) a rendered grid image and (2) a text description with exact coordinates, goal positions, and the valid actions from your current cell. Treat the text as ground truth; use the image for spatial intuition.',
    'Choose the single best action for this turn given the rules stated in the user message.',
    'Reply with exactly one token from the provided valid-actions set (e.g. up, down, left, or right). No punctuation, no quotes, no explanation — one word only.'
  ].join('\n');
}

function buildSharedTomSystemMessage() {
  return [
    'You are playing a grid navigation game with another player. You receive (1) a rendered grid image and (2) a text description with exact coordinates, goal positions, and the valid actions from your current cell. Treat the text as ground truth; use the image for spatial intuition.',
    'Infer where your partner is heading, then choose the single best action to coordinate with them given the rules stated in the user message.',
    'Reply with ONLY valid JSON — no explanations, no markdown, no extra text: {"inferred_goal": [row, col] or null, "action": "up"}'
  ].join('\n');
}

export async function decideGptVlmAction(payload) {
  const { imageDataUrl } = payload || {};
  const prompt = isStagHuntExperiment(payload?.experimentType)
    ? buildStagHuntPrompt(payload)
    : buildPrompt(payload);
  const externalModel = payload?.model || 'vlm';
  const provider = resolveVlmProvider(payload);
  const apiModel = resolveVlmModel(payload, provider);
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const maxTok = typeof payload?.maxOutputTokens === 'number' && payload.maxOutputTokens > 0
    ? payload.maxOutputTokens
    : getVlmMaxOutputTokens();

  const result = await callVlmVision({
    text: prompt,
    imageDataUrl,
    model: apiModel,
    temperature,
    maxTokens: maxTok,
    systemMessage: buildSharedNavigationSystemMessage()
  }, provider);

  const raw = (result && typeof result === 'object') ? result.content : result;
  const allowed = new Set(['up', 'down', 'left', 'right']);
  const token = String(raw || '').split(/\s+/)[0];
  let action = token;
  if (!allowed.has(action)) {
    for (const a of allowed) { if ((raw || '').includes(a)) { action = a; break; } }
  }
  if (!allowed.has(action)) {
    const arr = Array.from(allowed);
    action = arr[Math.floor(Math.random() * arr.length)];
  }

  try {
    logGptOutput({
      kind: 'base',
      modelLabel: externalModel,
      baseModel: apiModel,
      content: String(raw || ''),
      action,
      usage: (result && result.usage) || null,
      latencyMs: (result && result.latencyMs) || null,
      rate: (result && result.rate) || null
    });
  } catch (_) { /* noop */ }

  return {
    action,
    model: externalModel,
    baseModel: apiModel,
    provider,
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}

export async function decideGptVlmTomAction(payload) {
  const { imageDataUrl } = payload || {};
  const prompt = isStagHuntExperiment(payload?.experimentType)
    ? buildStagHuntTomPrompt(payload)
    : buildTomPrompt(payload);
  const externalModel = payload?.model || 'vlm-ToM';
  const provider = resolveVlmProvider(payload);
  const apiModel = resolveVlmModel(payload, provider);
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const maxTom = typeof payload?.maxOutputTokens === 'number' && payload.maxOutputTokens > 0
    ? payload.maxOutputTokens
    : getVlmTomMaxOutputTokens();

  const result = await callVlmVision({
    text: prompt,
    imageDataUrl,
    model: apiModel,
    temperature,
    maxTokens: maxTom,
    systemMessage: buildSharedTomSystemMessage()
  }, provider);

  const raw = (result && typeof result === 'object') ? result.content : result;
  const parsed = parseTomResponse(String(raw || ''));
  const allowed = new Set(['up', 'down', 'left', 'right']);
  let action = parsed.action || null;
  if (!allowed.has(action)) {
    for (const a of allowed) { if ((raw || '').includes(a)) { action = a; break; } }
  }
  if (!allowed.has(action)) {
    const arr = Array.from(allowed);
    action = arr[Math.floor(Math.random() * arr.length)];
  }

  try {
    logGptOutput({
      kind: 'tom',
      modelLabel: externalModel,
      baseModel: apiModel,
      content: String(raw || ''),
      action,
      inferredGoal: Array.isArray(parsed.inferredGoal) ? parsed.inferredGoal : null,
      usage: (result && result.usage) || null,
      latencyMs: (result && result.latencyMs) || null,
      rate: (result && result.rate) || null
    });
  } catch (_) { /* noop */ }

  return {
    action,
    inferredGoal: Array.isArray(parsed.inferredGoal) ? parsed.inferredGoal : null,
    model: 'vlm-ToM',
    baseModel: apiModel,
    provider,
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}

// === Theory-of-Mind variant ===

function buildTomPrompt({ matrix, currentPlayer, goals, memory, guidance, player1Pos, player2Pos }) {
  const legend = `Legend: 0=blank, 1=traveler1, 2=traveler2, 3=restaurant`;
  const showMatrix = Array.isArray(matrix) && matrix.length > 0;
  const { p1, p2 } = resolveDualPlayerPositions({ matrix, currentPlayer, player1Pos, player2Pos });
  const goalsList = (Array.isArray(goals) && goals.length > 0)
    ? goals
    : (showMatrix ? findAllCoords(matrix, 3) : []);
  const p1Str = p1 ? `(${p1[0]}, ${p1[1]})` : 'unknown';
  const p2Str = p2 ? `(${p2[0]}, ${p2[1]})` : 'unknown';
  const goalsStr = goalsList.length ? goalsList.map(g => `(${g[0]}, ${g[1]})`).join('; ') : 'none';

  const gridLines = showMatrix
    ? ['Grid map and legend:', legend, 'Grid matrix:', formatMatrix(matrix), '']
    : ['Grid map and legend:', legend, 'Use the attached image as the grid; coordinates below are ground truth.', ''];

  const lines = [
    '=== GAME CONTEXT ===',
    'You are playing a navigation game in a 2D grid world with another player. You are hungry travelers who need to reach restaurants as quickly as possible.',
    '',
    (typeof guidance === 'string' && guidance.trim().length > 0)
      ? `GAME RULES: ${guidance.trim()}`
      : 'GAME RULES: Collaborate to choose the same restaurant as the other traveler.',
    '',
    '=== CURRENT STATE ===',
    ...gridLines,
    `Player positions:`,
    `  Traveler1 (red): ${p1Str}`,
    `  Traveler2 (orange): ${p2Str}`,
    `Restaurants (blue): ${goalsStr}`,
    '',
    (currentPlayer && currentPlayer.label === 'player1')
      ? 'YOU ARE: Traveler 1 (red)'
      : 'YOU ARE: Traveler 2 (orange)',
    '',
    '=== ACTIONS ===',
    'Movement directions (coordinate deltas):',
    '  left = [0, -1]  (move left, column decreases)',
    '  right = [0, 1]  (move right, column increases)',
    '  up = [-1, 0]    (move up, row decreases)',
    '  down = [1, 0]   (move down, row increases)',
    ''
  ];

  if (memory && memory.enabled && memory.trajectories) {
    const p1t = Array.isArray(memory.trajectories.player1) ? memory.trajectories.player1 : [];
    const p2t = Array.isArray(memory.trajectories.player2) ? memory.trajectories.player2 : [];
    const fmt = (traj) => traj.map(c => `(${c[0]}, ${c[1]})`).join(' -> ');
    lines.push('=== RECENT MOVEMENT HISTORY ===');
    lines.push(`Traveler1 path: ${fmt(p1t) || 'n/a'}`);
    lines.push(`Traveler2 path: ${fmt(p2t) || 'n/a'}`);
    lines.push('');
  }

  // Enhanced ToM-specific instruction
  lines.push(
    '=== YOUR TASK ===',
    'STEP 1 - INFERENCE: Analyze the other traveler\'s recent movements and current position to infer which restaurant they are heading toward.',
    '  - Consider their trajectory history (if available)',
    '  - Consider their current position relative to each restaurant',
    '  - Consider which restaurant would be most efficient for them to reach',
    '  - If unclear, infer the closest restaurant to them',
    '',
    'STEP 2 - COLLABORATION: Choose your next action to move toward the same restaurant you inferred for the other traveler.',
    '  - Your goal is to coordinate and both reach the same restaurant',
    '  - Choose the most efficient single-step action (up, down, left, or right)',
    '  - Consider both your own position and the other traveler\'s likely goal',
    '',
    '=== OUTPUT FORMAT ===',
    'Reply with ONLY valid JSON in this exact format:',
    '  {"inferred_goal": [row, col] or null, "action": "up"|"down"|"left"|"right"}',
    '',
    'Examples:',
    '  {"inferred_goal": [5, 7], "action": "right"}',
    '  {"inferred_goal": [2, 3], "action": "up"}',
    '  {"inferred_goal": null, "action": "left"}',
    '',
    'Do NOT include any explanations, reasoning, or additional text. Only output the JSON object.'
  );


  const finalPrompt = lines.join('\n');
  logExactPrompt(finalPrompt);
  return finalPrompt;
}

function parseTomResponse(raw) {
  try {
    // Try to find a JSON object in the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : raw;
    const obj = JSON.parse(jsonStr);
    const allowed = new Set(['up', 'down', 'left', 'right']);
    const action = String(obj.action || '').toLowerCase();
    let inferred = obj.inferred_goal;
    if (!Array.isArray(inferred) || inferred.length < 2) inferred = null;
    const out = { action: allowed.has(action) ? action : null, inferredGoal: inferred };
    return out;
  } catch (_) {
    // Fallback: try to extract tokens
    const allowed = ['up','down','left','right'];
    const lower = String(raw || '').toLowerCase();
    const action = allowed.find(a => lower.includes(a)) || null;
    // Infer a coordinate like (r, c)
    const m = lower.match(/\((\-?\d+)\s*,\s*(\-?\d+)\)/);
    const inferredGoal = m ? [Number(m[1]), Number(m[2])] : null;
    return { action, inferredGoal };
  }
}

export async function decideGptTomAction(payload) {
  const prompt = buildTomPrompt(payload);
  // External label triggers ToM; API model can still be overridden per request.
  const externalModel = payload?.model || 'gpt-ToM';
  const baseModel = resolveGptApiModel(payload);
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const result = await callOpenAIChat(prompt, {
    model: baseModel,
    temperature,
    systemMessage: buildSharedTomSystemMessage()
  });
  const raw = (result && typeof result === 'object') ? result.content : result;
  const parsed = parseTomResponse(String(raw || ''));

  // Sanitize action
  const allowed = new Set(['up', 'down', 'left', 'right']);
  let action = parsed.action || null;
  if (!allowed.has(action)) {
    for (const a of allowed) { if ((raw || '').includes(a)) { action = a; break; } }
  }
  if (!allowed.has(action)) {
    // Random safe fallback
    const arr = Array.from(allowed);
    action = arr[Math.floor(Math.random() * arr.length)];
  }

  // Debug log the ToM output per step
  try {
    logGptOutput({
      kind: 'tom',
      modelLabel: externalModel,
      baseModel,
      content: String(raw || ''),
      action,
      inferredGoal: Array.isArray(parsed.inferredGoal) ? parsed.inferredGoal : null,
      usage: (result && result.usage) || null,
      latencyMs: (result && result.latencyMs) || null,
      rate: (result && result.rate) || null
    });
  } catch (_) { /* noop */ }

  return {
    action,
    inferredGoal: Array.isArray(parsed.inferredGoal) ? parsed.inferredGoal : null,
    // Expose external label so client can record it; also return underlying base model for debugging if needed
    model: (externalModel && /^gpt-?tom$/i.test(String(externalModel))) ? 'gpt-ToM' : externalModel || 'gpt-ToM',
    baseModel,
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}
