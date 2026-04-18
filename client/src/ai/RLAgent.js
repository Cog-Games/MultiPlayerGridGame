import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';

// Legacy-aligned RL agent configuration
const RL_AGENT_CONFIG = {
  gridSize: 15,
  noise: 0.0,
  gamma: 0.9,
  goalReward: 30,
  stepCost: -1,
  softmaxBeta: 3.0,
  proximityRewardWeight: 0.01,
  coordinationRewardWeight: 0.02,
  maxPolicyIterations: 15,
  progressivePolicyBuilding: true,
  policyBuildTimeout: 10,
  debugMode: false,
  useFastOptimalPolicy: false,
  enablePolicyPrecalculation: false,
  jointRLImplementation: 'bfs'
};

try {
  if (CONFIG?.game?.matrixSize) {
    RL_AGENT_CONFIG.gridSize = CONFIG.game.matrixSize;
  }
} catch (e) {
  // Ignore config errors
}

// ---------- Utilities (ported from legacy) ----------

function hashGoals(goals) {
  return goals.map(g => `${g[0]},${g[1]}`).sort().join('|');
}

function softmax(values, beta) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (values.some(v => !isFinite(v))) return new Array(values.length).fill(1 / values.length);

  const maxVal = Math.max(...values);
  const logProbs = values.map(v => beta * (v - maxVal));
  const clipped = logProbs.map(lp => Math.max(-700, Math.min(700, lp)));
  const exps = clipped.map(lp => Math.exp(lp));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;

  return exps.map(e => e / sum);
}

const CARDINAL_ACTIONS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0]
];

function sampleIndexFromWeights(weights) {
  const total = weights.reduce((sum, w) => sum + (isFinite(w) && w > 0 ? w : 0), 0);
  if (!isFinite(total) || total <= 0) return -1;

  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = (isFinite(weights[i]) && weights[i] > 0) ? weights[i] : 0;
    acc += w;
    if (r <= acc) return i;
  }
  return weights.length - 1;
}

/**
 * Check if taking a step from the given position with the given delta
 * would result in a valid (non-obstacle, in-bounds) cell on the grid.
 * This is used as a final safety filter so the RL agent never attempts
 * to move into an obstacle during actual gameplay, regardless of the
 * underlying value iteration state space.
 */
function isValidMoveOnGrid(gridMatrix, position, delta) {
  if (!Array.isArray(gridMatrix) || !Array.isArray(position) || position.length !== 2) {
    // If we don't have a proper grid, don't over-restrict movement
    return true;
  }
  const [rows, cols] = [gridMatrix.length, gridMatrix[0]?.length || 0];
  const [r, c] = position;
  const [dr, dc] = delta;
  const nr = r + dr;
  const nc = c + dc;

  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return false;
  const cell = gridMatrix[nr]?.[nc];
  if (typeof cell === 'undefined') return false;
  if (cell === GAME_OBJECTS.obstacle) return false;
  return true;
}

/**
 * Given a proposed move delta from the RL planner, ensure it never
 * points into an obstacle or outside the grid. If the proposed move
 * is invalid, fall back to the first valid cardinal move; if none
 * are valid, return [0, 0] (no-op).
 */
function sanitizeDelta(gridMatrix, position, delta) {
  // Normalize malformed or zero deltas early
  if (!Array.isArray(delta) || delta.length !== 2) return [0, 0];
  const [dr, dc] = delta;
  if (dr === 0 && dc === 0) return [0, 0];

  if (isValidMoveOnGrid(gridMatrix, position, delta)) {
    return delta;
  }

  // Try other cardinal directions in a fixed order (L, R, U, D)
  const actionSpace = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0]
  ];

  for (const alt of actionSpace) {
    if (isValidMoveOnGrid(gridMatrix, position, alt)) {
      return alt;
    }
  }

  // Completely boxed in – safest is to stay put
  return [0, 0];
}

class GridWorld {
  constructor(nx, ny) {
    this.nx = nx;
    this.ny = ny;
    this.coordinates = [];
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        this.coordinates.push([x, y]);
      }
    }
    this.terminals = [];
    this.obstacles = [];
    this.features = {};
  }

  addTerminals(ts) {
    this.terminals.push(...ts);
  }

  addObstacles(obs) {
    this.obstacles.push(...obs);
  }

  addFeatureMap(name, stateValues, defaultValue = 0) {
    this.features[name] = {};
    for (const c of this.coordinates) {
      this.features[name][c.toString()] = defaultValue;
    }
    for (const k in stateValues) {
      this.features[name][k.toString()] = stateValues[k];
    }
  }

  isStateValid([x, y]) {
    if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) return false;
    return !this.obstacles.some(o => o[0] === x && o[1] === y);
  }

  reward(s, _a, s_n, W = null) {
    if (!W) {
      return Object.keys(this.features).reduce((sum, f) =>
        sum + this.features[f][s_n.toString()], 0
      );
    }
    return Object.keys(W).reduce((sum, f) =>
      sum + this.features[f][s_n.toString()] * W[f], 0
    );
  }
}

