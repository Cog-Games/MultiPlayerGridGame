import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { GameRoomManager } from './gameRoomManager.js';
import { GameEventHandler } from './gameEventHandler.js';
import {
  decideGptAction,
  decideGptTomAction,
  getGptConfigInfo,
  decideLlmAction,
  decideLlmTomAction,
  getLlmConfigInfo,
  decideGptVlmAction,
  decideGptVlmTomAction,
  getVlmConfigInfo
} from './ai/gptAgent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lightweight .env loader (no external dependency)
// Loads key=value pairs from root .env if present and not already set
function loadEnvFromDotFile() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
    console.log('[env] Loaded .env file');
  } catch (e) {
    console.warn('[env] Failed to load .env:', e?.message || e);
  }
}

loadEnvFromDotFile();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
// Experiment payloads can be fairly large (base64 xlsx)
app.use(express.json({ limit: '25mb' }));

// Initialize game managers
const roomManager = new GameRoomManager();
const eventHandler = new GameEventHandler(roomManager);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Handle game events
  eventHandler.handleConnection(socket, io);

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    eventHandler.handleDisconnection(socket, io);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get room stats
app.get('/api/rooms', (req, res) => {
  res.json(roomManager.getRoomStats());
});

// Serve map configuration files
app.get('/config/MapsFor1P1G.js', (req, res) => {
  const configPath = path.join(__dirname, '..', 'config', 'MapsFor1P1G.js');
  res.sendFile(configPath);
});

app.get('/config/MapsFor1P2G.js', (req, res) => {
  const configPath = path.join(__dirname, '..', 'config', 'MapsFor1P2G.js');
  res.sendFile(configPath);
});

app.get('/config/MapsFor2P2G.js', (req, res) => {
  const configPath = path.join(__dirname, '..', 'config', 'MapsFor2P2G.js');
  res.sendFile(configPath);
});

app.get('/config/MapsFor2P3G.js', (req, res) => {
  const configPath = path.join(__dirname, '..', 'config', 'MapsFor2P3G.js');
  res.sendFile(configPath);
});

// Generic map config endpoint with better error handling
app.get('/config/:mapFile', (req, res) => {
  const { mapFile } = req.params;

  // Validate map file name for security
  if (!/^MapsFor[12]P[123]G\.js$/.test(mapFile)) {
    return res.status(400).json({ error: 'Invalid map file name' });
  }

  const configPath = path.join(__dirname, '..', 'config', mapFile);

  // Check if file exists
  if (!fs.existsSync(configPath)) {
    return res.status(404).json({ error: 'Map file not found' });
  }

  res.sendFile(configPath);
});

// API endpoint to get parsed map data as JSON
app.get('/api/maps/:experimentType', (req, res) => {
  const { experimentType } = req.params;

  // Map experiment types to config files
  const mapFiles = {
    '1P1G': 'MapsFor1P1G.js',
    '1P2G': 'MapsFor1P2G.js',
    '2P2G': 'MapsFor2P2G.js',
    '2P3G': 'MapsFor2P3G.js'
  };

  const mapFile = mapFiles[experimentType];
  if (!mapFile) {
    return res.status(400).json({ error: 'Invalid experiment type' });
  }

  const configPath = path.join(__dirname, '..', 'config', mapFile);

  try {
    const fileContent = fs.readFileSync(configPath, 'utf8');

    // Extract the map data from the JavaScript file
    const varName = `MapsFor${experimentType}`;
    const regex = new RegExp(`var ${varName} = ({[\\s\\S]*?});`);
    const match = fileContent.match(regex);

    if (match) {
      const mapData = JSON.parse(match[1]);
      res.json({
        experimentType,
        mapCount: Object.keys(mapData).length,
        maps: mapData
      });
    } else {
      res.status(500).json({ error: 'Could not parse map data' });
    }
  } catch (error) {
    console.error('Error reading map file:', error);
    res.status(500).json({ error: 'Failed to read map file' });
  }
});

// Save experiment data to Google Drive via Apps Script (server-to-server).
// This avoids the browser `no-cors` opaque response problem on Prolific.
app.post('/api/data/save', async (req, res) => {
  try {
    const { filename, filedata, filetype } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing filename' });
    }
    if (!filedata || typeof filedata !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing filedata' });
    }
    const ft = (filetype && typeof filetype === 'string') ? filetype : 'excel';

    // Prefer server env var; fallback to legacy hardcoded endpoint to match client default.
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL
      || 'https://script.google.com/macros/s/AKfycbyfQ-XKsoFbmQZGM7c741rEXh2ZUpVK-uUIu9ycooXKnaxM5-hRSzIUhQ-uWZ668Qql/exec';

    // Apps Script can read parameters from urlencoded bodies (`e.parameter.*`).
    const body = new URLSearchParams();
    body.set('filename', filename);
    body.set('filedata', filedata);
    body.set('filetype', ft);

    const resp = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });
    const text = await resp.text().catch(() => '');

    if (!resp.ok) {
      console.error('[data-save] Apps Script upload failed:', resp.status, text.slice(0, 500));
      return res.status(502).json({ ok: false, error: 'Apps Script upload failed', status: resp.status, detail: text.slice(0, 500) });
    }

    console.log('[data-save] Uploaded via Apps Script:', { filename, bytes: filedata.length });
    return res.json({ ok: true, filename });
  } catch (err) {
    console.error('[data-save] Error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to save data', detail: String(err?.message || err) });
  }
});

