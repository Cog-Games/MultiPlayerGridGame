import { RLAgent } from './RLAgent.js';
import { GameHelpers } from '../utils/GameHelpers.js';

const ACTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const SIGNAL_MODES = new Set(['logposterior', 'mixture']);

// Two-stage, continuous commitment/signaling model.
// Stage is controlled by rho_t = sigmoid(k * (max_g P_t(g) - tau)).
// Early: joint-RL over all goals, shaped toward ambiguity preservation.
// Late: mixture over goal-conditioned joint-RL policies, shaped toward signaling.
export class TwoStageSignalAgent {
  constructor(options = {}) {
    this.rl = options.rlAgent || new RLAgent();
    this.lambda = (typeof options.lambda === 'number') ? options.lambda : 0.125;
    this.tau = (typeof options.tau === 'number') ? options.tau : 0.75;
    this.alpha = (typeof options.alpha === 'number') ? options.alpha : 1.0;
    this.eta = (typeof options.eta === 'number') ? options.eta : 1.0;
    this.beta = (typeof options.beta === 'number') ? options.beta : 3.0;
    this.gateSharpness = (typeof options.gateSharpness === 'number') ? options.gateSharpness : 10.0;
    const requestedSignalMode = typeof options.signalMode === 'string'
      ? options.signalMode
      : (typeof options.score === 'string' ? options.score : 'logposterior');
    this.signalMode = SIGNAL_MODES.has(requestedSignalMode) ? requestedSignalMode : 'logposterior';
    this.eps = 1e-6;
    this.reset();
  }

  reset() {
    this._lastTrialKey = null;
    this._pIntent = null;
    this._lastObservedStep = -1;
  }

  getAIAction(gameState, trialData, aiPlayerNumber = 2) {
    const goals = Array.isArray(gameState?.currentGoals) ? gameState.currentGoals : [];
    if (!goals.length) return [0, 0];

    const selfPos = (aiPlayerNumber === 1) ? gameState?.player1 : gameState?.player2;
    const otherPos = (aiPlayerNumber === 1) ? gameState?.player2 : gameState?.player1;
    if (!selfPos || !otherPos) return [0, 0];

    const trialKey = `${String(gameState?.experimentType || '')}:${Number.isFinite(gameState?.trialIndex) ? gameState.trialIndex : 'na'}`;
    if (this._lastTrialKey !== trialKey) {
      this.reset();
      this._lastTrialKey = trialKey;
    }

    this._ensurePosterior(goals);
    this._bayesUpdateFromObservedActions(gameState, trialData, goals);

    const policy = this._twoStagePolicy(selfPos, otherPos, goals);
    this._recordPolicy(trialData, aiPlayerNumber, policy);
    return this._sampleActionFromPolicy(policy.probs);
  }

  _twoStagePolicy(selfPos, otherPos, goals) {
    const confidence = this._confidence(goals.length);
    const gate = this._sigmoid(this.gateSharpness * (confidence - this.tau));
    const early = this._earlyPolicy(selfPos, otherPos, goals);
    const goalWeights = this._goalWeights(goals, selfPos, otherPos);
    const late = this._latePolicy(selfPos, otherPos, goals, goalWeights);

    const probs = {};
    for (const action of ACTIONS) {
      const key = action.toString();
      probs[key] = ((1 - gate) * this._safeProb(early.probs[key])) + (gate * this._safeProb(late.probs[key]));
    }

    return {
      probs: this._normalizeActionMap(probs),
      early,
      late,
      goalWeights,
      confidence,
      gate,
      posterior: this._pIntent ? this._pIntent.slice() : null
    };
  }

  _earlyPolicy(selfPos, otherPos, goals) {
    const base = this.rl.getJointActionProbabilities(selfPos, otherPos, goals) || {};
    const unnormalized = {};
    const revealed = {};

    for (const action of ACTIONS) {
      const key = action.toString();
      const posterior = this._revealedPosteriorForAction(selfPos, otherPos, goals, key);
      const entropy = this._entropy(posterior);
      revealed[key] = { posterior, entropy };
      unnormalized[key] = this._safeProb(base[key]) * Math.exp(Math.max(-700, Math.min(700, this.eta * entropy)));
    }

    return {
      base,
      revealed,
      probs: this._normalizeActionMap(unnormalized)
    };
  }

