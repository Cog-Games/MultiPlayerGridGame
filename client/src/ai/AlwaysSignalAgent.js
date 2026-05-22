import { SignalAgent } from './SignalAgent.js';

const ACTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Always-on shared-agency signal model:
// sampleJointGoalAndRSASignal_fromStart when score='logposterior'.
export class AlwaysSignalAgent extends SignalAgent {
  getAIAction(gameState, trialData, aiPlayerNumber = 2) {
    const goals = Array.isArray(gameState?.currentGoals) ? gameState.currentGoals : [];
    if (!goals.length) return [0, 0];

    const aiPos = aiPlayerNumber === 1 ? gameState?.player1 : gameState?.player2;
    const otherPos = aiPlayerNumber === 1 ? gameState?.player2 : gameState?.player1;
    if (!aiPos || !otherPos) return [0, 0];

    const trialKey = `${String(gameState?.experimentType || '')}:${Number.isFinite(gameState?.trialIndex) ? gameState.trialIndex : 'na'}`;
    if (this._lastTrialKey !== trialKey) {
      this.reset();
      this._lastTrialKey = trialKey;
    }

    this._ensurePosterior(goals);
    this._bayesUpdateFromObservedActions(gameState, trialData, goals);

    const goalWeights = this._combinedWeights(goals, aiPos, otherPos);
    const targetGoalIdx = this._sampleFromWeights(goalWeights);
    const targetGoal = goals[targetGoalIdx];
    if (!Array.isArray(targetGoal) || targetGoal.length < 2) return [0, 0];

    if (this.scoreKind === 'mixture') {
      return this._mixtureAction(aiPos, otherPos, goals, targetGoalIdx, targetGoal, trialData, aiPlayerNumber, goalWeights);
    }

    const actionPolicy = this.horizon > 1
      ? this._signalActionPolicyTrajectory(aiPos, otherPos, goals, targetGoalIdx)
      : this._signalActionPolicy(aiPos, otherPos, goals, targetGoalIdx);
    this._recordSignalSample(trialData, aiPlayerNumber, targetGoalIdx, goalWeights, actionPolicy);
    return this._sampleActionFromPolicy(actionPolicy.probs);
  }

  _resizePosterior(oldPosterior, n) {
    const old = Array.isArray(oldPosterior) ? oldPosterior : [];
    if (!old.length) return new Array(n).fill(1 / n);

    const next = new Array(n).fill(0);
    const m = Math.min(old.length, n);
    const oldTotal = old.slice(0, m).reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
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

  _mixtureAction(aiPos, otherPos, goals, targetGoalIdx, targetGoal, trialData, aiPlayerNumber, goalWeights) {
    const p = Math.max(0, Math.min(1, this.alpha));
    const committedAction = this.rl.getJointRLAction(aiPos, otherPos, [targetGoal]);

    const dCur = Math.abs(aiPos[0] - targetGoal[0]) + Math.abs(aiPos[1] - targetGoal[1]);
    let legAction = null;
    let bestProb = -1;
    let legPosteriorAtTarget = null;
    for (const action of ACTIONS) {
      const dNew = Math.abs(aiPos[0] + action[0] - targetGoal[0]) + Math.abs(aiPos[1] + action[1] - targetGoal[1]);
      if (dNew >= dCur) continue;
      const posterior = this._revealedPosteriorForAction(aiPos, otherPos, goals, action.toString());
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
      const playerPrefix = aiPlayerNumber === 1 ? 'alwaysSignalAgentPlayer1' : 'alwaysSignalAgentPlayer2';
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        goal: targetGoalIdx,
        posterior: this._pIntent ? this._pIntent.slice() : null,
        weights: goalWeights.slice(),
        mixtureP: p,
        mixturePicked: useLeg ? 'legibility' : 'committed',
        legActionTargetPosterior: legPosteriorAtTarget,
        jointPolicyKind: this._jointPolicyKind(),
        alwaysSignal: true,
        everyStepResampling: true
      };
      trialData.alwaysSignalAgentSampledJointGoal = targetGoalIdx;
      trialData.alwaysSignalAgentSampledJointGoalPosterior = sample.posterior;
      trialData.alwaysSignalAgentSampledJointGoalWeights = goalWeights.slice();
      trialData.alwaysSignalAgentEveryStepResampling = true;
      trialData.alwaysSignalAgentJointPolicyKind = sample.jointPolicyKind;
      trialData.alwaysSignalAgentUnshapedJointRL = this.useUnshapedJointRL === true;
      trialData[`${playerPrefix}SampledJointGoal`] = targetGoalIdx;
      trialData[`${playerPrefix}SampledJointGoalPosterior`] = sample.posterior;
      trialData[`${playerPrefix}SampledJointGoalWeights`] = goalWeights.slice();
      trialData[`${playerPrefix}MixtureP`] = p;
      trialData[`${playerPrefix}MixturePicked`] = sample.mixturePicked;
      trialData[`${playerPrefix}LegActionTargetPosterior`] = legPosteriorAtTarget;
      trialData[`${playerPrefix}JointPolicyKind`] = sample.jointPolicyKind;
      const historyKey = `${playerPrefix}SampledJointGoalHistory`;
      if (!Array.isArray(trialData[historyKey])) trialData[historyKey] = [];
      trialData[historyKey].push(sample);
    } catch (_) { /* noop */ }

    return chosen;
  }

  _recordSignalSample(trialData, aiPlayerNumber, goalIdx, goalWeights, actionPolicy) {
    try {
      const playerPrefix = aiPlayerNumber === 1 ? 'alwaysSignalAgentPlayer1' : 'alwaysSignalAgentPlayer2';
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        goal: goalIdx,
        posterior: this._pIntent ? this._pIntent.slice() : null,
        weights: goalWeights.slice(),
        baseActionProbabilities: { ...actionPolicy.base },
        revealedIntentions: actionPolicy.revealed,
        actionProbabilities: { ...actionPolicy.probs },
        jointPolicyKind: actionPolicy.jointPolicyKind || this._jointPolicyKind(),
        alwaysSignal: true,
        everyStepResampling: true
      };
      trialData.alwaysSignalAgentSampledJointGoal = goalIdx;
      trialData.alwaysSignalAgentSampledJointGoalPosterior = sample.posterior;
      trialData.alwaysSignalAgentSampledJointGoalWeights = goalWeights.slice();
      trialData.alwaysSignalAgentActionProbabilities = { ...actionPolicy.probs };
      trialData.alwaysSignalAgentRevealedIntentions = actionPolicy.revealed;
      trialData.alwaysSignalAgentEveryStepResampling = true;
      trialData.alwaysSignalAgentJointPolicyKind = sample.jointPolicyKind;
      trialData.alwaysSignalAgentUnshapedJointRL = this.useUnshapedJointRL === true;
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
