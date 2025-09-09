import { CONFIG } from '../config/gameConfig.js';

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
  jointRLImplementation: '4action'
};

try { if (CONFIG?.game?.matrixSize) RL_AGENT_CONFIG.gridSize = CONFIG.game.matrixSize; } catch {}

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

class GridWorld {
  constructor(nx, ny) { this.nx = nx; this.ny = ny; this.coordinates = []; for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) this.coordinates.push([x, y]); this.terminals = []; this.obstacles = []; this.features = {}; }
  addTerminals(ts) { this.terminals.push(...ts); }
  addObstacles(obs) { this.obstacles.push(...obs); }
  addFeatureMap(name, stateValues, defaultValue = 0) { this.features[name] = {}; for (const c of this.coordinates) this.features[name][c.toString()] = defaultValue; for (const k in stateValues) this.features[name][k.toString()] = stateValues[k]; }
  isStateValid([x, y]) { if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) return false; return !this.obstacles.some(o => o[0] === x && o[1] === y); }
  reward(s, _a, s_n, W = null) { if (!W) return Object.keys(this.features).reduce((sum, f) => sum + this.features[f][s_n.toString()], 0); return Object.keys(W).reduce((sum, f) => sum + this.features[f][s_n.toString()] * W[f], 0); }
}

function transition(state, action) { return [state[0] + action[0], state[1] + action[1]]; }

class StochasticTransition {
  constructor(noise, noiseActionSpace, terminals, isStateValid) { this.noise = noise; this.noiseActionSpace = noiseActionSpace; this.terminals = terminals; this.isStateValid = isStateValid; }
  call(state, action) {
    if (this.terminals.some(t => t[0] === state[0] && t[1] === state[1])) return { [state.toString()]: 1 };
    const nextState = transition(state, action); if (!this.isStateValid(nextState)) return { [state.toString()]: 1 };
    const possible = this.noiseActionSpace.map(na => transition(state, na)).filter(this.isStateValid);
    const noiseProb = this.noise / (possible.length - 1 || 1);
    const result = {}; for (const s of possible) result[s.toString()] = noiseProb; result[nextState.toString()] = 1.0 - this.noise; return result;
  }
}

class ValueIteration {
  constructor(gamma, epsilon = 0.001, maxIter = 100, terminals = []) { this.gamma = gamma; this.epsilon = epsilon; this.maxIter = maxIter; this.terminals = terminals.map(s => s.toString()); }
  run(S, A, T, R) {
    const V = {}; for (const s of S) V[s] = this.terminals.includes(s) ? 0 : 0.1;
    for (let i = 0; i < this.maxIter; i++) { const Vc = { ...V }; for (const s of S) { if (this.terminals.includes(s)) continue; V[s] = Math.max(...A.map(a => Object.entries(T[s][a]).reduce((sum, [s_n, p]) => sum + p * (R[s][a][s_n] + this.gamma * Vc[s_n]), 0))); } const deltas = S.filter(s => !this.terminals.includes(s)).map(s => Math.abs(V[s] - Vc[s])); if (deltas.every(d => d < this.epsilon)) break; }
    return V;
  }
}

class RunIndividualVI {
  constructor(gridSize, actionSpace, noiseSpace, noise, gamma, goalReward, softmaxBeta) { this.gridSize = gridSize; this.actionSpace = actionSpace; this.noiseSpace = noiseSpace; this.noise = noise; this.gamma = gamma; this.goalReward = goalReward; this.softmaxBeta = softmaxBeta; }
  call(goalStates, obstacles) {
    const env = new GridWorld(this.gridSize, this.gridSize); if (!Array.isArray(goalStates[0])) goalStates = [goalStates];
    const terminalValue = {}; for (const s of goalStates) terminalValue[s.toString()] = this.goalReward; env.addFeatureMap('goal', terminalValue, 0); env.addTerminals(goalStates); env.addObstacles(obstacles);
    const S = []; for (let x = 0; x < env.nx; x++) for (let y = 0; y < env.ny; y++) { const st = [x, y]; if (env.isStateValid(st)) S.push(st.toString()); }
    const transitionFunction = new StochasticTransition(this.noise, this.noiseSpace, goalStates, env.isStateValid.bind(env));
    const T = {}; for (const s of S) { T[s] = {}; for (const a of this.actionSpace) { T[s][a.toString()] = transitionFunction.call(s.split(',').map(Number), a); } }
    const stepCost = RL_AGENT_CONFIG.stepCost;
    const R = {}; for (const s of S) { R[s] = {}; for (const a of this.actionSpace) { R[s][a.toString()] = {}; const sv = s.split(',').map(Number); for (const s_n of S) { const snv = s_n.split(',').map(Number); const reward = goalStates.some(gs => gs.toString() === s_n) ? stepCost + env.reward(snv, a, snv) : stepCost + env.reward(sv, a, sv); R[s][a.toString()][s_n] = reward; } } }
    const vi = new ValueIteration(this.gamma, 0.001, 100, goalStates); const V = vi.run(S, this.actionSpace.map(a => a.toString()), T, R); for (const s of goalStates) V[s.toString()] = this.goalReward;
    const Q_dict = {}; for (const s of S) { Q_dict[s] = {}; for (const a of this.actionSpace.map(a => a.toString())) { Q_dict[s][a] = Object.entries(T[s][a]).reduce((sum, [s_n, p]) => sum + p * (R[s][a][s_n] + this.gamma * V[s_n]), 0); } }
    const policy = new SoftmaxRLPolicy(Q_dict, this.softmaxBeta); return { Q_dict, policy };
  }
}

