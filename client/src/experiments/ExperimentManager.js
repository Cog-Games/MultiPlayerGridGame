import { CONFIG, GAME_OBJECTS, GameConfigUtils } from '../config/gameConfig.js';
import { RLAgent } from '../ai/RLAgent.js';
import { GptAgentClient } from '../ai/GptAgentClient.js';
import { GameHelpers } from '../utils/GameHelpers.js';
import { NewGoalGenerator } from '../utils/NewGoalGenerator.js';
import { mapLoader } from '../utils/MapLoader.js';

export class ExperimentManager {
  constructor(gameStateManager, uiManager, timelineManager = null) {
    this.gameStateManager = gameStateManager;
    this.uiManager = uiManager;
    this.timelineManager = timelineManager;
    this.rlAgent = new RLAgent();
    this.gptClient = new GptAgentClient();

    this.currentExperimentSequence = [];
    this.currentExperimentIndex = 0;
    this.currentTrialIndex = 0;
    this.isRunning = false;
    this.gameLoopInterval = null;
    this.aiMoveInterval = null;
    this.newGoalIntervalId = null;
    this.aiPlayerNumber = 2; // 1 or 2; default assume AI is player 2

    // Initialize map data with MapLoader
    this.mapLoader = mapLoader;
    try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('🗺️ ExperimentManager initialized with MapLoader'); } catch (_) {}

    // Ensure map data is loaded
    this.ensureMapDataLoaded();

