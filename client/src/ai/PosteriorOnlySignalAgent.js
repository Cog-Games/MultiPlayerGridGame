import { AlwaysSignalAgent } from './AlwaysSignalAgent.js';

const ACTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Always-on signaling with posterior-only joint-goal choice.
// - Maintain P_intent(joint goal) from trial start.
// - Sample each step from W_lambda(g) proportional to P_intent(g)^lambda.
// - Apply SignalAgent's legibility policy around the sampled target.
export class PosteriorOnlySignalAgent extends AlwaysSignalAgent {
  _combinedWeights(goals) {
    const n = Array.isArray(goals) ? goals.length : 0;
    if (!n) return [];
    const posterior = Array.isArray(this._pIntent) && this._pIntent.length === n
      ? this._pIntent
      : new Array(n).fill(1 / n);
    const lambda = Math.max(0, Number.isFinite(this.lambda) ? this.lambda : 0);
    const eps = this.eps || 1e-6;
    const weights = posterior.map(p => Math.pow(Math.max(eps, Number.isFinite(p) ? p : eps), lambda));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 0) return new Array(n).fill(1 / n);
    return weights.map(value => value / total);
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
      const playerPrefix = aiPlayerNumber === 1 ? 'posteriorOnlySignalAgentPlayer1' : 'posteriorOnlySignalAgentPlayer2';
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        goal: targetGoalIdx,
        posterior: this._pIntent ? this._pIntent.slice() : null,
        weights: goalWeights.slice(),
        mixtureP: p,
        mixturePicked: useLeg ? 'legibility' : 'committed',
        legActionTargetPosterior: legPosteriorAtTarget,
        posteriorOnlyGoalSelection: true,
        everyStepResampling: true
      };
      trialData.posteriorOnlySignalAgentSampledJointGoal = targetGoalIdx;
      trialData.posteriorOnlySignalAgentSampledJointGoalPosterior = sample.posterior;
      trialData.posteriorOnlySignalAgentSampledJointGoalWeights = goalWeights.slice();
      trialData.posteriorOnlySignalAgentPosteriorOnlyGoalSelection = true;
      trialData[`${playerPrefix}SampledJointGoal`] = targetGoalIdx;
      trialData[`${playerPrefix}SampledJointGoalPosterior`] = sample.posterior;
      trialData[`${playerPrefix}SampledJointGoalWeights`] = goalWeights.slice();
      trialData[`${playerPrefix}MixtureP`] = p;
      trialData[`${playerPrefix}MixturePicked`] = sample.mixturePicked;
      trialData[`${playerPrefix}LegActionTargetPosterior`] = legPosteriorAtTarget;
      const historyKey = `${playerPrefix}SampledJointGoalHistory`;
      if (!Array.isArray(trialData[historyKey])) trialData[historyKey] = [];
      trialData[historyKey].push(sample);
    } catch (_) { /* noop */ }

    return chosen;
  }

  _recordSignalSample(trialData, aiPlayerNumber, goalIdx, goalWeights, actionPolicy) {
    try {
      const playerPrefix = aiPlayerNumber === 1 ? 'posteriorOnlySignalAgentPlayer1' : 'posteriorOnlySignalAgentPlayer2';
      const sample = {
        step: this._inferCurrentStepIndex(trialData),
        goal: goalIdx,
        posterior: this._pIntent ? this._pIntent.slice() : null,
        weights: goalWeights.slice(),
        baseActionProbabilities: { ...actionPolicy.base },
        revealedIntentions: actionPolicy.revealed,
        actionProbabilities: { ...actionPolicy.probs },
        posteriorOnlyGoalSelection: true,
        everyStepResampling: true
      };
      trialData.posteriorOnlySignalAgentSampledJointGoal = goalIdx;
      trialData.posteriorOnlySignalAgentSampledJointGoalPosterior = sample.posterior;
      trialData.posteriorOnlySignalAgentSampledJointGoalWeights = goalWeights.slice();
      trialData.posteriorOnlySignalAgentActionProbabilities = { ...actionPolicy.probs };
      trialData.posteriorOnlySignalAgentRevealedIntentions = actionPolicy.revealed;
      trialData.posteriorOnlySignalAgentPosteriorOnlyGoalSelection = true;
      trialData[`${playerPrefix}SampledJointGoal`] = goalIdx;
      trialData[`${playerPrefix}SampledJointGoalPosterior`] = sample.posterior;
      trialData[`${playerPrefix}SampledJointGoalWeights`] = goalWeights.slice();
      trialData[`${playerPrefix}ActionProbabilities`] = { ...actionPolicy.probs };
      trialData[`${playerPrefix}RevealedIntentions`] = actionPolicy.revealed;
      const historyKey = `${playerPrefix}SampledJointGoalHistory`;
      if (!Array.isArray(trialData[historyKey])) trialData[historyKey] = [];
      trialData[historyKey].push(sample);
    } catch (_) { /* noop */ }
  }
}
