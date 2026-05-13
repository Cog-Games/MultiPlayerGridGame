import { RLAgent } from '../../client/src/ai/RLAgent.js';
import { GameHelpers } from '../../client/src/utils/GameHelpers.js';

// Experimental legacy variant.
// Unlike the main CommittedAgent, this class re-samples a joint goal at every
// post-new-goal step. Optional posterior lock-in can be enabled with
// lockInAfterSteps and lockThreshold.
export class CommittedAgentEveryStepExperimental {
  constructor(options = {}) {
    this.rl = options.rlAgent || new RLAgent();
    this.lambda = (typeof options.lambda === 'number') ? options.lambda : 1.0;
    this.beta = (typeof options.beta === 'number') ? options.beta : 1.0;
    this.lockInAfterSteps = Number.isFinite(options.lockInAfterSteps) ? options.lockInAfterSteps : null;
    this.lockThreshold = Number.isFinite(options.lockThreshold) ? options.lockThreshold : null;
    this.eps = 1e-6;
    this.reset();
  }

  reset() {
    this._detectedJointGoalIdx = null;
    this._jointDetectedAtStep = null;
    this._lastTrialKey = null;
    this._pIntent = null;
    this._lastObservedStep = -1;
    this._lockedGoalIdx = null;
    this._lockedAtStep = null;
  }

  getAIAction(gameState, trialData, aiPlayerNumber = 2) {
    const goals = Array.isArray(gameState?.currentGoals) ? gameState.currentGoals : [];
    if (!goals.length) return [0, 0];

    const aiPos = (aiPlayerNumber === 1) ? gameState?.player1 : gameState?.player2;
    const humanPos = (aiPlayerNumber === 1) ? gameState?.player2 : gameState?.player1;
    if (!aiPos || !humanPos) return [0, 0];

    const trialKey = `${String(gameState?.experimentType || '')}:${Number.isFinite(gameState?.trialIndex) ? gameState.trialIndex : 'na'}`;
    if (this._lastTrialKey !== trialKey) {
      this.reset();
      this._lastTrialKey = trialKey;
    }

    this._ensurePosterior(goals);
    this._maybeUpdateDetectedJointGoalIdx(trialData);
    this._bayesUpdateFromObservedActions(gameState, trialData, goals);

    const hasNewGoal = !!trialData?.newGoalPresented && goals.length >= 3;
    const jointDetected = Number.isInteger(this._detectedJointGoalIdx) && this._detectedJointGoalIdx >= 0;
    if (!hasNewGoal || !jointDetected) {
      return this.rl.getAIAction(gameState?.gridMatrix, aiPos, goals, humanPos);
    }

    const weights = this._combinedWeights(goals, aiPos, humanPos);
    const lockDecision = this._maybeLockGoal(trialData);
    const goalIdx = Number.isInteger(this._lockedGoalIdx)
      ? this._lockedGoalIdx
      : this._sampleFromWeights(weights);

    try {
      const playerPrefix = aiPlayerNumber === 1 ? 'committedAgentPlayer1' : 'committedAgentPlayer2';
      const posterior = this._pIntent ? this._pIntent.slice() : null;
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        goal: goalIdx,
        posterior,
        weights: weights.slice(),
        lockedGoal: this._lockedGoalIdx,
        lockedAtStep: this._lockedAtStep,
        lockDecision,
        experimentalVariant: 'every_step_resampling'
      };
      trialData.committedAgentSampledJointGoal = goalIdx;
      trialData.committedAgentSampledJointGoalPosterior = posterior;
      trialData.committedAgentSampledJointGoalWeights = weights.slice();
      trialData.committedAgentLockedJointGoal = this._lockedGoalIdx;
      trialData.committedAgentLockedAtStep = this._lockedAtStep;
      trialData[`${playerPrefix}SampledJointGoal`] = goalIdx;
      trialData[`${playerPrefix}SampledJointGoalPosterior`] = posterior;
      trialData[`${playerPrefix}SampledJointGoalWeights`] = weights.slice();
      trialData[`${playerPrefix}LockedJointGoal`] = this._lockedGoalIdx;
      trialData[`${playerPrefix}LockedAtStep`] = this._lockedAtStep;
      const historyKey = `${playerPrefix}SampledJointGoalHistory`;
      if (!Array.isArray(trialData[historyKey])) trialData[historyKey] = [];
      trialData[historyKey].push(sample);
    } catch (_) {
      // Logging should never block action generation.
    }

