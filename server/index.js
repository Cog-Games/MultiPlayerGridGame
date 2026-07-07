import http from 'node:http';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { fetchWithRetry } from './llmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const EXPERIMENT_DIR = path.join(PROJECT_ROOT, 'data', 'experiments');

loadLocalEnv(path.join(PROJECT_ROOT, '.env'));

const PORT = Number(process.env.API_PORT || process.env.PORT || 3001);
const LLM_PROVIDER = normalizeProvider(process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? 'anthropic' : 'openai'));
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const PLAYER_ACTIONS = ['up', 'down', 'left', 'right', 'signal'];
const DEFAULT_PLAYER_ACTIONS = ['up', 'down', 'left', 'right'];
const MOBILE_MATCH_TIMEOUT_MS = 10000;

const mobileMatchmaker = {
  waiting: null,
  rooms: new Map(),
  clients: new Map(),
};

const ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: PLAYER_ACTIONS,
    },
  },
  required: ['action'],
};

function loadLocalEnv(envPath) {
  let raw;
  try {
    raw = fsSync.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeProvider(provider) {
  const normalized = String(provider || '').toLowerCase();
  if (normalized === 'anthropic' || normalized === 'claude') return 'anthropic';
  return 'openai';
}

function getProviderLabel() {
  return LLM_PROVIDER === 'anthropic' ? 'Anthropic Claude' : 'OpenAI';
}

function getActiveModel() {
  return LLM_PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_000_000) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function buildPrompt(payload) {
  const availableActions = normalizeLegalPlayerActions(payload.legalActions).join(', ');
  const playerLabel = payload.playerLabel || payload.player || 'the active player';
  const actionCount = normalizeLegalPlayerActions(payload.legalActions).length;
  const isGroupPhase = payload.phase === 'group' || payload.symbolicState?.phase === 'group-foraging';

  return [
    isGroupPhase
      ? 'You are playing a four-player grid collection game.'
      : 'You are playing a two-player grid game.',
    '',
    isGroupPhase
      ? 'There are four players, multiple large moving targets, and small fixed targets on the grid.'
      : 'There are two players, one large moving target, and small fixed targets on the grid.',
    '',
    'Your goal is to earn as many points as possible.',
    '',
    `You control ${playerLabel}.`,
    '',
    `Each turn, the acting player must choose exactly one of ${actionCount} actions:`,
    availableActions,
    '',
    'Game rules:',
    payload.rules,
    '',
    'Symbolic state:',
    JSON.stringify(payload.symbolicState, null, 2),
    '',
    'ASCII grid:',
    payload.asciiGrid,
    '',
    'Return JSON only with exactly one field: {"action":"up|down|left|right|signal"}.',
  ].join('\n');
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === 'string') return responseJson.output_text;

  const textParts = [];
  for (const item of responseJson.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join('\n');
}

function sanitizeAction(action, legalActions) {
  if (typeof action === 'string' && legalActions.includes(action)) return action;
  return legalActions[0] || DEFAULT_PLAYER_ACTIONS[0];
}

function toTokenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeTokenUsage(provider, usage = {}) {
  const inputTokens = toTokenCount(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = toTokenCount(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = toTokenCount(usage.total_tokens) || inputTokens + outputTokens;

  return {
    provider,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheCreationInputTokens: toTokenCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: toTokenCount(
      usage.cache_read_input_tokens
        ?? usage.input_tokens_details?.cached_tokens,
    ),
    outputReasoningTokens: toTokenCount(usage.output_tokens_details?.reasoning_tokens),
    raw: usage,
  };
}

function normalizeLegalPlayerActions(actions) {
  if (!Array.isArray(actions)) return [...DEFAULT_PLAYER_ACTIONS];

  const normalized = actions.filter(action => PLAYER_ACTIONS.includes(action));
  return normalized.length ? normalized : [...DEFAULT_PLAYER_ACTIONS];
}

function logLlmStepOutput({ provider, model, payload, legalActions, rawAction, action, retryCount = 0 }) {
  console.log('[LLM] step output', {
    provider,
    model,
    retryCount,
    player: payload.player,
    roundIndex: payload.symbolicState?.roundIndex,
    actionCount: payload.symbolicState?.actionCount,
    condition: payload.condition,
    legalActions,
    rawAction,
    action,
  });
}

async function handleLlmAction(req, res) {
  const apiKey = LLM_PROVIDER === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
    : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    sendJson(res, 503, {
      error: LLM_PROVIDER === 'anthropic'
        ? 'ANTHROPIC_API_KEY is not set. Set it in your shell before starting the dev server.'
        : 'OPENAI_API_KEY is not set. Set it in your shell before starting the dev server.',
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const legalActions = normalizeLegalPlayerActions(payload.legalActions);
  const result = LLM_PROVIDER === 'anthropic'
    ? await requestAnthropicAction({ apiKey, payload, legalActions })
    : await requestOpenAiAction({ apiKey, payload, legalActions });

  sendJson(res, result.status, result.body);
}

function getSafeExperimentRunId(runId) {
  const safe = String(runId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);

  return safe || `experiment-${Date.now()}`;
}

async function handleSaveExperiment(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const runId = getSafeExperimentRunId(payload.runId);
  const filePath = path.join(EXPERIMENT_DIR, `${runId}.json`);
  const savedAt = new Date().toISOString();
  const body = {
    ...payload,
    runId,
    savedAt,
    provider: LLM_PROVIDER,
    model: getActiveModel(),
  };

  try {
    await fs.mkdir(EXPERIMENT_DIR, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('[experiment] failed to save data', {
      runId,
      filePath,
      error: error.message,
    });
    sendJson(res, 500, { error: `Failed to save experiment data: ${error.message}` });
    return;
  }

  console.log('[experiment] saved data', {
    runId,
    condition: payload.condition,
    stage: payload.stage,
    totalRounds: payload.gameData?.totalRounds,
    filePath,
  });

  sendJson(res, 200, {
    ok: true,
    runId,
    filePath,
    savedAt,
  });
}

async function requestOpenAiAction({ apiKey, payload, legalActions }) {
  const content = [
    { type: 'input_text', text: buildPrompt(payload) },
  ];

  if (typeof payload.gridImage === 'string' && payload.gridImage.startsWith('data:image/')) {
    content.push({ type: 'input_image', image_url: payload.gridImage });
  }

  const openaiBody = {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'grid_game_action',
        strict: true,
        schema: ACTION_SCHEMA,
      },
    },
    max_output_tokens: 250,
  };

  let openaiResult;
  try {
    openaiResult = await fetchWithRetry('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openaiBody),
    }, {
      provider: 'openai',
      model: OPENAI_MODEL,
    });
  } catch (error) {
    console.error('[LLM] OpenAI request failed before response', {
      model: OPENAI_MODEL,
      error: error.message,
    });
    return { status: 502, body: { error: `OpenAI request failed: ${error.message}` } };
  }

  const { response: openaiResponse, retryCount, retriesExhausted } = openaiResult;
  const responseJson = await openaiResponse.json().catch(() => ({}));
  if (!openaiResponse.ok) {
    const message = responseJson.error?.message || 'OpenAI request failed';
    console.error('[LLM] OpenAI API request failed', {
      model: OPENAI_MODEL,
      status: openaiResponse.status,
      retryCount,
      retriesExhausted,
      error: message,
    });
    return {
      status: openaiResponse.status,
      body: {
        error: retriesExhausted ? `OpenAI request retries exhausted: ${message}` : message,
        retryCount,
        provider: 'openai',
        model: OPENAI_MODEL,
        usage: normalizeTokenUsage('openai', responseJson.usage),
      },
    };
  }

  const usage = normalizeTokenUsage('openai', responseJson.usage);
  let parsed;
  try {
    parsed = JSON.parse(extractOutputText(responseJson));
  } catch {
    parsed = { action: legalActions[0] };
  }

  const action = sanitizeAction(parsed.action, legalActions);
  logLlmStepOutput({
    provider: 'openai',
    model: OPENAI_MODEL,
    payload,
    legalActions,
    rawAction: parsed.action,
    action,
    retryCount,
  });

  return {
    status: 200,
    body: {
      action,
      provider: 'openai',
      model: OPENAI_MODEL,
      retryCount,
      usage,
    },
  };
}

function getAnthropicImageBlock(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: match[1],
      data: match[2],
    },
  };
}

function extractAnthropicToolInput(responseJson) {
  const toolUse = (responseJson.content || []).find(block => block.type === 'tool_use' && block.name === 'choose_action');
  if (toolUse?.input) return toolUse.input;

  const text = (responseJson.content || [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n');

  try {
    return JSON.parse(text);
  } catch {
    return { action: null };
  }
}

async function requestAnthropicAction({ apiKey, payload, legalActions }) {
  const content = [];
  const imageBlock = getAnthropicImageBlock(payload.gridImage);
  if (imageBlock) content.push(imageBlock);
  content.push({ type: 'text', text: buildPrompt(payload) });

  const anthropicBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: 250,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    tools: [
      {
        name: 'choose_action',
        description: 'Choose exactly one action for the active player from the actions described in the prompt.',
        input_schema: ACTION_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'choose_action' },
  };

  let anthropicResult;
  try {
    anthropicResult = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(anthropicBody),
    }, {
      provider: 'anthropic',
      model: ANTHROPIC_MODEL,
    });
  } catch (error) {
    console.error('[LLM] Anthropic request failed before response', {
      model: ANTHROPIC_MODEL,
      error: error.message,
    });
    return { status: 502, body: { error: `Anthropic request failed: ${error.message}` } };
  }

  const { response: anthropicResponse, retryCount, retriesExhausted } = anthropicResult;
  const responseJson = await anthropicResponse.json().catch(() => ({}));
  if (!anthropicResponse.ok) {
    const message = responseJson.error?.message || 'Anthropic request failed';
    console.error('[LLM] Anthropic API request failed', {
      model: ANTHROPIC_MODEL,
      status: anthropicResponse.status,
      retryCount,
      retriesExhausted,
      error: message,
    });
    return {
      status: anthropicResponse.status,
      body: {
        error: retriesExhausted ? `Anthropic request retries exhausted: ${message}` : message,
        retryCount,
        provider: 'anthropic',
        model: ANTHROPIC_MODEL,
        usage: normalizeTokenUsage('anthropic', responseJson.usage),
      },
    };
  }

  const usage = normalizeTokenUsage('anthropic', responseJson.usage);
  const parsed = extractAnthropicToolInput(responseJson);

  const action = sanitizeAction(parsed.action, legalActions);
  logLlmStepOutput({
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
    payload,
    legalActions,
    rawAction: parsed.action,
    action,
    retryCount,
  });

  return {
    status: 200,
    body: {
      action,
      provider: 'anthropic',
      model: ANTHROPIC_MODEL,
      retryCount,
      usage,
    },
  };
}

async function serveStatic(req, res) {
  const rawPath = req.url === '/' ? '/index.html' : new URL(req.url, `http://localhost:${PORT}`).pathname;
  const filePath = path.normalize(path.join(DIST_DIR, rawPath));

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = ext === '.html'
      ? 'text/html'
      : ext === '.js'
        ? 'text/javascript'
        : ext === '.css'
          ? 'text/css'
          : 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    const indexPath = path.join(DIST_DIR, 'index.html');
    try {
      const index = await fs.readFile(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end('Client build not found. Run npm run build first.');
    }
  }
}

function sendSocketJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function createMobileClient(ws) {
  const client = {
    id: crypto.randomUUID(),
    ws,
    roomId: null,
    role: null,
    matchType: null,
    ready: false,
    waitingTimer: null,
  };
  mobileMatchmaker.clients.set(ws, client);
  return client;
}

function getMobileClient(ws) {
  return mobileMatchmaker.clients.get(ws) || createMobileClient(ws);
}

function clearWaitingTimer(client) {
  if (client?.waitingTimer) {
    clearTimeout(client.waitingTimer);
    client.waitingTimer = null;
  }
}

function takeWaitingMobileClient() {
  const waiting = mobileMatchmaker.waiting;
  if (!waiting) return null;

  mobileMatchmaker.waiting = null;
  clearWaitingTimer(waiting);

  if (waiting.ws.readyState !== WebSocket.OPEN) return null;
  return waiting;
}

function sendMobileBotMatch(client, reason = 'human-timeout') {
  clearWaitingTimer(client);
  if (mobileMatchmaker.waiting === client) mobileMatchmaker.waiting = null;
  client.matchType = 'bot';
  client.roomId = null;
  client.role = 'player1';
  client.ready = false;

  sendSocketJson(client.ws, {
    type: 'bot-match',
    reason,
    localPlayer: 'player1',
    condition: 'baseline',
  });
}

function pairMobileClients(left, right) {
  clearWaitingTimer(left);
  clearWaitingTimer(right);

  const roomId = `mobile-${crypto.randomUUID()}`;
  left.roomId = roomId;
  right.roomId = roomId;
  left.role = 'player1';
  right.role = 'player2';
  left.matchType = 'human';
  right.matchType = 'human';
  left.ready = false;
  right.ready = false;
  mobileMatchmaker.rooms.set(roomId, {
    id: roomId,
    clients: [left, right],
    ready: new Set(),
    started: false,
  });

  sendSocketJson(left.ws, {
    type: 'human-match',
    roomId,
    localPlayer: 'player1',
    remotePlayer: 'player2',
    condition: 'baseline',
  });
  sendSocketJson(right.ws, {
    type: 'human-match',
    roomId,
    localPlayer: 'player2',
    remotePlayer: 'player1',
    condition: 'baseline',
  });
}

function queueMobileHumanCandidate(client) {
  const waiting = takeWaitingMobileClient();
  if (waiting && waiting !== client) {
    pairMobileClients(waiting, client);
    return;
  }

  mobileMatchmaker.waiting = client;
  client.matchType = 'waiting-human';
  client.role = null;
  client.ready = false;
  sendSocketJson(client.ws, {
    type: 'waiting-for-human',
    timeoutMs: MOBILE_MATCH_TIMEOUT_MS,
  });

  client.waitingTimer = setTimeout(() => {
    if (mobileMatchmaker.waiting !== client) return;
    sendMobileBotMatch(client, 'human-timeout');
  }, MOBILE_MATCH_TIMEOUT_MS);
}

function handleMobileJoin(ws) {
  const client = getMobileClient(ws);
  cleanupMobileClient(ws, { keepSocket: true, notifyPeer: false });
  queueMobileHumanCandidate(client);
}

function relayMobileAction(ws, message) {
  const client = mobileMatchmaker.clients.get(ws);
  if (!client?.roomId) return;

  const room = mobileMatchmaker.rooms.get(client.roomId);
  if (!room) return;

  const other = room.clients.find(candidate => candidate.ws !== ws);
  if (!other) return;

  sendSocketJson(other.ws, {
    type: 'opponent-action',
    roomId: client.roomId,
    player: message.player,
    action: message.action,
  });
}

function handleMobileReady(ws, message) {
  const client = mobileMatchmaker.clients.get(ws);
  if (!client?.roomId || client.matchType !== 'human') return;
  if (message.roomId !== client.roomId) return;

  const room = mobileMatchmaker.rooms.get(client.roomId);
  if (!room || room.started) return;

  client.ready = true;
  room.ready.add(client.id);

  for (const participant of room.clients) {
    const other = room.clients.find(candidate => candidate !== participant);
    sendSocketJson(participant.ws, {
      type: 'ready-status',
      roomId: room.id,
      localReady: participant.ready,
      remoteReady: Boolean(other?.ready),
      readyCount: room.ready.size,
      totalPlayers: room.clients.length,
    });
  }

  if (room.ready.size < room.clients.length) return;

  room.started = true;
  for (const participant of room.clients) {
    sendSocketJson(participant.ws, {
      type: 'start-game',
      roomId: room.id,
    });
  }
}

function handleMobileSocketMessage(ws, raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    sendSocketJson(ws, { type: 'error', error: 'Invalid JSON message.' });
    return;
  }

  if (message.type === 'join-mobile-stag-hunt') {
    handleMobileJoin(ws);
    return;
  }

  if (message.type === 'mobile-action') {
    relayMobileAction(ws, message);
    return;
  }

  if (message.type === 'mobile-ready') {
    handleMobileReady(ws, message);
  }
}

function cleanupMobileClient(ws, options = {}) {
  const { keepSocket = false, notifyPeer = true } = options;
  const client = mobileMatchmaker.clients.get(ws);
  if (!client) return;

  clearWaitingTimer(client);

  if (mobileMatchmaker.waiting === client) {
    mobileMatchmaker.waiting = null;
  }

  if (client.roomId) {
    const room = mobileMatchmaker.rooms.get(client.roomId);
    if (room) {
      const other = room.clients.find(candidate => candidate.ws !== ws);
      if (notifyPeer && other) {
        sendSocketJson(other.ws, {
          type: 'opponent-left',
          roomId: client.roomId,
        });
        other.roomId = null;
        other.matchType = 'bot';
        other.role = other.role || 'player1';
        other.ready = false;
      }
      mobileMatchmaker.rooms.delete(client.roomId);
    }
  }

  client.roomId = null;
  client.matchType = null;
  client.role = null;
  client.ready = false;

  if (!keepSocket) {
    mobileMatchmaker.clients.delete(ws);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      provider: LLM_PROVIDER,
      providerLabel: getProviderLabel(),
      model: getActiveModel(),
      mobileMatchmaking: {
        waiting: Boolean(mobileMatchmaker.waiting),
        activeHumanRooms: mobileMatchmaker.rooms.size,
      },
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/llm-action') {
    await handleLlmAction(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/save-experiment') {
    await handleSaveExperiment(req, res);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  await serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  createMobileClient(ws);
  ws.on('message', message => handleMobileSocketMessage(ws, message));
  ws.on('close', () => cleanupMobileClient(ws));
  ws.on('error', () => cleanupMobileClient(ws));
});

server.listen(PORT, () => {
  console.log(`Stag Hunt API server listening on http://localhost:${PORT}`);
});