function transition(state, action) {
  return [state[0] + action[0], state[1] + action[1]];
}

class StochasticTransition {
  constructor(noise, noiseActionSpace, terminals, isStateValid) {
    this.noise = noise;
    this.noiseActionSpace = noiseActionSpace;
    this.terminals = terminals;
    this.isStateValid = isStateValid;
  }

  call(state, action) {
    if (this.terminals.some(t => t[0] === state[0] && t[1] === state[1])) {
      return { [state.toString()]: 1 };
    }

    const nextState = transition(state, action);
    if (!this.isStateValid(nextState)) {
      return { [state.toString()]: 1 };
    }

    const possible = this.noiseActionSpace
      .map(na => transition(state, na))
      .filter(this.isStateValid);

    const noiseProb = this.noise / (possible.length - 1 || 1);
    const result = {};

    for (const s of possible) {
      result[s.toString()] = noiseProb;
    }
    result[nextState.toString()] = 1.0 - this.noise;

    return result;
  }
}

class ValueIteration {
  constructor(gamma, epsilon = 0.001, maxIter = 100, terminals = []) {
    this.gamma = gamma;
    this.epsilon = epsilon;
    this.maxIter = maxIter;
    this.terminals = terminals.map(s => s.toString());
  }

  run(S, A, T, R) {
    const V = {};
    for (const s of S) {
      V[s] = this.terminals.includes(s) ? 0 : 0.1;
    }

    for (let i = 0; i < this.maxIter; i++) {
      const Vc = { ...V };
      for (const s of S) {
        if (this.terminals.includes(s)) continue;

        V[s] = Math.max(...A.map(a =>
          Object.entries(T[s][a]).reduce((sum, [s_n, p]) =>
            sum + p * (R[s][a][s_n] + this.gamma * Vc[s_n]), 0
          )
        ));
      }

      const deltas = S
        .filter(s => !this.terminals.includes(s))
        .map(s => Math.abs(V[s] - Vc[s]));

      if (deltas.every(d => d < this.epsilon)) break;
    }
    return V;
  }
}

class RunIndividualVI {
  constructor(gridSize, actionSpace, noiseSpace, noise, gamma, goalReward, softmaxBeta) {
    this.gridSize = gridSize;
    this.actionSpace = actionSpace;
    this.noiseSpace = noiseSpace;
    this.noise = noise;
    this.gamma = gamma;
    this.goalReward = goalReward;
    this.softmaxBeta = softmaxBeta;
  }

  call(goalStates, obstacles) {
    const env = new GridWorld(this.gridSize, this.gridSize);
    if (!Array.isArray(goalStates[0])) goalStates = [goalStates];

    const terminalValue = {};
    for (const s of goalStates) terminalValue[s.toString()] = this.goalReward;

    env.addFeatureMap('goal', terminalValue, 0);
    env.addTerminals(goalStates);
    env.addObstacles(obstacles);

    const S = [];
    for (let x = 0; x < env.nx; x++) {
      for (let y = 0; y < env.ny; y++) {
        const st = [x, y];
        if (env.isStateValid(st)) S.push(st.toString());
      }
    }

    const transitionFunction = new StochasticTransition(
      this.noise,
      this.noiseSpace,
      goalStates,
      env.isStateValid.bind(env)
    );

    const T = {};
    for (const s of S) {
      T[s] = {};
      for (const a of this.actionSpace) {
        T[s][a.toString()] = transitionFunction.call(s.split(',').map(Number), a);
      }
    }

    const stepCost = RL_AGENT_CONFIG.stepCost;
    const R = {};
    for (const s of S) {
      R[s] = {};
      for (const a of this.actionSpace) {
        R[s][a.toString()] = {};
        const sv = s.split(',').map(Number);

        for (const s_n of S) {
          const snv = s_n.split(',').map(Number);
          const reward = goalStates.some(gs => gs.toString() === s_n)
            ? stepCost + env.reward(snv, a, snv)
            : stepCost + env.reward(sv, a, sv);
          R[s][a.toString()][s_n] = reward;
        }
      }
    }

    const vi = new ValueIteration(this.gamma, 0.001, 100, goalStates);
    const V = vi.run(S, this.actionSpace.map(a => a.toString()), T, R);

    for (const s of goalStates) V[s.toString()] = this.goalReward;

    const Q_dict = {};
    for (const s of S) {
      Q_dict[s] = {};
      for (const a of this.actionSpace.map(a => a.toString())) {
        Q_dict[s][a] = Object.entries(T[s][a]).reduce((sum, [s_n, p]) =>
          sum + p * (R[s][a][s_n] + this.gamma * V[s_n]), 0
        );
      }
    }

    const policy = new SoftmaxRLPolicy(Q_dict, this.softmaxBeta);
    return { Q_dict, policy };
  }
}

