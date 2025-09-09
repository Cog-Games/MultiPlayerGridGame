// Client-side helper to request one-step GPT action from the server
// Uses HTTP POST to /api/ai/gpt/action

import { CONFIG } from '../config/gameConfig.js';

export class GptAgentClient {
  constructor() {
    this.baseUrl = CONFIG.server.url || '';
  }

  // Build guidance per experiment type (concise, single responsibility)
  static guidanceFor(experimentType) {
    switch (experimentType) {
      case '2P2G':
        // 2P2G: collaborate; win if both choose the same restaurant
        return 'You will collaborate  with another player. Each round, you can win if both of you go to the same restaurant. You lose the round if you end up at different restaurants. For each round that you win, you earn an additional 10 points.';
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

  // Build relative info summary for prompt readability
  static buildRelativeInfo(state, forPlayer = 'player2') {
    const player = state[forPlayer];
    const goals = state.currentGoals || [];
    if (!player || goals.length === 0) return null;
    // nearest goal
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
    const guidance = options.guidance || GptAgentClient.guidanceFor(experimentType);

    const agentCfg = CONFIG?.game?.agent?.gpt || {};
    // Optional trajectories memory
    const trialData = state.trialData || null;
    const maxSteps = Math.max(0, Number(agentCfg?.memory?.maxSteps) || 0);
    const p1Traj = Array.isArray(trialData?.player1Trajectory) ? trialData.player1Trajectory : [];
    const p2Traj = Array.isArray(trialData?.player2Trajectory) ? trialData.player2Trajectory : [];
    const sliceTail = (arr) => (maxSteps > 0 ? arr.slice(-maxSteps) : arr);

    const payload = {
      guidance,
      matrix: state.gridMatrix,
      currentPlayer: { label: 'player2', pos: state.player2 },
      goals: state.currentGoals,
      relativeInfo: GptAgentClient.buildRelativeInfo(state, 'player2'),
      model: options.model || agentCfg.model || undefined,
      temperature: typeof options.temperature === 'number' ? options.temperature : (typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined),
      memory: {
        enabled: Boolean(agentCfg?.memory?.enabled),
        maxSteps,
        trajectories: agentCfg?.memory?.enabled ? {
          player1: sliceTail(p1Traj),
          player2: sliceTail(p2Traj)
        } : undefined
      }
    };

    const url = `${this.baseUrl.replace(/\/$/, '')}/api/ai/gpt/action`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GPT action request failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    try {
      if (data && data.usage) {
        const u = data.usage;
        const latency = (typeof data.latencyMs === 'number') ? `${data.latencyMs}ms` : 'n/a';
        console.log(`GPT usage: prompt=${u.prompt_tokens ?? 'n/a'}, completion=${u.completion_tokens ?? 'n/a'}, total=${u.total_tokens ?? 'n/a'}, latency=${latency}`);
      }
    } catch (_) { /* ignore logging errors */ }
    return data?.action || null;
  }
}
