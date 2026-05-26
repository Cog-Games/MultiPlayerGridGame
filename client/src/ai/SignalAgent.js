import { CommittedAgent } from './CommittedAgent.js';

const ACTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const SCORE_KINDS = new Set([
  'margin',
  'logposterior',
  'logodds',
  'costly_mixture',
  'mixture',
  'opportunity_costly_mixture',
  'goal_contrast',
  'one_step_deliberate'
]);

export class SignalAgent extends CommittedAgent {
  constructor(options = {}) {
    super({
      ...options,
      lambda: (typeof options.lambda === 'number') ? options.lambda : 0.125,
      beta: (typeof options.beta === 'number') ? options.beta : 3.0
    });
    this.alpha = (typeof options.alpha === 'number') ? options.alpha : 0.0;
    const requested = typeof options.score === 'string' ? options.score : null;
    this.scoreKind = SCORE_KINDS.has(requested) ? requested : 'logposterior';
    // Trajectory-level legibility horizon. H=1 reduces to single-step; H>1 enables
    // multi-step planning where costly first moves can pay off via crisper later disambiguation.
    this.horizon = Math.max(1, Math.floor(options.horizon ?? 1));
    // Grid bounds for clipping rolled-out states (assumes square grid, 0-indexed positions).
    this.gridSize = Math.max(1, Math.floor(options.gridSize ?? 15));
    this.useUnshapedJointRL = options.useUnshapedJointRL === true;
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
      return this.rl.getAIAction(
        gameState?.gridMatrix,
        aiPos,
        goals,
        humanPos
      );
    }

    // Signaling targets WHATEVER goal this agent is heading to, sampled the same way
    // CommittedAgent picks its movement target (W_lambda(g) ∝ exp(beta*EU(g)) * P(g)^lambda).
    // The target may be the prior shared goal, the new goal, or the other old goal — the
    // legibility wrapper applies regardless. This decouples signaling from commitment.
    const goalWeights = this._combinedWeights(goals, aiPos, humanPos);
    const targetGoalIdx = this._sampleFromWeights(goalWeights);
    const targetGoal = goals[targetGoalIdx];
    if (!Array.isArray(targetGoal) || targetGoal.length < 2) return [0, 0];

    if (this.scoreKind === 'mixture') {
      return this._mixtureAction(aiPos, humanPos, goals, targetGoalIdx, targetGoal, trialData, aiPlayerNumber, goalWeights);
    }

