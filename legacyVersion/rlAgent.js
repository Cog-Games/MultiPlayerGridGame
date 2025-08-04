// ===============================================================================================
// RL AGENT IMPLEMENTATION FOR NODEGAME
// ===============================================================================================

// Global hashGoals function for policy caching
function hashGoals(goals) {
    // sort to make order irrelevant
    return goals.map(g => `${g[0]},${g[1]}`).sort().join('|');
}

// RL Agent Configuration
var RL_AGENT_CONFIG = {
    gridSize: 15,
    noise: 0.0,
    gamma: 0.9,
    goalReward: 30,
    stepCost: -1,  // Cost per step (negative reward for movement)
    softmaxBeta: 3.0,  // Reduced from 5 to prevent numerical instability
    proximityRewardWeight: 0.01,  // Weight for joint Manhattan distance proximity reward
    coordinationRewardWeight: 0.02,  // Weight for coordination reward when one player is on goal
    maxPolicyIterations: 15,  // Limit iterations for faster initial policy
    progressivePolicyBuilding: true,  // Build policy progressively
    policyBuildTimeout: 10,  // Max time (ms) for initial policy build
    debugMode: false,  // Disable debug logging for performance
    useFastOptimalPolicy: false,  // Use optimized fast version (true) or original version (false)
    enablePolicyPrecalculation: false,  // Enable pre-calculation of policies for instant response
    jointRLImplementation: 'bfs',  // Choose joint RL implementation: 'original' or 'bfs'
};

// ===============================================================================================
// CORE RL CLASSES AND FUNCTIONS
// ===============================================================================================

class GridWorld {
    constructor(name = '', nx = 0, ny = 0) {
        this.name = name;
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

    addTerminals(terminals) {
        this.terminals.push(...terminals);
    }

    addObstacles(obstacles) {
        this.obstacles.push(...obstacles);
    }

    addFeatureMap(name, stateValues, defaultValue = 0) {
        this.features[name] = {};
        for (const coord of this.coordinates) {
            this.features[name][coord.toString()] = defaultValue;
        }
        for (const key in stateValues) {
            this.features[name][key.toString()] = stateValues[key];
        }
    }

    isStateValid(state) {
        const [x, y] = state;
        if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) return false;
        return !this.obstacles.some(obs => obs[0] === x && obs[1] === y);
    }

    reward(s, a, s_n, W = null) {
        if (!W) {
            return Object.keys(this.features).reduce((sum, f) => sum + this.features[f][s_n.toString()], 0);
        }
        return Object.keys(W).reduce((sum, f) => sum + this.features[f][s_n.toString()] * W[f], 0);
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

        const possibleNextStates = this.noiseActionSpace
            .map(noiseAction => transition(state, noiseAction))
            .filter(this.isStateValid);

        const noiseProb = this.noise / (possibleNextStates.length - 1 || 1);
        const result = {};
        for (const s of possibleNextStates) {
            result[s.toString()] = noiseProb;
        }
        result[nextState.toString()] = 1.0 - this.noise;

        return result;
    }
}

function softmax(values, beta) {
    // Check for invalid inputs
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    // Check for non-finite values
    const invalidValues = values.filter(v => !isFinite(v));
    if (invalidValues.length > 0) {
        // Return uniform distribution as fallback
        return new Array(values.length).fill(1.0 / values.length);
    }

    // Use log-space computation for numerical stability
    const maxVal = Math.max(...values);
    const logProbs = values.map(v => beta * (v - maxVal));

    // Clip to prevent overflow/underflow
    const clippedLogProbs = logProbs.map(logP => Math.max(-700, Math.min(700, logP)));

    const expVals = clippedLogProbs.map(logP => Math.exp(logP));
    const sumExp = expVals.reduce((a, b) => a + b, 0);

    // Check for zero sum
    if (sumExp === 0 || !isFinite(sumExp)) {
        return new Array(values.length).fill(1.0 / values.length);
    }

    return expVals.map(v => v / sumExp);
}

class SoftmaxRLPolicy {
    constructor(Q_dict, beta) {
        this.Q_dict = Q_dict;
        this.beta = beta;
    }