class SoftmaxRLPolicy {
  constructor(Q_dict, beta = 1) {
    this.Q = Q_dict;
    this.beta = beta;
  }

  call(state) {
    const s = state.toString();
    const actions = Object.keys(this.Q[s] || {});
    const values = actions.map(a => this.Q[s][a]);
    const probs = softmax(values, this.beta);
    return Object.fromEntries(actions.map((a, i) => [a, probs[i]]));
  }
}

function chooseBestAction(probsMap) {
  // Sample from the softmax distribution rather than greedy argmax
  const actions = Object.keys(probsMap);
  const probs = Object.values(probsMap);
  let sum = 0;
  for (const p of probs) sum += (isFinite(p) ? p : 0);

  if (sum <= 0 || actions.length === 0) {
    // Fallback: pick any action
    const fallback = actions[0] || '0,1';
    return fallback.split(',').map(Number);
  }

  // Normalize for safety
  const norm = probs.map(p => (isFinite(p) ? p / sum : 0));
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < norm.length; i++) {
    acc += norm[i];
    if (r <= acc) return actions[i].split(',').map(Number);
  }

  // Numerical residue
  return actions[actions.length - 1].split(',').map(Number);
}

// ---------- Joint RL (4-action space, VI-based) ----------
const JointPlanner4Action = {
  planners: new Map(),

  _getHelpers(gridSize) {
    const COLS = gridSize;
    const ROWS = gridSize;
    return {
      COLS, ROWS,
      toIdx: (r, c) => r * COLS + c,
      rowOf: i => Math.floor(i / COLS),
      colOf: i => i % COLS,
      inGrid: (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS
    };
  },

  hashObstacles(obstacles) {
    if (!Array.isArray(obstacles)) return '';
    return obstacles.map(([r,c]) => `${r},${c}`).sort().join('|');
  },

  stepIdxWithObstacles(index, actionIndex, obstacleSet, helpers) {
    const { rowOf, colOf, inGrid, toIdx } = helpers;
    const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    const r = rowOf(index);
    const c = colOf(index);
    const [dr, dc] = actionSpace[actionIndex];
    const nr = r + dr;
    const nc = c + dc;

    if (!inGrid(nr, nc)) return index;
    if (obstacleSet && obstacleSet.has(`${nr},${nc}`)) return index;
    return toIdx(nr, nc);
  },

  // Heuristic: assumes partner moves toward closest goal, respecting obstacles
  playerNextIdx(idx, goals, aiIdx = null, helpers, obstacleSet = null) {
    const { rowOf, colOf, toIdx, inGrid } = helpers;
    const r = rowOf(idx);
    const c = colOf(idx);

    let best = goals[0];
    let bestJointD = Infinity;

    // Find best goal (possibly accounting for coordination distance)
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      const pD = Math.abs(r - g[0]) + Math.abs(c - g[1]);

      let jD;
      if (aiIdx !== null) {
        const aiR = rowOf(aiIdx);
        const aiC = colOf(aiIdx);
        const aiD = Math.abs(aiR - g[0]) + Math.abs(aiC - g[1]);
        jD = pD + aiD;
      } else {
        jD = pD;
      }

      if (jD < bestJointD) {
        best = g;
        bestJointD = jD;
      }
    }

    // Determine desired move
    let nr = r, nc = c;
    if (r !== best[0]) {
      nr += (best[0] < r ? -1 : 1);
    } else if (c !== best[1]) {
      nc += (best[1] < c ? -1 : 1);
    }

    // Check validity
    if (!inGrid(nr, nc)) return idx; // Stay put if out of bounds
    if (obstacleSet && obstacleSet.has(`${nr},${nc}`)) {
      // Blocked by obstacle.
      // Try alternate axis if applicable to avoid getting stuck on corners?
      // For now, simple physics: if blocked, stay put.
      // This ensures the model matches reality where partner can't walk through walls.
      return idx;
    }

    return toIdx(nr, nc);
  },

  buildPlanner(goals, beta = 1, obstacles = []) {
    const gridSize = RL_AGENT_CONFIG.gridSize || 15;
    const helpers = this._getHelpers(gridSize);
    const { toIdx } = helpers;
    const N = gridSize * gridSize;

    const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c)));
    const S = N * N;
    const V = new Float32Array(S);
    const Q = new Float32Array(S * 4);

    const rewardGoal = RL_AGENT_CONFIG.goalReward;
    const stepCost = RL_AGENT_CONFIG.stepCost;
    const gamma = RL_AGENT_CONFIG.gamma || 0.9;

    V.fill(-1000);
    const obstacleSet = new Set((obstacles||[]).map(([r,c]) => `${r},${c}`));

    // Initialize values at goal states
    for (let s = 0; s < S; s++) {
      const aiIdx = Math.floor(s / N);
      const plIdx = s % N;
      const aiOnGoal = goalSet.has(aiIdx);
      const plOnGoal = goalSet.has(plIdx);

      // Success only if both on SAME goal
      const both = aiOnGoal && plOnGoal && aiIdx === plIdx;
      if (both) {
        V[s] = 0;
        for (let a = 0; a < 4; a++) Q[s * 4 + a] = 0;
      }
    }

    let delta;
    let iterations = 0;
    const maxIterations = 1000;
    const threshold = 1e-6;

    do {
      delta = 0;
      iterations++;

      for (let s = 0; s < S; s++) {
        const aiIdx = Math.floor(s / N);
        const plIdx = s % N;
        const aiOnGoal = goalSet.has(aiIdx);
        const plOnGoal = goalSet.has(plIdx);
        const both = aiOnGoal && plOnGoal && aiIdx === plIdx;

        if (both) {
          V[s] = 0;
          for (let a = 0; a < 4; a++) Q[s * 4 + a] = 0;
          continue;
        }

        let bestV = -Infinity;

        for (let a = 0; a < 4; a++) {
          // AI transition
          const aiNext = aiOnGoal ? aiIdx : this.stepIdxWithObstacles(aiIdx, a, obstacleSet, helpers);

          // Partner transition (heuristic, now obstacle-aware)
          const plNext = this.playerNextIdx(plIdx, goals, aiNext, helpers, obstacleSet);

          const aiNextOnGoal = goalSet.has(aiNext);
          const plNextOnGoal = goalSet.has(plNext);
          const bothNext = aiNextOnGoal && plNextOnGoal && aiNext === plNext;

          let r = stepCost;
          if (bothNext) {
            r = rewardGoal;
          } else if (aiNextOnGoal && plNextOnGoal && aiNext !== plNext) {
            // Penalize if both on DIFFERENT goals
            r = stepCost * 0.5;
          } else if (aiNextOnGoal || plNextOnGoal) {
            // One on goal, waiting
            r = stepCost * 0.8;
          }

          const sNext = aiNext * N + plNext;
          const q = r + (bothNext ? 0 : gamma * V[sNext]);

          Q[s * 4 + a] = q;
          if (q > bestV) bestV = q;
        }

        const diff = Math.abs(bestV - V[s]);
        if (diff > delta) delta = diff;
        V[s] = bestV;
      }

      if (iterations > maxIterations) {
        console.warn(`Joint RL VI did not converge after ${maxIterations} iters Δ=${delta}`);
        break;
      }
    } while (delta > threshold);

    return { Q, goalSet, beta };
  },

  getAction(aiState, playerState, goals, beta = null, obstacles = []) {
    if (beta == null) beta = RL_AGENT_CONFIG.softmaxBeta;
    const key = hashGoals(goals) + '|' + beta + '|' + this.hashObstacles(obstacles);

    if (!this.planners.has(key)) {
      this.planners.set(key, this.buildPlanner(goals, beta, obstacles));
    }

    const { Q, goalSet } = this.planners.get(key);

    const gridSize = RL_AGENT_CONFIG.gridSize || 15;
    const helpers = this._getHelpers(gridSize);
    const { toIdx } = helpers;
    const N = gridSize * gridSize;
    const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    const aiIdx = toIdx(aiState[0], aiState[1]);
    const plIdx = toIdx(playerState[0], playerState[1]);

    const aiOnGoal = goalSet.has(aiIdx);
    const plOnGoal = goalSet.has(plIdx);
    const bothOnSameGoal = aiOnGoal && plOnGoal && aiIdx === plIdx;

    if (bothOnSameGoal) return null;

    const s = aiIdx * N + plIdx;
    const o = s * 4;
    const qValues = [Q[o], Q[o + 1], Q[o + 2], Q[o + 3]];

    if (qValues.some(q => !isFinite(q))) {
      return actionSpace[Math.floor(Math.random() * actionSpace.length)];
    }

    if (beta > 10) {
      const maxQ = Math.max(...qValues);
      const best = qValues.map((q, i) => ({ q, i })).filter(d => d.q === maxQ);
      return actionSpace[best[Math.floor(Math.random() * best.length)].i];
    }

    const maxQ = Math.max(...qValues);
    const logPrefs = qValues.map(q => beta * (q - maxQ));
    const clipped = logPrefs.map(lp => Math.max(-700, Math.min(700, lp)));
    const prefs = clipped.map(lp => Math.exp(lp));
    const sum = prefs.reduce((a, b) => a + b, 0);

    if (!isFinite(sum) || sum === 0) {
      const i = qValues.indexOf(maxQ);
      return actionSpace[i];
    }

    const r = Math.random() * sum;
    let acc = 0;
    for (let a = 0; a < prefs.length; a++) {
      acc += prefs[a];
      if (r < acc) return actionSpace[a];
    }

    const i = qValues.indexOf(maxQ);
    return actionSpace[i];
  },

  precalc(goals, obstacles = []) {
    const beta = RL_AGENT_CONFIG.softmaxBeta;
    const key = hashGoals(goals) + '|' + beta + '|' + this.hashObstacles(obstacles);
    if (!this.planners.has(key)) {
      this.planners.set(key, this.buildPlanner(goals, beta, obstacles));
    }
  },

  clear() {
    this.planners.clear();
  }
};

