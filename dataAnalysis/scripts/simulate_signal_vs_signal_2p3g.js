import fs from 'fs';
import path from 'path';
import vm from 'vm';

import { CONFIG } from '../../client/src/config/gameConfig.js';
import { GameStateManager } from '../../client/src/game/GameStateManager.js';
import { SignalAgent } from '../../client/src/ai/SignalAgent.js';
import { RLAgent } from '../../client/src/ai/RLAgent.js';
import { GameHelpers } from '../../client/src/utils/GameHelpers.js';
import { NewGoalGenerator } from '../../client/src/utils/NewGoalGenerator.js';

const DEFAULT_SESSIONS = 30;
const DEFAULT_TRIALS_PER_SESSION = 12;
const DEFAULT_SEED = 42;
const DEFAULT_OUTPUT_DIR = 'dataAnalysis/analyses/outputs/model_model/signal_agent/signal_agent_alpha_fit_beta3/simulations';
const VALID_SCORES = new Set(['margin', 'logposterior', 'mixture']);

function parseArgs(argv) {
  const out = {
    sessions: DEFAULT_SESSIONS,
    trialsPerSession: DEFAULT_TRIALS_PER_SESSION,
    seed: DEFAULT_SEED,
    sessionOffset: 0,
    alpha: 0,
    lambda: 0.125,
    beta: 3.0,
    score: 'logposterior',
    horizon: 1,
    outputDir: DEFAULT_OUTPUT_DIR
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--n' || arg === '--sessions') && argv[i + 1]) out.sessions = Number(argv[++i]);
    else if ((arg === '--trials-per-session' || arg === '--trials') && argv[i + 1]) out.trialsPerSession = Number(argv[++i]);
    else if ((arg === '--session-offset' || arg === '--offset') && argv[i + 1]) out.sessionOffset = Number(argv[++i]);
    else if (arg === '--seed' && argv[i + 1]) out.seed = Number(argv[++i]);
    else if (arg === '--alpha' && argv[i + 1]) out.alpha = Number(argv[++i]);
    else if (arg === '--lambda' && argv[i + 1]) out.lambda = Number(argv[++i]);
    else if (arg === '--beta' && argv[i + 1]) out.beta = Number(argv[++i]);
    else if (arg === '--score' && argv[i + 1]) out.score = String(argv[++i]);
    else if (arg === '--horizon' && argv[i + 1]) out.horizon = Number(argv[++i]);
    else if (arg === '--output-dir' && argv[i + 1]) out.outputDir = argv[++i];
  }
  if (!VALID_SCORES.has(out.score)) {
    throw new Error(`--score must be one of ${[...VALID_SCORES].join(', ')}; got "${out.score}"`);
  }
  return out;
}

function formatNumberForPath(value) {
  if (!Number.isFinite(value)) return null;
  return String(value).replace('-', 'neg').replace('.', 'p');
}

function createSeededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function deriveSessionSeed(baseSeed, sessionIndex) {
  let state = ((baseSeed >>> 0) ^ ((sessionIndex + 1) * 0x9e3779b9)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0;
  return (state ^ (state >>> 16)) >>> 0;
}

function withSeededRandom(seed, fn) {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function withSuppressedConsole(fn) {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn
  };
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
  }
}

function withSynchronousTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, _delay, ...args) => {
    if (typeof callback === 'function') callback(...args);
    return 0;
  };
  global.clearTimeout = () => {};
  try {
    return fn();
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

function loadMapsFor2P3G() {
  const mapsPath = path.resolve('config/MapsFor2P3G.js');
  const source = fs.readFileSync(mapsPath, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  if (!sandbox.MapsFor2P3G || typeof sandbox.MapsFor2P3G !== 'object') {
    throw new Error('Failed to load MapsFor2P3G.js');
  }
  return Object.entries(sandbox.MapsFor2P3G)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([mapId, arr]) => ({ mapId, design: { ...arr[0] } }));
}

function actionToDirection(action) {
  if (!Array.isArray(action) || action.length < 2) return null;
  const [dr, dc] = action;
  if (dr === -1 && dc === 0) return 'up';
  if (dr === 1 && dc === 0) return 'down';
  if (dr === 0 && dc === -1) return 'left';
  if (dr === 0 && dc === 1) return 'right';
  return null;
}

function maybePresentNewGoal(gameStateManager) {
  const state = gameStateManager.currentState;
  const trial = gameStateManager.trialData;
  if (!state || !trial) return false;
  if (state.experimentType !== '2P3G') return false;
  if (trial.newGoalPresented) return false;
  if (!Array.isArray(state.currentGoals) || state.currentGoals.length < 2) return false;
  if (!state.player1 || !state.player2) return false;

  const distanceCondition =
    trial.distanceCondition ||
    trial.newGoalConditionType ||
    CONFIG.twoP3G.distanceConditions.CLOSER_TO_PLAYER2;

  let generated = NewGoalGenerator.checkNewGoalPresentation2P3G(state, trial, distanceCondition);
  if (!generated && Number.isInteger(trial.firstDetectedSharedGoal)) {
    const p1CurrentGoal = NewGoalGenerator.getPlayerCurrentGoal(trial.player1CurrentGoal);
    const p2CurrentGoal = NewGoalGenerator.getPlayerCurrentGoal(trial.player2CurrentGoal);
    if (p1CurrentGoal === trial.firstDetectedSharedGoal && p2CurrentGoal === trial.firstDetectedSharedGoal) {
      const direct = NewGoalGenerator.generateNewGoal(
        state.player2,
        state.player1,
        state.currentGoals,
        trial.firstDetectedSharedGoal,
        distanceCondition
      );
      if (direct && direct.position) generated = direct;
    }
  }

  if (!generated || !generated.position) return false;

  gameStateManager.addGoal(generated.position);
  const closerInfo = (
    typeof generated.distanceToPlayer2 === 'number' &&
    typeof generated.distanceToPlayer1 === 'number'
  )
    ? { isNewGoalCloserToPlayer2: generated.distanceToPlayer2 < generated.distanceToPlayer1 }
    : {};
  gameStateManager.markNewGoalPresented(generated.position, distanceCondition, closerInfo);
  return true;
}

function summarizeTrial(trialData, mapId, sessionIndex) {
  const eligibleForCommitment =
    trialData.newGoalPresented &&
    Number.isInteger(trialData.firstDetectedSharedGoal) &&
    Number.isInteger(trialData.player1FinalReachedGoal) &&
    Number.isInteger(trialData.player2FinalReachedGoal);

  const player1Committed = eligibleForCommitment
    ? trialData.player1FinalReachedGoal === trialData.firstDetectedSharedGoal
    : null;
  const player2Committed = eligibleForCommitment
    ? trialData.player2FinalReachedGoal === trialData.firstDetectedSharedGoal
    : null;

  return {
    sessionIndex,
    trialIndex: trialData.trialIndex,
    mapId,
    distanceCondition: trialData.distanceCondition,
    totalSteps: trialData.totalSteps,
    newGoalPresented: !!trialData.newGoalPresented,
    newGoalStep: trialData.newGoalPresentedTime,
    firstDetectedSharedGoal: trialData.firstDetectedSharedGoal,
    player1FinalReachedGoal: trialData.player1FinalReachedGoal,
    player2FinalReachedGoal: trialData.player2FinalReachedGoal,
    player1SampledJointGoal: trialData.signalAgentPlayer1SampledJointGoal,
    player2SampledJointGoal: trialData.signalAgentPlayer2SampledJointGoal,
    commitmentDefinition: 'finalReachedGoal == firstDetectedSharedGoal',
    collaborationSucceeded: !!trialData.collaborationSucceeded,
    commitmentEligible: !!eligibleForCommitment,
    player1Committed,
    player2Committed,
    bothCommitted: eligibleForCommitment ? (player1Committed && player2Committed) : null
  };
}

function buildRawTrialRecord(trialData, mapId, sessionIndex, design) {
  const initialGoals = Array.isArray(trialData.initialGoalPositions) ? trialData.initialGoalPositions : [];
  const target1 = Array.isArray(design?.target1) ? [...design.target1] : (Array.isArray(initialGoals[0]) ? [...initialGoals[0]] : null);
  const target2 = Array.isArray(design?.target2) ? [...design.target2] : (Array.isArray(initialGoals[1]) ? [...initialGoals[1]] : null);
  return {
    sessionIndex,
    participantId_player1: `session_${sessionIndex}_player1`,
    participantId_player2: `session_${sessionIndex}_player2`,
    partnerType: 'signalAgent',
    experimentType: '2P3G',
    trialIndex: trialData.trialIndex,
    mapId,
    distanceCondition: trialData.distanceCondition,
    newGoalPresented: !!trialData.newGoalPresented,
    newGoalPresentedTime: trialData.newGoalPresentedTime,
    newGoalPosition: trialData.newGoalPosition,
    firstDetectedSharedGoal: trialData.firstDetectedSharedGoal,
    player1FirstDetectedGoal: trialData.player1FirstDetectedGoal,
    player2FirstDetectedGoal: trialData.player2FirstDetectedGoal,
    player1FinalReachedGoal: trialData.player1FinalReachedGoal,
    player2FinalReachedGoal: trialData.player2FinalReachedGoal,
    player1SampledJointGoal: trialData.signalAgentPlayer1SampledJointGoal,
    player2SampledJointGoal: trialData.signalAgentPlayer2SampledJointGoal,
    signalAgentPlayer1SampledJointGoal: trialData.signalAgentPlayer1SampledJointGoal,
    signalAgentPlayer2SampledJointGoal: trialData.signalAgentPlayer2SampledJointGoal,
    signalAgentPlayer1SampledJointGoalWeights: trialData.signalAgentPlayer1SampledJointGoalWeights,
    signalAgentPlayer2SampledJointGoalWeights: trialData.signalAgentPlayer2SampledJointGoalWeights,
    signalAgentPlayer1SampledJointGoalHistory: trialData.signalAgentPlayer1SampledJointGoalHistory,
    signalAgentPlayer2SampledJointGoalHistory: trialData.signalAgentPlayer2SampledJointGoalHistory,
    player1Trajectory: trialData.player1Trajectory,
    player2Trajectory: trialData.player2Trajectory,
    player1Actions: trialData.player1Actions,
    player2Actions: trialData.player2Actions,
    player1StartPosition: trialData.player1StartPosition,
    player2StartPosition: trialData.player2StartPosition,
    initialGoalPositions: initialGoals,
    target1,
    target2,
    totalSteps: trialData.totalSteps,
    collaborationSucceeded: !!trialData.collaborationSucceeded
  };
}

function computeSummary(trials, meta) {
  const totalTrials = trials.length;
  const successfulTrials = trials.filter(t => t.collaborationSucceeded).length;
  const eligibleTrials = trials.filter(t => t.commitmentEligible);
  const committedAgents = eligibleTrials.flatMap(t => [t.player1Committed, t.player2Committed]).filter(v => v !== null);
  const bothCommittedTrials = eligibleTrials.filter(t => t.bothCommitted).length;

  const byCondition = {};
  for (const trial of trials) {
    const key = trial.distanceCondition || 'unknown';
    if (!byCondition[key]) {
      byCondition[key] = {
        trials: 0,
        successes: 0,
        commitmentEligibleTrials: 0,
        committedAgents: 0,
        totalEligibleAgents: 0,
        bothCommittedTrials: 0
      };
    }
    const row = byCondition[key];
    row.trials += 1;
    if (trial.collaborationSucceeded) row.successes += 1;
    if (trial.commitmentEligible) {
      row.commitmentEligibleTrials += 1;
      row.totalEligibleAgents += 2;
      row.committedAgents += Number(!!trial.player1Committed) + Number(!!trial.player2Committed);
      if (trial.bothCommitted) row.bothCommittedTrials += 1;
    }
  }

  for (const value of Object.values(byCondition)) {
    value.successRate = value.trials ? value.successes / value.trials : null;
    value.commitmentRate = value.totalEligibleAgents ? value.committedAgents / value.totalEligibleAgents : null;
    value.bothCommittedRate = value.commitmentEligibleTrials ? value.bothCommittedTrials / value.commitmentEligibleTrials : null;
  }

  return {
    ...meta,
    totalTrials,
    successfulTrials,
    successRate: totalTrials ? successfulTrials / totalTrials : null,
    newGoalPresentedTrials: trials.filter(t => t.newGoalPresented).length,
    commitmentEligibleTrials: eligibleTrials.length,
    commitmentEligibleAgents: committedAgents.length,
    committedAgents: committedAgents.filter(Boolean).length,
    commitmentRate: committedAgents.length ? committedAgents.filter(Boolean).length / committedAgents.length : null,
    bothCommittedTrials,
    bothCommittedRate: eligibleTrials.length ? bothCommittedTrials / eligibleTrials.length : null,
    byCondition
  };
}

function runSimulation({ sessions, trialsPerSession, seed, sessionOffset, alpha, lambda, beta, score, horizon }) {
  const originalPlayers = {
    player1: CONFIG.game.players.player1.type,
    player2: CONFIG.game.players.player2.type
  };
  const originalNumTrials = CONFIG.game.experiments.numTrials['2P3G'];
  const originalOrder = [...CONFIG.game.experiments.order];
  const originalSignal = { ...(CONFIG.game.agent.signal || {}) };

  CONFIG.game.players.player1.type = 'signalAgent';
  CONFIG.game.players.player2.type = 'signalAgent';
  CONFIG.game.agent.type = 'joint';
  CONFIG.game.experiments.order = ['2P3G'];
  CONFIG.game.experiments.numTrials['2P3G'] = trialsPerSession;
  CONFIG.game.agent.signal = { alpha, lambda, beta, score, horizon };

  try {
    const maps = loadMapsFor2P3G().slice(0, trialsPerSession);
    if (maps.length < trialsPerSession) {
      throw new Error(`Requested ${trialsPerSession} trials per session but only found ${maps.length} 2P3G maps.`);
    }

    return withSuppressedConsole(() => withSynchronousTimers(() => {
      const trials = [];
      const rawTrials = [];

      for (let localSessionIndex = 0; localSessionIndex < sessions; localSessionIndex++) {
        const sessionIndex = sessionOffset + localSessionIndex;
        const sessionSeed = deriveSessionSeed(seed, sessionIndex);

        withSeededRandom(sessionSeed, () => {
          const gameStateManager = new GameStateManager();
          const sharedRl = new RLAgent();
          const agent1 = new SignalAgent({ rlAgent: sharedRl, alpha, lambda, beta, score, horizon });
          const agent2 = new SignalAgent({ rlAgent: sharedRl, alpha, lambda, beta, score, horizon });

          for (let trialIndex = 0; trialIndex < trialsPerSession; trialIndex++) {
            const { mapId, design } = maps[trialIndex];
            gameStateManager.initializeTrial(trialIndex, '2P3G', design);

            let trialComplete = false;
            while (!trialComplete && gameStateManager.stepCount < CONFIG.game.maxGameLength) {
              maybePresentNewGoal(gameStateManager);

              const state = gameStateManager.getCurrentState();
              const trialData = gameStateManager.trialData;
              const action1 = agent1.getAIAction(state, trialData, 1);
              const action2 = agent2.getAIAction(state, trialData, 2);
              const result = gameStateManager.processSynchronizedMoves(
                actionToDirection(action1),
                actionToDirection(action2)
              );
              gameStateManager.isMoving = false;
              trialComplete = !!result.trialComplete;
            }

            const success = GameHelpers.didBothPlayersReachSameGoal(gameStateManager.getCurrentState());
            gameStateManager.finalizeTrial(success);
            const finalizedTrial = gameStateManager.getExperimentData().allTrialsData.at(-1);
            trials.push(summarizeTrial(finalizedTrial, mapId, sessionIndex));
            rawTrials.push(buildRawTrialRecord(finalizedTrial, mapId, sessionIndex, design));
          }
        });
      }

      return {
        summary: computeSummary(trials, {
          seed,
          sessionOffset,
          sessions,
          trialsPerSession,
          totalPlannedTrials: sessions * trialsPerSession,
          alpha,
          lambda,
          beta,
          score,
          horizon,
          agentType: 'signalAgent',
          mapSelection: 'first_trials_per_session_sorted_maps_from_MapsFor2P3G'
        }),
        trials,
        rawTrials
      };
    }));
  } finally {
    CONFIG.game.players.player1.type = originalPlayers.player1;
    CONFIG.game.players.player2.type = originalPlayers.player2;
    CONFIG.game.experiments.order = originalOrder;
    CONFIG.game.experiments.numTrials['2P3G'] = originalNumTrials;
    CONFIG.game.agent.signal = originalSignal;
  }
}

function main() {
  const { sessions, trialsPerSession, seed, sessionOffset, alpha, lambda, beta, score, horizon, outputDir: outputDirArg } = parseArgs(process.argv.slice(2));
  const result = runSimulation({ sessions, trialsPerSession, seed, sessionOffset, alpha, lambda, beta, score, horizon });

  const outputDir = path.resolve(outputDirArg);
  fs.mkdirSync(outputDir, { recursive: true });

  const suffix = `beta_${formatNumberForPath(beta)}_lambda_${formatNumberForPath(lambda)}_alpha_${formatNumberForPath(alpha)}_sessions_${sessionOffset}_to_${sessionOffset + sessions - 1}`;
  const summaryPath = path.join(outputDir, `signal_vs_signal_2p3g_summary_${suffix}.json`);
  const trialsPath = path.join(outputDir, `signal_vs_signal_2p3g_trials_${suffix}.json`);
  const rawTrialsPath = path.join(outputDir, `signal_vs_signal_2p3g_raw_trials_${suffix}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(result.summary, null, 2));
  fs.writeFileSync(trialsPath, JSON.stringify(result.trials, null, 2));
  fs.writeFileSync(rawTrialsPath, JSON.stringify(result.rawTrials, null, 2));

  console.log(JSON.stringify({
    summaryPath,
    trialsPath,
    rawTrialsPath,
    summary: result.summary
  }, null, 2));
}

main();
