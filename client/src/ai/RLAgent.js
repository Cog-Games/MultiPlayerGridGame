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

// ---------- BFS-based joint planner (16 joint actions, legacy port) ----------
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

  buildPlanner(goals, beta = 1.0, obstacles = []) {
    const gridSize = RL_AGENT_CONFIG.gridSize || 15;
    const helpers = this._getHelpers(gridSize);
    const { toIdx, rowOf, colOf } = helpers;
    const N = gridSize * gridSize;

    const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c)));
    const S = N * N;
    const Q = new Float32Array(S * 16);
    const rewardGoal = RL_AGENT_CONFIG.goalReward;
    const stepCost = RL_AGENT_CONFIG.stepCost;
    const gamma = RL_AGENT_CONFIG.gamma || 0.9;

    const obstacleSet = new Set((obstacles||[]).map(([r,c]) => `${r},${c}`));

    // Precompute Manhattan distances to each goal for all positions
    const goalDistances = new Array(N);
    for (let pos = 0; pos < N; pos++) {
      goalDistances[pos] = new Array(goals.length);
      const r = rowOf(pos), c = colOf(pos);
      for (let g = 0; g < goals.length; g++) {
        const [gr, gc] = goals[g];
        goalDistances[pos][g] = Math.abs(r - gr) + Math.abs(c - gc);
      }
    }

    const proximityCache = new Map();
    function getProximityReward(nextAI, nextPL, done) {
      if (done) return 0;
      const key = (nextAI <= nextPL)
        ? `${nextAI}-${nextPL}`
        : `${nextPL}-${nextAI}`;
      if (proximityCache.has(key)) return proximityCache.get(key);

      let minJoint = Infinity;
      for (let g = 0; g < goals.length; g++) {
        const d = goalDistances[nextAI][g] + goalDistances[nextPL][g];
        if (d < minJoint) minJoint = d;
      }
      const reward = -RL_AGENT_CONFIG.proximityRewardWeight * minJoint;
      proximityCache.set(key, reward);
      return reward;
    }

    for (let s = 0; s < S; s++) {
      const iAI = Math.floor(s / N);
      const iPL = s % N;

      if (goalSet.has(iAI) && goalSet.has(iPL) && iAI === iPL) {
        for (let j = 0; j < 16; j++) Q[s * 16 + j] = 0;
        continue;
      }

      for (let aAI = 0; aAI < 4; aAI++) {
        const nextAI = goalSet.has(iAI) ? iAI : this.stepIdxWithObstacles(iAI, aAI, obstacleSet, helpers);

        for (let aPL = 0; aPL < 4; aPL++) {
          const nextPL = goalSet.has(iPL) ? iPL : this.stepIdxWithObstacles(iPL, aPL, obstacleSet, helpers);
          const jointIdx = aAI * 4 + aPL;

          const done = goalSet.has(nextAI) && goalSet.has(nextPL) && nextAI === nextPL;
          const proximityReward = getProximityReward(nextAI, nextPL, done);
          const r = done ? rewardGoal : stepCost + proximityReward;

          let futureValue = 0;
          if (!done) {
            let minDist = Infinity;
            for (let g = 0; g < goals.length; g++) {
              const d = goalDistances[nextAI][g] + goalDistances[nextPL][g];
              if (d < minDist) minDist = d;
            }
            futureValue = gamma * (rewardGoal + stepCost * minDist);
          }
          Q[s * 16 + jointIdx] = r + futureValue;
        }
      }
    }
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

    const idxAI = toIdx(aiState[0], aiState[1]);
    const idxPL = toIdx(playerState[0], playerState[1]);

    if (goalSet.has(idxAI) && goalSet.has(idxPL) && idxAI === idxPL) return null;

    const s = idxAI * N + idxPL;
    const base = s * 16;
    const qValues = [
      Q[base], Q[base + 1], Q[base + 2], Q[base + 3],
      Q[base + 4], Q[base + 5], Q[base + 6], Q[base + 7],
      Q[base + 8], Q[base + 9], Q[base + 10], Q[base + 11],
      Q[base + 12], Q[base + 13], Q[base + 14], Q[base + 15]
    ];

    // Optional slowdown when player already on a goal but AI not
    const playerOnGoal = goalSet.has(idxPL);
    const aiOnGoal = goalSet.has(idxAI);
    if (playerOnGoal && !aiOnGoal) {
      for (let j = 0; j < 16; j++) {
        const aiActionIdx = Math.floor(j / 4);
        if (aiActionIdx < 4) qValues[j] *= 0.5; // dampen movement
      }
    }

    if (qValues.some(q => !isFinite(q))) {
      return actionSpace[Math.floor(Math.random() * actionSpace.length)];
    }

    const maxQ = Math.max(...qValues);
    const logPrefs = qValues.map(q => beta * (q - maxQ));
    const clipped = logPrefs.map(lp => Math.max(-700, Math.min(700, lp)));
    const prefs = clipped.map(lp => Math.exp(lp));
    const sum = prefs.reduce((a, b) => a + b, 0);

    if (!isFinite(sum) || sum === 0) {
      return actionSpace[Math.floor(Math.random() * actionSpace.length)];
    }

    const r = Math.random() * sum;
    let acc = 0;
    for (let j = 0; j < 16; j++) {
      acc += prefs[j];
      if (r < acc) {
        const aiActionIdx = Math.floor(j / 4);
        return actionSpace[aiActionIdx];
      }
    }
    return actionSpace[0];
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

export class RLAgent {
  constructor() {
    this.isPreCalculating = false;
  }

  getAIAction(gridMatrix, currentPos, goals, playerPos = null) {
    if (!goals || goals.length === 0) return [0, 0];

    try {
      if (playerPos && CONFIG.game.agent.type === 'joint') {
        const impl = (RL_AGENT_CONFIG.jointRLImplementation || 'vi4').toLowerCase();

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

        let action = (impl === 'bfs')
          ? JointBFSPlanner.getAction(currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta, obstacles)
          : JointPlanner4Action.getAction(currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta, obstacles);
        if (!action) {
          action = [0, 0];
        }

        // Final safety: never return a move that would point into an obstacle
        const safeAction = sanitizeDelta(gridMatrix, currentPos, action);
        return safeAction;
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

  precalculatePolicyForGoals(goals, _experimentType) {
    if (this.isPreCalculating) return;
    this.isPreCalculating = true;

    setTimeout(() => {
      try {
        const impl = (RL_AGENT_CONFIG.jointRLImplementation || 'vi4').toLowerCase();
        if (impl === 'bfs') JointBFSPlanner.precalc(goals);
        else JointPlanner4Action.precalc(goals);
      } finally {
        this.isPreCalculating = false;
      }
    }, 0);
  }

  enableAutoPolicyPrecalculation() { /* compatibility */ }
  resetNewGoalPreCalculationFlag() { /* compatibility */ }
}

// Export internals for reuse by WeIntentAgent
export { RunIndividualVI, JointPlanner4Action, softmax, RL_AGENT_CONFIG };
