import { CONFIG, GAME_OBJECTS, GameConfigUtils } from '../config/gameConfig.js';
import { RLAgent } from '../ai/RLAgent.js';
import { GptAgentClient } from '../ai/GptAgentClient.js';
import { WeIntentAgent } from '../ai/WeIntentAgent.js';
import { VlmAgentClient } from '../ai/VlmAgentClient.js';
import { GameHelpers } from '../utils/GameHelpers.js';
import { NewGoalGenerator } from '../utils/NewGoalGenerator.js';
import { mapLoader } from '../utils/MapLoader.js';
import { MapParser } from '../utils/MapParser.js';

export class ExperimentManager {
  constructor(gameStateManager, uiManager, timelineManager = null) {
    this.gameStateManager = gameStateManager;
    this.uiManager = uiManager;
    this.timelineManager = timelineManager;
    this.rlAgent = new RLAgent();
    this.gptClient = new GptAgentClient();
    this.weIntentAgent = new WeIntentAgent();
    this.vlmClient = new VlmAgentClient();

    this.currentExperimentSequence = [];
    this.currentExperimentIndex = 0;
    this.currentTrialIndex = 0;
    this.isRunning = false;
    this.gameLoopInterval = null;
    this.aiMoveInterval = null;
    this.newGoalIntervalId = null;
    this.aiPlayerNumber = 2; // 1 or 2; default assume AI is player 2
    this.sampledMapsByExperiment = {};

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
          } else if (fallbackType === 'rl_individual_python') {
            td.partnerAgentType = 'individual-rl-python';
          } else {
            td.partnerAgentType = String(fallbackType);
          }
          // Record who is human vs AI (0-based for external analysis)
          td.humanPlayerIndex = (humanPlayerNumber - 1);
          td.aiPlayerIndex = (this.aiPlayerNumber - 1);
        }
      } catch (_) { /* ignore */ }

      // Set up AI movement based on the game's move mode
      const moveMode = CONFIG?.game?.moveMode || 'simultaneous';
      if (moveMode === 'free') {
        try { if (!CONFIG?.debug?.disableConsoleLogs) console.log('[DEBUG] Setting up AI movement (free/independent mode)'); } catch (_) {}
        this.setupAIMovement();
      } else {
        console.log(`🤖 AI fallback activated (${moveMode} moves)`);
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
    this.sampledMapsByExperiment = {};

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
      const needsRemoteAI = (t) => (
        t === 'gpt' || t === 'gpt-ToM' || t === 'vlm' || t === 'vlm-ToM'
      );
      if (GameConfigUtils.isTwoPlayerExperiment(experimentType)
        && (needsRemoteAI(p1Type) || needsRemoteAI(p2Type))) {
        await this.logCurrentAIModel();
      }
    } catch (_) { /* noop */ }

    // Legacy welcome screen has no canvas; create game layout before rendering state
    if (this.uiManager && this.uiManager.currentScreen !== 'game') {
      this.uiManager.showGameScreen();
    }

    // Initialize trial
    this.gameStateManager.initializeTrial(this.currentTrialIndex, experimentType, design);

    // Update UI
    this.uiManager.updateGameInfo(this.currentExperimentIndex, this.currentTrialIndex, experimentType);
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    // Reset WeIntentAgent beliefs at each trial start
    if (this.weIntentAgent) {
      this.weIntentAgent.reset();
    }

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
      case 'StagHunt':
      case 'StagHuntTwoStags':
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
      const moveMode = CONFIG?.game?.moveMode || 'simultaneous';
      if (moveMode === 'free') {
        this.setupAIMovement();
      } else {
        console.log(`2P2G: ${moveMode} human-AI moves enabled`);
        this.setupIndependentAIAfterHumanGoal();
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
      const moveMode = CONFIG?.game?.moveMode || 'simultaneous';
      if (moveMode === 'free') {
        this.setupAIMovement();
      } else {
        console.log(`2P3G: ${moveMode} human-AI moves enabled`);
        this.setupIndependentAIAfterHumanGoal();
      }
    } else {
      // Human-human mode - no AI movement setup needed
      console.log('2P3G: Human-human mode - waiting for network player actions');
    }
    this.setupNewGoalCheck2P3G();
  }

  async logCurrentAIModel() {
    try {
      const p1Type = CONFIG?.game?.players?.player1?.type;
      const p2Type = CONFIG?.game?.players?.player2?.type;
      const base = (CONFIG.server.url || '').replace(/\/$/, '');
      const gptPartner = (t) => t === 'gpt' || t === 'gpt-ToM';
      const vlmPartner = (t) => t === 'vlm' || t === 'vlm-ToM';

      if (gptPartner(p1Type) || gptPartner(p2Type)) {
        const resp = await fetch(`${base}/api/ai/gpt/config`);
        if (resp.ok) {
          const info = await resp.json();
          const model = info?.model || '(unknown)';
          if (info?.hasApiKey === false) {
            console.warn('GPT: server reports OPENAI_API_KEY is missing. GPT requests will fail; check the game server .env.');
          }
          try {
            if (model && model !== '(unknown)') {
              if (!CONFIG.game.agent.gpt) CONFIG.game.agent.gpt = {};
              CONFIG.game.agent.gpt.model = String(model).trim();
              const td = this.gameStateManager?.trialData;
              const st = this.gameStateManager?.currentState;
              if (td && st && GameConfigUtils.isTwoPlayerExperiment(st.experimentType)) {
                td.partnerAgentType = String(model).trim();
              }
            }
          } catch (_) { /* noop */ }
        }
      } else if (vlmPartner(p1Type) || vlmPartner(p2Type)) {
        const resp = await fetch(`${base}/api/ai/vlm/config`);
        if (resp.ok) {
          const info = await resp.json();
          const model = info?.model || '(unknown)';
          const provider = info?.provider || 'openai';
          if (info?.hasApiKey === false) {
            const keyHint = provider === 'google'
              ? 'Set GOOGLE_API_KEY (and VLM_PROVIDER=google if needed) in the game server .env.'
              : 'Set OPENAI_API_KEY in the game server .env, or use VLM_PROVIDER=google with GOOGLE_API_KEY.';
            console.warn(`VLM: server has no API key for provider "${provider}". ${keyHint} Requests will fail and the partner will fall back to RL.`);
          } else {
            try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`VLM: provider=${provider}, model=${model}`); } catch (_) { /* noop */ }
          }
          try {
            if (model && model !== '(unknown)') {
              if (!CONFIG.game.agent.vlm) CONFIG.game.agent.vlm = {};
              CONFIG.game.agent.vlm.model = String(model).trim();
              CONFIG.game.agent.vlm.provider = String(provider).trim();
              const td = this.gameStateManager?.trialData;
              const st = this.gameStateManager?.currentState;
              if (td && st && GameConfigUtils.isTwoPlayerExperiment(st.experimentType)) {
                td.partnerAgentType = String(model).trim();
              }
            }
          } catch (_) { /* noop */ }
        } else {
          console.warn(`VLM: could not reach ${base}/api/ai/vlm/config (HTTP ${resp.status}). Is the game server running and is VITE_SERVER_URL correct?`);
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

  async generateAIDirection(gameState) {
    let aiDirection = null;
    const isGptAllowed = GameConfigUtils.isTwoPlayerExperiment(gameState.experimentType);
    let gptError = null;

    const aiType = (this.aiPlayerNumber === 1)
      ? CONFIG.game.players.player1.type
      : CONFIG.game.players.player2.type;

    if ((aiType === 'gpt' || aiType === 'gpt-ToM') && isGptAllowed) {
      try {
        aiDirection = await this.gptClient.getNextAction(
          { ...gameState, trialData: this.gameStateManager.getCurrentTrialData() },
          { aiPlayerNumber: this.aiPlayerNumber, model: (aiType === 'gpt-ToM' ? 'gpt-ToM' : undefined) }
        );
        if (aiDirection && typeof aiDirection === 'object') {
          if (Object.prototype.hasOwnProperty.call(aiDirection, 'inferredGoal')) {
            this.gameStateManager.recordAIInferredOtherGoal(aiDirection.inferredGoal ?? null);
          }
          aiDirection = aiDirection?.action || null;
        }
      } catch (e) {
        gptError = e;
        console.warn('GPT agent request failed; falling back to RL:', e?.message || e);
      }
    } else if ((aiType === 'vlm' || aiType === 'vlm-ToM') && isGptAllowed) {
      try {
        aiDirection = await this.vlmClient.getNextAction(
          { ...gameState, trialData: this.gameStateManager.getCurrentTrialData() },
          { aiPlayerNumber: this.aiPlayerNumber, model: (aiType === 'vlm-ToM' ? 'vlm-ToM' : undefined) }
        );
        if (aiDirection && typeof aiDirection === 'object') {
          if (Object.prototype.hasOwnProperty.call(aiDirection, 'inferredGoal')) {
            this.gameStateManager.recordAIInferredOtherGoal(aiDirection.inferredGoal ?? null);
          }
          aiDirection = aiDirection?.action || null;
        }
      } catch (e) {
        gptError = e;
        console.warn('VLM agent request failed; falling back to RL:', e?.message || e);
      }
    } else if (aiType === 'we_intent_js') {
      try {
        aiDirection = this.weIntentAgent.getNextAction(
          { ...gameState, trialData: this.gameStateManager.getCurrentTrialData() },
          { aiPlayerNumber: this.aiPlayerNumber }
        );
      } catch (e) {
        console.warn('WeIntentAgent failed, falling back to RL:', e?.message || e);
      }
    }

    if (!aiDirection) {
      if (!this.rlAgent) return { aiDirection: null, gptError };
      const aiAction = this.rlAgent.getAIAction(
        gameState.gridMatrix,
        (this.aiPlayerNumber === 1) ? gameState.player1 : gameState.player2,
        gameState.currentGoals,
        (this.aiPlayerNumber === 1) ? gameState.player2 : gameState.player1,
        this.buildRLContext(gameState)
      );
      aiDirection = this.actionToDirection(aiAction);
    }

    return { aiDirection, gptError };
  }

  // Build an extra-context object for the joint RL planner so rewards and
  // goal types reflect the current map's utility structure.
  buildRLContext(gameState) {
    const design = this.gameStateManager?.getCurrentMapDesign?.() || null;
    const goalTypes = Array.isArray(gameState?.currentGoalTypes)
      ? gameState.currentGoalTypes
      : null;
    const utilitySummary = design?.utility_summary || null;
    return {
      goalTypes,
      utilitySummary,
      experimentType: gameState?.experimentType || null
    };
  }

  // Handle synchronized move: apply human + AI/GPT moves together, then redraw once
  async handleSynchronizedMove(humanDirection) {
    const p1Type = CONFIG.game.players.player1.type;
    const p2Type = CONFIG.game.players.player2.type;
    if (p1Type === 'human' && p2Type === 'human') return;

    const gameState = this.gameStateManager.getCurrentState();
    if (!gameState.player1 || !gameState.player2) return;

    const humanPlayerNumber = (this.aiPlayerNumber === 1) ? 2 : 1;
    const { aiDirection, gptError } = await this.generateAIDirection(gameState);

    if (!aiDirection && !this.rlAgent) return;

    if (gptError && aiDirection) {
      this.gameStateManager.recordGptErrorEvent({
        phase: 'synchronized',
        error: gptError?.message || String(gptError),
        humanDirection,
        fallback: 'rl',
        fallbackDirection: aiDirection
      });
    }

    let syncResult;
    if (humanPlayerNumber === 1) {
      syncResult = this.gameStateManager.processSynchronizedMoves(humanDirection, aiDirection);
    } else {
      syncResult = this.gameStateManager.processSynchronizedMovesMapped(2, humanDirection, aiDirection);
    }

    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

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

  // Handle turn-taking move: apply human move, redraw, then AI move after delay, redraw
  async handleTurnTakingMove(humanDirection) {
    const p1Type = CONFIG.game.players.player1.type;
    const p2Type = CONFIG.game.players.player2.type;
    if (p1Type === 'human' && p2Type === 'human') return;

    const gameState = this.gameStateManager.getCurrentState();
    if (!gameState.player1 || !gameState.player2) return;

    const humanPlayerNumber = (this.aiPlayerNumber === 1) ? 2 : 1;
    const humanPlayerIndex = humanPlayerNumber - 1;

    // Step 1: Apply only the human move
    const humanResult = this.gameStateManager.processPlayerMove(humanPlayerNumber, humanDirection, humanPlayerIndex);
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    if (humanResult?.trialComplete) {
      this.handleTrialComplete(humanResult);
      return;
    }

    // If human reached a goal, start independent AI (timer-based) instead
    const stateAfterHuman = this.gameStateManager.getCurrentState();
    const humanPos = (humanPlayerNumber === 1) ? stateAfterHuman.player1 : stateAfterHuman.player2;
    const humanAtGoal = GameHelpers.isGoalReached(humanPos, stateAfterHuman.currentGoals);
    if (humanAtGoal && !this.aiMoveInterval) {
      this.startIndependentAIMovement();
      return;
    }

    // Step 2: Brief delay so the human move is visually distinct
    const aiDelay = CONFIG.game.agent.delay || 500;
    await new Promise(resolve => setTimeout(resolve, aiDelay));

    // Step 3: Generate and apply AI move on the updated state
    const freshState = this.gameStateManager.getCurrentState();
    const aiPos = (this.aiPlayerNumber === 1) ? freshState.player1 : freshState.player2;
    if (GameHelpers.isGoalReached(aiPos, freshState.currentGoals)) return;

    const { aiDirection, gptError } = await this.generateAIDirection(freshState);
    if (!aiDirection) return;

    if (gptError) {
      this.gameStateManager.recordGptErrorEvent({
        phase: 'turn-taking',
        error: gptError?.message || String(gptError),
        humanDirection,
        fallback: 'rl',
        fallbackDirection: aiDirection
      });
    }

    const aiPlayerIndex = this.aiPlayerNumber - 1;
    const aiResult = this.gameStateManager.processPlayerMove(this.aiPlayerNumber, aiDirection, aiPlayerIndex);
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    if (aiResult?.trialComplete) {
      this.handleTrialComplete(aiResult);
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
    const isGptAllowed = GameConfigUtils.isTwoPlayerExperiment(gameState.experimentType);
    let gptError = null;


    if ((aiType === 'gpt' || aiType === 'gpt-ToM') && isGptAllowed) {
      try {
        direction = await this.gptClient.getNextAction(
          {
            ...gameState,
            trialData: this.gameStateManager.getCurrentTrialData()
          },
          { aiPlayerNumber: this.aiPlayerNumber, model: (aiType === 'gpt-ToM' ? 'gpt-ToM' : undefined) }
        );
        // If ToM variant, store inferred goal and use only the action for movement
        if (direction && typeof direction === 'object') {
          if (Object.prototype.hasOwnProperty.call(direction, 'inferredGoal')) {
            this.gameStateManager.recordAIInferredOtherGoal(direction.inferredGoal ?? null);
          }
          direction = direction?.action || null;
        }
      } catch (err) {
        gptError = err;
        console.warn('GPT agent failed, falling back to RL. Reason:', err?.message || err);
      }
    } else if ((aiType === 'vlm' || aiType === 'vlm-ToM') && isGptAllowed) {
      try {
        direction = await this.vlmClient.getNextAction(
          {
            ...gameState,
            trialData: this.gameStateManager.getCurrentTrialData()
          },
          { aiPlayerNumber: this.aiPlayerNumber, model: (aiType === 'vlm-ToM' ? 'vlm-ToM' : undefined) }
        );
        if (direction && typeof direction === 'object') {
          if (Object.prototype.hasOwnProperty.call(direction, 'inferredGoal')) {
            this.gameStateManager.recordAIInferredOtherGoal(direction.inferredGoal ?? null);
          }
          direction = direction?.action || null;
        }
      } catch (err) {
        gptError = err;
        console.warn('VLM agent failed, falling back to RL. Reason:', err?.message || err);
      }
    }

    if (!direction) {
      if (aiType === 'we_intent_js') {
        try {
          direction = this.weIntentAgent.getNextAction(
            { ...gameState, trialData: this.gameStateManager.getCurrentTrialData() },
            { aiPlayerNumber: this.aiPlayerNumber }
          );
        } catch (e) {
          console.warn('WeIntentAgent failed, falling back to RL:', e?.message || e);
        }
      }
    }

    if (!direction) {
      if (!this.rlAgent) return;
      const aiAction = this.rlAgent.getAIAction(
        gameState.gridMatrix,
        (this.aiPlayerNumber === 1) ? gameState.player1 : gameState.player2,
        gameState.currentGoals,
        (this.aiPlayerNumber === 1) ? gameState.player2 : gameState.player1,
        this.buildRLContext(gameState)
      );
      if (!aiAction) {
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

      // Pre-calculate RL policy at trial start to avoid first-move lag (legacy-inspired)
      try {
        const st = this.gameStateManager.getCurrentState();
        const p2Type = CONFIG?.game?.players?.player2?.type;
        const usingRL = (p2Type === 'rl_joint' || p2Type === 'ai' || CONFIG?.game?.agent?.type === 'joint');
        if (usingRL && this.rlAgent && typeof this.rlAgent.precalculatePolicyForGoals === 'function') {
          const goals = Array.isArray(st?.currentGoals) ? st.currentGoals : [];
          if (goals.length > 0) {
            const ctx = this.buildRLContext(st);
            setTimeout(() => this.rlAgent.precalculatePolicyForGoals(goals, experimentType, ctx), 0);
          }
        }
      } catch (_) { /* best-effort only */ }

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
      this.gameStateManager.addGoal(result.position, 'small');
      this.gameStateManager.markNewGoalPresented(result.position, distanceCondition, {});

      // Reset RL pre-calculation if available
      if (this.rlAgent && typeof this.rlAgent.resetNewGoalPreCalculationFlag === 'function') {
        this.rlAgent.resetNewGoalPreCalculationFlag();
      }

      // Pre-calculate RL policy for new goals to avoid first-move lag (legacy-inspired)
      try {
        const st2 = this.gameStateManager.getCurrentState();
        const p2Type2 = CONFIG?.game?.players?.player2?.type;
        const usingRL2 = (p2Type2 === 'rl_joint' || p2Type2 === 'ai' || CONFIG?.game?.agent?.type === 'joint');
        if (usingRL2 && this.rlAgent && typeof this.rlAgent.precalculatePolicyForGoals === 'function') {
          const goals2 = Array.isArray(st2?.currentGoals) ? st2.currentGoals : [];
          if (goals2.length > 0) {
            const ctx2 = this.buildRLContext(st2);
            setTimeout(() => this.rlAgent.precalculatePolicyForGoals(goals2, st2?.experimentType || null, ctx2), 0);
          }
        }
      } catch (_) { /* best-effort only */ }

      // Pre-calculate RL policy for new goals to avoid first-move lag (legacy-inspired)
      try {
        const st = this.gameStateManager.getCurrentState();
        const p2Type = CONFIG?.game?.players?.player2?.type;
        const usingRL = (p2Type === 'rl_joint' || p2Type === 'ai' || CONFIG?.game?.agent?.type === 'joint');
        if (usingRL && this.rlAgent && typeof this.rlAgent.precalculatePolicyForGoals === 'function') {
          const goals = Array.isArray(st?.currentGoals) ? st.currentGoals : [];
          if (goals.length > 0) {
            const ctx = this.buildRLContext(st);
            setTimeout(() => this.rlAgent.precalculatePolicyForGoals(goals, st?.experimentType || null, ctx), 0);
          }
        }
      } catch (_) { /* best-effort only */ }

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
      this.gameStateManager.addGoal(gen.position, 'small');
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
    if (!Array.isArray(action) || action.length < 2) return null;
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
    // For standalone mode, finalize trial data with proper success determination
    const experimentType = this.gameStateManager.getCurrentState().experimentType;
    let success;
    if (experimentType && experimentType.startsWith('1P')) {
      // Single player experiments - success means player reached a goal before timeout
      const st = this.gameStateManager.getCurrentState();
      const p1 = st.player1;
      success = !!(p1 && GameHelpers.isGoalReached(p1, st.currentGoals));
    } else if (GameConfigUtils.isStagHuntExperiment(experimentType)) {
      const st = this.gameStateManager.getCurrentState();
      const td = this.gameStateManager.getCurrentTrialData();
      success = !!GameHelpers.evaluateStagHuntOutcome(st, td).success;
    } else {
      // 2P experiments - recompute deterministically from final positions
      const st = this.gameStateManager.getCurrentState();
      success = !!GameHelpers.didBothPlayersReachSameGoal(st);
    }
    this.gameStateManager.finalizeTrial(success);

    // Show feedback with canonical success flag
    this.uiManager.showTrialFeedback({ success, experimentType });

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
      // Only use post-threshold random sampling when success-threshold mode is enabled.
      // Otherwise fixed-order experiments like StagHunt round 13 should still load map 13.
      if (
        CONFIG.game.successThreshold.enabled &&
        GameConfigUtils.isTwoPlayerExperiment(experimentType) &&
        trialIndex >= CONFIG.game.successThreshold.randomSamplingAfterTrial
      ) {
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

      const totalTrials = CONFIG.game.experiments.numTrials[experimentType] || 12;
      if (!this.sampledMapsByExperiment[experimentType] || this.sampledMapsByExperiment[experimentType].length !== totalTrials) {
        this.sampledMapsByExperiment[experimentType] = this.mapLoader.selectRandomMaps(mapsForExperiment, totalTrials, experimentType);
      }
      const selectedDesign = this.sampledMapsByExperiment[experimentType][trialIndex];

      if (selectedDesign) {
        let design = { ...selectedDesign };

        // If this design is based on an ASCII map and has randomization enabled,
        // apply a fresh random rotation/mirroring for EACH trial.
        if (Array.isArray(design.asciiMap) && design.randomize) {
          try {
            const transformedAscii = MapParser.transformRandomly(design.asciiMap);
            const parsed = MapParser.parseAsciiMap(transformedAscii);
            design = { ...design, ...parsed };
            console.log(`🎲 Applied random ASCII transform for trial ${trialIndex}`);
          } catch (e) {
            console.warn('⚠️ Failed to apply ASCII randomization, using base design:', e?.message || e);
          }
        }

        const shouldSwapStarts = GameConfigUtils.shouldSwapPlayerStartPositions(experimentType, trialIndex);
        if (
          shouldSwapStarts &&
          Array.isArray(design.initPlayerGrid) &&
          Array.isArray(design.initAIGrid)
        ) {
          design = {
            ...design,
            initPlayerGrid: [...design.initAIGrid],
            initAIGrid: [...design.initPlayerGrid],
            playerStartPositionsSwapped: true
          };
          console.log(`🔄 Swapped red/orange start positions for trial ${trialIndex}`);
        } else {
          design = {
            ...design,
            playerStartPositionsSwapped: false
          };
        }

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

    // Notify GameApplication of trial start for ALL experiments
    // This resets its trial-complete guard and starts inactivity tracking when applicable
    try {
      const gameApp = window.__GAME_APPLICATION__;
      if (gameApp) {
        console.log('🔗 Notifying GameApplication of trial start');
        gameApp.handleTrialStart?.(experimentType, experimentIndex, trialIndex);
      }
    } catch (error) {
      console.warn('⚠️ Could not notify GameApplication of trial start:', error);
    }

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
      case 'StagHunt':
      case 'StagHuntTwoStags':
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

    // Notify GameApplication to stop inactivity tracking
    try {
      const gameApp = window.__GAME_APPLICATION__;
      if (gameApp) {
        console.log('🔗 Notifying GameApplication of trial completion');
        gameApp.handleTrialEnd?.();
      }
    } catch (error) {
      console.warn('⚠️ Could not notify GameApplication of trial completion:', error);
    }

    // Determine success with authoritative override when provided
    const currentTrialData = this.gameStateManager.getCurrentTrialData();
    const currentState = this.gameStateManager.getCurrentState();
    const experimentType = currentState.experimentType;
    let success;
    const hasAuthoritative = (result && typeof result.success === 'boolean');
    if (experimentType && experimentType.startsWith('1P')) {
      success = hasAuthoritative ? !!result.success : (() => {
        const p1 = currentState.player1;
        return !!(p1 && GameHelpers.isGoalReached(p1, currentState.currentGoals));
      })();
    } else if (GameConfigUtils.isStagHuntExperiment(experimentType)) {
      const stagHuntOutcome = GameHelpers.evaluateStagHuntOutcome(currentState, currentTrialData);
      success = hasAuthoritative ? !!result.success && stagHuntOutcome.success : stagHuntOutcome.success;
      currentTrialData.collaborationSucceeded = !!stagHuntOutcome.collaborationSucceeded;
      this.gameStateManager.trialData = {
        ...this.gameStateManager.trialData,
        collaborationSucceeded: !!stagHuntOutcome.collaborationSucceeded
      };
    } else {
      // 2P experiments - deterministically recompute success from final positions
      const recomputed = !!GameHelpers.didBothPlayersReachSameGoal(currentState);
      // If authoritative success disagrees, override with recomputed
      success = hasAuthoritative ? !!result.success && recomputed : recomputed;
      // Force trial data flag to align with recomputed success for consistency
      currentTrialData.collaborationSucceeded = !!success;
      this.gameStateManager.trialData = { ...this.gameStateManager.trialData, collaborationSucceeded: !!success };
    }

    // Finalize trial data
    this.gameStateManager.finalizeTrial(success);

    // Get trial data for timeline
    const trialData = {
      ...result,
      success: !!success, // Ensure both clients store identical boolean
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

    let messageType;

    if (GameConfigUtils.isStagHuntExperiment(experimentType)) {
      const td = this.gameStateManager.getCurrentTrialData();
      const goalTypes = this.gameStateManager.getCurrentState()?.currentGoalTypes || [];
      const humanIdx = td?.humanPlayerIndex ?? 0;       // 0 = player1, 1 = player2
      const p1Goal = td?.player1FinalReachedGoal;       // goal index, or -1/null = none
      const p2Goal = td?.player2FinalReachedGoal;

      const humanGoal  = humanIdx === 0 ? p1Goal  : p2Goal;
      const partnerGoal = humanIdx === 0 ? p2Goal : p1Goal;

      const humanReachedBig =
        Number.isInteger(humanGoal) && humanGoal >= 0 &&
        goalTypes[humanGoal] === 'big';
      const partnerReachedBig =
        Number.isInteger(partnerGoal) && partnerGoal >= 0 &&
        goalTypes[partnerGoal] === 'big';
      const humanReachedSmall =
        Number.isInteger(humanGoal) && humanGoal >= 0 &&
        goalTypes[humanGoal] === 'small';

      if (humanReachedBig && partnerReachedBig && humanGoal === partnerGoal) {
        messageType = 'stag-hunt-both-stag';
      } else if (humanReachedSmall) {
        messageType = 'stag-hunt-human-rabbit';
      } else {
        messageType = 'stag-hunt-human-nothing';
      }
    } else {
      messageType = experimentType.startsWith('1P') ? 'single' : 'collaboration';
    }

    this.uiManager.showTrialFeedbackInContainer(success, canvasContainer, messageType);
  }

  // Public API
  restart() {
    this.clearGameIntervals();
    this.gameStateManager.reset();
    this.currentExperimentIndex = 0;
    this.currentTrialIndex = 0;
    this.isRunning = false;
    this.sampledMapsByExperiment = {};
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
