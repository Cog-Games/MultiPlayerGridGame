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

// Shared prompt context derivation (no prompt-specific strings here).
function derivePromptContext({ matrix, currentPlayer, goals }) {
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
  const isPlayer1 = Boolean(currentPlayer && currentPlayer.label === 'player1');
  return { legend, matrixStr, p1Str, p2Str, goalsStr, isPlayer1 };
}

function appendTrajectories(lines, memory) {
  if (!(memory && memory.enabled && memory.trajectories)) return;
  const p1t = Array.isArray(memory.trajectories.player1) ? memory.trajectories.player1 : [];
  const p2t = Array.isArray(memory.trajectories.player2) ? memory.trajectories.player2 : [];
  const fmt = (traj) => traj.map(c => `(${c[0]}, ${c[1]})`).join(' -> ');
  lines.push('=== RECENT MOVEMENT HISTORY ===');
  lines.push(`Traveler1 path: ${fmt(p1t) || 'n/a'}`);
  lines.push(`Traveler2 path: ${fmt(p2t) || 'n/a'}`);
  lines.push('');
}

function buildSectionedScaffold({ currentPlayer, matrix, goals, memory, guidance }) {
  const { legend, matrixStr, p1Str, p2Str, goalsStr, isPlayer1 } = derivePromptContext({ matrix, currentPlayer, goals });
  const lines = [
    '=== GAME CONTEXT ===',
    'You are playing a navigation game in a 2D grid world with another player. You are hungry travelers who need to reach restaurants as quickly as possible.',
    '',
    (typeof guidance === 'string' && guidance.trim().length > 0)
      ? `GAME RULES: ${guidance.trim()}`
      : 'GAME RULES: Collaborate to choose the same restaurant as the other traveler.',
    '',
    '=== CURRENT STATE ===',
    'Grid map and legend:',
    legend,
    'Grid matrix:',
    matrixStr,
    '',
    'Player positions:',
    `  Traveler1 (red): ${p1Str}`,
    `  Traveler2 (orange): ${p2Str}`,
    `Restaurants (blue): ${goalsStr}`,
    '',
    isPlayer1 ? 'YOU ARE: Traveler 1 (red)' : 'YOU ARE: Traveler 2 (orange)',
    '',
    '=== ACTIONS ===',
    'Movement directions (coordinate deltas):',
    '  left = [0, -1]  (move left, column decreases)',
    '  right = [0, 1]  (move right, column increases)',
    '  up = [-1, 0]    (move up, row decreases)',
    '  down = [1, 0]   (move down, row increases)',
    ''
  ];

  appendTrajectories(lines, memory);
  return lines;
}

function buildPrompt({ matrix, currentPlayer, goals, memory, guidance /*, relativeInfo */ }) {
  const lines = buildSectionedScaffold({ matrix, currentPlayer, goals, memory, guidance });
  lines.push(
    '=== YOUR TASK ===',
    'Choose the best single-step action.',
    '',
    '=== OUTPUT FORMAT ===',
    'Reply with exactly one action token:',
    '  up | down | left | right',
    '',
    'Do NOT include any explanations, reasoning, JSON, or additional text.'
  );

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

// === Canonical LLM naming (backward compatible) ===
// In this codebase:
// - LLM == text-only chat completion (legacy name: GPT)
// - VLM == vision chat completion (text + image)
export async function decideLlmAction(payload) {
  return await decideGptAction(payload);
}

export async function decideLlmTomAction(payload) {
  return await decideGptTomAction(payload);
}

export function getLlmConfigInfo() {
  return getGptConfigInfo();
}

// === Vision (VLM) variant ===

function getVlmModel() {
  // Vision-capable model; allow override via VLM_API_MODEL else reuse GPT_API_MODEL
  return process.env.VLM_API_MODEL || process.env.GPT_API_MODEL || process.env.GPT_MODEL || 'gpt-4o-mini';
}

export function getVlmConfigInfo() {
  return {
    model: getVlmModel(),
    apiModel: getVlmModel(),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY)
  };
}