    call(state) {
        const actionDict = this.Q_dict[state.toString()];
        const actions = Object.keys(actionDict);
        const values = actions.map(a => actionDict[a]);
        const probs = softmax(values, this.beta);
        return Object.fromEntries(actions.map((a, i) => [a, probs[i]]));
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
            const V_copy = { ...V };
            for (const s of S) {
                if (this.terminals.includes(s)) continue;
                V[s] = Math.max(...A.map(a => {
                    return Object.entries(T[s][a]).reduce((sum, [s_n, p]) => {
                        return sum + p * (R[s][a][s_n] + this.gamma * V_copy[s_n]);
                    }, 0);
                }));
            }
            const deltas = S.filter(s => !this.terminals.includes(s)).map(s => Math.abs(V[s] - V_copy[s]));
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
        const env = new GridWorld("test", this.gridSize, this.gridSize);

        if (!Array.isArray(goalStates[0])) goalStates = [goalStates];

        const terminalValue = {};
        for (const s of goalStates) terminalValue[s.toString()] = this.goalReward;

        env.addFeatureMap("goal", terminalValue, 0);
        env.addTerminals(goalStates);
        env.addObstacles(obstacles);

        let S = [];
        for (let x = 0; x < env.nx; x++) {
            for (let y = 0; y < env.ny; y++) {
                const state = [x, y];
                if (env.isStateValid(state)) S.push(state.toString());
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
                const stateVec = s.split(',').map(Number);
                for (const s_n of S) {
                    const s_nVec = s_n.split(',').map(Number);
                    const reward = goalStates.some(gs => gs.toString() === s_n) ?
                        stepCost + env.reward(s_nVec, a, s_nVec) :
                        stepCost + env.reward(stateVec, a, stateVec);
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
                Q_dict[s][a] = Object.entries(T[s][a]).reduce((sum, [s_n, p]) => {
                    return sum + p * (R[s][a][s_n] + this.gamma * V[s_n]);
                }, 0);
            }
        }

        const policy = new SoftmaxRLPolicy(Q_dict, this.softmaxBeta);

        return { Q_dict, policy };
    }
}

function chooseMaxAction(actionDict) {
    const actions = Object.keys(actionDict);
    const values = Object.values(actionDict);
    const maxValue = Math.max(...values);

    // Filter actions that have the max value
    const actionMaxList = actions.filter(action => actionDict[action] === maxValue);

    // Randomly choose one of the max-valued actions
    const randomIndex = Math.floor(Math.random() * actionMaxList.length);
    return actionMaxList[randomIndex];
}

// ===============================================================================================
// INDIVIDUAL RL AGENT
// ===============================================================================================

/**
 * Individual RL Action - only considers own position and goals
 * @param {number[]} currentPos - AI's current position [row, col]
 * @param {number[][]} goalStates - Array of goal positions [[row1, col1], [row2, col2], ...]
 * @returns {number[]} Action vector [deltaRow, deltaCol]
 */
function getIndividualRLAction(currentPos, goalStates) {
    const actionSpace = [
        [0, -1], // left
        [0, 1],  // right
        [-1, 0], // up
        [1, 0]   // down
    ];

    const noiseActionSpace = [...actionSpace];
    const obstacles = [];

    const runner = new RunIndividualVI(
        RL_AGENT_CONFIG.gridSize,
        actionSpace,
        noiseActionSpace,
        RL_AGENT_CONFIG.noise,
        RL_AGENT_CONFIG.gamma,
        RL_AGENT_CONFIG.goalReward,
        RL_AGENT_CONFIG.softmaxBeta
    );
    const { Q_dict, policy } = runner.call(goalStates, obstacles);

    const probs = policy.call(currentPos);
    const sampledAction = chooseMaxAction(probs);

    return sampledAction;
}

// ===============================================================================================
// JOINT RL AGENT - ORIGINAL VERSION
// ===============================================================================================

const getSoftmaxOptimalJointRLAction = (function () {
    // ---------- grid & actions ----------
    const ROWS = 15, COLS = 15, N = ROWS * COLS;          // N = 225
    const actionSpace = [
        [0, -1], // 0: left
        [0, 1], // 1: right
        [-1, 0], // 2: up
        [1, 0]  // 3: down
    ];

    // ---------- helpers ----------
    const toIdx = (r, c) => r * COLS + c;                         // (row,col) → 0‑224
    const rowOf = idx => Math.floor(idx / COLS);
    const colOf = idx => idx % COLS;
    const inGrid = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

    // apply one of four primitive moves; out‑of‑bounds ⇒ stay
    function stepIdx(idx, a) {
        const r = rowOf(idx), c = colOf(idx);
        const dr = actionSpace[a][0], dc = actionSpace[a][1];
        const nr = r + dr, nc = c + dc;
        return inGrid(nr, nc) ? toIdx(nr, nc) : idx;
    }

    // ---------- enhanced cache keyed by goals|β ----------
    const planners = new Map();   // key -> { Q: Float32Array, goalSet: Set, beta }

    // ---------- offline Value‑Iteration builder (joint 16‑actions) ----------
    function buildPlanner(goals, beta = 1.0) {
        const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c)));
        const S = N * N;                                     // 50 625 joint states
        const V = new Float32Array(S);                       // value table
        const Q = new Float32Array(S * 16);                  // Q(s, jointA) for soft‑max
        const rewardGoal = RL_AGENT_CONFIG.goalReward, stepCost = RL_AGENT_CONFIG.stepCost;
        const γ = RL_AGENT_CONFIG.gamma || 0.9;

