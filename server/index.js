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
const CELL_PHONE_STAG_HUNT_PREFIX = 'cellPhoneStagHunt';
const LEGACY_GOOGLE_DRIVE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyfQ-XKsoFbmQZGM7c741rEXh2ZUpVK-uUIu9ycooXKnaxM5-hRSzIUhQ-uWZ668Qql/exec';

loadLocalEnv(path.join(PROJECT_ROOT, '.env'));

const GOOGLE_DRIVE_APPS_SCRIPT_URL = process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL
  || LEGACY_GOOGLE_DRIVE_APPS_SCRIPT_URL;
const PORT = Number(process.env.API_PORT || process.env.PORT || 3001);
const LLM_PROVIDER = normalizeProvider(process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? 'anthropic' : 'openai'));
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const PLAYER_ACTIONS = ['up', 'down', 'left', 'right', 'signal'];
const DEFAULT_PLAYER_ACTIONS = ['up', 'down', 'left', 'right'];
const MOBILE_MATCH_TIMEOUT_MS = 10000;
const MOBILE_DEFAULT_SESSION_ID = 'default';

const mobileMatchmaker = {
  sessions: new Map(),
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

function getSafeFileName(fileName, fallback = `experiment-${Date.now()}.json`) {
  const safe = String(fileName || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180);

  return safe || fallback;
}

function getCellPhoneStagHuntFileName(payload) {
  const roundNumber = Number(payload.roundNumber ?? payload.roundIndex + 1);
  const roundLabel = Number.isFinite(roundNumber)
    ? `round-${String(roundNumber).padStart(2, '0')}`
    : 'round-unknown';
  const localPlayer = getSafeFileName(payload.localPlayer || payload.gameData?.onlineMatch?.localPlayer || 'player', 'player');
  const runId = getSafeExperimentRunId(payload.runId);
  const timestamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
  const requested = getSafeFileName(payload.fileName, '');

  if (requested.startsWith(CELL_PHONE_STAG_HUNT_PREFIX)) {
    return requested.endsWith('.json') ? requested : `${requested}.json`;
  }

  return `${CELL_PHONE_STAG_HUNT_PREFIX}-${runId}-${roundLabel}-${localPlayer}-${timestamp}.json`;
}

function getCellPhoneStagHuntDriveFileName(fileName) {
  const safeFileName = getSafeFileName(fileName, `${CELL_PHONE_STAG_HUNT_PREFIX}-${Date.now()}.json`);
  const spreadsheetName = safeFileName.replace(/\.json$/i, '.xlsx');
  return spreadsheetName.endsWith('.xlsx') ? spreadsheetName : `${spreadsheetName}.xlsx`;
}

function stringifyCell(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getPositionPart(position, index) {
  return Array.isArray(position) && position.length > index ? position[index] : '';
}

function createMobileRoundWorkbook(payload) {
  const round = payload.round || {};
  const outcome = round.outcome || payload.outcome || {};
  const scores = round.scores || {};
  const playerSteps = round.playerSteps || {};
  const movementRows = Array.isArray(payload.movementData)
    ? payload.movementData
    : Array.isArray(round.movementData)
      ? round.movementData
      : [];

  const summaryRows = [
    ['field', 'value'],
    ['runId', payload.runId],
    ['jsonFileName', payload.fileName],
    ['roundNumber', payload.roundNumber],
    ['condition', payload.condition],
    ['conditionLabel', payload.conditionLabel],
    ['participantCondition', payload.participantCondition],
    ['playerMode', payload.playerMode],
    ['localPlayer', payload.localPlayer],
    ['roomId', payload.roomId],
    ['matchType', payload.matchType],
    ['outcomeType', outcome.type],
    ['outcomeReward', outcome.reward],
    ['totalSteps', round.totalSteps],
    ['player1Steps', playerSteps.player1],
    ['player2Steps', playerSteps.player2],
    ['maxPlayerSteps', round.maxPlayerSteps || payload.gameData?.maxPlayerSteps],
    ['player1Score', scores.player1],
    ['player2Score', scores.player2],
    ['roundCompletedAt', round.completedAt],
    ['savedAt', payload.savedAt],
    ['exportedAt', payload.exportedAt],
  ];

  const movementHeader = [
    'stepIndex',
    'agent',
    'actionLabel',
    'action',
    'time',
    'elapsedMs',
    'player1Row',
    'player1Col',
    'player2Row',
    'player2Col',
    'stagRow',
    'stagCol',
    'player1Signal',
    'player2Signal',
  ];

  const movementSheetRows = [
    movementHeader,
    ...movementRows.map(row => [
      row.stepIndex,
      row.agent,
      row.actionLabel,
      row.action,
      row.time,
      row.elapsedMs,
      getPositionPart(row.player1Position, 0),
      getPositionPart(row.player1Position, 1),
      getPositionPart(row.player2Position, 0),
      getPositionPart(row.player2Position, 1),
      getPositionPart(row.stagPosition, 0),
      getPositionPart(row.stagPosition, 1),
      row.player1Signal,
      row.player2Signal,
    ]),
  ];

  return createXlsxWorkbook([
    { name: 'Round Summary', rows: summaryRows },
    { name: 'Movement Data', rows: movementSheetRows },
  ]);
}

function createXlsxWorkbook(sheets) {
  const files = [
    { name: '[Content_Types].xml', data: createContentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: createRootRelsXml() },
    { name: 'xl/workbook.xml', data: createWorkbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: createWorkbookRelsXml(sheets.length) },
    { name: 'xl/styles.xml', data: createStylesXml() },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: createSheetXml(sheet.rows),
    })),
  ];

  return createZip(files.map(file => ({
    name: file.name,
    data: Buffer.from(file.data, 'utf8'),
  })));
}