  _latePolicy(selfPos, otherPos, goals, goalWeights) {
    const perGoal = [];
    const probs = Object.fromEntries(ACTIONS.map(action => [action.toString(), 0]));

    for (let g = 0; g < goals.length; g++) {
      const policy = this._signalPolicyForGoal(selfPos, otherPos, goals, g);
      perGoal[g] = policy;
      const w = goalWeights[g] || 0;
      for (const action of ACTIONS) {
        const key = action.toString();
        probs[key] += w * this._safeProb(policy.probs[key]);
      }
    }

    return {
      perGoal,
      probs: this._normalizeActionMap(probs)
    };
  }

  _signalPolicyForGoal(selfPos, otherPos, goals, goalIdx) {
    if (this.signalMode === 'mixture') {
      return this._mixtureSignalPolicyForGoal(selfPos, otherPos, goals, goalIdx);
    }

    const target = goals[goalIdx];
    const base = this.rl.getJointActionProbabilities(selfPos, otherPos, [target]) || {};
    const unnormalized = {};
    const revealed = {};

    for (const action of ACTIONS) {
      const key = action.toString();
      const posterior = this._revealedPosteriorForAction(selfPos, otherPos, goals, key);
      const targetProb = posterior[goalIdx] || 0;
      revealed[key] = {
        posterior,
        targetGoalProbability: targetProb,
        logTargetPosterior: Math.log(Math.max(this.eps, targetProb))
      };
      unnormalized[key] = this._safeProb(base[key]) * Math.exp(
        Math.max(-700, Math.min(700, this.alpha * Math.log(Math.max(this.eps, targetProb))))
      );
    }

    return {
      goalIdx,
      signalMode: this.signalMode,
      base,
      revealed,
      probs: this._normalizeActionMap(unnormalized)
    };
  }

  _mixtureSignalPolicyForGoal(selfPos, otherPos, goals, goalIdx) {
    const target = goals[goalIdx];
    const base = this.rl.getJointActionProbabilities(selfPos, otherPos, [target]) || {};
    const committedAction = this.rl.getJointRLAction(selfPos, otherPos, [target]);
    const committedKey = this._validActionKey(committedAction)
      ? committedAction.toString()
      : this._argmaxActionKey(base);

    const p = Math.max(0, Math.min(1, this.alpha));
    const dCur = GameHelpers.calculateGridDistance(selfPos, target);
    let legibleKey = null;
    let bestTargetPosterior = -1;
    const revealed = {};

    for (const action of ACTIONS) {
      const key = action.toString();
      const posterior = this._revealedPosteriorForAction(selfPos, otherPos, goals, key);
      const targetProb = posterior[goalIdx] || 0;
      const nextPos = [selfPos[0] + action[0], selfPos[1] + action[1]];
      const dNew = GameHelpers.calculateGridDistance(nextPos, target);
      const isProgress = Number.isFinite(dCur) && Number.isFinite(dNew) && dNew < dCur;
      revealed[key] = {
        posterior,
        targetGoalProbability: targetProb,
        isProgress,
        mixtureP: p
      };
      if (isProgress && targetProb > bestTargetPosterior) {
        bestTargetPosterior = targetProb;
        legibleKey = key;
      }
    }

    if (!legibleKey) legibleKey = committedKey;

    const probs = Object.fromEntries(ACTIONS.map(action => [action.toString(), 0]));
    if (committedKey && probs[committedKey] != null) probs[committedKey] += (1 - p);
    if (legibleKey && probs[legibleKey] != null) probs[legibleKey] += p;
    if (!Object.values(probs).some(v => v > 0)) {
      return {
        goalIdx,
        signalMode: this.signalMode,
        mixtureP: p,
        base,
        revealed,
        committedActionKey: committedKey,
        legibleActionKey: legibleKey,
        probs: this._normalizeActionMap(base)
      };
    }

    return {
      goalIdx,
      signalMode: this.signalMode,
      mixtureP: p,
      base,
      revealed,
      committedActionKey: committedKey,
      legibleActionKey: legibleKey,
      probs: this._normalizeActionMap(probs)
    };
  }

  _ensurePosterior(goals) {
    const n = goals.length;
    if (!this._pIntent || !Array.isArray(this._pIntent)) {
      this._pIntent = new Array(n).fill(1 / n);
      this._lastObservedStep = -1;
      return;
    }
    if (this._pIntent.length !== n) {
      this._pIntent = this._resizePosterior(this._pIntent, n);
      this._normalizePosterior(this._pIntent);
    }
  }

