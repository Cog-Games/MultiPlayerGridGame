// Numerically equivalent implementation of kidSaReference/jointRLFast.js.
// Keep Float32 V/Q, Float64 reward arithmetic, stable priority order, the
// Gauss-Seidel update order, stopping rule, and reference sampling/RNG order.
// Tests compare every Q entry against the unmodified reference implementation.
const N = 225;
const actionSpace = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const toIdx = (r, c) => r * 15 + c;
const planners = new Map();

export function buildKidSaPlanner(goals, beta = 3) {
  const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c)));
  const S = N * N;
  const V = new Float32Array(S);
  const Q = new Float32Array(S * 16);
  const terminal = new Uint8Array(S);
  const rewards = new Float64Array(S);
  const priorities = new Uint16Array(S);
  const nextPos = new Uint16Array(N * 4);
  for (let p = 0; p < N; p++) {
    const row = Math.floor(p / 15), col = p % 15;
    for (let a = 0; a < 4; a++) {
      const r = row + actionSpace[a][0], c = col + actionSpace[a][1];
      nextPos[p * 4 + a] = goalSet.has(p) || r < 0 || r >= 15 || c < 0 || c >= 15 ? p : toIdx(r, c);
    }
  }
  const stateOrder = [];
  for (let s = 0; s < S; s++) {
    const ai = Math.floor(s / N), pl = s % N;
    terminal[s] = goalSet.has(ai) && ai === pl ? 1 : 0;
    let distance = Infinity;
    for (const [r, c] of goals) {
      const d = Math.abs(Math.floor(ai / 15) - r) + Math.abs(ai % 15 - c)
        + Math.abs(Math.floor(pl / 15) - r) + Math.abs(pl % 15 - c);
      if (d < distance) distance = d;
    }
    priorities[s] = distance;
    rewards[s] = terminal[s] ? 30 : -1 + -0.02 * distance;
    if (!terminal[s]) stateOrder.push(s);
  }
  // Sorting once is identical: these priorities do not depend on V.
  stateOrder.sort((a, b) => priorities[a] - priorities[b]);
  const nextStates = new Uint16Array(S * 16);
  for (const s of stateOrder) {
    const ai = Math.floor(s / N), pl = s % N;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      nextStates[s * 16 + a * 4 + b] = nextPos[ai * 4 + a] * N + nextPos[pl * 4 + b];
    }
  }
  let delta, iterations = 0;
  do {
    delta = 0;
    iterations++;
    for (const s of stateOrder) {
      const oldV = V[s];
      let best = -Infinity;
      const offset = s * 16;
      for (let j = 0; j < 16; j++) {
        const next = nextStates[offset + j];
        const q = rewards[next] + (terminal[next] ? 0 : 0.9 * V[next]);
        Q[offset + j] = q;
        if (q > best) best = q;
      }
      V[s] = best;
      const diff = Math.abs(best - oldV);
      if (diff > delta) delta = diff;
    }
  } while (delta > 1e-3 && iterations < 100);
  return { Q, goalSet, beta, lastUsed: Date.now() };
}

function plannerKey(goals, beta) { return goals.map(g => `${g[0]},${g[1]}`).sort().join('|') + '|' + beta; }
function getPlanner(goals, beta) {
  const key = plannerKey(goals, beta);
  if (!planners.has(key)) {
    if (planners.size >= 50) {
      let oldest, oldestTime = Infinity;
      for (const [k, p] of planners) if (p.lastUsed < oldestTime) { oldest = k; oldestTime = p.lastUsed; }
      planners.delete(oldest);
    }
    planners.set(key, buildKidSaPlanner(goals, beta));
  }
  const planner = planners.get(key);
  planner.lastUsed = Date.now();
  return planner;
}

export function prepareKidSaGoals(goals) {
  // SA conditions its joint planner on one sampled goal, not all visible goals.
  for (const goal of goals) getPlanner([goal], 3);
}

export function getSoftmaxOptimalJointRLActionFast(aiState, playerState, goals, beta = 3) {
  if (beta === null) beta = 3;
  if (!isFinite(beta) || beta <= 0) beta = 1;
  const key = plannerKey(goals, beta);
  const { Q, goalSet } = getPlanner(goals, beta);
        const idxAI = toIdx(aiState[0], aiState[1]);
        const idxPL = toIdx(playerState[0], playerState[1]);

        // already together on a goal → stay
        if (goalSet.has(idxAI) && goalSet.has(idxPL) && idxAI === idxPL) return null;

        const s = idxAI * N + idxPL;
        const o = s * 16;

        // Get Q-values for all 16 joint actions
        const qValues = new Array(16);
        for (let j = 0; j < 16; j++) {
            qValues[j] = Q[o + j];
        }

        // Check for invalid Q-values
        const invalidQValues = qValues.filter(q => !isFinite(q));
        if (invalidQValues.length > 0) {
            console.warn('⚠️ Fast: Invalid Q-values detected, using fallback');
            planners.delete(key); // Remove corrupted planner
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // OPTIMIZATION: Improved numerical stability in softmax
        const maxQ = Math.max(...qValues);
        const minQ = Math.min(...qValues);

        // Check for numerical issues
        if (!isFinite(maxQ) || !isFinite(minQ)) {
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // Use log-space computation for better numerical stability
        const logPrefs = qValues.map(q => Math.max(-700, Math.min(700, beta * (q - maxQ))));
        const prefs = logPrefs.map(logP => Math.exp(logP));
        const sum = prefs.reduce((a, b) => a + b, 0);

        // Check for numerical issues in sum
        if (!isFinite(sum) || sum === 0) {
            console.warn('⚠️ Fast: Sum of preferences is invalid, using uniform random fallback');
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // Improved action selection with better numerical stability
        const r = Math.random() * sum;
        let acc = 0;
        for (let j = 0; j < prefs.length; j++) {
            acc += prefs[j];
            if (r < acc) {
                const aiActionIdx = Math.floor(j / 4);    // high bits = AI's choice
                const selectedAction = actionSpace[aiActionIdx];
                return selectedAction;
            }
        }

        // Fallback: return last action if numerical issues occur
        return actionSpace[actionSpace.length - 1];
}
