import { RLAgent } from './RLAgent.js';
import { GameHelpers } from '../utils/GameHelpers.js';

// Bayesian goal selection with one-parameter commitment bias.
// - Maintain P_intent(goal) inferred from observed actions using RL policy likelihood.
// - Combine with EU to sample goals: P(goal) ∝ Softmax(EU(goal)) * P_intent(goal)
// - After joint goal detected and a new goal appears, bias toward the old joint goal with:
//     P(choose_old)=σ(logit(0.8) + κ * ΔS)
//   where ΔS compares old vs best alternative using S(g)=EU(g)+log P_intent(g).
// - Before joint detection/new-goal, act using joint-RL policy.

export class CommittedAgent {
  constructor(options = {}) {
    this.rl = options.rlAgent || new RLAgent();
    // Single free commitment parameter (sensitivity). logit(0.8) is fixed.
    this.kappa = (typeof options.kappa === 'number') ? options.kappa : 0.5;
    // Non-free constants (can be adjusted later but not fit as "commitment" params)
    this.eps = 1e-6;
    this.euBeta = 1.0; // softmax temperature for EU weighting
    this.reset();
  }

  reset() {
    this._detectedJointGoalIdx = null; // old joint goal index
    this._jointDetectedAtStep = null; // index in action history when first detected
    this._lastTrialKey = null;

    // Bayesian posterior over current goals, stored as array aligned with currentGoals indices
    this._pIntent = null;
    // Track how many action-steps we've already incorporated into posterior
    this._lastObservedStep = -1;
  }

  /**
   * Main entry point used by ExperimentManager.
   * Returns an ACTION delta [dRow, dCol] (same format as RLAgent.getAIAction).
   */
  getAIAction(gameState, trialData, aiPlayerNumber = 2) {
    const goals = Array.isArray(gameState?.currentGoals) ? gameState.currentGoals : [];
    if (!goals.length) return [0, 0];

    const aiPos = (aiPlayerNumber === 1) ? gameState?.player1 : gameState?.player2;
    const humanPos = (aiPlayerNumber === 1) ? gameState?.player2 : gameState?.player1;
    if (!aiPos || !humanPos) return [0, 0];

    // Reset when trial changes (best-effort). trialIndex alone is ambiguous across experiment types,
    // so include experimentType as a key.
    const trialKey = `${String(gameState?.experimentType || '')}:${Number.isFinite(gameState?.trialIndex) ? gameState.trialIndex : 'na'}`;
    if (this._lastTrialKey !== trialKey) {
      this.reset();
      this._lastTrialKey = trialKey;
    }

    // Keep internal posterior shape aligned with current goals
    this._ensurePosterior(goals);

    // Update joint-goal detection state
    this._maybeUpdateDetectedJointGoalIdx(trialData);

    // Bayesian update from newly observed actions (both players if available)
    this._bayesUpdateFromObservedActions(gameState, trialData, goals);

    const hasNewGoal = !!trialData?.newGoalPresented && goals.length >= 3;
    const jointDetected = Number.isInteger(this._detectedJointGoalIdx) && this._detectedJointGoalIdx >= 0;

    // Before joint detection/new-goal, keep using joint-RL for movement (legacy behavior)
    if (!hasNewGoal || !jointDetected) {
      return this.rl.getAIAction(
        gameState?.gridMatrix,
        aiPos,
        goals,
        humanPos,
        { forceJoint: true }
      );
    }

    // After joint detection + new-goal: sample a goal using Bayes+EU + commitment bias
    const goalIdx = this._sampleGoalIndexWithCommitmentBias(goals, aiPos, humanPos);
    const goal = goals[goalIdx];
    if (!Array.isArray(goal) || goal.length < 2) return [0, 0];

    // Act using goal-conditioned RL toward sampled goal
    return this.rl.getIndividualRLAction(aiPos, [goal]);
  }