// LLM agent endpoints (canonical)
app.get('/api/ai/llm/config', (req, res) => {
  try {
    res.json(getLlmConfigInfo());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read LLM config' });
  }
});

app.post('/api/ai/llm/action', async (req, res) => {
  try {
    const { guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory, tom } = req.body || {};


    if (!Array.isArray(matrix) || matrix.length === 0) {
      return res.status(400).json({ error: 'Invalid matrix' });
    }
    if (!currentPlayer || !Array.isArray(currentPlayer.pos)) {
      return res.status(400).json({ error: 'Invalid currentPlayer' });
    }
    // Route to ToM variant if requested via boolean (preferred) or legacy model label.
    // IMPORTANT: if `tom` is explicitly provided (true/false), it overrides the legacy model-label routing.
    let result;
    const hasTomFlag = (typeof tom === 'boolean');
    const useTom = hasTomFlag ? tom : Boolean(model && /^(gpt-?tom|llm-?tom)$/i.test(String(model)));
    if (useTom) {
      result = await decideLlmTomAction({ guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory });
    } else {
      result = await decideLlmAction({ guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory });
    }


    // result: { action, inferredGoal?, usage, latencyMs, rate }
    res.json(result);
  } catch (err) {
    console.error('LLM action error:', err);
    res.status(500).json({ error: 'Failed to get LLM action', detail: String(err?.message || err) });
  }
});

// Legacy GPT endpoints (aliases to LLM endpoints)
app.get('/api/ai/gpt/config', (req, res) => {
  try {
    // Legacy alias: return the same config as /api/ai/llm/config
    res.json(getLlmConfigInfo());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read GPT config' });
  }
});

app.post('/api/ai/gpt/action', async (req, res) => {
  try {
    // Legacy alias: execute the same logic as /api/ai/llm/action
    const { guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory, tom } = req.body || {};

    if (!Array.isArray(matrix) || matrix.length === 0) {
      return res.status(400).json({ error: 'Invalid matrix' });
    }
    if (!currentPlayer || !Array.isArray(currentPlayer.pos)) {
      return res.status(400).json({ error: 'Invalid currentPlayer' });
    }

    let result;
    const hasTomFlag = (typeof tom === 'boolean');
    const useTom = hasTomFlag ? tom : Boolean(model && /^(gpt-?tom|llm-?tom)$/i.test(String(model)));
    if (useTom) {
      result = await decideLlmTomAction({ guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory });
    } else {
      result = await decideLlmAction({ guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory });
    }
    res.json(result);
  } catch (err) {
    console.error('GPT action error:', err);
    res.status(500).json({ error: 'Failed to get GPT action', detail: String(err?.message || err) });
  }
});

// VLM agent endpoints
app.get('/api/ai/vlm/config', (req, res) => {
  try {
    res.json(getVlmConfigInfo());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read VLM config' });
  }
});

app.post('/api/ai/vlm/action', async (req, res) => {
  try {
    const { guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory, imageDataUrl, tom } = req.body || {};
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return res.status(400).json({ error: 'Invalid matrix' });
    }
    if (!currentPlayer || !Array.isArray(currentPlayer.pos)) {
      return res.status(400).json({ error: 'Invalid currentPlayer' });
    }
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return res.status(400).json({ error: 'Missing imageDataUrl' });
    }
    let result;
    // Route to ToM variant if requested via boolean (preferred) or legacy model label.
    // IMPORTANT: if `tom` is explicitly provided (true/false), it overrides the legacy model-label routing.
    const hasTomFlag = (typeof tom === 'boolean');
    const useTom = hasTomFlag ? tom : Boolean(model && /^vlm-?tom$/i.test(String(model)));
    if (useTom) {
      result = await decideGptVlmTomAction({ guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory, imageDataUrl });
    } else {
      result = await decideGptVlmAction({ guidance, matrix, currentPlayer, goals, relativeInfo, model, temperature, memory, imageDataUrl });
    }
    res.json(result);
  } catch (err) {
    console.error('VLM action error:', err);
    res.status(500).json({ error: 'Failed to get VLM action', detail: String(err?.message || err) });
  }
});

// Serve client static files (single-service deployment)
// In production, serve built files from dist; in dev, serve from client
const clientDir = fs.existsSync(path.join(__dirname, '..', 'dist'))
  ? path.join(__dirname, '..', 'dist')
  : path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// Fallback to index.html for SPA routes (exclude API/config/socket.io)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/config') || req.path.startsWith('/socket.io')) {
    return next();
  }
  const indexPath = path.join(clientDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Client not found');
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