        // Precompute distances from every position to every goal (optimized)
        const goalDistances = new Array(N);
        for (let pos = 0; pos < N; pos++) {
            goalDistances[pos] = new Array(goals.length);
            const r = rowOf(pos), c = colOf(pos);
            for (let g = 0; g < goals.length; g++) {
                const goal = goals[g];
                goalDistances[pos][g] = Math.abs(r - goal[0]) + Math.abs(c - goal[1]);
            }
        }

        // Precompute proximity rewards for common goal configurations
        const proximityCache = new Map();
        function getProximityReward(nextAI, nextPL, done) {
            if (done) return 0;

            const cacheKey = `${nextAI}-${nextPL}`;
            if (proximityCache.has(cacheKey)) {
                return proximityCache.get(cacheKey);
            }

            let minJointDist = Infinity;
            for (let g = 0; g < goals.length; g++) {
                const jointDist = goalDistances[nextAI][g] + goalDistances[nextPL][g];
                if (jointDist < minJointDist) {
                    minJointDist = jointDist;
                }
            }

            const reward = -RL_AGENT_CONFIG.proximityRewardWeight * minJointDist;
            proximityCache.set(cacheKey, reward);
            return reward;
        }

        let Δ;
        do {
            Δ = 0;
            for (let s = 0; s < S; s++) {
                const iAI = Math.floor(s / N);   // AI index 0‑224
                const iPL = s % N;               // Player index 0‑224

                // terminal if both players are on the same goal square
                if (goalSet.has(iAI) && goalSet.has(iPL) && iAI === iPL) {
                    V[s] = 0;
                    for (let j = 0; j < 16; j++) Q[s * 16 + j] = 0;
                    continue;
                }

                let best = -Infinity;

                for (let aAI = 0; aAI < 4; aAI++) {
                    // If AI is already on a goal, it stays there
                    const nextAI = goalSet.has(iAI) ? iAI : stepIdx(iAI, aAI);

                    for (let aPL = 0; aPL < 4; aPL++) {
                        // If player is already on a goal, it stays there
                        const nextPL = goalSet.has(iPL) ? iPL : stepIdx(iPL, aPL);

                        const jointIdx = aAI * 4 + aPL;          // 0‑15
                        const done = goalSet.has(nextAI) && goalSet.has(nextPL) && nextAI === nextPL;

                        // Use cached proximity reward for better performance
                        const proximityReward = getProximityReward(nextAI, nextPL, done);

                        const r = done ? rewardGoal : stepCost + proximityReward;
                        const sNext = nextAI * N + nextPL;
                        const q = r + (done ? 0 : γ * V[sNext]);

                        Q[s * 16 + jointIdx] = q;
                        if (q > best) best = q;
                    }
                }
                const diff = Math.abs(best - V[s]);
                if (diff > Δ) Δ = diff;
                V[s] = best;
            }
        } while (Δ > 1e-3);  // Full convergence for optimality