  _maybeUpdateDetectedJointGoalIdx(trialData) {
    // Prefer GameStateManager's computed shared-goal marker (2P3G).
    const shared = trialData?.firstDetectedSharedGoal;
    if (Number.isInteger(shared) && shared >= 0) {
      if (this._detectedJointGoalIdx == null) {
        this._jointDetectedAtStep = this._inferCurrentStepIndex(trialData);
      }
      this._detectedJointGoalIdx = shared;
      return;
    }

    // Fallback: if both players' last inferred goals match, treat as a detected joint goal.
    try {
      const p1Hist = trialData?.player1CurrentGoal;
      const p2Hist = trialData?.player2CurrentGoal;
      const p1g = Array.isArray(p1Hist) && p1Hist.length ? p1Hist[p1Hist.length - 1] : null;
      const p2g = Array.isArray(p2Hist) && p2Hist.length ? p2Hist[p2Hist.length - 1] : null;
      if (Number.isInteger(p1g) && Number.isInteger(p2g) && p1g === p2g) {
        if (this._detectedJointGoalIdx == null) {
          this._jointDetectedAtStep = this._inferCurrentStepIndex(trialData);
        }
        this._detectedJointGoalIdx = p1g;
      }
    } catch (_) { /* noop */ }
  }

  _inferCurrentStepIndex(trialData) {
    try {
      const a1 = Array.isArray(trialData?.player1Actions) ? trialData.player1Actions.length : 0;
      const a2 = Array.isArray(trialData?.player2Actions) ? trialData.player2Actions.length : 0;
      return Math.max(a1, a2) - 1;
    } catch (_) {
      return null;
    }
  }

  _ensurePosterior(goals) {
    const n = goals.length;
    if (!this._pIntent || !Array.isArray(this._pIntent)) {
      this._pIntent = new Array(n).fill(1 / n);
      this._lastObservedStep = -1;
      return;
    }
    if (this._pIntent.length !== n) {
      const old = this._pIntent;
      const next = new Array(n).fill(0);
      const m = Math.min(old.length, n);
      for (let i = 0; i < m; i++) next[i] = old[i];
      // For newly added goals, initialize with small uniform mass
      if (n > old.length) {
        const fill = 1 / n;
        for (let i = old.length; i < n; i++) next[i] = fill;
      }
      this._pIntent = next;
      this._normalizePosterior();
    }
  }

  _bayesUpdateFromObservedActions(gameState, trialData, goals) {
    if (!trialData) return;
    const p1A = Array.isArray(trialData.player1Actions) ? trialData.player1Actions : [];
    const p2A = Array.isArray(trialData.player2Actions) ? trialData.player2Actions : [];
    const p1T = Array.isArray(trialData.player1Trajectory) ? trialData.player1Trajectory : [];
    const p2T = Array.isArray(trialData.player2Trajectory) ? trialData.player2Trajectory : [];

    const maxSteps = Math.max(p1A.length, p2A.length);
    if (maxSteps <= 0) return;

    for (let t = this._lastObservedStep + 1; t < maxSteps; t++) {
      // For each goal, multiply by likelihood from whichever actions exist at t
      for (let g = 0; g < goals.length; g++) {
        let like = 1.0;
        const goal = goals[g];
        if (Array.isArray(p1A[t]) && Array.isArray(p1T[t])) {
          like *= this._actionLikelihood(p1T[t], p1A[t], goal);
        }
        if (Array.isArray(p2A[t]) && Array.isArray(p2T[t])) {
          like *= this._actionLikelihood(p2T[t], p2A[t], goal);
        }
        this._pIntent[g] *= like;
      }
      this._normalizePosterior();
      this._lastObservedStep = t;
    }

    // Best-effort: expose current posterior for logging/analysis
    try {
      trialData.goalPosterior = this._pIntent.slice();
    } catch (_) { /* noop */ }
  }

