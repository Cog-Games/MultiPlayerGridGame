// Simple GPT agent wrapper to decide next move based on grid state
// Outputs one of: up | down | left | right
// Server-side only. Reads config via process.env at call time.

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

function buildPrompt({ matrix, currentPlayer, goals, memory }) {
  const legend = `Legend: 0=blank, 1=player1, 2=player2, 3=goal`;
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
    'You will play a navigation game in 2d grid world, where two players must coordinate to go to the SAME goal to win.',
    'Here is the grid map and legend:',
    'Grid :',
    matrixStr,
    '',
    legend,
    '',
    `Player1 at ${p1Str}`,
    `Player2 at ${p2Str}`,
    `Goals: ${goalsStr}`,
    '',
    'Actions coordinate deltas:',
    'left = [0, -1]',
    'right = [0, 1]',
    'up = [-1, 0]',
    'down = [1, 0]',
  ];

  // Append recent trajectories if provided and enabled
  if (memory && memory.enabled && memory.trajectories) {
    const p1t = Array.isArray(memory.trajectories.player1) ? memory.trajectories.player1 : [];
    const p2t = Array.isArray(memory.trajectories.player2) ? memory.trajectories.player2 : [];
    const fmt = (traj) => traj.map(c => `(${c[0]}, ${c[1]})`).join(' -> ');
    lines.push('Recent trajectories:');
    lines.push(`Player1: ${fmt(p1t) || 'n/a'}`);
    lines.push(`Player2: ${fmt(p2t) || 'n/a'}`);
    lines.push('');
  }

  lines.push( 'You are the player 2.', 'Given the above information, choose the best move. Reply only with with just one action: up | down | left | right');

  return lines.join('\n');
}

function getDefaultModel() {
  return process.env.GPT_MODEL || 'gpt-4o-mini';
}

function isDebugEnabled() {
  const v = String(process.env.GPT_DEBUG || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function debugLog(...args) {
  if (isDebugEnabled()) {
    try { console.log('[GPT]', ...args); } catch (_) {}
  }
}

async function callOpenAIChat(prompt, { model = getDefaultModel(), temperature = 0 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set on the server');
  }

  // Use global fetch (Node >= 18)
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
        { role: 'system', content: 'You output only one token: up, down, left, or right.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
  return content;
}

export async function decideGptAction(payload) {
  const prompt = buildPrompt(payload);
  const model = payload?.model || getDefaultModel();
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0;

  // Log input summary (gated by env flag)
  const matrixPreview = Array.isArray(payload?.matrix) ? formatMatrix(payload.matrix) : '(invalid matrix)';
  debugLog('Request model:', model, 'temp:', temperature);
  debugLog('Guidance:', payload?.guidance || '(none)');
  debugLog('CurrentPlayer:', JSON.stringify(payload?.currentPlayer), 'Goals:', JSON.stringify(payload?.goals));
  debugLog('Matrix:\n' + matrixPreview);
  debugLog('Prompt:\n' + prompt);

  const raw = await callOpenAIChat(prompt, { model, temperature });

  // Log raw output
  debugLog('Raw response:', raw);

  // Sanitize to allowed actions only
  const allowed = new Set(['up', 'down', 'left', 'right']);
  const token = raw.split(/\s+/)[0];
  let action = token;
  if (!allowed.has(action)) {
    for (const a of allowed) {
      if (raw.includes(a)) { action = a; break; }
    }
  }
  if (!allowed.has(action)) action = 'right';

  // Log final chosen action
  debugLog('Chosen action:', action);

  return action;
}

export function getGptConfigInfo() {
  return {
    model: getDefaultModel(),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY)
  };
}
