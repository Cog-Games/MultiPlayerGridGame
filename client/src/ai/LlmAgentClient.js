// Client-side helper to request one-step LLM action from the server (text-only)
// Uses HTTP POST to /api/ai/llm/action

import { CONFIG } from '../config/gameConfig.js';

export class LlmAgentClient {
  constructor() {
    this.baseUrl = CONFIG.server.url || '';
  }

  // Build guidance per experiment type (concise, single responsibility)
  static guidanceFor(experimentType) {
    switch (experimentType) {
      case '2P2G':
        return 'You will collaborate with another player. Each round, you can win if both of you go to the same restaurant. You lose the round if you end up at different restaurants. Movement: Both players move one step at a time - the action will only take effect after both players have pressed their buttons. For each round that you win, you earn an additional 10 points.';
      case '2P3G':
        return 'You will collaborate  with another player. Each round, you can win if both of you go to the same restaurant. You lose the round if you end up at different restaurants. Note that some restaurants are already open when the round starts. Others may appear later. For each round that you win, you earn an additional 10 points.';
      case '1P2G':
        return 'Single player: reach any open goal.';
      case '1P1G':
        return 'Single player: reach the goal.';
      default:
        return 'Choose the best single step to reach a valid goal.';
    }
  }

  // Build relative info summary for prompt readability
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

  async getNextAction(state, options = {}) {
    const experimentType = state.experimentType;
    const guidance = options.guidance || LlmAgentClient.guidanceFor(experimentType);

    // Determine which player the LLM controls; default to player2
    const aiPlayerNumber = Number(options.aiPlayerNumber) === 1 ? 1 : 2;
    const aiLabel = aiPlayerNumber === 1 ? 'player1' : 'player2';

    const agentCfg = CONFIG?.game?.agent?.llm || {};
    const useTom = Boolean(options?.tom);

    // Optional trajectories memory
    const trialData = state.trialData || null;
    const maxSteps = Math.max(0, Number(agentCfg?.memory?.maxSteps) || 0);
    const p1Traj = Array.isArray(trialData?.player1Trajectory) ? trialData.player1Trajectory : [];
    const p2Traj = Array.isArray(trialData?.player2Trajectory) ? trialData.player2Trajectory : [];
    const sliceTail = (arr) => (maxSteps > 0 ? arr.slice(-maxSteps) : arr);

    const payload = {
      guidance,
      matrix: state.gridMatrix,
      currentPlayer: { label: aiLabel, pos: state[aiLabel] },
      goals: state.currentGoals,
      relativeInfo: LlmAgentClient.buildRelativeInfo(state, aiLabel),
      // IMPORTANT: `model` is the underlying LLM model (shared by llm and llm-tom).
      // ToM vs base is requested via `tom: true`.
      model: options.model || agentCfg.model || undefined,
      temperature: typeof options.temperature === 'number' ? options.temperature : (typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined),
      tom: useTom,
      memory: {
        enabled: Boolean(agentCfg?.memory?.enabled),
        maxSteps,
        trajectories: agentCfg?.memory?.enabled ? {
          player1: sliceTail(p1Traj),
          player2: sliceTail(p2Traj)
        } : undefined
      }
    };

    const url = `${this.baseUrl.replace(/\/$/, '')}/api/ai/llm/action`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM action request failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();

    // Persist exact model used (ensures recordings use precise model)
    try {
      const modelUsed = data && (data.baseModel || data.modelUsed || data.model);
      if (modelUsed) {
        const current = (CONFIG?.game?.agent?.llm?.model);
        if (!current || String(current).trim() !== String(modelUsed).trim()) {
          CONFIG.game.agent.llm.model = String(modelUsed).trim();
        }
      }
    } catch (_) { /* ignore */ }

    // If ToM variant returned an inferred goal, surface it to caller
    if (data && Object.prototype.hasOwnProperty.call(data, 'inferredGoal')) {
      return { action: data?.action || null, inferredGoal: data?.inferredGoal ?? null, model: data?.model };
    }
    return data?.action || null;
  }
}


