// Intention-monitoring, role-selection, and commitment agent (JS)
// Implements a lightweight version of the model described in the attached figures:
// - Maintain a belief over partner intentions (goals)
// - Update via likelihood from observed action (moved closer to which goal)
// - Compute entropy and an approximate expected information gain (EIG)
// - Choose a role (signal-giver vs signal-waiter)
// - If belief entropy below threshold, commit to a shared intention and move toward it

export class WeIntentAgent {
  constructor(config = {}) {
    this.config = {
      betaUtility: 3.0,   // Softmax weight for utility
      alphaInfo: 2.0,     // Weight for information seeking/avoiding
      thetaRole: 1.0,     // Role selection sensitivity to EIG
      entropyCommitThreshold: 0.5, // Δ threshold to commit
      likelihoodScale: 1.0, // Likelihood scale for movement toward a goal
      ...config
    };
    this.reset();
  }

  reset() {
    this.goalKeys = [];
    this.partnerBelief = null; // { 'r,c': probability }
  }

  getNextAction(gameState, { aiPlayerNumber = 2 } = {}) {
    const { gridMatrix, currentGoals, player1, player2, trialData } = gameState || {};
    if (!Array.isArray(gridMatrix) || !Array.isArray(currentGoals) || currentGoals.length === 0) return 'right';

    const myPos = (aiPlayerNumber === 1) ? player1 : player2;
    const partnerPos = (aiPlayerNumber === 1) ? player2 : player1;
    if (!Array.isArray(myPos) || !Array.isArray(partnerPos)) return 'right';

    this.ensureBelief(currentGoals);
    this.updateBeliefFromPartnerStep(trialData, aiPlayerNumber);

    const entropyNow = this.entropy(this.goalKeys.map(k => this.partnerBelief[k]));
    if (entropyNow < this.config.entropyCommitThreshold) {
      const target = this.argmaxGoalFromBelief();
      return this.bestDirectionToward(myPos, target, gridMatrix);
    }

    // Compute role via EIG on our actions
    const actions = ['up', 'down', 'left', 'right'];
    const eigPerAction = this.estimateEigForActions(myPos, currentGoals, actions, gridMatrix);
    const eigMax = Math.max(...eigPerAction);
    const roleScore = Math.exp(this.config.thetaRole * eigMax);
    const isSignalGiver = roleScore > Math.E; // simple threshold

    // Utilities relative to MAP goal under our partner-belief
    const utility = actions.map(dir => this.utilityTowardMapGoal(myPos, dir, currentGoals, gridMatrix));
    const scores = actions.map((_, i) =>
      (isSignalGiver
        ? (this.config.betaUtility * utility[i] + this.config.alphaInfo * eigPerAction[i])
        : (this.config.betaUtility * utility[i] - this.config.alphaInfo * eigPerAction[i]))
    );
    return this.sampleSoftmax(actions, scores);
  }

  ensureBelief(goals) {
    const keys = goals.map(g => `${g[0]},${g[1]}`);
    if (!this.partnerBelief || keys.join('|') !== this.goalKeys.join('|')) {
      const p = 1 / keys.length;
      this.partnerBelief = Object.fromEntries(keys.map(k => [k, p]));
      this.goalKeys = keys;
    }
  }

  updateBeliefFromPartnerStep(trialData, aiPlayerNumber) {
    try {
      if (!trialData) return;
      const partnerIndex = (aiPlayerNumber === 1) ? 1 : 0; // 0: p1, 1: p2
      const trajectory = partnerIndex === 0 ? trialData.player1Trajectory : trialData.player2Trajectory;
      if (!Array.isArray(trajectory) || trajectory.length < 2) return;

      const prev = trajectory[trajectory.length - 2];
      const curr = trajectory[trajectory.length - 1];
      if (!Array.isArray(prev) || !Array.isArray(curr)) return;

      const likelihood = {};
      let normalizer = 0;
      for (const k of this.goalKeys) {
        const [gr, gc] = k.split(',').map(Number);
        const dPrev = Math.abs(prev[0] - gr) + Math.abs(prev[1] - gc);
        const dCurr = Math.abs(curr[0] - gr) + Math.abs(curr[1] - gc);
        const delta = dPrev - dCurr; // moved closer => positive
        const L = Math.exp(this.config.likelihoodScale * delta);
        likelihood[k] = L; normalizer += L;
      }
      // Bayes update
      let sum = 0;
      for (const k of this.goalKeys) {
        const prior = this.partnerBelief[k] ?? (1 / this.goalKeys.length);
        const like = normalizer > 0 ? likelihood[k] / normalizer : 1 / this.goalKeys.length;
        this.partnerBelief[k] = prior * like; sum += this.partnerBelief[k];
      }
      for (const k of this.goalKeys) this.partnerBelief[k] /= (sum || 1);
    } catch (_) { /* best effort */ }
  }