  _resizePosterior(oldPosterior, n) {
    const old = Array.isArray(oldPosterior) ? oldPosterior : [];
    if (!old.length) return new Array(n).fill(1 / n);

    const next = new Array(n).fill(0);
    const m = Math.min(old.length, n);
    const oldTotal = old.slice(0, m).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const added = Math.max(0, n - old.length);
    const newGoalMass = added > 0 ? added / n : 0;
    const oldMass = Math.max(0, 1 - newGoalMass);

    for (let i = 0; i < m; i++) {
      next[i] = oldTotal > 0 ? (old[i] / oldTotal) * oldMass : oldMass / m;
    }
    if (added > 0) {
      const perNewGoal = 1 / n;
      for (let i = old.length; i < n; i++) next[i] = perNewGoal;
    }
    return next;
  }

  _bayesUpdateFromObservedActions(_gameState, trialData, goals) {
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
      this._normalizePosterior(this._pIntent);
      this._lastObservedStep = t;
    }

    try {
      trialData.twoStageSignalAgentGoalPosterior = this._pIntent.slice();
    } catch (_) { /* noop */ }
  }

  _actionLikelihood(pos, otherPos, action, goal) {
    const probs = this.rl.getJointActionProbabilities(pos, otherPos, [goal]);
    const key = Array.isArray(action) ? action.toString() : String(action || '');
    return this._safeProb(probs?.[key]);
  }

  _revealedPosteriorForAction(selfPos, otherPos, goals, actionKey) {
    const out = new Array(goals.length).fill(0);
    let denom = 0;
    for (let g = 0; g < goals.length; g++) {
      const prior = Math.max(this.eps, this._pIntent?.[g] ?? (1 / goals.length));
      const probs = this.rl.getJointActionProbabilities(selfPos, otherPos, [goals[g]]) || {};
      const likelihood = this._safeProb(probs[actionKey]);
      out[g] = prior * likelihood;
      denom += out[g];
    }
    if (!Number.isFinite(denom) || denom <= 0) return new Array(goals.length).fill(1 / goals.length);
    return out.map(v => v / denom);
  }

  _goalWeights(goals, selfPos, otherPos) {
    const eus = goals.map(g => this._euJointDistance(selfPos, otherPos, g));
    const scaled = eus.map(eu => (Number.isFinite(eu) ? this.beta * eu : -Infinity));
    const finite = scaled.filter(Number.isFinite);
    const maxScaled = finite.length ? Math.max(...finite) : 0;
    const out = new Array(goals.length).fill(0);

    for (let i = 0; i < goals.length; i++) {
      const pi = (this._pIntent && this._pIntent[i] != null) ? this._pIntent[i] : (1 / goals.length);
      const euWeight = Number.isFinite(scaled[i])
        ? Math.exp(Math.max(-700, Math.min(700, scaled[i] - maxScaled)))
        : 0;
      out[i] = euWeight * Math.pow(Math.max(this.eps, pi), this.lambda);
    }

    const sum = out.reduce((a, b) => a + b, 0);
    if (Number.isFinite(sum) && sum > 0) return out.map(v => v / sum);
    return new Array(goals.length).fill(1 / goals.length);
  }

  _recordPolicy(trialData, aiPlayerNumber, policy) {
    if (!trialData) return;
    try {
      const playerPrefix = aiPlayerNumber === 1 ? 'twoStageSignalAgentPlayer1' : 'twoStageSignalAgentPlayer2';
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        posterior: policy.posterior,
        confidence: policy.confidence,
        gate: policy.gate,
        signalMode: this.signalMode,
        goalWeights: policy.goalWeights.slice(),
        actionProbabilities: { ...policy.probs },
        earlyActionProbabilities: { ...policy.early.probs },
        lateActionProbabilities: { ...policy.late.probs }
      };

      trialData.twoStageSignalAgentGoalPosterior = policy.posterior;
      trialData.twoStageSignalAgentCommitmentConfidence = policy.confidence;
      trialData.twoStageSignalAgentGate = policy.gate;
      trialData.twoStageSignalAgentGoalWeights = policy.goalWeights.slice();
      trialData.twoStageSignalAgentActionProbabilities = { ...policy.probs };
      trialData.twoStageSignalAgentSignalMode = this.signalMode;

      trialData[`${playerPrefix}GoalPosterior`] = policy.posterior;
      trialData[`${playerPrefix}CommitmentConfidence`] = policy.confidence;
      trialData[`${playerPrefix}Gate`] = policy.gate;
      trialData[`${playerPrefix}GoalWeights`] = policy.goalWeights.slice();
      trialData[`${playerPrefix}ActionProbabilities`] = { ...policy.probs };
      trialData[`${playerPrefix}SignalMode`] = this.signalMode;

      const historyKey = `${playerPrefix}History`;
      if (!Array.isArray(trialData[historyKey])) trialData[historyKey] = [];
      trialData[historyKey].push(sample);
    } catch (_) { /* noop */ }
  }

  _inferCurrentStepIndex(trialData) {
    try {
      const a1 = Array.isArray(trialData?.player1Actions) ? trialData.player1Actions.length : 0;
      const a2 = Array.isArray(trialData?.player2Actions) ? trialData.player2Actions.length : 0;
      return Math.max(a1, a2);
    } catch (_) {
      return null;
    }
  }

  _confidence(n) {
    if (!this._pIntent || !this._pIntent.length) return 1 / Math.max(1, n);
    return Math.max(...this._pIntent.map(v => Number.isFinite(v) ? v : 0));
  }

  _sigmoid(x) {
    if (x >= 0) {
      const z = Math.exp(-x);
      return 1 / (1 + z);
    }
    const z = Math.exp(x);
    return z / (1 + z);
  }

  _entropy(posterior) {
    if (!Array.isArray(posterior) || !posterior.length) return 0;
    return posterior.reduce((acc, p) => {
      const v = Math.max(this.eps, p || 0);
      return acc - (v * Math.log(v));
    }, 0);
  }

  _normalizePosterior(posterior = this._pIntent) {
    if (!Array.isArray(posterior) || !posterior.length) return;
    const sum = posterior.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    if (!Number.isFinite(sum) || sum <= 0) {
      const n = posterior.length || 1;
      for (let i = 0; i < n; i++) posterior[i] = 1 / n;
      return;
    }
    for (let i = 0; i < posterior.length; i++) posterior[i] /= sum;
  }

  _normalizeActionMap(weights) {
    const entries = Object.entries(weights);
    const sum = entries.reduce((acc, [, value]) => acc + (Number.isFinite(value) ? value : 0), 0);
    if (!Number.isFinite(sum) || sum <= 0) {
      return Object.fromEntries(ACTIONS.map(action => [action.toString(), 1 / ACTIONS.length]));
    }
    return Object.fromEntries(entries.map(([key, value]) => [key, value / sum]));
  }

  _sampleActionFromPolicy(probs) {
    const keys = ACTIONS.map(action => action.toString());
    const weights = keys.map(key => this._safeProb(probs[key]));
    const sum = weights.reduce((a, b) => a + b, 0);
    const r = Math.random() * sum;
    let acc = 0;
    for (let i = 0; i < keys.length; i++) {
      acc += weights[i];
      if (r < acc) return keys[i].split(',').map(Number);
    }
    return keys[keys.length - 1].split(',').map(Number);
  }

  _safeProb(value) {
    return (typeof value === 'number' && Number.isFinite(value) && value > 0) ? value : this.eps;
  }

  _validActionKey(action) {
    return Array.isArray(action) && ACTIONS.some(candidate => (
      candidate[0] === action[0] && candidate[1] === action[1]
    ));
  }

  _argmaxActionKey(probs = {}) {
    let bestKey = ACTIONS[0].toString();
    let bestValue = -Infinity;
    for (const action of ACTIONS) {
      const key = action.toString();
      const value = this._safeProb(probs[key]);
      if (value > bestValue) {
        bestValue = value;
        bestKey = key;
      }
    }
    return bestKey;
  }

  _euJointDistance(selfPos, otherPos, goalPos) {
    const dSelf = GameHelpers.calculateGridDistance(selfPos, goalPos);
    const dOther = GameHelpers.calculateGridDistance(otherPos, goalPos);
    const joint = dSelf + dOther;
    return Number.isFinite(joint) ? -joint : -Infinity;
  }
}