class SoftmaxRLPolicy { constructor(Q_dict, beta = 1) { this.Q = Q_dict; this.beta = beta; } call(state) { const s = state.toString(); const actions = Object.keys(this.Q[s] || {}); const values = actions.map(a => this.Q[s][a]); const probs = softmax(values, this.beta); return Object.fromEntries(actions.map((a, i) => [a, probs[i]])); } }

function chooseBestAction(probsMap) { const actions = Object.keys(probsMap); const values = Object.values(probsMap); const maxValue = Math.max(...values); const ties = actions.filter((a, i) => values[i] === maxValue); const pick = ties[Math.floor(Math.random() * ties.length)]; return pick.split(',').map(Number); }

// ---------- Joint RL (4‑action space) from legacy ----------
const JointPlanner4Action = (() => {
  const ROWS = 15, COLS = 15, N = ROWS * COLS; const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const toIdx = (r, c) => r * COLS + c; const rowOf = idx => Math.floor(idx / COLS); const colOf = idx => idx % COLS; const inGrid = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  function stepIdx(idx, action) { const r = rowOf(idx), c = colOf(idx); const [dr, dc] = actionSpace[action]; const nr = r + dr, nc = c + dc; return inGrid(nr, nc) ? toIdx(nr, nc) : idx; }
  function playerNextIdx(idx, goals, aiIdx = null) { const r = rowOf(idx), c = colOf(idx); let best = goals[0]; let bestJointD = Infinity; for (let i = 0; i < goals.length; i++) { const g = goals[i]; const pD = Math.abs(r - g[0]) + Math.abs(c - g[1]); let jD; if (aiIdx !== null) { const aiR = rowOf(aiIdx), aiC = colOf(aiIdx); const aiD = Math.abs(aiR - g[0]) + Math.abs(aiC - g[1]); jD = pD + aiD; } else { jD = pD; } if (jD < bestJointD) { best = g; bestJointD = jD; } } let nr = r, nc = c; if (r !== best[0]) nr += (best[0] < r ? -1 : 1); else if (c !== best[1]) nc += (best[1] < c ? -1 : 1); return toIdx(nr, nc); }
  const planners = new Map();
  function buildPlanner(goals, beta = 1) {
    const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c))); const S = N * N; const V = new Float32Array(S); const Q = new Float32Array(S * 4);
    const rewardGoal = RL_AGENT_CONFIG.goalReward, stepCost = RL_AGENT_CONFIG.stepCost; const gamma = RL_AGENT_CONFIG.gamma || 0.9; V.fill(-1000);
    for (let s = 0; s < S; s++) { const aiIdx = Math.floor(s / N); const plIdx = s % N; const aiOnGoal = goalSet.has(aiIdx); const plOnGoal = goalSet.has(plIdx); const both = aiOnGoal && plOnGoal && aiIdx === plIdx; if (both) { V[s] = 0; for (let a = 0; a < 4; a++) Q[s * 4 + a] = 0; } }
    let delta, iterations = 0; const maxIterations = 1000, threshold = 1e-6;
    do { delta = 0; iterations++; for (let s = 0; s < S; s++) { const aiIdx = Math.floor(s / N); const plIdx = s % N; const aiOnGoal = goalSet.has(aiIdx); const plOnGoal = goalSet.has(plIdx); const both = aiOnGoal && plOnGoal && aiIdx === plIdx; if (both) { V[s] = 0; for (let a = 0; a < 4; a++) Q[s * 4 + a] = 0; continue; } let bestV = -Infinity; for (let a = 0; a < 4; a++) { const aiNext = aiOnGoal ? aiIdx : stepIdx(aiIdx, a); const plNext = playerNextIdx(plIdx, goals, aiNext); const aiNextOnGoal = goalSet.has(aiNext); const plNextOnGoal = goalSet.has(plNext); const bothNext = aiNextOnGoal && plNextOnGoal && aiNext === plNext; let r = stepCost; if (bothNext) r = rewardGoal; else if (aiNextOnGoal && plNextOnGoal && aiNext !== plNext) r = stepCost * 0.5; else if (aiNextOnGoal || plNextOnGoal) r = stepCost * 0.8; const sNext = aiNext * N + plNext; const q = r + (bothNext ? 0 : gamma * V[sNext]); Q[s * 4 + a] = q; if (q > bestV) bestV = q; } const diff = Math.abs(bestV - V[s]); if (diff > delta) delta = diff; V[s] = bestV; } if (iterations > maxIterations) { console.warn(`Joint RL VI did not converge after ${maxIterations} iters Δ=${delta}`); break; } } while (delta > threshold);
    return { Q, goalSet, beta };
  }
  function getAction(aiState, playerState, goals, beta = null) {
    if (beta == null) beta = RL_AGENT_CONFIG.softmaxBeta; const key = hashGoals(goals) + '|' + beta; if (!planners.has(key)) planners.set(key, buildPlanner(goals, beta));
    const { Q, goalSet } = planners.get(key); const toIdxLocal = (r, c) => r * COLS + c; const aiIdx = toIdxLocal(aiState[0], aiState[1]); const plIdx = toIdxLocal(playerState[0], playerState[1]);
    const aiOnGoal = goalSet.has(aiIdx); const plOnGoal = goalSet.has(plIdx); const bothOnSameGoal = aiOnGoal && plOnGoal && aiIdx === plIdx; if (bothOnSameGoal) return null;
    const s = aiIdx * N + plIdx; const o = s * 4; const qValues = [Q[o], Q[o + 1], Q[o + 2], Q[o + 3]]; if (qValues.some(q => !isFinite(q))) return actionSpace[Math.floor(Math.random() * actionSpace.length)];
    if (beta > 10) { const maxQ = Math.max(...qValues); const best = qValues.map((q, i) => ({ q, i })).filter(d => d.q === maxQ); return actionSpace[best[Math.floor(Math.random() * best.length)].i]; }
    const maxQ = Math.max(...qValues); const logPrefs = qValues.map(q => beta * (q - maxQ)); const clipped = logPrefs.map(lp => Math.max(-700, Math.min(700, lp))); const prefs = clipped.map(lp => Math.exp(lp)); const sum = prefs.reduce((a, b) => a + b, 0); if (!isFinite(sum) || sum === 0) { const i = qValues.indexOf(maxQ); return actionSpace[i]; }
    const r = Math.random() * sum; let acc = 0; for (let a = 0; a < prefs.length; a++) { acc += prefs[a]; if (r < acc) return actionSpace[a]; } const i = qValues.indexOf(maxQ); return actionSpace[i];
  }
  function precalc(goals) { const beta = RL_AGENT_CONFIG.softmaxBeta; const key = hashGoals(goals) + '|' + beta; if (!planners.has(key)) planners.set(key, buildPlanner(goals, beta)); }
  function clear() { planners.clear(); }
  return { getAction, precalc, clear };
})();