    // Set up timeline event handlers if timeline manager is provided
    this.setupTimelineIntegration();
  }

  // Enable AI partner dynamically (e.g., when human partner disconnects)
  activateAIFallback(fallbackType = (CONFIG?.multiplayer?.fallbackAIType || 'rl_joint'), aiPlayerNumber = 2) {
    try {
      try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] activateAIFallback called - fallbackType: ${fallbackType}, aiPlayerNumber: ${aiPlayerNumber}`); } catch (_) {}

      // Update which player is controlled by AI
      this.aiPlayerNumber = (aiPlayerNumber === 1) ? 1 : 2;

      // Switch config to AI on the correct side and human on the other
      const humanPlayerNumber = (this.aiPlayerNumber === 1) ? 2 : 1;
      GameConfigUtils.setPlayerType(this.aiPlayerNumber, fallbackType);
      GameConfigUtils.setPlayerType(humanPlayerNumber, 'human');

      try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] After setPlayerType - Player1: ${CONFIG.game.players.player1.type}, Player2: ${CONFIG.game.players.player2.type}`); } catch (_) {}

      // Ensure RL agent exists for fallback when GPT is unavailable
      if (!this.rlAgent) {
        this.rlAgent = new RLAgent();
      }

      // Update current trial's recorded partner agent type
      try {
        const td = this.gameStateManager?.trialData;
        if (td) {
          if (fallbackType === 'gpt') {
            const model = CONFIG?.game?.agent?.gpt?.model;
            td.partnerAgentType = (model && String(model).trim()) ? model : 'gpt';
            // If model not known yet, attempt to fetch/log and update asynchronously
            if (!model || !String(model).trim()) {
              this.logCurrentAIModel?.();
            }
          } else if (fallbackType === 'rl_joint') {
            td.partnerAgentType = 'joint-rl';
          } else if (fallbackType === 'rl_individual') {
            td.partnerAgentType = 'individual-rl';
          } else {
            td.partnerAgentType = String(fallbackType);
          }
          // Record who is human vs AI (0-based for external analysis)
          td.humanPlayerIndex = (humanPlayerNumber - 1);
          td.aiPlayerIndex = (this.aiPlayerNumber - 1);
        }
      } catch (_) { /* ignore */ }

      // Set up AI movement listeners for the fallback AI
      if (!CONFIG?.game?.agent?.synchronizedMoves) {
        try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Setting up AI movement (non-synchronized mode)'); } catch (_) {}
        this.setupAIMovement();
      } else {
        // In synchronized mode, no extra setup needed; AI moves are generated on human input
        console.log('🤖 AI fallback activated (synchronized moves)');
        try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Setting up independent AI movement after human goal'); } catch (_) {}
        // But we still need to set up independent AI movement for when human reaches goal
        this.setupIndependentAIAfterHumanGoal();
      }

      // Restart new goal checking for the current experiment type after fallback
      // This is crucial because the original setup was for human-human mode
      try {
        const currentExperimentType = this.gameStateManager?.currentState?.experimentType;
        if (currentExperimentType === '2P3G') {
          try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Restarting new goal checking for 2P3G after AI fallback'); } catch (_) {}
          this.setupNewGoalCheck2P3G();
        } else if (currentExperimentType === '1P2G') {
          try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Restarting new goal checking for 1P2G after AI fallback'); } catch (_) {}
          this.setupNewGoalCheck1P2G();
        }
      } catch (restartErr) {
        console.warn('Failed to restart new goal checking after fallback:', restartErr?.message || restartErr);
      }

      // Best-effort log model/mode info
      this.logCurrentAIModel?.();
    } catch (e) {
      console.warn('Failed to activate AI fallback:', e?.message || e);
    }
  }

  async startExperiment(experimentType) {
    // Single experiment wrapper
    await this.startExperimentSequence([experimentType]);
  }

  async startExperimentSequence(experiments) {
    this.currentExperimentSequence = experiments || CONFIG.game.experiments.order;
    this.currentExperimentIndex = 0;
    this.isRunning = true;

    console.log('Starting experiment sequence:', this.currentExperimentSequence);

    // Start first experiment
    await this.startNextExperiment();
  }

  async startNextExperiment() {
    if (this.currentExperimentIndex >= this.currentExperimentSequence.length) {
      this.completeAllExperiments();
      return;
    }

    const experimentType = this.currentExperimentSequence[this.currentExperimentIndex];
    console.log(`Starting experiment ${this.currentExperimentIndex + 1}/${this.currentExperimentSequence.length}: ${experimentType}`);

    this.currentTrialIndex = 0;

    // Show consent or instruction if needed
    await this.showExperimentIntroduction(experimentType);

    // Start first trial
    await this.startNextTrial(experimentType);
  }

  async showExperimentIntroduction(experimentType) {
    // For now, just proceed directly to the game
    // In the future, you might want to show instructions specific to each experiment type
    return Promise.resolve();
  }

  async startNextTrial(experimentType) {
    // Safety check for undefined experimentType
    if (!experimentType) {
      console.error('startNextTrial called with undefined experimentType');
      this.completeAllExperiments();
      return;
    }

    const maxTrials = CONFIG.game.experiments.numTrials[experimentType] || 12;

    // Check if experiment should end early due to success threshold
    if (this.shouldEndExperimentEarly(experimentType)) {
      console.log(`Experiment ${experimentType} ended early due to success threshold`);
      this.currentExperimentIndex++;
      await this.startNextExperiment();
      return;
    }

    // Check if we've completed all trials
    if (this.currentTrialIndex >= maxTrials) {
      console.log(`Completed all trials for ${experimentType}`);
      this.currentExperimentIndex++;
      await this.startNextExperiment();
      return;
    }

    console.log(`Starting trial ${this.currentTrialIndex + 1}/${maxTrials} for ${experimentType}`);

    // Get trial design
    let design = await this.getTrialDesign(experimentType, this.currentTrialIndex);
    if (!design) {
      console.error('Failed to get trial design, using fallback');
      design = GameHelpers.createFallbackDesign(experimentType);
    }

    // If this is a 2P experiment with a GPT partner on either side,
    // prefetch the exact model so partnerAgentType records it from the start
    try {
      const p1Type = CONFIG?.game?.players?.player1?.type;
      const p2Type = CONFIG?.game?.players?.player2?.type;
      if (String(experimentType || '').includes('2P') && (p1Type === 'gpt' || p2Type === 'gpt')) {
        await this.logCurrentAIModel();
      }
    } catch (_) { /* noop */ }

    // Initialize trial
    this.gameStateManager.initializeTrial(this.currentTrialIndex, experimentType, design);

    // Update UI
    this.uiManager.updateGameInfo(this.currentExperimentIndex, this.currentTrialIndex, experimentType);
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    // Start trial based on experiment type
    this.startTrialExecution(experimentType);
  }

  startTrialExecution(experimentType) {
    // Clear any existing intervals
    this.clearGameIntervals();

    // Start appropriate trial type
    switch (experimentType) {
      case '1P1G':
        this.runTrial1P1G();
        break;
      case '1P2G':
        this.runTrial1P2G();
        break;
      case '2P2G':
        this.runTrial2P2G();
        break;
      case '2P3G':
        this.runTrial2P3G();
        break;
      default:
        console.error('Unknown experiment type:', experimentType);
    }

    // Set up game timeout
    this.setupGameTimeout();
  }

  runTrial1P1G() {
    // Single player, single goal - just wait for player to reach goal
    // The GameStateManager handles move processing and goal checking
  }

  runTrial1P2G() {
    // Single player, two goals - handle new goal presentation
    this.setupNewGoalCheck1P2G();
  }

  runTrial2P2G() {
    // Two players, two goals - check if AI or human player 2
    const p1Type = CONFIG.game.players.player1.type;
    const p2Type = CONFIG.game.players.player2.type;
    if (p2Type !== 'human' || p1Type !== 'human') {
      // Determine which side is AI
      this.aiPlayerNumber = (p2Type !== 'human') ? 2 : 1;
      // Log current AI model/config for visibility
      this.logCurrentAIModel();
      if (CONFIG.game.agent.synchronizedMoves) {
        console.log('2P2G: Synchronized human-AI moves enabled');
        this.setupIndependentAIAfterHumanGoal();
      } else {
        this.setupAIMovement();
      }
    } else {
      // Human-human mode - no AI movement setup needed
      console.log('2P2G: Human-human mode - waiting for network player actions');
    }
  }

  runTrial2P3G() {
    // Two players, three goals - check if AI or human player 2
    const p1Type = CONFIG.game.players.player1.type;
    const p2Type = CONFIG.game.players.player2.type;
    if (p2Type !== 'human' || p1Type !== 'human') {
      this.aiPlayerNumber = (p2Type !== 'human') ? 2 : 1;
      // Log current AI model/config for visibility
      this.logCurrentAIModel();
      if (CONFIG.game.agent.synchronizedMoves) {
        console.log('2P3G: Synchronized human-AI moves enabled');
        this.setupIndependentAIAfterHumanGoal();
      } else {
        this.setupAIMovement();
      }
    } else {
      // Human-human mode - no AI movement setup needed
      console.log('2P3G: Human-human mode - waiting for network player actions');
    }
    this.setupNewGoalCheck2P3G();
  }

  async logCurrentAIModel() {
    try {
      const p2Type = CONFIG?.game?.players?.player2?.type;
      if (p2Type === 'gpt') {
        const base = (CONFIG.server.url || '').replace(/\/$/, '');
        const resp = await fetch(`${base}/api/ai/gpt/config`);
        if (resp.ok) {
          const info = await resp.json();
          const model = info?.model || '(unknown)';
          // Persist model for data recording
          try {
            if (model && model !== '(unknown)') {
              CONFIG.game.agent.gpt.model = model;
              // Update current trial's partnerAgentType if available
              const td = this.gameStateManager?.trialData;
              const st = this.gameStateManager?.currentState;
              if (td && st && String(st.experimentType || '').includes('2P')) {
                td.partnerAgentType = model;
                // If a fallback occurred earlier and the fallback AI type was generic 'gpt',
                // upgrade it to the exact model string for accurate export
                if (td.partnerFallbackOccurred) {
                  if (!td.partnerFallbackAIType || /^gpt$/i.test(String(td.partnerFallbackAIType))) {
                    td.partnerFallbackAIType = model;
                  }
                  // Also update experiment-level fallbackEvents for this trial if present
                  try {
                    const exp = this.gameStateManager?.experimentData;
                    const curIdx = Number.isInteger(st.trialIndex) ? st.trialIndex : null;
                    if (exp && Array.isArray(exp.fallbackEvents)) {
                      exp.fallbackEvents.forEach(evt => {
                        const matchIdx = (curIdx !== null) ? (evt.trialIndex === curIdx) : true;
                        if (matchIdx && (!evt.aiType || /^gpt$/i.test(String(evt.aiType)))) {
                          evt.aiType = model;
                        }
                      });
                    }
                  } catch (_) { /* noop */ }
                }
              }
              // Also sweep existing saved trials to upgrade any generic 'gpt' fallback entries
              try {
                const exp = this.gameStateManager?.experimentData;
                if (exp && Array.isArray(exp.allTrialsData)) {
                  exp.allTrialsData.forEach(tr => {
                    if (tr && tr.partnerFallbackOccurred && (!tr.partnerFallbackAIType || /^gpt$/i.test(String(tr.partnerFallbackAIType)))) {
                      tr.partnerFallbackAIType = model;
                    }
                    if (tr && String(tr.partnerAgentType || '').toLowerCase() === 'gpt') {
                      tr.partnerAgentType = model;
                    }
                  });
                }
                if (exp && Array.isArray(exp.fallbackEvents)) {
                  exp.fallbackEvents.forEach(evt => {
                    if (evt && (!evt.aiType || /^gpt$/i.test(String(evt.aiType)))) {
                      evt.aiType = model;
                    }
                  });
                }
              } catch (_) { /* noop */ }
            }
          } catch (_) { /* ignore */ }
        }
      } else if (p2Type === 'rl_joint' || p2Type === 'rl_individual' || p2Type === 'ai') {
        const mode = CONFIG?.game?.agent?.type || (p2Type === 'rl_joint' ? 'joint' : 'individual');
        console.log(`🤖 AI partner: RL mode = ${mode}`);
      }
    } catch (e) {
      console.log('🤖 AI partner: failed to log model info:', e?.message || e);
    }
  }

  // In both sync and legacy modes, when human reaches a goal, start independent AI movement
  setupIndependentAIAfterHumanGoal() {
    let humanAtGoal = false;
    const checkPlayerGoal = setInterval(() => {
      const gameState = this.gameStateManager.getCurrentState();
      if (!gameState.player1 || !gameState.player2) return;

      const humanNum = (this.aiPlayerNumber === 1) ? 2 : 1;
      const humanPos = (humanNum === 1) ? gameState.player1 : gameState.player2;
      const currentHumanAtGoal = GameHelpers.isGoalReached(humanPos, gameState.currentGoals);

      if (!humanAtGoal && currentHumanAtGoal) {
        humanAtGoal = true;
        this.startIndependentAIMovement();
      }
    }, 100);

    // Store interval for cleanup
    this.gameLoopInterval = checkPlayerGoal;
  }

  // Handle synchronized move: apply human + AI/GPT moves together, then redraw once
  async handleSynchronizedMove(humanDirection) {
    // Active when either player is AI/GPT
    const p1Type = CONFIG.game.players.player1.type;
    const p2Type = CONFIG.game.players.player2.type;
    if (p1Type === 'human' && p2Type === 'human') return;

    const gameState = this.gameStateManager.getCurrentState();
    if (!gameState.player1 || !gameState.player2) return;

    // Determine human/AI mapping
    const humanPlayerNumber = (this.aiPlayerNumber === 1) ? 2 : 1;

    // Generate AI/GPT direction
    let aiDirection = null;
    const isGptAllowed = (gameState.experimentType === '2P2G' || gameState.experimentType === '2P3G');
    let gptError = null;

    // Determine which side is AI and its configured type
    const aiType = (this.aiPlayerNumber === 1)
      ? CONFIG.game.players.player1.type
      : CONFIG.game.players.player2.type;

    if (aiType === 'gpt' && isGptAllowed) {
      try {
        aiDirection = await this.gptClient.getNextAction(
          {
            ...gameState,
            trialData: this.gameStateManager.getCurrentTrialData()
          },
          { aiPlayerNumber: this.aiPlayerNumber }
        );
      } catch (e) {
        gptError = e;
        console.warn('GPT agent request failed during synchronized move; falling back to RL:', e?.message || e);
      }
    }
    if (!aiDirection) {
      if (!this.rlAgent) return; // Safety
      const aiAction = this.rlAgent.getAIAction(
        gameState.gridMatrix,
        (this.aiPlayerNumber === 1) ? gameState.player1 : gameState.player2,
        gameState.currentGoals,
        (this.aiPlayerNumber === 1) ? gameState.player2 : gameState.player1
      );
      aiDirection = this.actionToDirection(aiAction);

      // If GPT error occurred, record the event with fallback details
      if (gptError) {
        this.gameStateManager.recordGptErrorEvent({
          phase: 'synchronized',
          error: gptError?.message || String(gptError),
          humanDirection,
          fallback: 'rl',
          fallbackDirection: aiDirection
        });
      }
    }

    // Apply both moves before a single redraw, mapped to correct players
    let syncResult;
    if (humanPlayerNumber === 1) {
      syncResult = this.gameStateManager.processSynchronizedMoves(humanDirection, aiDirection);
    } else {
      syncResult = this.gameStateManager.processSynchronizedMovesMapped(2, humanDirection, aiDirection);
    }

    // Redraw once with both positions updated
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    // If human reached a goal, ensure independent AI movement starts immediately
    try {
      const stateAfter = this.gameStateManager.getCurrentState();
      const humanPos = (humanPlayerNumber === 1) ? stateAfter.player1 : stateAfter.player2;
      const aiPos = (this.aiPlayerNumber === 1) ? stateAfter.player1 : stateAfter.player2;
      const humanAtGoal = GameHelpers.isGoalReached(humanPos, stateAfter.currentGoals);
      const aiAtGoal = GameHelpers.isGoalReached(aiPos, stateAfter.currentGoals);
      if (humanAtGoal && !aiAtGoal && !this.aiMoveInterval) {
        this.startIndependentAIMovement();
      }
    } catch (_) { /* noop */ }

    if (syncResult?.trialComplete) {
      this.handleTrialComplete(syncResult);
    }
  }

  setupAIMovement() {
    // Proceed for both RL and GPT-based AI

    const aiMoveDelay = CONFIG.game.agent.delay;
    let player1AtGoal = false;

    // AI moves with human initially
    this.uiManager.on('player-move', () => {
      // Check if this is a multiplayer game and AI should move
      const gameState = this.gameStateManager.getCurrentState();
      if (!gameState.player2) return;

      // Don't move AI if it's already at a goal
      if (GameHelpers.isGoalReached(gameState.player2, gameState.currentGoals)) {
        return;
      }

      setTimeout(() => {
        // Fire and forget; makeAIMove may be async (GPT)
        this.makeAIMove();
      }, aiMoveDelay);
    });

    // Monitor for when player1 reaches goal to start independent AI movement
    const checkPlayerGoal = setInterval(() => {
      const gameState = this.gameStateManager.getCurrentState();
      if (!gameState.player1 || !gameState.player2) return;

      const currentPlayer1AtGoal = GameHelpers.isGoalReached(gameState.player1, gameState.currentGoals);

      if (!player1AtGoal && currentPlayer1AtGoal) {
        // Player1 just reached goal
        player1AtGoal = true;
        this.startIndependentAIMovement();
      }
    }, 100);

    // Store interval for cleanup
    this.gameLoopInterval = checkPlayerGoal;
  }

  async makeAIMove() {
    const gameState = this.gameStateManager.getCurrentState();
    const aiPos = (this.aiPlayerNumber === 1) ? gameState.player1 : gameState.player2;
    if (!aiPos || !gameState.currentGoals) return;

    // Don't move if AI is already at a goal
    if (GameHelpers.isGoalReached(aiPos, gameState.currentGoals)) {
      return;
    }

    // Decide action depending on agent type
    let direction = null;
    const aiType = (this.aiPlayerNumber === 1)
      ? CONFIG.game.players.player1.type
      : CONFIG.game.players.player2.type;
    const isGptAllowed = (gameState.experimentType === '2P2G' || gameState.experimentType === '2P3G');
    let gptError = null;


    if (aiType === 'gpt' && isGptAllowed) {
      try {
        direction = await this.gptClient.getNextAction(
          {
            ...gameState,
            trialData: this.gameStateManager.getCurrentTrialData()
          },
          { aiPlayerNumber: this.aiPlayerNumber }
        );
      } catch (err) {
        gptError = err;
        console.warn('GPT agent failed, falling back to RL. Reason:', err?.message || err);
      }
    }

    if (!direction) {
      if (!this.rlAgent) return;
      const aiAction = this.rlAgent.getAIAction(
        gameState.gridMatrix,
        (this.aiPlayerNumber === 1) ? gameState.player1 : gameState.player2,
        gameState.currentGoals,
        (this.aiPlayerNumber === 1) ? gameState.player2 : gameState.player1
      );
      if (aiAction[0] === 0 && aiAction[1] === 0) {
        return; // No movement
      }
      direction = this.actionToDirection(aiAction);

      // If GPT error occurred, record the event with fallback details
      if (gptError) {
        this.gameStateManager.recordGptErrorEvent({
          phase: 'independent',
          error: gptError?.message || String(gptError),
          humanDirection: null,
          fallback: 'rl',
          fallbackDirection: direction
        });
      }
    }
    if (direction) {
      const moveResult = this.gameStateManager.processPlayerMove(this.aiPlayerNumber, direction);
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

      if (moveResult.trialComplete) {
        this.handleTrialComplete(moveResult);
      }
    }
  }

  startIndependentAIMovement() {
    // Clear any existing AI interval
    if (this.aiMoveInterval) {
      clearInterval(this.aiMoveInterval);
    }

    // Start independent AI movement at slower pace
    this.aiMoveInterval = setInterval(() => {
      const gameState = this.gameStateManager.getCurrentState();
      const aiPos = (this.aiPlayerNumber === 1) ? gameState.player1 : gameState.player2;
      if (!aiPos) return;

      // Stop if AI reached a goal
      if (GameHelpers.isGoalReached(aiPos, gameState.currentGoals)) {
        clearInterval(this.aiMoveInterval);
        this.aiMoveInterval = null;
        return;
      }

      // Fire and forget; makeAIMove may be async
      this.makeAIMove();
    }, CONFIG.game.agent.independentDelay);
  }

  setupNewGoalCheck1P2G() {
    // Present new goal for 1P2G after player shows intent to a goal (legacy-inspired)
    const checkInterval = 100;
    // Clear any existing new-goal interval first
    if (this.newGoalIntervalId) {
      clearInterval(this.newGoalIntervalId);
      this.newGoalIntervalId = null;
    }

    const intervalId = setInterval(() => {
      // Use live internal references to avoid mutating getter copies
      const state = this.gameStateManager.currentState;
      const trial = this.gameStateManager.trialData;

      if (!state || !trial) return;
      if (trial.newGoalPresented) return;
      if (state.experimentType !== '1P2G') return;

      // Require exactly 2 goals before adding the third
      if (!state.currentGoals || state.currentGoals.length !== 2) return;

      // Ensure minimum steps before presenting
      if (this.gameStateManager.stepCount < (CONFIG.oneP2G?.minStepsBeforeNewGoal ?? 0)) return;

      const distanceCondition = trial.distanceCondition || trial.newGoalConditionType || CONFIG.oneP2G.distanceConditions.CLOSER_TO_PLAYER1;
      const result = NewGoalGenerator.checkNewGoalPresentation1P2G(
        this.gameStateManager.getCurrentState(), // safe read-only snapshot
        this.gameStateManager.getCurrentTrialData(),
        distanceCondition
      );
      if (!result) return;

      // Apply changes to internal state via GameStateManager APIs
      this.gameStateManager.addGoal(result.position);
      this.gameStateManager.markNewGoalPresented(result.position, distanceCondition, {});

      // Reset RL pre-calculation if available
      if (this.rlAgent && typeof this.rlAgent.resetNewGoalPreCalculationFlag === 'function') {
        this.rlAgent.resetNewGoalPreCalculationFlag();
      }

      // Redraw
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
    }, checkInterval);

    // Track interval for cleanup
    this.newGoalIntervalId = intervalId;
  }

  setupNewGoalCheck2P3G() {
    // Present third goal when both players first reveal same goal
    const checkInterval = 100;
    // Clear any existing new-goal interval first
    if (this.newGoalIntervalId) {
      clearInterval(this.newGoalIntervalId);
      this.newGoalIntervalId = null;
    }
    // Reset debug logging flag for this setup
    this._loggedFallbackMode = false;

    const intervalId = setInterval(() => {
      // In human-human mode, only the host (playerIndex 0) should generate the new goal
      // After fallback to AI, we should continue generating goals (no longer need host restriction)
      const isCurrentlyHumanHuman = (CONFIG.game.players.player1.type === 'human' && CONFIG.game.players.player2.type === 'human');
      if (isCurrentlyHumanHuman) {
        const isHost = !!this.timelineManager && this.timelineManager.playerIndex === 0;
        if (!isHost) {
          return; // Non-host waits for host to broadcast state
        }
      }
      // After AI fallback, both human-AI combinations should generate goals locally

      // Debug logging for fallback scenarios (only log once per setup)
      if (!isCurrentlyHumanHuman && !this._loggedFallbackMode) {
        // This means we're in human-AI mode (either originally or after fallback)
        const p1Type = CONFIG.game.players.player1.type;
        const p2Type = CONFIG.game.players.player2.type;
        try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] New goal check active in human-AI mode: P1=${p1Type}, P2=${p2Type}, aiPlayerNumber=${this.aiPlayerNumber}`); } catch (_) {}
        this._loggedFallbackMode = true;
      }

      // Use live internal references to avoid mutating getter copies
      const state = this.gameStateManager.currentState;
      const trial = this.gameStateManager.trialData;
      if (!state || !trial) return;
      if (trial.newGoalPresented) return;
      if (state.experimentType !== '2P3G') return;

      // Ensure we currently have exactly two goals (third will be added)
      if (!state.currentGoals || state.currentGoals.length < 2) return;

      // Ensure both players exist
      if (!state.player1 || !state.player2) return;

      const distanceCondition = trial.distanceCondition || trial.newGoalConditionType || CONFIG.twoP3G.distanceConditions.CLOSER_TO_PLAYER2;
      let gen = NewGoalGenerator.checkNewGoalPresentation2P3G(
        this.gameStateManager.getCurrentState(),
        this.gameStateManager.getCurrentTrialData(),
        distanceCondition
      );
      // Fallback: if we previously detected a shared goal but missed generation timing,
      // synthesize the new goal directly from the recorded shared goal index
      if (!gen && typeof trial.firstDetectedSharedGoal === 'number' && trial.firstDetectedSharedGoal !== null) {
        try {
          const direct = NewGoalGenerator.generateNewGoal(
            state.player2, state.player1, state.currentGoals,
            trial.firstDetectedSharedGoal, distanceCondition
          );
          if (direct && direct.position) {
            gen = direct;
          }
        } catch (_) { /* ignore fallback errors */ }
      }

      if (!gen) return;

      // Double-check that we haven't already presented a goal (race condition protection)
      if (this.gameStateManager.trialData?.newGoalPresented) {
        console.log('🔧 [RACE PROTECTION] Goal already presented, skipping duplicate generation');
        return;
      }

      console.log('🎯 [GOAL GEN] Generating new goal at position:', gen.position);

      // Apply changes to internal state via GameStateManager APIs
      this.gameStateManager.addGoal(gen.position);
      const closerInfo = (typeof gen.distanceToPlayer2 === 'number' && typeof gen.distanceToPlayer1 === 'number')
        ? { isNewGoalCloserToPlayer2: gen.distanceToPlayer2 < gen.distanceToPlayer1 }
        : {};
      this.gameStateManager.markNewGoalPresented(gen.position, distanceCondition, closerInfo);

      // Reset RL pre-calculation if available
      if (this.rlAgent && typeof this.rlAgent.resetNewGoalPreCalculationFlag === 'function') {
        this.rlAgent.resetNewGoalPreCalculationFlag();
      }

      // Redraw
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

      // Broadcast synchronized state to partner in human-human mode
      // After AI fallback, no network sync needed since AI is local
      if (isCurrentlyHumanHuman) {
        try {
          const nm = window.__NETWORK_MANAGER__;
          if (nm && typeof nm.syncGameState === 'function') {
            nm.syncGameState(this.gameStateManager.getCurrentState());
          }
        } catch (_) { /* ignore */ }
      }
    }, checkInterval);

    // Track interval for cleanup
    this.newGoalIntervalId = intervalId;
  }

  actionToDirection(action) {
    const [deltaRow, deltaCol] = action;

    if (deltaRow === -1 && deltaCol === 0) return 'up';
    if (deltaRow === 1 && deltaCol === 0) return 'down';
    if (deltaRow === 0 && deltaCol === -1) return 'left';
    if (deltaRow === 0 && deltaCol === 1) return 'right';

    return null;
  }

  setupGameTimeout() {
    const durationMs = Number(CONFIG?.game?.timing?.maxTrialDurationMs) || 0;
    if (durationMs > 0) {
      const timeout = setTimeout(() => {
        console.log('Game timeout reached');
        this.handleTrialComplete({ success: false, timeout: true });
      }, durationMs);
      this.gameTimeoutId = timeout;
    } else {
      try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Trial time cap disabled (maxTrialDurationMs=0)'); } catch (_) {}
    }
  }

  handleTrialComplete(result) {
    console.log('Trial completed:', result);

    // If we're using timeline manager, delegate to timeline handler
    if (this.timelineManager && this.currentTrialCompleteCallback) {
      this.handleTimelineTrialComplete(result);
      return;
    }

    // Original standalone logic
    // Clear intervals
    this.clearGameIntervals();

    // Note: finalizeTrial is handled by handleTimelineTrialComplete when using timeline
    // For standalone mode, finalize trial data
    this.gameStateManager.finalizeTrial(result.success || result.trialComplete);

    // Show feedback
    this.uiManager.showTrialFeedback(result);

    // Move to next trial after delay
    setTimeout(() => {
      this.currentTrialIndex++;

      // Check if we still have experiments to run
      if (this.currentExperimentIndex >= this.currentExperimentSequence.length) {
        console.log('All experiments completed during timeout');
        this.completeAllExperiments();
        return;
      }

      const currentExperiment = this.currentExperimentSequence[this.currentExperimentIndex];
      if (currentExperiment) {
        this.startNextTrial(currentExperiment);
      } else {
        console.error('No current experiment found, completing all experiments');
        this.completeAllExperiments();
      }
    }, CONFIG.game.timing.trialToFeedbackDelay + CONFIG.game.timing.feedbackDisplayDuration);
  }

  shouldEndExperimentEarly(experimentType) {
    if (!CONFIG.game.successThreshold.enabled) return false;

    const experimentData = this.gameStateManager.getExperimentData();
    const threshold = experimentData.successThreshold;

    return threshold.consecutiveSuccesses >= CONFIG.game.successThreshold.consecutiveSuccessesRequired &&
           threshold.totalTrialsCompleted >= CONFIG.game.successThreshold.minTrialsBeforeCheck;
  }

  completeAllExperiments() {
    // Prevent multiple calls to completeAllExperiments
    if (!this.isRunning) {
      console.log('Experiments already completed, ignoring duplicate call');
      return;
    }

    console.log('All experiments completed');
    this.isRunning = false;

    // Get final results
    const experimentData = this.gameStateManager.getExperimentData();
    const results = {
      totalTrials: experimentData.allTrialsData.length,
      successfulTrials: experimentData.allTrialsData.filter(t => t.completed || t.collaborationSucceeded).length,
      successRate: GameHelpers.calculateSuccessRate(experimentData.allTrialsData),
      totalTime: GameHelpers.formatDuration(Date.now() - (experimentData.allTrialsData[0]?.trialStartTime || Date.now()))
    };

    // Show completion screen
    this.uiManager.showExperimentComplete(results);

    // Export data if needed
    this.exportExperimentData(experimentData);
  }

  exportExperimentData(data) {
    // Local file export removed per requirement; data should be saved via timeline flow
    console.log('Export suppressed: data saving handled by timeline (cloud only).');
  }

  // Multiplayer experiment support
  async startMultiplayerExperiment(config) {
    console.log('Starting multiplayer experiment:', config);

    // Configure for multiplayer mode
    this.currentExperimentSequence = [config.experimentType];

    // Disable AI agent for human-human mode
    if (config.gameMode === 'human-human') {
      this.rlAgent = null;
    }

    await this.startExperimentSequence();
  }

  async getTrialDesign(experimentType, trialIndex) {
    // Safety check for undefined experimentType
    if (!experimentType) {
      console.error('getTrialDesign called with undefined experimentType');
      return null;
    }

    console.log(`🗺️ Loading trial design for ${experimentType} trial ${trialIndex}`);

    // Ensure map data is loaded
    await this.ensureMapDataLoaded();

    try {
      // For collaboration experiments after trial 12, use random maps
      if (experimentType.includes('2P') && trialIndex >= CONFIG.game.successThreshold.randomSamplingAfterTrial) {
        const randomDesign = this.mapLoader.getRandomMapForCollaborationGame(experimentType, trialIndex);
        if (randomDesign) {
          console.log('✅ Loaded random map design:', randomDesign);
          return randomDesign;
        }
      }

      // Get maps for experiment type
      const mapsForExperiment = this.mapLoader.getMapsForExperiment(experimentType);
      console.log(`🗺️ Available maps for ${experimentType}:`, Object.keys(mapsForExperiment || {}).length);

      if (!mapsForExperiment || Object.keys(mapsForExperiment).length === 0) {
        console.warn('⚠️ No maps available, using fallback design');
        return this.mapLoader.createFallbackDesign(experimentType);
      }

      // Select map based on trial index (or randomly if too many trials)
      const mapKeys = Object.keys(mapsForExperiment);
      const selectedKey = mapKeys[trialIndex % mapKeys.length];
      const selectedMapArray = mapsForExperiment[selectedKey];

      if (Array.isArray(selectedMapArray) && selectedMapArray.length > 0) {
        const design = { ...selectedMapArray[0] }; // Clone the design
        console.log(`✅ Loaded map design for trial ${trialIndex}:`, design);
        return design;
      }

      console.warn('⚠️ Invalid map structure, using fallback design');
      return this.mapLoader.createFallbackDesign(experimentType);

    } catch (error) {
      console.error('❌ Error loading trial design:', error);
      return this.mapLoader.createFallbackDesign(experimentType);
    }
  }

  async ensureMapDataLoaded() {
    if (!this.mapLoader.mapData) {
      console.log('🗺️ Waiting for map data to load...');
      await this.mapLoader.initialize();
      console.log('✅ Map data loaded for ExperimentManager');
    }
  }

  clearGameIntervals() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }

    if (this.aiMoveInterval) {
      clearInterval(this.aiMoveInterval);
      this.aiMoveInterval = null;
    }

    if (this.newGoalIntervalId) {
      clearInterval(this.newGoalIntervalId);
      this.newGoalIntervalId = null;
    }

    if (this.gameTimeoutId) {
      clearTimeout(this.gameTimeoutId);
      this.gameTimeoutId = null;
    }
  }

  // Timeline Integration
  setupTimelineIntegration() {
    if (!this.timelineManager) return;

    // Handle timeline events
    this.timelineManager.on('show-fixation', (data) => {
      this.handleFixationDisplay(data);
    });

    this.timelineManager.on('start-trial', (data) => {
      this.handleTimelineTrialStart(data);
    });

    this.timelineManager.on('show-trial-feedback', (data) => {
      this.handleTrialFeedback(data);
    });

    // Handle AI fallback activation from timeline
    this.timelineManager.on('ai-fallback-activated', (data) => {
      try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] ExperimentManager received ai-fallback-activated event:', data); } catch (_) {}
      const { fallbackType, aiPlayerNumber } = data;
      this.activateAIFallback(fallbackType, aiPlayerNumber);
    });

    console.log('✅ Timeline integration setup completed');
  }

  handleFixationDisplay(data) {
    const { experimentType, experimentIndex, trialIndex } = data;
    console.log(`⚡ Showing fixation for ${experimentType} trial ${trialIndex}`);

    // Find the fixation container that timeline created
    const fixationContainer = document.getElementById('fixation-canvas-container');
    if (fixationContainer) {
      // Add fixation cross to the timeline's container instead of replacing the whole page
      fixationContainer.innerHTML = `
        <div style="font-size: 48px; font-weight: bold; color: #333; padding: 50px;">
          +
        </div>
      `;
      console.log('✅ Fixation cross added to timeline container');
    } else {
      console.warn('⚠️ Fixation container not found, timeline may not be set up properly');
      // Fallback: use UIManager's method
      this.uiManager.showFixation();
    }
  }

  async handleTimelineTrialStart(data) {
    const { experimentType, experimentIndex, trialIndex, onComplete } = data;
    console.log(`🎮 Timeline starting trial ${trialIndex} of ${experimentType}`);

    // Store completion callback
    this.currentTrialCompleteCallback = onComplete;

    try {
      // Get trial design (now async)
      let design = await this.getTrialDesign(experimentType, trialIndex);
      if (!design) {
        console.error('Failed to get trial design, using fallback');
        design = GameHelpers.createFallbackDesign(experimentType);
      }

      // Initialize trial
      this.gameStateManager.initializeTrial(trialIndex, experimentType, design);

      // Update UI - use timeline's game container
      this.uiManager.updateGameInfo(experimentIndex, trialIndex, experimentType);

      // Set up game canvas in timeline's container
      const gameContainer = document.getElementById('game-canvas-container');
      if (gameContainer) {
        console.log('✅ Found timeline game container, setting up game canvas');
        this.uiManager.setupGameCanvasInContainer(gameContainer);
      } else {
        console.warn('⚠️ Timeline game container not found, using fallback');
      }

      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

      // Start trial execution
      this.startTimelineTrialExecution(experimentType);

    } catch (error) {
      console.error('❌ Error starting timeline trial:', error);
      // Use fallback design if everything fails
      const fallbackDesign = GameHelpers.createFallbackDesign(experimentType);
      this.gameStateManager.initializeTrial(trialIndex, experimentType, fallbackDesign);
      this.uiManager.updateGameInfo(experimentIndex, trialIndex, experimentType);
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
      this.startTimelineTrialExecution(experimentType);
    }
  }

  startTimelineTrialExecution(experimentType) {
    // Clear any existing intervals
    this.clearGameIntervals();

    // Start appropriate trial type
    switch (experimentType) {
      case '1P1G':
        this.runTrial1P1G();
        break;
      case '1P2G':
        this.runTrial1P2G();
        break;
      case '2P2G':
        this.runTrial2P2G();
        break;
      case '2P3G':
        this.runTrial2P3G();
        break;
      default:
        console.error('Unknown experiment type:', experimentType);
    }

    // Set up game timeout
    this.setupTimelineGameTimeout();
  }

  setupTimelineGameTimeout() {
    const durationMs = Number(CONFIG?.game?.timing?.maxTrialDurationMs) || 0;
    if (durationMs > 0) {
      const timeout = setTimeout(() => {
        console.log('Game timeout reached');
        this.handleTimelineTrialComplete({ success: false, timeout: true });
      }, durationMs);
      this.gameTimeoutId = timeout;
    } else {
      try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Timeline trial time cap disabled (maxTrialDurationMs=0)'); } catch (_) {}
    }
  }

  handleTimelineTrialComplete(result) {
    console.log('Timeline trial completed:', result);

    // Clear intervals
    this.clearGameIntervals();

    // Determine success based on experiment type
    const currentTrialData = this.gameStateManager.getCurrentTrialData();
    const experimentType = this.gameStateManager.getCurrentState().experimentType;
    let success;
    if (experimentType && experimentType.startsWith('1P')) {
      // Single player experiments - use result success
      success = !!(result.success || result.trialComplete);
    } else {
      // 2P experiments - use collaboration success (coerce to boolean; default false)
      if (typeof currentTrialData.collaborationSucceeded !== 'boolean') {
        currentTrialData.collaborationSucceeded = false;
      }
      success = currentTrialData.collaborationSucceeded === true;
    }

    // Finalize trial data
    this.gameStateManager.finalizeTrial(success);

    // Get trial data for timeline
    const trialData = {
      ...result,
      success: success, // Override with correct success value
      trialData: this.gameStateManager.getCurrentTrialData(),
      gameState: this.gameStateManager.getCurrentState()
    };

    // Call timeline completion callback
    if (this.currentTrialCompleteCallback) {
      this.currentTrialCompleteCallback(trialData);
      this.currentTrialCompleteCallback = null;
    }
  }

  handleTrialFeedback(data) {
    const { success, experimentType, trialIndex, canvasContainer } = data;
    console.log(`📊 Showing trial feedback for ${experimentType} trial ${trialIndex}`);

    // Determine message type based on experiment type
    const messageType = experimentType.startsWith('1P') ? 'single' : 'collaboration';

    // Create feedback display in the provided container
    this.uiManager.showTrialFeedbackInContainer(success, canvasContainer, messageType);
  }

  // Public API
  restart() {
    this.clearGameIntervals();
    this.gameStateManager.reset();
    this.currentExperimentIndex = 0;
    this.currentTrialIndex = 0;
    this.isRunning = false;
  }

  pause() {
    this.clearGameIntervals();
  }

  resume() {
    if (this.isRunning && this.currentExperimentIndex < this.currentExperimentSequence.length) {
      const currentExperiment = this.currentExperimentSequence[this.currentExperimentIndex];
      if (currentExperiment) {
        this.startTrialExecution(currentExperiment);
      } else {
        console.error('No current experiment found during resume');
      }
    }
  }
}
