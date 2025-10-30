// Client-side helper to request one-step VLM action from the server
// Sends text prompt plus an offscreen-rendered image of the grid

import { CONFIG } from '../config/gameConfig.js';

export class VlmAgentClient {
  constructor() {
    this.baseUrl = CONFIG.server.url || '';
  }

  static guidanceFor(experimentType) {
    switch (experimentType) {
      case '2P2G':
        return 'You will collaborate with another player; pick the same restaurant to win.';
      case '2P3G':
        return 'You will collaborate with another player; some restaurants may appear later.';
      case '1P2G':
        return 'Single player: reach any open restaurant.';
      case '1P1G':
        return 'Single player: reach the restaurant.';
      default:
        return 'Choose the best single step to reach a valid restaurant.';
    }
  }

  // Build a compact relative info summary (optional)
  static buildRelativeInfo(state, forPlayer = 'player2') {
    const player = state[forPlayer];
    const goals = state.currentGoals || [];
    if (!player || goals.length === 0) return null;
    let nearest = null, dist = Infinity;
    for (const g of goals) {
      const d = Math.abs(g[0] - player[0]) + Math.abs(g[1] - player[1]);
      if (d < dist) { dist = d; nearest = g; }
    }
    const delta = nearest ? { dRow: nearest[0] - player[0], dCol: nearest[1] - player[1] } : null;
    return { nearestGoal: nearest, manhattanDistance: dist, deltaToNearest: delta };
  }

  // Render the matrix into an offscreen canvas and return a PNG data URL
  static matrixToImageDataURL(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0) return null;
    const gridSize = matrix.length;
    const padding = 1; // 1px gap grid lines
    const cell = 12;   // small cells to keep image compact
    const W = gridSize * cell + (gridSize + 1) * padding;
    const H = W;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const colors = {
      background: CONFIG.visual.colors.background || '#ffffff',
      grid: CONFIG.visual.colors.grid || '#cccccc',
      player1: CONFIG.visual.colors.player1 || '#ff0000',
      player2: CONFIG.visual.colors.player2 || '#ff8800',
      goal: CONFIG.visual.colors.goal || '#0066ff',
      obstacle: CONFIG.visual.colors.obstacle || '#333333'
    };

    // fill background
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, W, H);

    // draw cells
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const x = padding + c * (cell + padding);
        const y = padding + r * (cell + padding);
        let fill = colors.background;
        switch (matrix[r][c]) {
          case 1: fill = colors.player1; break;
          case 2: fill = colors.player2; break;
          case 3: fill = colors.goal; break;
          case 4: fill = colors.obstacle; break;
          default: fill = '#f9f9f9';
        }
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, cell, cell);
      }
    }

    // Optional subtle grid overlay
    ctx.strokeStyle = colors.grid;
    for (let i = 0; i <= gridSize; i++) {
      const pos = i * (cell + padding) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(W, pos);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, H);
      ctx.stroke();
    }

    return canvas.toDataURL('image/png');
  }

  async getNextAction(state, options = {}) {
    const experimentType = state.experimentType;
    const guidance = options.guidance || VlmAgentClient.guidanceFor(experimentType);
    const aiPlayerNumber = Number(options.aiPlayerNumber) === 1 ? 1 : 2;
    const aiLabel = aiPlayerNumber === 1 ? 'player1' : 'player2';

    const agentCfg = CONFIG?.game?.agent?.vlm || {};
    const trialData = state.trialData || null;
    const maxSteps = Math.max(0, Number(agentCfg?.memory?.maxSteps) || 0);
    const p1Traj = Array.isArray(trialData?.player1Trajectory) ? trialData.player1Trajectory : [];
    const p2Traj = Array.isArray(trialData?.player2Trajectory) ? trialData.player2Trajectory : [];
    const sliceTail = (arr) => (maxSteps > 0 ? arr.slice(-maxSteps) : arr);

    const imageDataUrl = VlmAgentClient.matrixToImageDataURL(state.gridMatrix);

    const payload = {
      guidance,
      matrix: state.gridMatrix,
      currentPlayer: { label: aiLabel, pos: state[aiLabel] },
      goals: state.currentGoals,
      relativeInfo: VlmAgentClient.buildRelativeInfo(state, aiLabel),
      model: options.model || agentCfg.model || undefined,
      temperature: typeof options.temperature === 'number' ? options.temperature : (typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined),
      memory: {
        enabled: Boolean(agentCfg?.memory?.enabled),
        maxSteps,
        trajectories: agentCfg?.memory?.enabled ? {
          player1: sliceTail(p1Traj),
          player2: sliceTail(p2Traj)
        } : undefined
      },
      imageDataUrl
    };

    const url = `${this.baseUrl.replace(/\/$/, '')}/api/ai/vlm/action`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`VLM action request failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    // Persist model used for export consistency
    try {
      const modelUsed = data && (data.model || data.modelUsed);
      if (modelUsed) {
        const current = (CONFIG?.game?.agent?.vlm?.model);
        if (!current || String(current).trim() !== String(modelUsed).trim()) {
          CONFIG.game.agent.vlm.model = String(modelUsed).trim();
        }
      }
    } catch (_) { /* ignore */ }
    return data?.action || null;
  }
}

