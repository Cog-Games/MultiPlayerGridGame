// Reference configuration and fast planner copied verbatim from kid-SA rlAgent.js.
// Despite useUnshapedJointRL in its metadata, the deployed planner has proximity reward 0.02.
var RL_AGENT_CONFIG = {
    gridSize: 15,
    noise: 0.0,
    gamma: 0.9,
    goalReward: 30,
    stepCost: -1,  // Cost per step (negative reward for movement)
    softmaxBeta: 3.0,
    proximityRewardWeight: 0.02,  // Weight for joint Manhattan distance proximity reward
    coordinationRewardWeight: 0.02,  // Weight for coordination reward when one player is on goal
    maxPolicyIterations: 15,  // Limit iterations for faster initial policy
    progressivePolicyBuilding: true,  // Build policy progressively
    policyBuildTimeout: 10,  // Max time (ms) for initial policy build
    debugMode: false,  // Disable debug logging for performance
    useFastOptimalPolicy: false,  // Use optimized fast version (true) or original version (false)
    enablePolicyPrecalculation: false,  // Enable pre-calculation of policies for instant response
    jointRLImplementation: 'bfs',  // Choose joint RL implementation: '4action', 'original', or 'fast'
};
const getSoftmaxOptimalJointRLActionFast = (function () {
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

    // ---------- enhanced cache with LRU management ----------
    const MAX_CACHE_SIZE = 50;  // Limit cache size to prevent memory leaks
    const planners = new Map();   // key -> { Q: Float32Array, goalSet: Set, beta, lastUsed: timestamp }
    const cacheStats = { hits: 0, misses: 0, builds: 0, evictions: 0 };

    // Use global hashGoals function
    function hashGoals(goals) {
        return goals.map(g => `${g[0]},${g[1]}`).sort().join('|');
    }

    // LRU cache management
    function evictOldestCache() {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [key, planner] of planners.entries()) {
            if (planner.lastUsed < oldestTime) {
                oldestTime = planner.lastUsed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            planners.delete(oldestKey);
            cacheStats.evictions++;
        }
    }

    // ---------- OPTIMIZATION 1: Goal Distance Precomputation ----------
    function precomputeGoalDistances(goals) {
        const goalDistances = new Array(N);
        for (let pos = 0; pos < N; pos++) {
            goalDistances[pos] = new Array(goals.length);
            const r = rowOf(pos), c = colOf(pos);
            for (let g = 0; g < goals.length; g++) {
                const goal = goals[g];
                goalDistances[pos][g] = Math.abs(r - goal[0]) + Math.abs(c - goal[1]);
            }
        }
        return goalDistances;
    }



    // ---------- OPTIMIZATION 3: Optimized Value Iteration with Priority Sweeping ----------
    function buildPlannerFast(goals, beta = 1.0) {
        const startTime = performance.now();

        const goalSet = new Set(goals.map(([r, c]) => toIdx(r, c)));
        const S = N * N;                                     // 50 625 joint states
        const V = new Float32Array(S);                       // value table
        const Q = new Float32Array(S * 16);                  // Q(s, jointA) for soft‑max
        const rewardGoal = RL_AGENT_CONFIG.goalReward, stepCost = RL_AGENT_CONFIG.stepCost;
        const γ = RL_AGENT_CONFIG.gamma || 0.9;

        // OPTIMIZATION 1: Precompute all goal distances once
        const goalDistances = precomputeGoalDistances(goals);
        console.log(`⚡ Fast: Precomputed goal distances in ${(performance.now() - startTime).toFixed(1)}ms`);

        // Precompute proximity rewards cache (OPTIMIZATION 1 enhancement)
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

        console.log(`⚡ Fast: Setup completed in ${(performance.now() - startTime).toFixed(1)}ms`);

        // OPTIMIZATION 3: IMPROVED Value Iteration with proper convergence
        let Δ;
        let iterations = 0;
        const maxIterations = 100; // Increased safety limit
        const convergenceThreshold = 1e-3; // Same as original for optimality

        do {
            Δ = 0;
            iterations++;

            // OPTIMIZATION: Process states in order of potential value change
            // Use a simple heuristic: prioritize states closer to goals
            const stateOrder = [];
            for (let s = 0; s < S; s++) {
                const iAI = Math.floor(s / N);
                const iPL = s % N;

                // Skip terminal states
                if (goalSet.has(iAI) && goalSet.has(iPL) && iAI === iPL) {
                    V[s] = 0;
                    for (let j = 0; j < 16; j++) Q[s * 16 + j] = 0;
                    continue;
                }

                // Calculate heuristic priority based on distance to goals
                let minDist = Infinity;
                for (let g = 0; g < goals.length; g++) {
                    const distAI = goalDistances[iAI][g];
                    const distPL = goalDistances[iPL][g];
                    const jointDist = distAI + distPL;
                    if (jointDist < minDist) minDist = jointDist;
                }

                stateOrder.push({ state: s, priority: minDist });
            }

            // Sort by priority (closer to goals first)
            stateOrder.sort((a, b) => a.priority - b.priority);

            // Process states in priority order
            for (const { state: s } of stateOrder) {
                const iAI = Math.floor(s / N);   // AI index 0‑224
                const iPL = s % N;               // Player index 0‑224

                // Skip terminal states (already handled above)
                if (goalSet.has(iAI) && goalSet.has(iPL) && iAI === iPL) {
                    continue;
                }

                const oldV = V[s];
                let best = -Infinity;

                // Evaluate all joint actions (4x4 = 16)
                for (let aAI = 0; aAI < 4; aAI++) {
                    // If AI already on goal, it stays there
                    const nextAI = goalSet.has(iAI) ? iAI : stepIdx(iAI, aAI);

                    for (let aPL = 0; aPL < 4; aPL++) {
                        // If player already on goal, it stays there
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

                // Update value and track convergence
                V[s] = best;
                const diff = Math.abs(best - oldV);
                if (diff > Δ) Δ = diff;
            }

            // Log progress every 50 iterations
            if (iterations % 50 === 0) {
                console.log(`⚡ Fast: Iteration ${iterations}, Δ = ${Δ.toFixed(6)}`);
            }

        } while (Δ > convergenceThreshold && iterations < maxIterations);

        const endTime = performance.now();
        console.log(`✅ Fast: Value iteration converged in ${iterations} iterations, ${(endTime - startTime).toFixed(1)}ms`);
        console.log(`✅ Fast: Final Δ = ${Δ.toFixed(6)}, Convergence: ${Δ <= convergenceThreshold ? 'YES' : 'NO'}`);
        console.log(`✅ Fast: Cache stats - Proximity lookups: ${proximityCache.size}`);

        return { Q, goalSet, beta, lastUsed: Date.now() };
    }

    // ---------- public function with numerical stability improvements ----------
    return function getSoftmaxOptimalJointRLActionFast(aiState, playerState, goals, beta = null) {
        const startTime = performance.now();

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

        // Check cache with LRU management
        if (planners.has(key)) {
            const planner = planners.get(key);
            planner.lastUsed = Date.now(); // Update LRU timestamp
            cacheStats.hits++;
            console.log(`⚡ Fast: Cache hit in ${(performance.now() - startTime).toFixed(2)}ms`);
        } else {
            // Evict oldest if cache is full
            if (planners.size >= MAX_CACHE_SIZE) {
                evictOldestCache();
            }

            cacheStats.misses++;
            cacheStats.builds++;
            planners.set(key, buildPlannerFast(goals, beta));
            console.log(`⚡ Fast: New planner built in ${(performance.now() - startTime).toFixed(1)}ms`);
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
                console.log(`⚡ Fast: Action selected in ${(performance.now() - startTime).toFixed(2)}ms`);
                return selectedAction;
            }
        }

        // Fallback: return last action if numerical issues occur
        return actionSpace[actionSpace.length - 1];
    };

    // Cache statistics function for the fast version
    function getFastCacheStats() {
        return {
            ...cacheStats,
            hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100,
            totalRequests: cacheStats.hits + cacheStats.misses,
            cacheSize: planners.size,
            maxCacheSize: MAX_CACHE_SIZE
        };
    }

    // Make cache stats accessible
    if (typeof window !== 'undefined') {
        window.getFastJointRLCacheStats = getFastCacheStats;
    }
})();
export { getSoftmaxOptimalJointRLActionFast };
