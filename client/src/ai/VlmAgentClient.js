// Client-side helper to request one-step VLM action from the server
// Sends text prompt plus an offscreen-rendered image of the grid

import { CONFIG } from '../config/gameConfig.js';
import { GameRenderer } from '../ui/GameRenderer.js';

export class VlmAgentClient {
  constructor() {
    this.baseUrl = CONFIG.server.url || '';
  }

  // Build guidance per experiment type (concise, single responsibility)
  static guidanceFor(experimentType) {
    switch (experimentType) {
      case 'StagHunt':
        return 'Stag Hunt: choose the best single move under the current round rules.';
      case '2P2G':
        // 2P2G: collaborate; win if both choose the same restaurant
        return 'You will collaborate with another player. Each round, you can win if both of you go to the same restaurant. You lose the round if you end up at different restaurants. Movement: Both players move one step at a time - the action will only take effect after both players have pressed their buttons. For each round that you win, you earn an additional 10 points.';
      case '2P3G':
        // 2P3G: same partner; some restaurants may appear later
        return 'You will collaborate  with another player. Each round, you can win if both of you go to the same restaurant. You lose the round if you end up at different restaurants. Note that some restaurants are already open when the round starts. Others may appear later. For each round that you win, you earn an additional 10 points.';
      case '1P2G':
        return 'Single player: reach any open goal.';
      case '1P1G':
        return 'Single player: reach the goal.';
      default:
        return 'Choose the best single step to reach a valid goal.';
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

  static findGoalsByType(state, type) {
    const goals = Array.isArray(state?.currentGoals) ? state.currentGoals : [];
    const goalTypes = Array.isArray(state?.currentGoalTypes) ? state.currentGoalTypes : [];
    return goals
      .map((goal, index) => ({ goal, type: goalTypes[index] || 'small', index }))
      .filter(entry => entry.type === type)
      .map(entry => [...entry.goal]);
  }

  static getClaimedSmallGoalIndices(state) {
    const claimed = state?.claimedSmallGoals;
    if (claimed && typeof claimed.has === 'function' && typeof claimed.forEach === 'function') {
      const out = [];
      claimed.forEach((index) => {
        if (Number.isInteger(index)) out.push(index);
      });
      return out;
    }
    if (Array.isArray(claimed)) {
      return claimed.filter(index => Number.isInteger(index));
    }
    return [];
  }

  static getAvailableRabbitPositions(state) {
    const goals = Array.isArray(state?.currentGoals) ? state.currentGoals : [];
    const goalTypes = Array.isArray(state?.currentGoalTypes) ? state.currentGoalTypes : [];
    const claimed = new Set(VlmAgentClient.getClaimedSmallGoalIndices(state));
    return goals
      .map((goal, index) => ({ goal, type: goalTypes[index] || 'small', index }))
      .filter(entry => entry.type === 'small' && !claimed.has(entry.index))
      .map(entry => [...entry.goal]);
  }

  static getValidActions(matrix, position) {
    const candidates = {
      up: [-1, 0],
      down: [1, 0],
      left: [0, -1],
      right: [0, 1]
    };
    if (!Array.isArray(matrix) || !Array.isArray(position) || position.length < 2) {
      return Object.keys(candidates);
    }

    const rowCount = matrix.length;
    const colCount = Array.isArray(matrix[0]) ? matrix[0].length : 0;

    return Object.entries(candidates)
      .filter(([, [dRow, dCol]]) => {
        const nextRow = position[0] + dRow;
        const nextCol = position[1] + dCol;
        if (nextRow < 0 || nextRow >= rowCount || nextCol < 0 || nextCol >= colCount) {
          return false;
        }
        return matrix[nextRow][nextCol] !== 4;
      })
      .map(([name]) => name);
  }

  static getVisibleGameCanvas() {
    if (typeof document === 'undefined') return null;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    if (canvases.length === 0) return null;

    // Prefer the largest visible canvas. In this app that is the live game
    // canvas the participant is looking at.
    const visible = canvases.filter((canvas) => {
      const rect = canvas.getBoundingClientRect?.();
      return rect && rect.width > 0 && rect.height > 0;
    });
    if (visible.length === 0) return null;

    visible.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    });
    return visible[0] || null;
  }

  static renderStateToImageDataURL(state) {
    if (typeof document === 'undefined' || !state?.gridMatrix) return null;
    const renderer = new GameRenderer();
    const canvas = renderer.createCanvas();
    renderer.render(canvas, state);
    return canvas.toDataURL('image/png');
  }

  // Prefer the exact on-screen canvas so the VLM sees the same board the
  // participant sees. Fall back to an offscreen render using GameRenderer.
  static stateToImageDataURL(state) {
    const liveCanvas = VlmAgentClient.getVisibleGameCanvas();
    if (liveCanvas && typeof liveCanvas.toDataURL === 'function') {
      try {
        return liveCanvas.toDataURL('image/png');
      } catch (_) { /* ignore and fall back */ }
    }
    return VlmAgentClient.renderStateToImageDataURL(state);
  }