async function callOpenAIChatVision({ text, imageDataUrl, model = getVlmModel(), temperature = 0, systemMessage } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set on the server');

  const userContent = [];
  if (text) userContent.push({ type: 'text', text });
  if (imageDataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } });
  }

  const t0 = Date.now();
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: systemMessage || 'You output only one token: up, down, left, or right.' },
        { role: 'user', content: userContent }
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
  const usage = data?.usage || null;
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

export async function decideGptVlmAction(payload) {
  const { imageDataUrl } = payload || {};
  // Build the same prompt as text but include image for visual grounding
  const prompt = buildPrompt(payload);
  const externalModel = payload?.model || 'vlm';
  const apiModel = getVlmModel();
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const result = await callOpenAIChatVision({
    text: prompt,
    imageDataUrl,
    model: apiModel,
    temperature,
    systemMessage: 'You are a precise navigator. Consider the image and text; output only one token: up, down, left, or right.'
  });

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
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}

export async function decideGptVlmTomAction(payload) {
  const { imageDataUrl } = payload || {};
  // Reuse ToM prompt content and add image
  const prompt = buildTomPrompt(payload);
  const externalModel = payload?.model || 'vlm-tom';
  const apiModel = getVlmModel();
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const result = await callOpenAIChatVision({
    text: prompt,
    imageDataUrl,
    model: apiModel,
    temperature,
    systemMessage: 'You are a collaborative navigation AI with theory-of-mind capabilities. Analyze the visual grid image and text context to infer the other player\'s intended goal, then choose your next action to coordinate with them. Output ONLY valid JSON with keys "inferred_goal" (array [row,col] or null) and "action" (one of: "up", "down", "left", "right"). No explanations, no markdown, no additional text.'
  });

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
    // Mirror GPT ToM behavior: if caller passed a real model name, don't overwrite it with the ToM label.
    // The underlying model actually used is always `baseModel`.
    model: (externalModel && /^vlm-?tom$/i.test(String(externalModel))) ? 'vlm-tom' : (externalModel || 'vlm-tom'),
    baseModel: apiModel,
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}

// === Theory-of-Mind variant ===

function buildTomPrompt({ matrix, currentPlayer, goals, memory, guidance }) {
  const lines = buildSectionedScaffold({ matrix, currentPlayer, goals, memory, guidance });

  // Enhanced ToM-specific instruction
  lines.push(
    '=== YOUR TASK ===',
    'STEP 1 - INFERENCE: Using all available information (grid, positions, goals, trajectories if provided), infer the partner\'s intended restaurant.',
    '',
    'STEP 2 - ACTION: Using all available information (including your inferred partner goal), choose your next single-step action.',
    '',
    '=== OUTPUT FORMAT ===',
    'Reply with ONLY valid JSON in this exact format (no extra keys, no prose):',
    '  {"inferred_goal": [row, col] or null, "action": "up"|"down"|"left"|"right"}'
  );


  const finalPrompt = lines.join('\n');
  logExactPrompt(finalPrompt);
  return finalPrompt;
}

// Debug-only prompt accessors (pure, no network). Useful for prompt snapshot comparisons.
export function __debug_buildBasePrompt(payload) {
  return buildPrompt(payload);
}

export function __debug_buildTomPrompt(payload) {
  return buildTomPrompt(payload);
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
  const externalModel = payload?.model || 'llm-tom';
  const baseModel = getApiModel();
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  const result = await callOpenAIChat(prompt, {
    model: baseModel,
    temperature,
    systemMessage: 'You are a collaborative navigation AI with theory-of-mind capabilities. Analyze the visual grid image and text context to infer the other player\'s intended goal, then choose your next action to coordinate with them. Output ONLY valid JSON with keys "inferred_goal" (array [row,col] or null) and "action" (one of: "up", "down", "left", "right"). No explanations, no markdown, no additional text.'
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
    model: (externalModel && /^(gpt-?tom|llm-?tom)$/i.test(String(externalModel))) ? 'llm-tom' : externalModel || 'llm-tom',
    baseModel,
    usage: (result && result.usage) || null,
    latencyMs: (result && result.latencyMs) || null,
    rate: (result && result.rate) || null
  };
}