        return { Q, goalSet, beta };
    }

    // ---------- public function ----------
    return function getSoftmaxOptimalJointRLAction(aiState, playerState, goals, beta = null) {
        // Use configured beta if not provided
        if (beta === null) {
            beta = RL_AGENT_CONFIG.softmaxBeta;
        }

        // Ensure beta is reasonable to prevent numerical issues
        if (!isFinite(beta) || beta <= 0) {
            console.warn('⚠️ Invalid beta value, using default of 1.0');
            beta = 1.0;
        }

        const key = hashGoals(goals) + '|' + beta;
        if (!planners.has(key)) {
            planners.set(key, buildPlanner(goals, beta));
        }
        const { Q, goalSet } = planners.get(key);

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
            console.warn('⚠️ Invalid Q-values detected, using fallback');
            planners.clear(); // Clear cache to force rebuild
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // Soft‑max sampling with improved numerical stability
        const maxQ = Math.max(...qValues);
        const minQ = Math.min(...qValues);

        // Check for numerical issues
        if (!isFinite(maxQ) || !isFinite(minQ)) {
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // Use log-space computation for better numerical stability
        const logPrefs = qValues.map(q => beta * (q - maxQ));

        // Clip to prevent overflow/underflow
        const clippedLogPrefs = logPrefs.map(logP => Math.max(-700, Math.min(700, logP)));

        const prefs = clippedLogPrefs.map(logP => Math.exp(logP));
        const sum = prefs.reduce((a, b) => a + b, 0);

        // Check for numerical issues in sum
        if (!isFinite(sum) || sum === 0) {
            console.warn('⚠️ Sum of preferences is invalid, using uniform random fallback');
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
    };
})();

// ===============================================================================================
// JOINT RL AGENT - BFS VERSION
// ===============================================================================================