    const goal = goals[goalIdx];
    if (!Array.isArray(goal) || goal.length < 2) return [0, 0];
    return this.rl.getJointRLAction(aiPos, humanPos, [goal]);
  }

  _maybeUpdateDetectedJointGoalIdx(trialData) {
    const shared = trialData?.firstDetectedSharedGoal;
    if (Number.isInteger(shared) && shared >= 0) {
      if (this._detectedJointGoalIdx == null) {
        this._jointDetectedAtStep = this._inferCurrentStepIndex(trialData);
      }
      this._detectedJointGoalIdx = shared;
      return;
    }

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
    } catch (_) {
      // noop
    }
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
      for (let g = 0; g < goals.length; g++) {
        let like = 1.0;
        const goal = goals[g];
        if (Array.isArray(p1A[t]) && Array.isArray(p1T[t]) && Array.isArray(p2T[t])) {
          like *= this._actionLikelihood(p1T[t], p2T[t], p1A[t], goal);
        }
        if (Array.isArray(p2A[t]) && Array.isArray(p2T[t]) && Array.isArray(p1T[t])) {
          like *= this._actionLikelihood(p2T[t], p1T[t], p2A[t], goal);
        }
        this._pIntent[g] *= like;
      }
      this._normalizePosterior();
      this._lastObservedStep = t;
    }

    try {
      trialData.goalPosterior = this._pIntent.slice();
    } catch (_) {
      // noop
    }
  }

  _actionLikelihood(pos, otherPos, action, goal) {
    const probs = this.rl.getJointActionProbabilities(pos, otherPos, [goal]);
    const key = Array.isArray(action) ? action.toString() : String(action || '');
    const p = probs && typeof probs === 'object' ? probs[key] : null;
    if (typeof p === 'number' && isFinite(p) && p > 0) return p;
    return this.eps;
  }

  _normalizePosterior() {
    const sum = this._pIntent.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
    if (!isFinite(sum) || sum <= 0) {
      const n = this._pIntent.length || 1;
      this._pIntent = new Array(n).fill(1 / n);
      return;
    }
    for (let i = 0; i < this._pIntent.length; i++) this._pIntent[i] /= sum;
  }

  _combinedWeights(goals, aiPos, humanPos) {
    const eus = goals.map((g) => this._euJointDistance(aiPos, humanPos, g));
    const scaled = eus.map((eu) => (isFinite(eu) ? this.beta * eu : -Infinity));
    const finiteScaled = scaled.filter((v) => isFinite(v));
    const maxScaled = finiteScaled.length ? Math.max(...finiteScaled) : 0;
    const out = new Array(goals.length).fill(0);
    for (let i = 0; i < goals.length; i++) {
      const pi = (this._pIntent && this._pIntent[i] != null) ? this._pIntent[i] : (1 / goals.length);
      const euWeight = isFinite(scaled[i]) ? Math.exp(Math.max(-700, Math.min(700, scaled[i] - maxScaled))) : 0;
      out[i] = euWeight * Math.pow(Math.max(this.eps, pi), this.lambda);
    }
    const sum = out.reduce((a, b) => a + b, 0) || 0;
    if (sum > 0) return out.map(w => w / sum);
    return new Array(goals.length).fill(1 / goals.length);
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

  _maybeLockGoal(trialData) {
    if (Number.isInteger(this._lockedGoalIdx)) {
      return { locked: true, reason: 'already_locked', goal: this._lockedGoalIdx };
    }
    if (!Number.isFinite(this.lockInAfterSteps) || !Number.isFinite(this.lockThreshold)) {
      return { locked: false, reason: 'disabled' };
    }
    const newGoalTime = Number.isFinite(trialData?.newGoalPresentedTime)
      ? trialData.newGoalPresentedTime
      : null;
    if (newGoalTime == null || !Array.isArray(this._pIntent) || !this._pIntent.length) {
      return { locked: false, reason: 'not_ready' };
    }

    const decisionStep = this._inferCurrentDecisionStep(trialData);
    const stepsSinceNewGoal = decisionStep - newGoalTime;
    if (stepsSinceNewGoal < this.lockInAfterSteps) {
      return { locked: false, reason: 'sampling_window', stepsSinceNewGoal };
    }

    let bestIdx = 0;
    let bestP = -Infinity;
    for (let i = 0; i < this._pIntent.length; i++) {
      const p = this._pIntent[i];
      if (Number.isFinite(p) && p > bestP) {
        bestP = p;
        bestIdx = i;
      }
    }
    if (bestP >= this.lockThreshold) {
      this._lockedGoalIdx = bestIdx;
      this._lockedAtStep = decisionStep;
      return { locked: true, reason: 'posterior_threshold', goal: bestIdx, posterior: bestP, stepsSinceNewGoal };
    }
    return { locked: false, reason: 'below_threshold', posterior: bestP, stepsSinceNewGoal };
  }

  _inferCurrentDecisionStep(trialData) {
    try {
      const a1 = Array.isArray(trialData?.player1Actions) ? trialData.player1Actions.length : 0;
      const a2 = Array.isArray(trialData?.player2Actions) ? trialData.player2Actions.length : 0;
      return Math.max(a1, a2);
    } catch (_) {
      return 0;
    }
  }

  _euJointDistance(aiPos, humanPos, goalPos) {
    const dAi = GameHelpers.calculateGridDistance(aiPos, goalPos);
    const dHu = GameHelpers.calculateGridDistance(humanPos, goalPos);
    const joint = dAi + dHu;
    if (!Number.isFinite(joint)) return -Infinity;
    return -joint;
  }
}