// ---------- Joint cooperative Value Iteration planner (Stag-Hunt aware) ----------
//
// State: joint position (aiIdx, partnerIdx) where each index is row*COLS + col.
// Action space: 16 joint actions (AI_action × Partner_action, each in [L, R, U, D]).
// Terminal: both players on any goal tile (matches StagHunt trial-end semantics).
// Reward model (team utility):
//   Per-step: -|stepCost| charged for each agent that actually moved.
//   Terminal (evaluated once on arrival):
//     * both on the SAME big goal → bigReward + bigReward (2 × stag_reward_each)
//     * big goal reached alone    → 0 for that agent (stag requires partner)
//     * small goal reached        → smallReward for that agent (solo-collectable)
//     * both on SAME small goal   → only one agent can claim it (smallReward × 1)
//
// Reward parameters are sourced per planner call from (in order):
//   1. map utility_summary (hare_reward_each, stag_reward_each, step_cost_per_move)
//   2. CONFIG.game.rewards (smallGoalReward, bigGoalJointReward, stepPenalty)
//   3. hard-coded fallbacks
const JointBFSPlanner = {
  planners: new Map(),

  _getHelpers(gridSize) {
    const COLS = gridSize;
    const ROWS = gridSize;
    return {
      COLS, ROWS,
      toIdx: (r, c) => r * COLS + c,
      rowOf: i => Math.floor(i / COLS),
      colOf: i => i % COLS,
      inGrid: (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS
    };
  },

  hashObstacles(obstacles) {
    if (!Array.isArray(obstacles)) return '';
    return obstacles.map(([r,c]) => `${r},${c}`).sort().join('|');
  },

  hashGoalTypes(goalTypes) {
    if (!Array.isArray(goalTypes)) return '';
    return goalTypes.map(t => (t === 'big' ? 'B' : 's')).join('');
  },

  hashRewards(rewards) {
    if (!rewards) return '';
    return `b${rewards.bigReward}|s${rewards.smallReward}|c${rewards.stepCost}|g${rewards.gamma}`;
  },

  resolveRewards(utilitySummary) {
    const cfg = (typeof CONFIG !== 'undefined' && CONFIG?.game?.rewards) || {};
    const util = utilitySummary || {};

    // Negative stepCost (cost per moving agent per tick). map stores a negative value.
    let stepCost = -1;
    if (Number.isFinite(util.step_cost_per_move)) {
      stepCost = util.step_cost_per_move <= 0 ? util.step_cost_per_move : -Math.abs(util.step_cost_per_move);
    } else if (Number.isFinite(cfg.stepPenalty)) {
      stepCost = -Math.abs(cfg.stepPenalty);
    }

    let smallReward = Number.isFinite(util.hare_reward_each)
      ? util.hare_reward_each
      : (Number.isFinite(cfg.smallGoalReward) ? cfg.smallGoalReward : 3);

    let bigReward = Number.isFinite(util.stag_reward_each)
      ? util.stag_reward_each
      : (Number.isFinite(cfg.bigGoalJointReward) ? cfg.bigGoalJointReward : 10);

    // Undiscounted (γ = 1) so the planner's V matches the map's
    // utility_summary arithmetic exactly — the task is episodic with a
    // finite maxGameLength, so no discounting is needed.
    const gamma = 1.0;
    return { stepCost, smallReward, bigReward, gamma };
  },

  stepIdxWithObstacles(idx, a, obstacleSet, helpers) {
    const { rowOf, colOf, toIdx, inGrid } = helpers;
    const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    const r = rowOf(idx), c = colOf(idx);
    const nr = r + actionSpace[a][0];
    const nc = c + actionSpace[a][1];

    if (!inGrid(nr, nc)) return idx;
    if (obstacleSet && obstacleSet.has(`${nr},${nc}`)) return idx;
    return toIdx(nr, nc);
  },

  hasAuthoritativeUtilitySummary(utilitySummary) {
    return Number.isFinite(utilitySummary?.step_cost_per_move) &&
      Number.isFinite(utilitySummary?.hare_reward_each) &&
      Number.isFinite(utilitySummary?.stag_reward_each);
  },

  assertUtilitySummary(utilitySummary, context = {}) {
    const exp = String(context?.experimentType || '').toUpperCase();
    if (exp === 'STAGHUNT' && !this.hasAuthoritativeUtilitySummary(utilitySummary)) {
      throw new Error('StagHunt joint planner requires utility_summary with step_cost_per_move, hare_reward_each, and stag_reward_each');
    }
  },

  // Compute the team terminal reward assuming the trial ended with the
  // given configuration. All inputs are goal indices (0..goals.length-1) or
  // null if the agent is not on a goal.
  terminalTeamReward(aiGoalIdx, plGoalIdx, goalTypes, rewards) {
    if (aiGoalIdx == null || plGoalIdx == null) return 0;
    const aiType = goalTypes[aiGoalIdx] || 'small';
    const plType = goalTypes[plGoalIdx] || 'small';

    if (aiType === 'big' && plType === 'big' && aiGoalIdx === plGoalIdx) {
      return rewards.bigReward + rewards.bigReward;
    }

    let team = 0;
    if (aiType === 'small') team += rewards.smallReward;
    if (plType === 'small') team += rewards.smallReward;
    if (aiType === 'small' && plType === 'small' && aiGoalIdx === plGoalIdx) {
      team -= rewards.smallReward; // same small goal: only one claim
    }
    return team;
  },

  buildPlanner({ goals, goalTypes, obstacles = [], utilitySummary = null, beta = 1.0, context = {} }) {
    this.assertUtilitySummary(utilitySummary, context);

    const gridSize = RL_AGENT_CONFIG.gridSize || 15;
    const helpers = this._getHelpers(gridSize);
    const { toIdx } = helpers;
    const N = gridSize * gridSize;
    const S = N * N;

    const rewards = this.resolveRewards(utilitySummary);
    const { stepCost, gamma } = rewards;

    // Map each goal cell index → goal array index, so we can look up types.
    const goalIdxByCell = new Map();
    goals.forEach(([r, c], i) => goalIdxByCell.set(toIdx(r, c), i));
    const goalSet = new Set(goalIdxByCell.keys());
    const types = (Array.isArray(goalTypes) && goalTypes.length === goals.length)
      ? goalTypes.map(t => (t === 'big' ? 'big' : 'small'))
      : goals.map(() => 'small');

    const obstacleSet = new Set((obstacles || []).map(([r, c]) => `${r},${c}`));

    // Precompute per-cell action transitions so the VI inner loop is tight.
    const nextByAction = new Array(N);
    const validActionsByCell = new Array(N);
    for (let pos = 0; pos < N; pos++) {
      nextByAction[pos] = [
        this.stepIdxWithObstacles(pos, 0, obstacleSet, helpers),
        this.stepIdxWithObstacles(pos, 1, obstacleSet, helpers),
        this.stepIdxWithObstacles(pos, 2, obstacleSet, helpers),
        this.stepIdxWithObstacles(pos, 3, obstacleSet, helpers)
      ];
      validActionsByCell[pos] = nextByAction[pos]
        .map((nextPos, actionIdx) => (nextPos !== pos ? actionIdx : -1))
        .filter(actionIdx => actionIdx !== -1);
    }

    const V = new Float32Array(S); // initial V = 0
    const Q = new Float32Array(S * 16);
    Q.fill(Number.NEGATIVE_INFINITY);

    // Precompute terminal flag and terminal reward for every joint state.
    const isTerminal = new Uint8Array(S);
    const terminalR = new Float32Array(S);
    for (let s = 0; s < S; s++) {
      const aiIdx = (s / N) | 0;
      const plIdx = s % N;
      const aiOn = goalSet.has(aiIdx);
      const plOn = goalSet.has(plIdx);
      if (aiOn && plOn) {
        isTerminal[s] = 1;
        const aiG = goalIdxByCell.get(aiIdx);
        const plG = goalIdxByCell.get(plIdx);
        terminalR[s] = this.terminalTeamReward(aiG, plG, types, rewards);
      }
    }

    // Value iteration.
    const maxIterations = RL_AGENT_CONFIG.maxJointVIIter || 400;
    const threshold = 1e-4;

    for (let iter = 0; iter < maxIterations; iter++) {
      let delta = 0;

      for (let s = 0; s < S; s++) {
        if (isTerminal[s]) {
          if (V[s] !== 0) V[s] = 0;
          continue;
        }

        const aiIdx = (s / N) | 0;
        const plIdx = s % N;
        const aiOn = goalSet.has(aiIdx);
        const plOn = goalSet.has(plIdx);

        let bestQ = -Infinity;
        const aiActions = aiOn ? [0] : validActionsByCell[aiIdx];
        const plActions = plOn ? [0] : validActionsByCell[plIdx];

        for (const aAI of aiActions) {
          const aiNext = aiOn ? aiIdx : nextByAction[aiIdx][aAI];
          const aiMoved = aiNext !== aiIdx;

          for (const aPL of plActions) {
            const plNext = plOn ? plIdx : nextByAction[plIdx][aPL];
            const plMoved = plNext !== plIdx;
            const sNext = aiNext * N + plNext;

            // Per-step move cost: applies to each agent that actually moved.
            let r = 0;
            if (aiMoved) r += stepCost;
            if (plMoved) r += stepCost;

            // Terminal arrival reward from the team's perspective.
            if (isTerminal[sNext]) r += terminalR[sNext];

            const q = isTerminal[sNext] ? r : (r + gamma * V[sNext]);
            Q[s * 16 + aAI * 4 + aPL] = q;
            if (q > bestQ) bestQ = q;
          }
        }

        const diff = Math.abs(bestQ - V[s]);
        if (diff > delta) delta = diff;
        V[s] = bestQ;
      }

      if (delta < threshold) break;
      if (iter === maxIterations - 1) {
        console.warn(`JointVI did not fully converge after ${maxIterations} iters (Δ=${delta.toFixed(4)})`);
      }
    }

    return { Q, V, goalSet, goalIdxByCell, goalTypes: types, rewards, beta, validActionsByCell };
  },

  getActionDistribution(aiState, playerState, goals, beta = null, obstacles = [], context = {}) {
    if (beta == null) beta = RL_AGENT_CONFIG.softmaxBeta;
    const goalTypes = Array.isArray(context.goalTypes) ? context.goalTypes : goals.map(() => 'small');
    const utilitySummary = context.utilitySummary || null;

    this.assertUtilitySummary(utilitySummary, context);

    const rewards = this.resolveRewards(utilitySummary);
    const key = hashGoals(goals) + '|' + this.hashGoalTypes(goalTypes) +
                '|' + this.hashObstacles(obstacles) + '|' + this.hashRewards(rewards) +
                '|' + beta;

    if (!this.planners.has(key)) {
      this.planners.set(key, this.buildPlanner({ goals, goalTypes, obstacles, utilitySummary, beta, context }));
    }

    const { Q, goalSet, validActionsByCell } = this.planners.get(key);

    const gridSize = RL_AGENT_CONFIG.gridSize || 15;
    const helpers = this._getHelpers(gridSize);
    const { toIdx } = helpers;
    const N = gridSize * gridSize;

    const idxAI = toIdx(aiState[0], aiState[1]);
    const idxPL = toIdx(playerState[0], playerState[1]);
    const aiOnGoal = goalSet.has(idxAI);
    const partnerOnGoal = goalSet.has(idxPL);

    if (aiOnGoal) return null;

    const aiActions = validActionsByCell[idxAI] || [];
    if (aiActions.length === 0) return null;

    const partnerActions = partnerOnGoal ? [0] : (validActionsByCell[idxPL] || []);
    if (partnerActions.length === 0) return null;

    const s = idxAI * N + idxPL;
    const jointEntries = [];
    let maxQ = -Infinity;

    for (const aAI of aiActions) {
      for (const aPL of partnerActions) {
        const q = Q[s * 16 + aAI * 4 + aPL];
        if (!isFinite(q)) continue;
        jointEntries.push({ aAI, aPL, q });
        if (q > maxQ) maxQ = q;
      }
    }

    if (jointEntries.length === 0 || !isFinite(maxQ)) return null;

    const massesByAI = new Map();
    for (const entry of jointEntries) {
      const mass = Math.exp(Math.max(-700, Math.min(700, beta * (entry.q - maxQ))));
      entry.mass = mass;
      massesByAI.set(entry.aAI, (massesByAI.get(entry.aAI) || 0) + mass);
    }

    const actionIndices = [...massesByAI.keys()];
    const weights = actionIndices.map(actionIdx => massesByAI.get(actionIdx) || 0);
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const probabilities = weights.map(weight => weight / total);

    return {
      actionIndices,
      weights,
      probabilities,
      entries: jointEntries,
      actionDeltas: actionIndices.map(actionIdx => [...CARDINAL_ACTIONS[actionIdx]])
    };
  },

  getAction(aiState, playerState, goals, beta = null, obstacles = [], context = {}) {
    const distribution = this.getActionDistribution(aiState, playerState, goals, beta, obstacles, context);
    if (!distribution) return null;

    const sampledIdx = sampleIndexFromWeights(distribution.weights);
    if (sampledIdx < 0) return null;
    return distribution.actionDeltas[sampledIdx];
  },

  precalc(goals, obstacles = [], context = {}) {
    const beta = RL_AGENT_CONFIG.softmaxBeta;
    const goalTypes = Array.isArray(context.goalTypes) ? context.goalTypes : goals.map(() => 'small');
    const utilitySummary = context.utilitySummary || null;

    this.assertUtilitySummary(utilitySummary, context);

    const rewards = this.resolveRewards(utilitySummary);
    const key = hashGoals(goals) + '|' + this.hashGoalTypes(goalTypes) +
                '|' + this.hashObstacles(obstacles) + '|' + this.hashRewards(rewards) +
                '|' + beta;
    if (!this.planners.has(key)) {
      this.planners.set(key, this.buildPlanner({ goals, goalTypes, obstacles, utilitySummary, beta, context }));
    }
  },

  clear() {
    this.planners.clear();
  }
};

export class RLAgent {
  constructor() {
    this.isPreCalculating = false;
  }

  getAIAction(gridMatrix, currentPos, goals, playerPos = null, context = {}) {
    if (!goals || goals.length === 0) return null;

    try {
      if (playerPos && CONFIG.game.agent.type === 'joint') {
        const impl = (RL_AGENT_CONFIG.jointRLImplementation || 'bfs').toLowerCase();

        // Extract obstacles from the current grid matrix (value 4)
        const obstacles = [];
        try {
          if (Array.isArray(gridMatrix)) {
            for (let rr = 0; rr < gridMatrix.length; rr++) {
              for (let cc = 0; cc < gridMatrix[rr].length; cc++) {
                if (gridMatrix[rr][cc] === 4) obstacles.push([rr, cc]);
              }
            }
          }
        } catch (_) { /* ignore */ }

        let action;
        if (impl === 'vi4') {
          // Legacy 4-action joint planner (kept for backward compatibility).
          action = JointPlanner4Action.getAction(
            currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta, obstacles
          );
          if (!action) {
            return null;
          }

          return sanitizeDelta(gridMatrix, currentPos, action);
        } else {
          // Default: goal-type-aware cooperative joint VI (Stag-Hunt aware).
          try {
            action = JointBFSPlanner.getAction(
              currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta, obstacles, context
            );
          } catch (plannerError) {
            console.warn('Joint StagHunt planner unavailable; falling back explicitly to individual RL:', plannerError?.message || plannerError);
            return this.getIndividualRLAction(gridMatrix, currentPos, goals);
          }

          if (!action) {
            return null;
          }
          if (!isValidMoveOnGrid(gridMatrix, currentPos, action)) {
            throw new Error(`Joint planner produced non-executable action ${JSON.stringify(action)} from ${JSON.stringify(currentPos)}`);
          }
          return action;
        }
      }

      return this.getIndividualRLAction(gridMatrix, currentPos, goals);
    } catch (e) {
      console.error('Error in RL agent:', e);
      return [0, 0];
    }
  }

  getIndividualRLAction(gridMatrix, currentPos, goals) {
    const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const noiseActionSpace = [...actionSpace];

    // Extract obstacles from the current grid (value 4 per GAME_OBJECTS)
    let obstacles = [];
    try {
      if (Array.isArray(gridMatrix)) {
        for (let r = 0; r < gridMatrix.length; r++) {
          const row = gridMatrix[r];
          for (let c = 0; c < row.length; c++) {
            if (row[c] === 4) obstacles.push([r, c]);
          }
        }
      }
    } catch (_) {
      obstacles = [];
    }

    try {
      if (!CONFIG?.debug?.disableConsoleLogs) {
        console.log(`[RLAgent] obstacles detected: ${obstacles.length}`);
      }
    } catch (_) { /* noop */ }

    const runner = new RunIndividualVI(
      RL_AGENT_CONFIG.gridSize,
      actionSpace,
      noiseActionSpace,
      RL_AGENT_CONFIG.noise,
      RL_AGENT_CONFIG.gamma,
      RL_AGENT_CONFIG.goalReward,
      RL_AGENT_CONFIG.softmaxBeta
    );

    const { policy } = runner.call(goals, obstacles);
    const probs = policy.call(currentPos);

    // Choose action from softmax, then ensure it never targets an obstacle
    const rawDelta = chooseBestAction(probs);
    const safeDelta = sanitizeDelta(gridMatrix, currentPos, rawDelta);
    return safeDelta;
  }

  precalculatePolicyForGoals(goals, _experimentType, context = {}) {
    if (this.isPreCalculating) return;
    this.isPreCalculating = true;

    setTimeout(() => {
      try {
        const impl = (RL_AGENT_CONFIG.jointRLImplementation || 'bfs').toLowerCase();
        if (impl === 'vi4') JointPlanner4Action.precalc(goals);
        else JointBFSPlanner.precalc(goals, context.obstacles || [], context);
      } finally {
        this.isPreCalculating = false;
      }
    }, 0);
  }

  enableAutoPolicyPrecalculation() { /* compatibility */ }
  resetNewGoalPreCalculationFlag() { /* compatibility */ }
}

// Export internals for reuse by WeIntentAgent and for testing
export { RunIndividualVI, JointPlanner4Action, JointBFSPlanner, softmax, RL_AGENT_CONFIG };