  estimateEigForActions(myPos, goals, actions, grid) {
    const entropyBefore = this.entropy(this.goalKeys.map(k => this.partnerBelief[k]));
    return actions.map(dir => {
      const myNext = this.applyAction(myPos, dir, grid);
      // Use our next-step as if we were revealing our intention; compute posterior of our own intention
      let norm = 0; const weights = [];
      for (const g of goals) {
        const d0 = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
        const d1 = Math.abs(myNext[0] - g[0]) + Math.abs(myNext[1] - g[1]);
        const delta = d0 - d1;
        const w = Math.exp(this.config.likelihoodScale * delta);
        weights.push(w); norm += w;
      }
      const probs = weights.map(w => w / (norm || 1));
      const entropyAfter = this.entropy(probs);
      return Math.max(0, entropyBefore - entropyAfter);
    });
  }

  utilityTowardMapGoal(myPos, dir, goals, grid) {
    const likely = this.argmaxGoalFromBelief();
    const next = this.applyAction(myPos, dir, grid);
    const d0 = Math.abs(myPos[0] - likely[0]) + Math.abs(myPos[1] - likely[1]);
    const d1 = Math.abs(next[0] - likely[0]) + Math.abs(next[1] - likely[1]);
    return d0 - d1; // positive is progress
  }

  argmaxGoalFromBelief() {
    let bestKey = this.goalKeys[0];
    let bestVal = -Infinity;
    for (const k of this.goalKeys) {
      const v = this.partnerBelief[k];
      if (v > bestVal) { bestVal = v; bestKey = k; }
    }
    return bestKey.split(',').map(Number);
  }

  entropy(probabilities) {
    let H = 0;
    for (const p of probabilities) if (p > 0) H -= p * Math.log(p);
    return H;
  }

  applyAction(pos, dir, grid) {
    const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const move = deltas[dir] || [0, 1];
    const nr = pos[0] + move[0];
    const nc = pos[1] + move[1];
    if (!this.inBounds(grid, nr, nc) || grid[nr][nc] === 4) return pos;
    return [nr, nc];
  }

  inBounds(grid, r, c) { return Array.isArray(grid) && r >= 0 && c >= 0 && r < grid.length && c < grid[0].length; }

  bestDirectionToward(pos, goal, grid) {
    const options = ['up', 'down', 'left', 'right'];
    let bestDir = 'right';
    let bestGain = -Infinity;
    for (const dir of options) {
      const next = this.applyAction(pos, dir, grid);
      const d0 = Math.abs(pos[0] - goal[0]) + Math.abs(pos[1] - goal[1]);
      const d1 = Math.abs(next[0] - goal[0]) + Math.abs(next[1] - goal[1]);
      const gain = d0 - d1;
      if (gain > bestGain) { bestGain = gain; bestDir = dir; }
    }
    return bestDir;
  }

  sampleSoftmax(actions, scores) {
    const maxS = Math.max(...scores);
    const prefs = scores.map(s => Math.exp(s - maxS));
    const sum = prefs.reduce((a,b) => a + b, 0) || 1;
    let r = Math.random();
    let acc = 0;
    for (let i = 0; i < prefs.length; i++) { acc += prefs[i] / sum; if (r <= acc) return actions[i]; }
    return actions[actions.length - 1];
  }
}