const getSoftmaxBFSJointRLAction = (function () {
    // ---------- grid & actions ----------
    const ROWS = 15, COLS = 15, N = ROWS * COLS;        // single‑agent states
    const actionSpace = [
        [0, -1], [0,  1], [-1, 0], [1, 0]                 // L, R, U, D
    ];

    // ---------- helpers ----------
    const toIdx   = (r, c)   => r * COLS + c;           // (row,col) ➜ 0‑224
    const rowOf   = i => Math.floor(i / COLS);
    const colOf   = i => i % COLS;
    const inGrid  = (r, c)   => r >= 0 && r < ROWS && c >= 0 && c < COLS;
    const stepIdx = (idx, a) => {                       // apply action, stay on OOB
        const r  = rowOf(idx), c  = colOf(idx);
        const nr = r + actionSpace[a][0];
        const nc = c + actionSpace[a][1];
        return inGrid(nr, nc) ? toIdx(nr, nc) : idx;
    };

    // ---------- cache keyed only by goal set (distance doesn't depend on β) ----------
    const planners = new Map();   // key -> { dist: Int16Array, goalSet: Set }

    // ---------- build Q-value table using BFS-based approach ----------
    function buildPlanner(goals, beta = 1.0) {
        const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c)));
        const S = N * N;                                     // 50 625 joint states
        const Q = new Float32Array(S * 16);                  // Q(s, jointA) for soft‑max
        const rewardGoal = RL_AGENT_CONFIG.goalReward, stepCost = RL_AGENT_CONFIG.stepCost;
        const γ = RL_AGENT_CONFIG.gamma || 0.9;

        // Precompute distances from every position to every goal
        const goalDistances = new Array(N);
        for (let pos = 0; pos < N; pos++) {
            goalDistances[pos] = new Array(goals.length);
            const r = Math.floor(pos / COLS), c = pos % COLS;
            for (let g = 0; g < goals.length; g++) {
                const goal = goals[g];
                goalDistances[pos][g] = Math.abs(r - goal[0]) + Math.abs(c - goal[1]);
            }
        }

        // Precompute proximity rewards for common goal configurations
        const proximityCache = new Map();
        function getProximityReward(nextAI, nextPL, done) {
            if (done) return 0;

            const cacheKey = `${nextAI}-${nextPL}`;
            if (proximityCache.has(cacheKey)) {
                return proximityCache.get(cacheKey);
            }

            let minJointDist = Infinity;
            for (let g = 0; g < goals.length; g++) {
                const jointDist = goalDistances[nextAI][g] + goalDistances[nextPL][g];
                if (jointDist < minJointDist) {
                    minJointDist = jointDist;
                }
            }

            const reward = -RL_AGENT_CONFIG.proximityRewardWeight * minJointDist;
            proximityCache.set(cacheKey, reward);
            return reward;
        }

        // Use BFS to compute optimal Q-values
        // Initialize Q-values with immediate rewards
        for (let s = 0; s < S; s++) {
            const iAI = Math.floor(s / N);   // AI index 0‑224
            const iPL = s % N;               // Player index 0‑224

            // terminal if both players are on the same goal square
            if (goalSet.has(iAI) && goalSet.has(iPL) && iAI === iPL) {
                for (let j = 0; j < 16; j++) Q[s * 16 + j] = 0;
                continue;
            }

            for (let aAI = 0; aAI < 4; aAI++) {
                // If AI is already on a goal, it stays there
                const nextAI = goalSet.has(iAI) ? iAI : stepIdx(iAI, aAI);

                for (let aPL = 0; aPL < 4; aPL++) {
                    // If player is already on a goal, it stays there
                    const nextPL = goalSet.has(iPL) ? iPL : stepIdx(iPL, aPL);

                    const jointIdx = aAI * 4 + aPL;          // 0‑15
                    const done = goalSet.has(nextAI) && goalSet.has(nextPL) && nextAI === nextPL;

                    // Use cached proximity reward for better performance
                    const proximityReward = getProximityReward(nextAI, nextPL, done);

                    const r = done ? rewardGoal : stepCost + proximityReward;

                    // For BFS approach, we use the immediate reward plus discounted future value
                    // Since we don't have V(s), we'll use a heuristic based on distance to goals
                    const sNext = nextAI * N + nextPL;
                    let futureValue = 0;

                    if (!done) {
                        // Estimate future value based on minimum distance to any goal
                        let minDistToGoal = Infinity;
                        for (let g = 0; g < goals.length; g++) {
                            const distToGoal = goalDistances[nextAI][g] + goalDistances[nextPL][g];
                            if (distToGoal < minDistToGoal) {
                                minDistToGoal = distToGoal;
                            }
                        }
                        // Heuristic: future value is discounted reward for reaching goal
                        futureValue = γ * (rewardGoal + stepCost * minDistToGoal);
                    }

                    Q[s * 16 + jointIdx] = r + futureValue;
                }
            }
        }

        return { Q, goalSet, beta };
    }

    // ---------- public function ----------
    return function getSoftmaxBFSJointRLAction(aiState, playerState, goals, beta = null) {
        // Use configured beta if not provided
        if (beta === null) {
            beta = RL_AGENT_CONFIG.softmaxBeta;
        }

        // Ensure beta is reasonable to prevent numerical issues
        if (!isFinite(beta) || beta <= 0) {
            console.warn('⚠️ Invalid beta value, using default of 1.0');
            beta = 1.0;
        }

        const key = hashGoals(goals) + '|' + beta;
        if (!planners.has(key)) {
            planners.set(key, buildPlanner(goals, beta));
        }
        const { Q, goalSet } = planners.get(key);

        const idxAI = toIdx(aiState[0], aiState[1]);
        const idxPL = toIdx(playerState[0], playerState[1]);

        // already together on a goal → stay
        if (goalSet.has(idxAI) && goalSet.has(idxPL) && idxAI === idxPL) return null;

        // Check if player has reached a goal but AI hasn't - this should slow down AI movement
        const playerOnGoal = goalSet.has(idxPL);
        const aiOnGoal = goalSet.has(idxAI);
        const isIndependentPhase = playerOnGoal && !aiOnGoal;

        const s = idxAI * N + idxPL;
        const o = s * 16;

        // Get Q-values for all 16 joint actions
        const qValues = new Array(16);
        for (let j = 0; j < 16; j++) {
            qValues[j] = Q[o + j];
        }

        // If in independent phase (player on goal, AI not), adjust Q-values to slow down AI
        if (isIndependentPhase) {
            // Reduce the Q-values for AI movement actions to make AI move slower
            for (let j = 0; j < 16; j++) {
                const aiActionIdx = Math.floor(j / 4);
                // Only penalize non-stay actions (actions that actually move the AI)
                if (aiActionIdx < 4) { // All 4 actions are movement actions
                    qValues[j] *= 0.5; // Reduce Q-value by 50% to slow down AI
                }
            }
        }

        // Check for invalid Q-values
        const invalidQValues = qValues.filter(q => !isFinite(q));
        if (invalidQValues.length > 0) {
            console.warn('⚠️ Invalid Q-values detected, using fallback');
            planners.clear(); // Clear cache to force rebuild
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // Soft‑max sampling with improved numerical stability
        const maxQ = Math.max(...qValues);
        const minQ = Math.min(...qValues);

        // Check for numerical issues
        if (!isFinite(maxQ) || !isFinite(minQ)) {
            return actionSpace[Math.floor(Math.random() * actionSpace.length)];
        }

        // Use log-space computation for better numerical stability
        const logPrefs = qValues.map(q => beta * (q - maxQ));

        // Clip to prevent overflow/underflow
        const clippedLogPrefs = logPrefs.map(logP => Math.max(-700, Math.min(700, logP)));

        const prefs = clippedLogPrefs.map(logP => Math.exp(logP));
        const sum = prefs.reduce((a, b) => a + b, 0);

        // Check for numerical issues in sum
        if (!isFinite(sum) || sum === 0) {
            console.warn('⚠️ Sum of preferences is invalid, using uniform random fallback');
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
    };
})();