function createContentTypesXml(sheetCount) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`;
}

function createRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function createWorkbookXml(sheets) {
  const sheetXml = sheets.map((sheet, index) => (
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`;
}

function createWorkbookRelsXml(sheetCount) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join('');
  const stylesRelId = sheetCount + 1;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function createStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
}

function createSheetXml(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, columnIndex) => {
      const cellRef = `${getColumnName(columnIndex + 1)}${rowNumber}`;
      return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(stringifyCell(value))}</t></is></c>`;
    }).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
}

function getColumnName(index) {
  let value = index;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const crc = getCrc32(file.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function getCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function uploadMobileRoundToGoogleDrive(fileName, body) {
  if (!GOOGLE_DRIVE_APPS_SCRIPT_URL) {
    return { ok: false, skipped: true, error: 'GOOGLE_DRIVE_APPS_SCRIPT_URL is not configured.' };
  }

  const driveFileName = getCellPhoneStagHuntDriveFileName(fileName);
  const workbook = createMobileRoundWorkbook(body);
  const formData = new FormData();
  formData.append('filename', driveFileName);
  formData.append('filedata', workbook.toString('base64'));
  formData.append('filetype', 'excel');
  formData.append('mimetype', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  formData.append('mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  formData.append('contentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const response = await fetch(GOOGLE_DRIVE_APPS_SCRIPT_URL, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  const responseText = await response.text().catch(() => '');
  const accepted = response.ok || (response.status >= 300 && response.status < 400);
  if (!accepted) {
    throw new Error(`Google Drive upload failed: HTTP ${response.status} ${responseText}`.trim());
  }

  return {
    ok: true,
    fileName: driveFileName,
    status: response.status,
    redirected: response.status >= 300 && response.status < 400,
    location: response.headers.get('location') || null,
    responseText: responseText.slice(0, 500),
  };
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

async function handleSaveMobileRound(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const runId = getSafeExperimentRunId(payload.runId);
  const fileName = getCellPhoneStagHuntFileName({ ...payload, runId });
  const filePath = path.join(EXPERIMENT_DIR, fileName);
  const savedAt = new Date().toISOString();
  const body = {
    ...payload,
    runId,
    fileName,
    savedAt,
    provider: LLM_PROVIDER,
    model: getActiveModel(),
  };

  try {
    await fs.mkdir(EXPERIMENT_DIR, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('[mobile-round] failed to save local data', {
      runId,
      fileName,
      filePath,
      error: error.message,
    });
    sendJson(res, 500, { error: `Failed to save mobile round locally: ${error.message}` });
    return;
  }

  let driveResult;
  try {
    driveResult = await uploadMobileRoundToGoogleDrive(fileName, body);
  } catch (error) {
    driveResult = { ok: false, error: error.message };
    console.error('[mobile-round] Google Drive upload failed', {
      runId,
      fileName,
      error: error.message,
    });
  }

  console.log('[mobile-round] saved data', {
    runId,
    fileName,
    roundNumber: payload.roundNumber,
    localPlayer: payload.localPlayer,
    eventCount: payload.round?.events?.length,
    filePath,
    googleDrive: driveResult.ok,
  });

  sendJson(res, 200, {
    ok: true,
    runId,
    fileName,
    filePath,
    savedAt,
    googleDrive: driveResult,
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
    participantLabel: null,
    ws,
    sessionId: MOBILE_DEFAULT_SESSION_ID,
    roomId: null,
    role: null,
    matchType: null,
    assignmentType: null,
    ready: false,
    waitingTimer: null,
  };
  mobileMatchmaker.clients.set(ws, client);
  return client;
}

function createMobileParticipantLabel(session) {
  const participantNumber = session.nextParticipantNumber;
  session.nextParticipantNumber = session.nextParticipantNumber >= 99
    ? 1
    : session.nextParticipantNumber + 1;
  return `player ${String(participantNumber).padStart(2, '0')}`;
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

function getSafeMobileSessionId(sessionId) {
  const safe = String(sessionId || MOBILE_DEFAULT_SESSION_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

  return safe || MOBILE_DEFAULT_SESSION_ID;
}

function getMobileSession(sessionId = MOBILE_DEFAULT_SESSION_ID) {
  const id = getSafeMobileSessionId(sessionId);
  let session = mobileMatchmaker.sessions.get(id);
  if (!session) {
    session = {
      id,
      waiting: null,
      humanAssigned: 0,
      botAssigned: 0,
      humanRoomsCreated: 0,
      botMatchesCreated: 0,
      nextParticipantNumber: 1,
      createdAt: new Date().toISOString(),
    };
    mobileMatchmaker.sessions.set(id, session);
  }
  return session;
}

function getMobileClientSession(client) {
  return getMobileSession(client?.sessionId || MOBILE_DEFAULT_SESSION_ID);
}

function shouldAssignMobileJoinToBot(session) {
  return session.botAssigned < session.humanAssigned;
}

function getWaitingMobileClient(session) {
  const waiting = session.waiting;
  if (!waiting) return null;

  if (waiting.ws.readyState !== WebSocket.OPEN) {
    session.waiting = null;
    clearWaitingTimer(waiting);
    return null;
  }

  return waiting;
}

function takeWaitingMobileClient(session) {
  const waiting = getWaitingMobileClient(session);
  if (!waiting) return null;

  session.waiting = null;
  clearWaitingTimer(waiting);

  return waiting;
}

function sendMobileBotMatch(client, reason = 'human-timeout') {
  const session = getMobileClientSession(client);
  clearWaitingTimer(client);
  if (session.waiting === client) session.waiting = null;
  if (client.assignmentType !== 'bot') {
    session.botAssigned += 1;
    session.botMatchesCreated += 1;
    client.assignmentType = 'bot';
  }
  client.matchType = 'bot';
  client.roomId = null;
  client.role = 'player1';
  client.ready = false;

  sendSocketJson(client.ws, {
    type: 'bot-match',
    reason,
    localPlayer: 'player1',
    condition: 'baseline',
    sessionId: session.id,
  });
}

function pairMobileClients(left, right, session = getMobileClientSession(left)) {
  clearWaitingTimer(left);
  clearWaitingTimer(right);

  const roomId = `mobile-${crypto.randomUUID()}`;
  left.sessionId = session.id;
  right.sessionId = session.id;
  left.roomId = roomId;
  right.roomId = roomId;
  left.role = 'player1';
  right.role = 'player2';
  left.matchType = 'human';
  right.matchType = 'human';
  left.assignmentType = 'human';
  right.assignmentType = 'human';
  left.participantLabel = createMobileParticipantLabel(session);
  right.participantLabel = createMobileParticipantLabel(session);
  left.ready = false;
  right.ready = false;
  session.humanAssigned += 2;
  session.humanRoomsCreated += 1;
  mobileMatchmaker.rooms.set(roomId, {
    id: roomId,
    sessionId: session.id,
    clients: [left, right],
    ready: new Set(),
    started: false,
  });

  sendSocketJson(left.ws, {
    type: 'human-match',
    roomId,
    localPlayer: 'player1',
    remotePlayer: 'player2',
    localParticipantLabel: left.participantLabel,
    remoteParticipantLabel: right.participantLabel,
    condition: 'baseline',
    sessionId: session.id,
  });
  sendSocketJson(right.ws, {
    type: 'human-match',
    roomId,
    localPlayer: 'player2',
    remotePlayer: 'player1',
    localParticipantLabel: right.participantLabel,
    remoteParticipantLabel: left.participantLabel,
    condition: 'baseline',
    sessionId: session.id,
  });
}

function queueMobileHumanCandidate(client) {
  const session = getMobileClientSession(client);
  const waiting = getWaitingMobileClient(session);

  if (waiting && waiting !== client && !shouldAssignMobileJoinToBot(session)) {
    pairMobileClients(takeWaitingMobileClient(session), client, session);
    return;
  }

  if (shouldAssignMobileJoinToBot(session)) {
    sendMobileBotMatch(client, 'dynamic-balance');
    return;
  }

  session.waiting = client;
  client.matchType = 'waiting-human';
  client.role = null;
  client.assignmentType = null;
  client.ready = false;
  sendSocketJson(client.ws, {
    type: 'waiting-for-human',
    timeoutMs: MOBILE_MATCH_TIMEOUT_MS,
    sessionId: session.id,
  });

  client.waitingTimer = setTimeout(() => {
    if (session.waiting !== client) return;
    sendMobileBotMatch(client, 'human-timeout');
  }, MOBILE_MATCH_TIMEOUT_MS);
}

function handleMobileJoin(ws, message = {}) {
  const client = getMobileClient(ws);
  cleanupMobileClient(ws, { keepSocket: true, notifyPeer: false });
  client.sessionId = getSafeMobileSessionId(message.sessionId);
  client.participantLabel = null;
  client.assignmentType = null;
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
    handleMobileJoin(ws, message);
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

  const session = getMobileClientSession(client);
  if (session.waiting === client) {
    session.waiting = null;
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

function getMobileMatchmakingSummary() {
  const sessions = [...mobileMatchmaker.sessions.values()].map(session => {
    const activeHumanRooms = [...mobileMatchmaker.rooms.values()]
      .filter(room => room.sessionId === session.id).length;
    const totalAssigned = session.humanAssigned + session.botAssigned;

    return {
      id: session.id,
      waiting: Boolean(session.waiting),
      activeHumanRooms,
      humanAssigned: session.humanAssigned,
      botAssigned: session.botAssigned,
      totalAssigned,
      humanRoomsCreated: session.humanRoomsCreated,
      botMatchesCreated: session.botMatchesCreated,
    };
  });

  return {
    waiting: sessions.some(session => session.waiting),
    waitingCount: sessions.filter(session => session.waiting).length,
    activeHumanRooms: mobileMatchmaker.rooms.size,
    connectedClients: mobileMatchmaker.clients.size,
    sessions,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const matchmaking = getMobileMatchmakingSummary();
    sendJson(res, 200, {
      status: 'ok',
      provider: LLM_PROVIDER,
      providerLabel: getProviderLabel(),
      model: getActiveModel(),
      mobileMatchmaking: matchmaking,
      googleDrive: {
        configured: Boolean(GOOGLE_DRIVE_APPS_SCRIPT_URL),
        usingLegacyEndpoint: GOOGLE_DRIVE_APPS_SCRIPT_URL === LEGACY_GOOGLE_DRIVE_APPS_SCRIPT_URL,
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

  if (req.method === 'POST' && req.url === '/api/save-mobile-round') {
    await handleSaveMobileRound(req, res);
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
