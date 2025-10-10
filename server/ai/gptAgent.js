// Simple GPT agent wrapper to decide next move based on grid state
// Outputs one of: up | down | left | right
// Server-side only. Reads config via process.env at call time.

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

function buildPrompt({ matrix, currentPlayer, goals, memory, guidance /*, relativeInfo */ }) {
  const legend = `Legend: 0=blank, 1=traveler1, 2=traveler2, 3=restaurant`;
  const matrixStr = formatMatrix(matrix);
  // Derive coordinates for players and goals
  const p1 = findFirstCoord(matrix, 1);
  const inferredP2 = findFirstCoord(matrix, 2);
  const p2 = (currentPlayer && Array.isArray(currentPlayer.pos)) ? currentPlayer.pos : inferredP2;
  const goalsList = (Array.isArray(goals) && goals.length > 0) ? goals : findAllCoords(matrix, 3);
  const p1Str = p1 ? `(${p1[0]}, ${p1[1]})` : 'unknown';
  const p2Str = p2 ? `(${p2[0]}, ${p2[1]})` : 'unknown';
  const goalsStr = goalsList.length ? goalsList.map(g => `(${g[0]}, ${g[1]})`).join('; ') : 'none';

  const lines = [
    'You are playing a navigation game in a 2d grid world with another player where you are hungry travelers need to reach restaurants as quickly as possible.',
    (typeof guidance === 'string' && guidance.trim().length > 0)
      ? `Instructions for this game: ${guidance.trim()}`
      : 'Instructions for this game: Collaborate to choose the same restaurant as the other traveler.',
    'Here is current grid map and legend:',
    legend,
    'Grid:',
    matrixStr,
    '',
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
  // Backward-compatible default display model (may be used for labeling)
  return process.env.GPT_MODEL || 'gpt-4.1-mini';
}

function getApiModel() {
  // The actual model used for API calls. Prefer GPT_API_MODEL, fallback to GPT_MODEL, else sane default.
  return process.env.GPT_API_MODEL || process.env.GPT_MODEL || 'gpt-4.1-mini';
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
  // Always call API with env-configured model to avoid invalid labels like 'gpt-ToM'
  const apiModel = getApiModel();
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

// === Theory-of-Mind variant ===

function buildTomPrompt({ matrix, currentPlayer, goals, memory, guidance }) {
  const legend = `Legend: 0=blank, 1=traveler1, 2=traveler2, 3=restaurant`;
  const matrixStr = formatMatrix(matrix);
  const p1 = findFirstCoord(matrix, 1);
  const inferredP2 = findFirstCoord(matrix, 2);
  const p2 = (currentPlayer && Array.isArray(currentPlayer.pos)) ? currentPlayer.pos : inferredP2;
  const goalsList = (Array.isArray(goals) && goals.length > 0) ? goals : findAllCoords(matrix, 3);
  const p1Str = p1 ? `(${p1[0]}, ${p1[1]})` : 'unknown';
  const p2Str = p2 ? `(${p2[0]}, ${p2[1]})` : 'unknown';
  const goalsStr = goalsList.length ? goalsList.map(g => `(${g[0]}, ${g[1]})`).join('; ') : 'none';

  const lines = [
    'You are playing a navigation game in a 2d grid world with another player where you are hungry travelers need to reach restaurants as quickly as possible.',
    (typeof guidance === 'string' && guidance.trim().length > 0)
      ? `Instructions for this game: ${guidance.trim()}`
      : 'Instructions for this game: Collaborate to choose the same restaurant as the other traveler.',
    'Here is current grid map and legend:',
    legend,
    'Grid:',
    matrixStr,
    '',
    `Traveler1 at ${p1Str}`,
    `Traveler2 at ${p2Str}`,
    `Restaurants: ${goalsStr}`,
    (currentPlayer && currentPlayer.label === 'player1')
      ? 'You are traveler 1.'
      : 'You are traveler 2.',
    '',
    'Actions coordinate deltas:',
    'left = [0, -1]',
    'right = [0, 1]',
    'up = [-1, 0]',
    'down = [1, 0]',
    ''
  ];

  if (memory && memory.enabled && memory.trajectories) {
    const p1t = Array.isArray(memory.trajectories.player1) ? memory.trajectories.player1 : [];
    const p2t = Array.isArray(memory.trajectories.player2) ? memory.trajectories.player2 : [];
    const fmt = (traj) => traj.map(c => `(${c[0]}, ${c[1]})`).join(' -> ');
    lines.push('Recent trajectories:');
    lines.push(`Traveler1: ${fmt(p1t) || 'n/a'}`);
    lines.push(`Traveler2: ${fmt(p2t) || 'n/a'}`);
    lines.push('');
  }

  // ToM-specific instruction and strict JSON output requirement for reliable parsing
  lines.push(
    'First, infer the other traveler\'s current intended restaurant (choose from Restaurants).',
    'Then, choose the best action for you given all information.',
    'Reply ONLY with strict JSON: {"inferred_goal":[row,col] or null, "action":"up|down|left|right"}. No extra text.'
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
  // External label triggers ToM; API calls always use env-configured base model
  const externalModel = payload?.model || 'gpt-ToM';
  const baseModel = getApiModel();
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const result = await callOpenAIChat(prompt, {
    model: baseModel,
    temperature,
    systemMessage: 'You are a precise planner. Output ONLY strict JSON with keys inferred_goal (array or null) and action (up|down|left|right). No explanations.'
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