// ===============================================================================================
// MAIN AI ACTION FUNCTION
// ===============================================================================================

/**
 * Main function to get AI action based on current agent type
 * @param {Array} gridMatrix - Game grid (not used by RL agents)
 * @param {number[]} currentPos - AI's current position [row, col]
 * @param {number[][]} goals - Array of goal positions [[row1, col1], [row2, col2], ...]
 * @param {number[]} playerPos - Human player position [row, col] (required for joint RL)
 * @returns {number[]} Action vector [deltaRow, deltaCol]
 */
function getAIAction(gridMatrix, currentPos, goals, playerPos = null) {
    if (!goals || goals.length === 0) return [0, 0];

    let action;

    try {
        const rlAgentType = NodeGameConfig.getRLAgentType();
        if (rlAgentType === 'joint' && playerPos !== null) {
            // Use joint RL agent that considers both players' positions for cooperation
            if (RL_AGENT_CONFIG.debugMode) {
                const implementationType = RL_AGENT_CONFIG.jointRLImplementation;
                console.log(`🎯 Using Joint RL Agent (${implementationType}) - AI: [${currentPos}], Human: [${playerPos}], Goals: [${goals.map(g => `[${g}]`).join(', ')}]`);
            }

            // Choose joint RL implementation based on config
            switch (RL_AGENT_CONFIG.jointRLImplementation) {
                case 'original':
                    action = getSoftmaxOptimalJointRLAction(currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta);
                    break;
                case 'bfs':
                default:
                    action = getSoftmaxBFSJointRLAction(currentPos, playerPos, goals, RL_AGENT_CONFIG.softmaxBeta);
                    break;
            }

        } else {
            // Use individual RL agent that only considers own position
            if (rlAgentType === 'joint' && playerPos === null) {
                console.warn(`⚠️ Joint RL requested but playerPos is null. Falling back to Individual RL.`);
            }
            if (RL_AGENT_CONFIG.debugMode) {
                console.log(`🎯 Using Individual RL Agent - AI: [${currentPos}], Goals: [${goals.map(g => `[${g}]`).join(', ')}]`);
            }
            action = getIndividualRLAction(currentPos, goals);
        }
    } catch (error) {
        console.error('❌ Error in RL agent:', error);
        console.log('🔄 Falling back to individual RL agent');
        action = getIndividualRLAction(currentPos, goals);
    }

    // Convert string action to array format if needed
    if (typeof action === 'string') {
        action = action.split(',').map(Number);
    }

    return action;
}

