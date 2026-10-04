import { createSharedAgencyCore } from './kidSaReference/sharedAgencyCore.js';
import { getSoftmaxOptimalJointRLActionFast } from './kidSaReference/jointRLFast.js';
import { GameHelpers } from '../utils/GameHelpers.js';

// Adapt canonical player numbers to the reference experiment's human=P1, AI=P2.
// Keep the reference posterior, goal reset, tie breaking and RNG consumption intact.
export class KidSharedAgencyAgent {
  constructor() {
    this.context = {
      RLAgent: { getSoftmaxOptimalJointRLActionFast },
      isValidMove: (...args) => GameHelpers.isValidMove(...args)
    };
    this.core = createSharedAgencyCore(this.context);
  }

  reset() { this.core.reset(); }
  getConfig() { return this.core.getConfig(); }

  getAIAction(gameState, trialData, aiPlayerNumber = 2, pendingHumanAction = null) {
    if (this.lastTrialData !== trialData) {
      this.reset();
      this.lastTrialData = trialData;
    }
    const humanPlayerNumber = aiPlayerNumber === 1 ? 2 : 1;
    const aiPos = gameState[`player${aiPlayerNumber}`];
    const humanPos = gameState[`player${humanPlayerNumber}`];
    const historyKey = `alwaysSignalAgentPlayer${aiPlayerNumber}SampledJointGoalHistory`;
    const referenceTrial = {
      experimentType: gameState.experimentType,
      trialIndex: gameState.trialIndex,
      initPlayerGrid: trialData[`player${humanPlayerNumber}StartPosition`],
      initAIGrid: trialData[`player${aiPlayerNumber}StartPosition`],
      player1Actions: trialData[`player${humanPlayerNumber}Actions`],
      player1Trajectory: trialData[`player${humanPlayerNumber}Trajectory`],
      alwaysSignalAgentPlayer2SampledJointGoalHistory: trialData[historyKey] || []
    };
    // The old experiment records the current human input BEFORE requesting the AI
    // action, while keeping both positions unchanged. Expose the same observation
    // without adding a duplicate entry to the canonical movement log.
    if (pendingHumanAction) {
      referenceTrial.player1Actions = [...(referenceTrial.player1Actions || []), pendingHumanAction];
      referenceTrial.player1Trajectory = [...(referenceTrial.player1Trajectory || []), humanPos];
    }
    this.context.gameData = {
      currentExperiment: gameState.experimentType,
      currentTrial: gameState.trialIndex,
      currentGoals: gameState.currentGoals,
      player1: humanPos, player2: aiPos,
      stepCount: trialData.moveEvents?.at(-1)?.round || 0
    };
    const action = this.core.getAIAction(gameState.gridMatrix, aiPos,
      gameState.currentGoals, humanPos, this.context.gameData, referenceTrial);
    for (const [key, value] of Object.entries(referenceTrial)) {
      if (key.startsWith('sharedAgency') || key.startsWith('alwaysSignalAgent')) {
        trialData[key === 'alwaysSignalAgentPlayer2SampledJointGoalHistory' ? historyKey : key] = value;
      }
    }
    trialData.sharedAgencyModelAdapterVersion = 'canonical-player-adapter-v1';
    trialData.sharedAgencyAIPlayerIndex = aiPlayerNumber - 1;
    return action;
  }
}