  _actionLikelihood(pos, action, goal) {
    const probs = this.rl.getIndividualActionProbabilities(pos, goal);
    const key = Array.isArray(action) ? action.toString() : String(action || '');
    const p = probs && typeof probs === 'object' ? probs[key] : null;
    if (typeof p === 'number' && isFinite(p) && p > 0) return p;
    // If action isn't in policy (e.g., [0,0]) use a small floor
    return this.eps;
  }

  _normalizePosterior() {
    const sum = this._pIntent.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
    if (!isFinite(sum) || sum <= 0) {
      const n = this._pIntent.length || 1;
      this._pIntent = new Array(n).fill(1 / n);
      return;
    }
    for (let i = 0; i < this._pIntent.length; i++) this._pIntent[i] = this._pIntent[i] / sum;
  }

  _sampleGoalIndexWithCommitmentBias(goals, aiPos, humanPos) {
    const weights = this._combinedWeights(goals, aiPos, humanPos);
    const oldIdx = this._detectedJointGoalIdx;
    const validOld = Number.isInteger(oldIdx) && oldIdx >= 0 && oldIdx < goals.length;

    if (!validOld) {
      return this._sampleFromWeights(weights);
    }

    // Commitment-biased selection toward old goal
    const logit08 = Math.log(0.8 / 0.2);
    const sigmoid = (x) => 1 / (1 + Math.exp(-x));

    const score = (i) => {
      const eu = this._euJointDistance(aiPos, humanPos, goals[i]);
      const pi = (this._pIntent && this._pIntent[i] != null) ? this._pIntent[i] : (1 / goals.length);
      return eu + Math.log(Math.max(this.eps, pi));
    };

    let bestOther = -Infinity;
    for (let i = 0; i < goals.length; i++) {
      if (i === oldIdx) continue;
      const s = score(i);
      if (s > bestOther) bestOther = s;
    }
    const deltaS = score(oldIdx) - bestOther;
    const pOld = sigmoid(logit08 + this.kappa * deltaS);

    const chooseOld = Math.random() < pOld;
    if (chooseOld) return oldIdx;

    // Else sample among remaining goals proportional to weights
    const w2 = weights.slice();
    w2[oldIdx] = 0;
    return this._sampleFromWeights(w2);
  }

  _combinedWeights(goals, aiPos, humanPos) {
    // Softmax(EU) * P_intent
    const eus = goals.map(g => this._euJointDistance(aiPos, humanPos, g));
    const euW = this._softmax(eus, this.euBeta);
    const out = new Array(goals.length).fill(0);
    for (let i = 0; i < goals.length; i++) {
      const pi = (this._pIntent && this._pIntent[i] != null) ? this._pIntent[i] : (1 / goals.length);
      out[i] = (euW[i] || 0) * pi;
    }
    // Normalize weights to sum to 1 for sampling
    const sum = out.reduce((a, b) => a + b, 0) || 0;
    if (sum > 0) return out.map(w => w / sum);
    return new Array(goals.length).fill(1 / goals.length);
  }

  _softmax(values, beta = 1.0) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const maxV = Math.max(...values.filter(v => isFinite(v)));
    const exps = values.map(v => {
      if (!isFinite(v)) return 0;
      const z = beta * (v - maxV);
      const clipped = Math.max(-700, Math.min(700, z));
      return Math.exp(clipped);
    });
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    return exps.map(e => e / sum);
  }

  _sampleFromWeights(weights) {
    const sum = weights.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
    if (!isFinite(sum) || sum <= 0) return 0;
    const r = Math.random() * sum;
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r < acc) return i;
    }
    return weights.length - 1;
  }

  _euJointDistance(aiPos, humanPos, goalPos) {
    // EU is defined from joint distances; higher EU should mean better.
    // We use negative joint Manhattan distance so closer goals yield higher EU.
    const dAi = GameHelpers.calculateGridDistance(aiPos, goalPos);
    const dHu = GameHelpers.calculateGridDistance(humanPos, goalPos);
    const joint = dAi + dHu;
    if (!Number.isFinite(joint)) return -Infinity;
    return -joint;
  }
}