    const actionPolicy = (this.horizon > 1)
      ? this._signalActionPolicyTrajectory(aiPos, humanPos, goals, targetGoalIdx)
      : this._signalActionPolicy(aiPos, humanPos, goals, targetGoalIdx, null, trialData);
    this._recordSignalSample(trialData, aiPlayerNumber, targetGoalIdx, goalWeights, actionPolicy);
    return this._sampleActionFromPolicy(actionPolicy.probs);
  }

  // Bernoulli mixture: with probability p, override CommittedAgent's action with the
  // most-legible progress action toward the same target g*. p = clip(this.alpha, 0, 1).
  // p=0 reduces exactly to CommittedAgent (target sampling, action argmax). p=1 always
  // takes the legibility-maximizing progress action. Commitment is preserved because
  // both branches strictly reduce distance to the same g*.
  _mixtureAction(aiPos, humanPos, goals, targetGoalIdx, targetGoal, trialData, aiPlayerNumber, goalWeights) {
    const p = Math.max(0, Math.min(1, this.alpha));
    const committedAction = this.rl.getJointRLAction(aiPos, humanPos, [targetGoal]);

    const dCur = Math.abs(aiPos[0] - targetGoal[0]) + Math.abs(aiPos[1] - targetGoal[1]);
    let legAction = null;
    let bestProb = -1;
    let legPosteriorAtTarget = null;
    for (const action of ACTIONS) {
      const dNew = Math.abs(aiPos[0] + action[0] - targetGoal[0]) + Math.abs(aiPos[1] + action[1] - targetGoal[1]);
      if (dNew >= dCur) continue;
      const posterior = this._revealedPosteriorForAction(aiPos, humanPos, goals, action.toString());
      const targetProb = posterior[targetGoalIdx] || 0;
      if (targetProb > bestProb) {
        bestProb = targetProb;
        legAction = action;
        legPosteriorAtTarget = targetProb;
      }
    }

    const useLeg = legAction !== null && Math.random() < p;
    const chosen = useLeg ? legAction : committedAction;

    try {
      const playerPrefix = aiPlayerNumber === 1 ? 'signalAgentPlayer1' : 'signalAgentPlayer2';
      trialData[`${playerPrefix}SampledJointGoal`] = targetGoalIdx;
      trialData[`${playerPrefix}SampledJointGoalWeights`] = goalWeights.slice();
      trialData[`${playerPrefix}MixtureP`] = p;
      trialData[`${playerPrefix}MixturePicked`] = useLeg ? 'legibility' : 'committed';
      trialData[`${playerPrefix}LegActionTargetPosterior`] = legPosteriorAtTarget;
      trialData.signalAgentSampledJointGoal = targetGoalIdx;
      trialData.signalAgentSampledJointGoalWeights = goalWeights.slice();
    } catch (_) { /* noop */ }

    return chosen;
  }

  // Trajectory-level legibility (Dragan-style RSA over plans).
  // Score:  log π(a | g*) = log π_base(a | g*) + α · Σ_t log P_t(g* | a_{t0:t})
  // where P_t is the listener's posterior after observing the action prefix, with
  // states rolled forward via grid dynamics and partner held frozen at humanPos.
  // Marginalizes over future actions to give a first-action distribution.
  _signalActionPolicyTrajectory(aiPos, humanPos, goals, targetGoalIdx) {
    const H = this.horizon;
    const eps = (typeof this.eps === 'number' && this.eps > 0) ? this.eps : 1e-12;
    const numGoals = goals.length;
    const numActions = ACTIONS.length;
    const numSeqs = Math.pow(numActions, H);
    const gridMax = Math.max(0, this.gridSize - 1);
    const clip = (v) => Math.max(0, Math.min(gridMax, v));

    const logPrior = new Array(numGoals);
    for (let g = 0; g < numGoals; g++) {
      const p = Math.max(eps, (this._pIntent && this._pIntent[g] != null) ? this._pIntent[g] : (1 / numGoals));
      logPrior[g] = Math.log(p);
    }

    const policyCache = new Map();
    const getPolicy = (pos, g) => {
      const key = `${pos[0]},${pos[1]}|${g}`;
      let pol = policyCache.get(key);
      if (!pol) {
        pol = this._goalActionProbabilities(pos, humanPos, goals[g]);
        policyCache.set(key, pol);
      }
      return pol;
    };

    const seqScores = new Array(numSeqs);
    const seqFirstAction = new Array(numSeqs);

    for (let seqIdx = 0; seqIdx < numSeqs; seqIdx++) {
      let q = seqIdx;
      const actionSeq = new Array(H);
      for (let h = 0; h < H; h++) {
        actionSeq[h] = q % numActions;
        q = Math.floor(q / numActions);
      }
      seqFirstAction[seqIdx] = actionSeq[0];

      let r = aiPos[0];
      let c = aiPos[1];
      const logLikelihood = new Array(numGoals).fill(0);
      let logLegibility = 0;

      for (let t = 0; t < H; t++) {
        const aIdx = actionSeq[t];
        const action = ACTIONS[aIdx];
        const actionKey = `${action[0]},${action[1]}`;
        const pos = [r, c];

        for (let g = 0; g < numGoals; g++) {
          const pol = getPolicy(pos, g);
          const p = this._safeProb(pol[actionKey]);
          logLikelihood[g] += Math.log(Math.max(eps, p));
        }

        // log P_{t+1}(g*) ∝ logPrior[g*] + logLikelihood[g*]
        let maxLog = -Infinity;
        for (let g = 0; g < numGoals; g++) {
          const v = logPrior[g] + logLikelihood[g];
          if (v > maxLog) maxLog = v;
        }
        let sumExp = 0;
        for (let g = 0; g < numGoals; g++) {
          sumExp += Math.exp(logPrior[g] + logLikelihood[g] - maxLog);
        }
        const logZ = maxLog + Math.log(sumExp);
        logLegibility += (logPrior[targetGoalIdx] + logLikelihood[targetGoalIdx]) - logZ;

        r = clip(r + action[0]);
        c = clip(c + action[1]);
      }

      const logBase = logLikelihood[targetGoalIdx];
      seqScores[seqIdx] = logBase + this.alpha * logLegibility;
    }

    let maxS = -Infinity;
    for (let i = 0; i < numSeqs; i++) if (seqScores[i] > maxS) maxS = seqScores[i];
    const expScores = new Array(numSeqs);
    let total = 0;
    for (let i = 0; i < numSeqs; i++) {
      expScores[i] = Math.exp(Math.max(-700, Math.min(700, seqScores[i] - maxS)));
      total += expScores[i];
    }

    const probs = {};
    for (let a = 0; a < numActions; a++) probs[`${ACTIONS[a][0]},${ACTIONS[a][1]}`] = 0;
    for (let i = 0; i < numSeqs; i++) {
      probs[`${ACTIONS[seqFirstAction[i]][0]},${ACTIONS[seqFirstAction[i]][1]}`] += expScores[i];
    }
    const inv = 1 / Math.max(eps, total);
    for (const k of Object.keys(probs)) probs[k] *= inv;

    const baseAtStart = {};
    const startPol = this._goalActionProbabilities(aiPos, humanPos, goals[targetGoalIdx]);
    for (let a = 0; a < numActions; a++) {
      const k = `${ACTIONS[a][0]},${ACTIONS[a][1]}`;
      baseAtStart[k] = this._safeProb(startPol[k]);
    }

    return { base: baseAtStart, revealed: null, probs, scoreKind: 'trajectory_logposterior', horizon: H, jointPolicyKind: this._jointPolicyKind() };
  }

  _signalActionPolicy(aiPos, humanPos, goals, targetGoalIdx, posteriorOverride = null, trialData = null) {
    const base = this._goalActionProbabilities(aiPos, humanPos, goals[targetGoalIdx]);
    const revealed = {};
    const unnormalized = {};
    const eps = (typeof this.eps === 'number' && this.eps > 0) ? this.eps : 1e-12;
    let minScore = Infinity;
    let maxScore = -Infinity;

    for (const action of ACTIONS) {
      const key = action.toString();
      const baseProb = this._safeProb(base[key]);
      const posterior = this._revealedPosteriorForAction(aiPos, humanPos, goals, key, posteriorOverride);
      const targetProb = posterior[targetGoalIdx] || 0;
      const bestAlternative = posterior.reduce((best, value, idx) => (
        idx === targetGoalIdx ? best : Math.max(best, value || 0)
      ), 0);

      let score;
      if (this.scoreKind === 'margin') {
        // Max-margin: P(g* | a) - max_{g != g*} P(g | a)
        score = targetProb - bestAlternative;
      } else if (
        this.scoreKind === 'logodds' ||
        this.scoreKind === 'costly_mixture' ||
        this.scoreKind === 'opportunity_costly_mixture' ||
        this.scoreKind === 'one_step_deliberate'
      ) {
        // Costly log-odds legibility: log P(g* | a) - log Σ_{g != g*} P(g | a).
        score = Math.log(Math.max(eps, targetProb)) - Math.log(Math.max(eps, 1 - targetProb));
      } else if (this.scoreKind === 'goal_contrast') {
        const contrastIdx = this._contrastGoalIndex(targetGoalIdx, goals, posterior, trialData);
        const contrastProb = contrastIdx === targetGoalIdx ? bestAlternative : (posterior[contrastIdx] || eps);
        score = Math.log(Math.max(eps, targetProb)) - Math.log(Math.max(eps, contrastProb));
      } else {
        // Info-theoretic (RSA): log P(g* | a) = -KL(delta_{g*} || P(.|a))
        score = Math.log(Math.max(eps, targetProb));
      }
      minScore = Math.min(minScore, score);
      maxScore = Math.max(maxScore, score);

      revealed[key] = {
        posterior,
        targetGoalProbability: targetProb,
        bestAlternativeProbability: bestAlternative,
        ambiguityMargin: targetProb - bestAlternative,
        logTargetPosterior: Math.log(Math.max(eps, targetProb)),
        logTargetOdds: Math.log(Math.max(eps, targetProb)) - Math.log(Math.max(eps, 1 - targetProb)),
        score,
        scoreKind: this.scoreKind
      };
      const scoreWeight = this._usesMixtureWithUnitCommunicativePolicy() ? 1 : this.alpha;
      unnormalized[key] = baseProb * Math.exp(Math.max(-700, Math.min(700, scoreWeight * score)));
    }

    const communicativeProbs = this._normalizeActionMap(unnormalized);
    let probs = communicativeProbs;
    const baseProbs = this._normalizeActionMap(Object.fromEntries(
      ACTIONS.map(action => {
        const key = action.toString();
        return [key, this._safeProb(base[key])];
      })
    ));
    let rho = null;
    if (this.scoreKind === 'costly_mixture' || this.scoreKind === 'goal_contrast') {
      rho = Math.max(0, Math.min(1, this.alpha));
      probs = this._mixActionPolicies(baseProbs, communicativeProbs, rho);
    } else if (this.scoreKind === 'opportunity_costly_mixture') {
      const uncertainty = this._normalizedEntropy(posteriorOverride);
      const opportunity = 1 - Math.exp(-Math.max(0, maxScore - minScore));
      rho = Math.max(0, Math.min(1, this.alpha)) * uncertainty * opportunity;
      probs = this._mixActionPolicies(baseProbs, communicativeProbs, rho);
    } else if (this.scoreKind === 'one_step_deliberate') {
      const relativeStep = this._relativeStepFromNewGoal(trialData);
      rho = relativeStep === 1 ? Math.max(0, Math.min(1, this.alpha)) : 0;
      probs = this._mixActionPolicies(baseProbs, communicativeProbs, rho);
    }
    return {
      base,
      revealed,
      probs,
      scoreKind: this.scoreKind,
      jointPolicyKind: this._jointPolicyKind(),
      signalingMixtureWeight: rho
    };
  }

  _usesMixtureWithUnitCommunicativePolicy() {
    return (
      this.scoreKind === 'costly_mixture' ||
      this.scoreKind === 'opportunity_costly_mixture' ||
      this.scoreKind === 'goal_contrast' ||
      this.scoreKind === 'one_step_deliberate'
    );
  }

  _mixActionPolicies(baseProbs, communicativeProbs, rho) {
    const clipped = Math.max(0, Math.min(1, rho));
    const probs = {};
    for (const action of ACTIONS) {
      const key = action.toString();
      probs[key] = (1 - clipped) * this._safeProb(baseProbs[key]) + clipped * this._safeProb(communicativeProbs[key]);
    }
    return this._normalizeActionMap(probs);
  }

  _normalizedEntropy(posteriorOverride = null) {
    const posterior = (Array.isArray(posteriorOverride) && posteriorOverride.length)
      ? posteriorOverride
      : this._pIntent;
    if (!Array.isArray(posterior) || posterior.length <= 1) return 0;
    let total = 0;
    for (const value of posterior) total += isFinite(value) ? Math.max(this.eps, value) : 0;
    if (!isFinite(total) || total <= 0) return 1;
    let entropy = 0;
    for (const value of posterior) {
      const p = Math.max(this.eps, value || 0) / total;
      entropy -= p * Math.log(p);
    }
    return Math.max(0, Math.min(1, entropy / Math.log(posterior.length)));
  }

  _contrastGoalIndex(targetGoalIdx, goals, posterior, trialData) {
    const shared = trialData?.firstDetectedSharedGoal;
    const newGoalIdx = goals.length >= 3 ? goals.length - 1 : null;
    if (Number.isInteger(shared) && shared >= 0 && shared < goals.length) {
      if (targetGoalIdx !== shared) return shared;
      if (newGoalIdx !== null && newGoalIdx !== shared) return newGoalIdx;
    }
    let bestIdx = targetGoalIdx;
    let bestProb = -Infinity;
    for (let idx = 0; idx < goals.length; idx++) {
      if (idx === targetGoalIdx) continue;
      const value = posterior?.[idx] || 0;
      if (value > bestProb) {
        bestProb = value;
        bestIdx = idx;
      }
    }
    return bestIdx;
  }

  _relativeStepFromNewGoal(trialData) {
    const currentStep = this._inferCurrentStepIndex(trialData);
    const newGoalStep = Number.isFinite(trialData?.newGoalPresentedTime) ? trialData.newGoalPresentedTime : null;
    if (!Number.isFinite(currentStep) || !Number.isFinite(newGoalStep)) return null;
    return currentStep - newGoalStep;
  }

  _revealedPosteriorForAction(aiPos, humanPos, goals, actionKey, posteriorOverride = null) {
    const prior = (Array.isArray(posteriorOverride) && posteriorOverride.length === goals.length)
      ? posteriorOverride
      : this._pIntent;
    const out = new Array(goals.length).fill(0);
    let denom = 0;
    for (let g = 0; g < goals.length; g++) {
      const priorProb = Math.max(this.eps, prior?.[g] ?? (1 / goals.length));
      const probs = this._goalActionProbabilities(aiPos, humanPos, goals[g]);
      const likelihood = this._safeProb(probs[actionKey]);
      out[g] = priorProb * likelihood;
      denom += out[g];
    }
    if (!isFinite(denom) || denom <= 0) return new Array(goals.length).fill(1 / goals.length);
    return out.map(v => v / denom);
  }

  _goalActionProbabilities(aiPos, humanPos, goal) {
    if (this.useUnshapedJointRL && typeof this.rl?.getUnshapedJointActionProbabilities === 'function') {
      return this.rl.getUnshapedJointActionProbabilities(aiPos, humanPos, [goal]) || {};
    }
    return this.rl.getJointActionProbabilities(aiPos, humanPos, [goal]) || {};
  }

  _jointPolicyKind() {
    return this.useUnshapedJointRL ? 'unshapedJointRL' : 'defaultJointRL';
  }

  _combinedWeights(goals, aiPos, humanPos, posteriorOverride = null) {
    if (!this.useUnshapedJointRL || typeof this.rl?.getUnshapedJointSoftStateValue !== 'function') {
      return super._combinedWeights(goals, aiPos, humanPos);
    }
    const posterior = (Array.isArray(posteriorOverride) && posteriorOverride.length === goals.length)
      ? posteriorOverride
      : (this._pIntent || new Array(goals.length).fill(1 / Math.max(1, goals.length)));
    const values = goals.map(goal => this.rl.getUnshapedJointSoftStateValue(aiPos, humanPos, [goal]));
    const finiteValues = values.filter(v => isFinite(v));
    const minValue = finiteValues.length ? Math.min(...finiteValues) : 0;
    const maxValue = finiteValues.length ? Math.max(...finiteValues) : 0;
    const range = Math.max(this.eps, maxValue - minValue);
    const scaled = values.map(value => {
      if (!isFinite(value)) return -Infinity;
      const normalized = (value - minValue) / range;
      return this.beta * normalized;
    });
    const maxScaled = Math.max(...scaled.filter(v => isFinite(v)), 0);
    const out = [];
    for (let i = 0; i < goals.length; i++) {
      const pi = posterior[i] ?? (1 / goals.length);
      const euWeight = isFinite(scaled[i]) ? Math.exp(Math.max(-700, Math.min(700, scaled[i] - maxScaled))) : 0;
      out[i] = euWeight * Math.pow(Math.max(this.eps, pi), this.lambda);
    }
    const sum = out.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
    if (!isFinite(sum) || sum <= 0) return new Array(goals.length).fill(1 / goals.length);
    return out.map(w => w / sum);
  }

  _safeProb(value) {
    return (typeof value === 'number' && isFinite(value) && value > 0) ? value : this.eps;
  }

  _normalizeActionMap(weights) {
    const entries = Object.entries(weights);
    const sum = entries.reduce((acc, [, value]) => acc + (isFinite(value) ? value : 0), 0);
    if (!isFinite(sum) || sum <= 0) {
      return Object.fromEntries(ACTIONS.map(action => [action.toString(), 1 / ACTIONS.length]));
    }
    return Object.fromEntries(entries.map(([key, value]) => [key, value / sum]));
  }

  _sampleActionFromPolicy(probs) {
    const keys = ACTIONS.map(action => action.toString());
    const weights = keys.map(key => this._safeProb(probs[key]));
    const idx = this._sampleFromWeights(weights);
    return keys[idx].split(',').map(Number);
  }

  _recordSignalSample(trialData, aiPlayerNumber, goalIdx, goalWeights, actionPolicy) {
    try {
      const playerPrefix = aiPlayerNumber === 1 ? 'signalAgentPlayer1' : 'signalAgentPlayer2';
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        goal: goalIdx,
        posterior: this._pIntent ? this._pIntent.slice() : null,
        weights: goalWeights.slice(),
        baseActionProbabilities: { ...actionPolicy.base },
        revealedIntentions: actionPolicy.revealed,
        actionProbabilities: { ...actionPolicy.probs },
        jointPolicyKind: actionPolicy.jointPolicyKind || this._jointPolicyKind()
      };
      if (typeof actionPolicy.signalingMixtureWeight === 'number') {
        sample.signalingMixtureWeight = actionPolicy.signalingMixtureWeight;
      }
      trialData.signalAgentSampledJointGoal = goalIdx;
      trialData.signalAgentSampledJointGoalPosterior = sample.posterior;
      trialData.signalAgentSampledJointGoalWeights = goalWeights.slice();
      trialData.signalAgentActionProbabilities = { ...actionPolicy.probs };
      trialData.signalAgentRevealedIntentions = actionPolicy.revealed;
      trialData.signalAgentJointPolicyKind = sample.jointPolicyKind;
      trialData[`${playerPrefix}SampledJointGoal`] = goalIdx;
      trialData[`${playerPrefix}SampledJointGoalPosterior`] = sample.posterior;
      trialData[`${playerPrefix}SampledJointGoalWeights`] = goalWeights.slice();
      trialData[`${playerPrefix}ActionProbabilities`] = { ...actionPolicy.probs };
      trialData[`${playerPrefix}RevealedIntentions`] = actionPolicy.revealed;
      trialData[`${playerPrefix}JointPolicyKind`] = sample.jointPolicyKind;
      const historyKey = `${playerPrefix}SampledJointGoalHistory`;
      if (!Array.isArray(trialData[historyKey])) trialData[historyKey] = [];
      trialData[historyKey].push(sample);
    } catch (_) { /* noop */ }
  }
}