// ===============================================================================================
// CONFIGURATION FUNCTIONS
// ===============================================================================================

/**
 * Set the RL agent type
 * @param {string} agentType - 'individual' or 'joint'
 */
function setRLAgentType(agentType) {
    NodeGameConfig.setRLAgentType(agentType);
}

/**
 * Update RL agent configuration
 * @param {object} config - Configuration object with any of the RL_AGENT_CONFIG properties
 */
function updateRLAgentConfig(config) {
    Object.assign(RL_AGENT_CONFIG, config);
}

/**
 * Get current RL agent type
 * @returns {string} Current RL agent type
 */
function getRLAgentType() {
    return NodeGameConfig.getRLAgentType();
}

/**
 * Get current RL agent configuration
 * @returns {object} Current RL agent configuration
 */
function getRLAgentConfig() {
    return { ...RL_AGENT_CONFIG };
}

/**
 * Set joint RL implementation
 * @param {string} implementation - 'original' or 'bfs'
 */
function setJointRLImplementation(implementation) {
    const validImplementations = ['original', 'bfs'];
    if (validImplementations.includes(implementation)) {
        RL_AGENT_CONFIG.jointRLImplementation = implementation;
        console.log(`✅ Joint RL implementation set to: ${implementation}`);
    } else {
        console.error(`Invalid joint RL implementation: ${implementation}. Must be one of: ${validImplementations.join(', ')}`);
    }
}

/**
 * Get current joint RL implementation
 * @returns {string} Current joint RL implementation
 */
function getJointRLImplementation() {
    return RL_AGENT_CONFIG.jointRLImplementation;
}

/**
 * Enable original 16-action joint RL implementation (full joint planning)
 */
function enableOriginalJointRL() {
    setJointRLImplementation('original');
}

/**
 * Enable BFS joint RL implementation (reverse 4-D BFS planner)
 */
function enableBFSJointRL() {
    setJointRLImplementation('bfs');
}

// ===============================================================================================
// CONVENIENCE FUNCTIONS
// ===============================================================================================

function setRLAgentIndividual() {
    setRLAgentType('individual');
}

function setRLAgentJoint() {
    setRLAgentType('joint');
}

// ===============================================================================================
// EXPORTS
// ===============================================================================================

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getAIAction,
        getIndividualRLAction,
        getSoftmaxOptimalJointRLAction,
        getSoftmaxBFSJointRLAction,
        setRLAgentType,
        setRLAgentIndividual,
        setRLAgentJoint,
        updateRLAgentConfig,
        getRLAgentType,
        getRLAgentConfig,
        setJointRLImplementation,
        getJointRLImplementation,
        enableOriginalJointRL,
        enableBFSJointRL,
        RL_AGENT_CONFIG
    };
}

// Create window.RLAgent object for browser environment
if (typeof window !== 'undefined') {
    window.RLAgent = {
        getAIAction,
        getIndividualRLAction,
        getSoftmaxOptimalJointRLAction,
        getSoftmaxBFSJointRLAction,
        setRLAgentType,
        setRLAgentIndividual,
        setRLAgentJoint,
        updateRLAgentConfig,
        getRLAgentType,
        getRLAgentConfig,
        setJointRLImplementation,
        getJointRLImplementation,
        enableOriginalJointRL,
        enableBFSJointRL,
        RL_AGENT_CONFIG
    };
}