export class RLAgent {
  constructor() { this.isPreCalculating = false; }
  getAIAction(_gridMatrix, currentPos, goals, playerPos = null) {
    if (!goals || goals.length === 0) return [0, 0];
    try {
      if (playerPos && CONFIG.game.agent.type === 'joint') {
        const action = JointPlanner4Action.getAction(currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta);
        return action === null ? [0, 0] : action;
      }
      return this.getIndividualRLAction(currentPos, goals);
    } catch (e) { console.error('Error in RL agent:', e); return [0, 0]; }
  }
  getIndividualRLAction(currentPos, goals) {
    const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]]; const noiseActionSpace = [...actionSpace]; const obstacles = [];
    const runner = new RunIndividualVI(RL_AGENT_CONFIG.gridSize, actionSpace, noiseActionSpace, RL_AGENT_CONFIG.noise, RL_AGENT_CONFIG.gamma, RL_AGENT_CONFIG.goalReward, RL_AGENT_CONFIG.softmaxBeta);
    const { policy } = runner.call(goals, obstacles); const probs = policy.call(currentPos); return chooseBestAction(probs);
  }
  precalculatePolicyForGoals(goals, _experimentType) { if (this.isPreCalculating) return; this.isPreCalculating = true; setTimeout(() => { try { JointPlanner4Action.precalc(goals); } finally { this.isPreCalculating = false; } }, 0); }
  enableAutoPolicyPrecalculation() { /* compatibility */ }
  resetNewGoalPreCalculationFlag() { /* compatibility */ }
}