  async getNextAction(state, options = {}) {
    const experimentType = state.experimentType;
    const guidance = options.guidance || VlmAgentClient.guidanceFor(experimentType);
    const aiPlayerNumber = Number(options.aiPlayerNumber) === 1 ? 1 : 2;
    const aiLabel = aiPlayerNumber === 1 ? 'player1' : 'player2';

    const agentCfg = CONFIG?.game?.agent?.vlm || {};
    const trialData = state.trialData || null;
    const maxStepsRaw = agentCfg?.memory?.maxSteps;
    const maxSteps = maxStepsRaw === undefined || maxStepsRaw === null
      ? 3
      : Math.max(0, Number(maxStepsRaw));
    const p1Traj = Array.isArray(trialData?.player1Trajectory) ? trialData.player1Trajectory : [];
    const p2Traj = Array.isArray(trialData?.player2Trajectory) ? trialData.player2Trajectory : [];
    const sliceTail = (arr) => (maxSteps > 0 ? arr.slice(-maxSteps) : arr);

    const imageDataUrl = VlmAgentClient.stateToImageDataURL(state);
    const utilitySummary = trialData?.utilitySummary || null;
    const currentGoalTypes = Array.isArray(state?.currentGoalTypes) ? state.currentGoalTypes : [];
    const availableRabbitPositions = VlmAgentClient.getAvailableRabbitPositions(state);
    const stagPositions = VlmAgentClient.findGoalsByType(state, 'big');
    const validActions = VlmAgentClient.getValidActions(state.gridMatrix, state[aiLabel]);

    const isTomModel = /^vlm-?tom$/i.test(String(options.model || agentCfg.model || ''));
    const maxOutCfg = isTomModel
      ? CONFIG?.modelExp?.vlmTomMaxOutputTokens
      : CONFIG?.modelExp?.vlmMaxOutputTokens;

    const payload = {
      experimentType,
      guidance,
      player1Pos: state.player1,
      player2Pos: state.player2,
      currentPlayer: { label: aiLabel, pos: state[aiLabel] },
      goals: state.currentGoals,
      currentGoalTypes,
      utilitySummary: utilitySummary ? {
        step_cost_per_move: utilitySummary.step_cost_per_move,
        hare_reward_each: utilitySummary.hare_reward_each,
        stag_reward_each: utilitySummary.stag_reward_each
      } : null,
      stagPosition: Array.isArray(trialData?.stagPosition) ? [...trialData.stagPosition] : (stagPositions[0] || null),
      // Also send the full list so StagHuntTwoStags trials can describe both stags.
      stagPositions: stagPositions.length > 0 ? stagPositions : null,
      availableRabbitPositions,
      claimedSmallGoalIndices: VlmAgentClient.getClaimedSmallGoalIndices(state),
      validActions,
      relativeInfo: VlmAgentClient.buildRelativeInfo(state, aiLabel),
      // Only send the high-level agent label (e.g. vlm-ToM). Provider/model
      // selection lives on the server and comes from .env.
      model: options.model || undefined,
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

    if (typeof maxOutCfg === 'number' && maxOutCfg > 0) {
      payload.maxOutputTokens = maxOutCfg;
    }

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
      const modelUsed = data?.baseModel || data?.modelUsed || data?.model;
      if (modelUsed) {
        const current = (CONFIG?.game?.agent?.vlm?.model);
        if (!current || String(current).trim() !== String(modelUsed).trim()) {
          if (!CONFIG.game.agent.vlm) CONFIG.game.agent.vlm = {};
          CONFIG.game.agent.vlm.model = String(modelUsed).trim();
        }
      }
    } catch (_) { /* ignore */ }
    const resolvedModel = data?.baseModel || data?.model || null;
    // Persist actual runtime model when the server returns one.
    try {
      if (resolvedModel) {
        const current = CONFIG?.game?.agent?.vlm?.model;
        if (!current || String(current).trim() !== String(resolvedModel).trim()) {
          if (!CONFIG.game.agent.vlm) CONFIG.game.agent.vlm = {};
          CONFIG.game.agent.vlm.model = String(resolvedModel).trim();
        }
      }
      if (data?.provider) {
        if (!CONFIG.game.agent.vlm) CONFIG.game.agent.vlm = {};
        CONFIG.game.agent.vlm.provider = String(data.provider).trim();
      }
    } catch (_) { /* ignore */ }

    return {
      action: data?.action || null,
      inferredGoal: Object.prototype.hasOwnProperty.call(data || {}, 'inferredGoal')
        ? (data?.inferredGoal ?? null)
        : undefined,
      model: data?.model || null,
      baseModel: data?.baseModel || null,
      usage: data?.usage || null,
      latencyMs: data?.latencyMs ?? null,
      rate: data?.rate || null
    };
  }
}
