import { CONFIG, GAME_OBJECTS, DIRECTIONS } from '../config/gameConfig.js';
import { GameHelpers } from '../utils/GameHelpers.js';

export class GameStateManager {
  constructor() {
    this.currentState = null;
    this.trialData = null;
    this.experimentData = null;
    this.isMoving = false;
    this.gameStartTime = 0;
    this.stepCount = 0;
    this.conditionSequences = {}; // Balanced condition sequences per experiment

    // Real-time multiplayer synchronization
    this.lastMoveTime = new Map(); // playerIndex -> timestamp
    this.moveCounter = 0;
    this.lastSyncTime = 0;
    this.syncPending = false;

    this.reset();
  }

  reset() {
    this.currentState = {
      gridMatrix: null,
      player1: null,
      player2: null,
      currentGoals: [],
      experimentType: null,
      trialIndex: 0,
      gameMode: 'human-ai'
    };

    // Clear real-time synchronization state
    this.clearRealTimeSync();

    this.trialData = {
      trialIndex: 0,
      experimentType: null,
      partnerAgentType: null,
      distanceCondition: null,
      // GPT error logging per move
      gptErrorEvents: [],
      player1Trajectory: [],
      player2Trajectory: [],
      player1Actions: [],
      player2Actions: [],
      player1RT: [],
      player2RT: [],
      // Track which player made each move (for human-human mode analysis)
      currentPlayerIndex: [], // 0-based index (0 or 1) for each move
      trialStartTime: 0,
      player1GoalReachedStep: -1,
      player2GoalReachedStep: -1,
      player1CurrentGoal: [],
      player2CurrentGoal: [],
      player1FirstDetectedGoal: null,
      player2FirstDetectedGoal: null,
      player1FinalReachedGoal: null,
      player2FinalReachedGoal: null,
      firstDetectedSharedGoal: null,
      newGoalPresentedTime: null,
      newGoalPosition: null,
      newGoalConditionType: null,
      newGoalPresented: false,
      isNewGoalCloserToPlayer2: null,
      collaborationSucceeded: undefined,
      // Fallback logging: records when human-human switches to AI
      partnerFallbackOccurred: false,
      partnerFallbackReason: null, // 'disconnect' | 'waiting-timeout' | 'match-play-timeout' | 'no-partner-found'
      partnerFallbackStage: null,  // 'waiting-for-partner' | 'match-play' | 'in-game'
      partnerFallbackTime: null,
      partnerFallbackAIType: null, // 'gpt' | 'joint-rl' | 'individual-rl' | etc.
      // Which side is controlled by human vs AI (0-based index for consistency with app)
      humanPlayerIndex: null,
      aiPlayerIndex: null
    };

    this.experimentData = {
      allTrialsData: [],
      currentExperiment: null,
      successThreshold: {
        consecutiveSuccesses: 0,
        totalTrialsCompleted: 0,
        experimentEndedEarly: false,
        lastSuccessTrial: -1,
        successHistory: []
      },
      // Experiment-level fallback event log
      fallbackEvents: []
    };

    this.stepCount = 0;
    this.isMoving = false;
    this.conditionSequences = {};
  }

  initializeTrial(trialIndex, experimentType, design) {
    this.trialData.trialIndex = trialIndex;
    this.trialData.experimentType = experimentType;
    this.trialData.partnerAgentType = this.getPartnerAgentType(experimentType);
    this.trialData.trialStartTime = Date.now();
    this.gameStartTime = Date.now();
    this.stepCount = 0;
    this.isMoving = false;

    // Reset trajectory and action arrays
    this.trialData.player1Trajectory = [];
    this.trialData.player2Trajectory = [];
    this.trialData.player1Actions = [];
    this.trialData.player2Actions = [];
    this.trialData.player1RT = [];
    this.trialData.player2RT = [];
    this.trialData.currentPlayerIndex = [];
    this.trialData.gptErrorEvents = [];
    this.trialData.player1CurrentGoal = [];
    this.trialData.player2CurrentGoal = [];

    // Reset goal detection variables
    this.trialData.player1FirstDetectedGoal = null;
    this.trialData.player2FirstDetectedGoal = null;
    this.trialData.player1FinalReachedGoal = null;
    this.trialData.player2FinalReachedGoal = null;
    this.trialData.firstDetectedSharedGoal = null;
    this.trialData.player1GoalReachedStep = -1;
    this.trialData.player2GoalReachedStep = -1;

    // Reset new goal variables
    this.trialData.newGoalPresentedTime = null;
    this.trialData.newGoalPosition = null;
    this.trialData.newGoalConditionType = null;
    this.trialData.distanceCondition = null; // ensure no carry-over between trials
    this.trialData.newGoalPresented = false;
    this.trialData.isNewGoalCloserToPlayer2 = null;
    this.trialData.collaborationSucceeded = undefined;
    // Reset finalization flag for new trial
    this.trialData._finalized = false;
    // Reset fallback flags for new trial
    this.trialData.partnerFallbackOccurred = false;
    this.trialData.partnerFallbackReason = null;
    this.trialData.partnerFallbackStage = null;
    this.trialData.partnerFallbackTime = null;
    // Initialize who is human vs AI at trial start (for 2P modes)
    try {
      if (String(experimentType || '').includes('2P')) {
        const t1 = CONFIG?.game?.players?.player1?.type;
        const t2 = CONFIG?.game?.players?.player2?.type;
        if (t1 === 'human' && t2 !== 'human') {
          this.trialData.humanPlayerIndex = 0;
          this.trialData.aiPlayerIndex = 1;
        } else if (t2 === 'human' && t1 !== 'human') {
          this.trialData.humanPlayerIndex = 1;
          this.trialData.aiPlayerIndex = 0;
        } else {
          this.trialData.humanPlayerIndex = null;
          this.trialData.aiPlayerIndex = null;
        }
      } else {
        this.trialData.humanPlayerIndex = 0;
        this.trialData.aiPlayerIndex = null;
      }
    } catch (_) { /* noop */ }

    // Add distance condition for trials (balanced sequence)
    if (experimentType === '2P3G') {
      const cond = this.getRandomDistanceConditionFor2P3G(trialIndex);
      this.trialData.newGoalConditionType = cond;
      this.trialData.distanceCondition = cond; // legacy naming for saving
      this.currentState.newGoalConditionType = cond;
      this.currentState.distanceCondition = cond;
    } else if (experimentType === '1P2G') {
      const cond = this.getRandomDistanceConditionFor1P2G(trialIndex);
      this.trialData.newGoalConditionType = cond;
      this.trialData.distanceCondition = cond; // legacy naming for saving
      this.currentState.newGoalConditionType = cond;
      this.currentState.distanceCondition = cond;
    } else if (experimentType === '2P2G') {
      // Explicitly tag no_new_goal for 2P2G to keep both players consistent
      const noNew = CONFIG?.twoP3G?.distanceConditions?.NO_NEW_GOAL || 'no_new_goal';
      this.trialData.newGoalConditionType = noNew;
      this.trialData.distanceCondition = noNew;
      this.currentState.newGoalConditionType = noNew;
      this.currentState.distanceCondition = noNew;
    }

    // Log current new-goal condition when map starts (for debugging/recording)
    if (experimentType === '1P2G' || experimentType === '2P3G') {
      console.log(
        `🗺️ Starting ${experimentType} trial ${trialIndex}: new-goal condition =`,
        this.trialData.distanceCondition
      );
      console.log(`🤝 Partner agent type: ${this.trialData.partnerAgentType}`);
    }

    // Set up grid matrix
    this.setupGridMatrix(design, experimentType);

    // Update current state
    this.currentState.experimentType = experimentType;
    this.currentState.trialIndex = trialIndex;
  }

  // Record a human→AI fallback event for the current run (and current trial if any)
  recordPartnerFallback({ reason = 'disconnect', stage = 'in-game', at = Date.now(), fallbackAIType = null } = {}) {
    try {
      // Determine actual AI type being used as fallback
      let aiTypeDesc = 'unknown';

      if (fallbackAIType) {
        // Use explicitly provided fallback AI type (preferred)
        aiTypeDesc = this.normalizeAITypeName(fallbackAIType);
      } else {
        // Fallback: try to determine from current config
        try {
          const p1 = CONFIG?.game?.players?.player1?.type;
          const p2 = CONFIG?.game?.players?.player2?.type;
          const t = (p1 !== 'human') ? p1 : ((p2 !== 'human') ? p2 : null);

          if (t === 'gpt') {
            const model = CONFIG?.game?.agent?.gpt?.model;
            if (model && String(model).trim().length > 0) {
              aiTypeDesc = String(model);
            } else {
              console.warn('⚠️ GPT model not cached in CONFIG for fallback recording, using configured default');
              aiTypeDesc = 'gpt-4o'; // matches the configured GPT_MODEL in .env
            }
          } else if (t === 'rl_joint') {
            aiTypeDesc = 'joint-rl';
          } else if (t === 'rl_individual') {
            aiTypeDesc = 'individual-rl';
          } else if (t === 'ai') {
            aiTypeDesc = (CONFIG?.game?.agent?.type === 'individual') ? 'individual-rl' : 'joint-rl';
          } else if (t && t !== 'human') {
            aiTypeDesc = String(t);
          } else {
            // No AI type found, use default fallback
            const defaultFallback = CONFIG?.multiplayer?.fallbackAIType || 'rl_joint';
            aiTypeDesc = this.normalizeAITypeName(defaultFallback);
          }
        } catch (_) {
          // Use default fallback if config parsing fails
          const defaultFallback = CONFIG?.multiplayer?.fallbackAIType || 'rl_joint';
          aiTypeDesc = this.normalizeAITypeName(defaultFallback);
        }
      }

      // Tag current trial if active
      if (this.trialData) {
        this.trialData.partnerFallbackOccurred = true;
        this.trialData.partnerFallbackReason = reason;
        this.trialData.partnerFallbackStage = stage;
        this.trialData.partnerFallbackTime = at;
        this.trialData.partnerFallbackAIType = aiTypeDesc;
      }
      // Push experiment-level event
      if (this.experimentData) {
        const trialIdx = (this.currentState && Number.isInteger(this.currentState.trialIndex)) ? this.currentState.trialIndex : -1;
        const experimentType = (this.currentState && this.currentState.experimentType) || null;
        const evt = { reason, stage, at, trialIndex: trialIdx, experimentType, aiType: aiTypeDesc };
        if (Array.isArray(this.experimentData.fallbackEvents)) {
          this.experimentData.fallbackEvents.push(evt);
        } else {
          this.experimentData.fallbackEvents = [evt];
        }
      }
    } catch (_) { /* noop */ }
  }

  // Record a GPT API error event during this trial
  recordGptErrorEvent({ phase = 'independent', error = '', humanDirection = null, fallback = null, fallbackDirection = null } = {}) {
    try {
      const event = {
        step: this.stepCount,
        timeMs: Date.now() - (this.gameStartTime || Date.now()),
        phase, // 'synchronized' | 'independent'
        error: String(error || ''),
        humanDirection: humanDirection || null,
        fallback: fallback || null, // e.g., 'rl'
        fallbackDirection: fallbackDirection || null
      };
      if (Array.isArray(this.trialData.gptErrorEvents)) {
        this.trialData.gptErrorEvents.push(event);
      } else {
        this.trialData.gptErrorEvents = [event];
      }
    } catch (_) {
      // Swallow logging errors to avoid interfering with gameplay
    }
  }

  setupGridMatrix(design, experimentType) {
    if (!design) {
      console.error('Invalid design provided to setupGridMatrix:', design);
      return;
    }

    // Initialize empty grid
    const size = CONFIG.game.matrixSize;
    this.currentState.gridMatrix = Array(size).fill(0).map(() => Array(size).fill(0));

    // Place player1
    if (design.initPlayerGrid && design.initPlayerGrid.length >= 2) {
      const [row, col] = design.initPlayerGrid;
      this.currentState.gridMatrix[row][col] = GAME_OBJECTS.player;
      this.currentState.player1 = [row, col];
    }

    // Place player2 for 2P experiments
    if (experimentType && experimentType.includes('2P') && design.initAIGrid && design.initAIGrid.length >= 2) {
      const [row, col] = design.initAIGrid;
      this.currentState.gridMatrix[row][col] = GAME_OBJECTS.ai_player;
      this.currentState.player2 = [row, col];
    } else {
      this.currentState.player2 = null;
    }

    // Place goals
    this.currentState.currentGoals = [];
    if (design.target1 && design.target1.length >= 2) {
      const [row, col] = design.target1;
      this.currentState.gridMatrix[row][col] = GAME_OBJECTS.goal;
      this.currentState.currentGoals.push([row, col]);
    }

    if (design.target2 && design.target2.length >= 2) {
      const [row, col] = design.target2;
      this.currentState.gridMatrix[row][col] = GAME_OBJECTS.goal;
      this.currentState.currentGoals.push([row, col]);
    }
  }

  // Safely add a new goal to the internal state and grid
  addGoal(position) {
    if (!position || position.length < 2) return;
    const [row, col] = position;
    if (!this.currentState || !this.currentState.gridMatrix) return;
    // Bounds check
    if (row < 0 || row >= this.currentState.gridMatrix.length) return;
    if (col < 0 || col >= this.currentState.gridMatrix[0].length) return;
    // Do not add duplicate
    if (this.currentState.currentGoals.some(g => g[0] === row && g[1] === col)) {
      console.log(`🔧 [GOAL] Duplicate goal at [${row}, ${col}] not added`);
      return;
    }
    console.log(`🎯 [GOAL] Adding goal at [${row}, ${col}]. Total goals: ${this.currentState.currentGoals.length + 1}`);
    this.currentState.gridMatrix[row][col] = GAME_OBJECTS.goal;
    this.currentState.currentGoals.push([row, col]);
  }

  // Record trial metadata for a newly presented goal
  markNewGoalPresented(position, conditionType, extra = {}) {
    if (!this.trialData) return;
    this.trialData.newGoalPresented = true;
    this.trialData.newGoalPresentedTime = this.stepCount;
    this.trialData.newGoalPosition = position ? [...position] : null;
    const cond = conditionType || this.trialData.newGoalConditionType || this.trialData.distanceCondition || null;
    this.trialData.newGoalConditionType = cond;
    this.trialData.distanceCondition = cond; // keep legacy field in sync
    // Mirror in state for network sync visibility
    if (this.currentState) {
      this.currentState.newGoalConditionType = cond;
      this.currentState.distanceCondition = cond;
    }
    if (typeof extra.isNewGoalCloserToPlayer2 === 'boolean') {
      this.trialData.isNewGoalCloserToPlayer2 = extra.isNewGoalCloserToPlayer2;
    }
  }

  processPlayerMove(playerIndex, direction, currentPlayerIndex = null) {
    if (this.isMoving) {
      return { success: false, reason: 'already_moving' };
    }

    const player = playerIndex === 1 ? this.currentState.player1 : this.currentState.player2;
    if (!player) {
      return { success: false, reason: 'invalid_player' };
    }

    // Check if player already reached goal
    if (GameHelpers.isGoalReached(player, this.currentState.currentGoals)) {
      return { success: false, reason: 'already_at_goal' };
    }

    this.isMoving = true;

    try {
      // Get movement vector
      const movement = DIRECTIONS[`arrow${direction}`]?.movement;
      if (!movement) {
        return { success: false, reason: 'invalid_direction' };
      }

      // Record the move
      const reactionTime = Date.now() - this.gameStartTime;
      this.recordPlayerMove(playerIndex, movement, reactionTime, currentPlayerIndex);

      // Calculate new position
      const realAction = GameHelpers.isValidMove(this.currentState.gridMatrix, player, movement);
      const nextState = GameHelpers.transition(player, realAction);

      // Update grid matrix
      this.updatePlayerPosition(playerIndex, player, nextState);

      // Detect player goals
      this.detectAndRecordGoals(playerIndex, movement);

      this.stepCount++;

      // Check for trial completion
      const trialComplete = this.checkTrialCompletion();

      return {
        success: true,
        trialComplete,
        newPosition: nextState,
        stepCount: this.stepCount
      };

    } finally {
      // Reset moving flag after a short delay
      setTimeout(() => {
        this.isMoving = false;
      }, 100);
    }
  }

  // Apply human (player 1) and AI/GPT (player 2) moves in a single synchronized step
  processSynchronizedMoves(humanDirection, aiDirection) {
    if (this.isMoving) {
      return { success: false, reason: 'already_moving' };
    }

    this.isMoving = true;

    try {
      const results = { success: true, trialComplete: false };

      // Prepare player references
      const p1 = this.currentState.player1;
      const p2 = this.currentState.player2;

      // Movements (may be null)
      const move1 = humanDirection ? DIRECTIONS[`arrow${humanDirection}`]?.movement : null;
      const move2 = aiDirection ? DIRECTIONS[`arrow${aiDirection}`]?.movement : null;

      // Record reaction time once for the step
      const reactionTime = Date.now() - this.gameStartTime;

      // Compute next positions safely
      let next1 = p1;
      if (p1 && move1 && !GameHelpers.isGoalReached(p1, this.currentState.currentGoals)) {
        this.recordPlayerMove(1, move1, reactionTime);
        const real1 = GameHelpers.isValidMove(this.currentState.gridMatrix, p1, move1);
        next1 = GameHelpers.transition(p1, real1);
      }

      let next2 = p2;
      if (p2 && move2 && !GameHelpers.isGoalReached(p2, this.currentState.currentGoals)) {
        this.recordPlayerMove(2, move2, reactionTime);
        const real2 = GameHelpers.isValidMove(this.currentState.gridMatrix, p2, move2);
        next2 = GameHelpers.transition(p2, real2);
      }

      // Update grid: clear old positions then set new ones
      if (p1 && next1 && (next1 !== p1)) {
        this.updatePlayerPosition(1, p1, next1);
      }
      if (p2 && next2 && (next2 !== p2)) {
        this.updatePlayerPosition(2, p2, next2);
      }

      // Detect goals after movement
      if (p1 && move1) this.detectAndRecordGoals(1, move1);
      if (p2 && move2) this.detectAndRecordGoals(2, move2);

      // Increment step count once for the synchronized step
      this.stepCount++;

      // Check completion
      results.trialComplete = this.checkTrialCompletion();
      results.newPositions = { player1: next1, player2: next2 };
      return results;
    } finally {
      setTimeout(() => {
        this.isMoving = false;
      }, 100);
    }
  }

  // Generalized synchronized move: specify which player is the human (1 or 2)
  processSynchronizedMovesMapped(humanPlayerNumber, humanDirection, aiDirection) {
    if (this.isMoving) {
      return { success: false, reason: 'already_moving' };
    }

    this.isMoving = true;

    try {
      const results = { success: true, trialComplete: false };

      const p1 = this.currentState.player1;
      const p2 = this.currentState.player2;

      const moveHuman = humanDirection ? DIRECTIONS[`arrow${humanDirection}`]?.movement : null;
      const moveAI = aiDirection ? DIRECTIONS[`arrow${aiDirection}`]?.movement : null;

      // Map to player1/player2 moves
      const move1 = (humanPlayerNumber === 1) ? moveHuman : moveAI;
      const move2 = (humanPlayerNumber === 2) ? moveHuman : moveAI;

      const reactionTime = Date.now() - this.gameStartTime;

      let next1 = p1;
      if (p1 && move1 && !GameHelpers.isGoalReached(p1, this.currentState.currentGoals)) {
        // Record as player1 move regardless of human/AI
        this.recordPlayerMove(1, move1, reactionTime);
        const real1 = GameHelpers.isValidMove(this.currentState.gridMatrix, p1, move1);
        next1 = GameHelpers.transition(p1, real1);
      }

      let next2 = p2;
      if (p2 && move2 && !GameHelpers.isGoalReached(p2, this.currentState.currentGoals)) {
        this.recordPlayerMove(2, move2, reactionTime);
        const real2 = GameHelpers.isValidMove(this.currentState.gridMatrix, p2, move2);
        next2 = GameHelpers.transition(p2, real2);
      }

      if (p1 && next1 && (next1 !== p1)) this.updatePlayerPosition(1, p1, next1);
      if (p2 && next2 && (next2 !== p2)) this.updatePlayerPosition(2, p2, next2);

      if (p1 && move1) this.detectAndRecordGoals(1, move1);
      if (p2 && move2) this.detectAndRecordGoals(2, move2);

      results.trialComplete = this.checkTrialCompletion();
      return results;
    } finally {
      setTimeout(() => { this.isMoving = false; }, 100);
    }
  }

  updatePlayerPosition(playerIndex, oldPos, newPos) {
    const objectType = playerIndex === 1 ? GAME_OBJECTS.player : GAME_OBJECTS.ai_player;

    // Clear old position
    this.currentState.gridMatrix[oldPos[0]][oldPos[1]] = GAME_OBJECTS.blank;

    // Set new position
    this.currentState.gridMatrix[newPos[0]][newPos[1]] = objectType;

    // Update player state
    if (playerIndex === 1) {
      this.currentState.player1 = [...newPos];
    } else {
      this.currentState.player2 = [...newPos];
    }
  }

  recordPlayerMove(playerIndex, action, reactionTime, currentPlayerIndex = null) {
    const player = playerIndex === 1 ? this.currentState.player1 : this.currentState.player2;

    if (playerIndex === 1) {
      this.trialData.player1Actions.push(action);
      this.trialData.player1Trajectory.push([...player]);
      this.trialData.player1RT.push(reactionTime);
    } else {
      this.trialData.player2Actions.push(action);
      this.trialData.player2Trajectory.push([...player]);
      this.trialData.player2RT.push(reactionTime);
    }

    // Record which player (0 or 1) made this move for human-human analysis
    // If currentPlayerIndex is not provided, infer from playerIndex (assuming player1=0, player2=1)
    if (currentPlayerIndex !== null) {
      this.trialData.currentPlayerIndex.push(currentPlayerIndex);
    } else {
      // Default behavior: player1 -> 0, player2 -> 1
      this.trialData.currentPlayerIndex.push(playerIndex === 1 ? 0 : 1);
    }
  }

  detectAndRecordGoals(playerIndex, action) {
    const player = playerIndex === 1 ? this.currentState.player1 : this.currentState.player2;
    const goalHistory = playerIndex === 1 ? this.trialData.player1CurrentGoal : this.trialData.player2CurrentGoal;

    const detectedGoal = GameHelpers.detectPlayerGoal(player, action, this.currentState.currentGoals, goalHistory);

    if (playerIndex === 1) {
      this.trialData.player1CurrentGoal.push(detectedGoal);

      // Record first detected goal
      if (detectedGoal !== null && this.trialData.player1FirstDetectedGoal === null) {
        this.trialData.player1FirstDetectedGoal = detectedGoal;
      }
    } else {
      this.trialData.player2CurrentGoal.push(detectedGoal);

      // Record first detected goal
      if (detectedGoal !== null && this.trialData.player2FirstDetectedGoal === null) {
        this.trialData.player2FirstDetectedGoal = detectedGoal;
      }
    }

    // Check for first shared goal (2P3G only)
    if (this.currentState.experimentType === '2P3G' &&
        this.trialData.player1CurrentGoal.length > 0 &&
        this.trialData.player2CurrentGoal.length > 0) {

      const p1Goal = this.trialData.player1CurrentGoal[this.trialData.player1CurrentGoal.length - 1];
      const p2Goal = this.trialData.player2CurrentGoal[this.trialData.player2CurrentGoal.length - 1];

      if (p1Goal !== null && p2Goal !== null && p1Goal === p2Goal &&
          this.trialData.firstDetectedSharedGoal === null) {
        this.trialData.firstDetectedSharedGoal = p1Goal;
      }
    }
  }

    checkTrialCompletion() {
    const player1AtGoal = GameHelpers.isGoalReached(this.currentState.player1, this.currentState.currentGoals);
    const player2AtGoal = this.currentState.player2 ?
      GameHelpers.isGoalReached(this.currentState.player2, this.currentState.currentGoals) : true;

    // Record when players reach goals
    if (player1AtGoal && this.trialData.player1GoalReachedStep === -1) {
      this.trialData.player1GoalReachedStep = this.stepCount;
      this.trialData.player1FinalReachedGoal = GameHelpers.whichGoalReached(
        this.currentState.player1, this.currentState.currentGoals
      );
    }

    if (this.currentState.player2 && player2AtGoal && this.trialData.player2GoalReachedStep === -1) {
      this.trialData.player2GoalReachedStep = this.stepCount;
      this.trialData.player2FinalReachedGoal = GameHelpers.whichGoalReached(
        this.currentState.player2, this.currentState.currentGoals
      );
    }

    // Check completion conditions based on experiment type
    if (this.currentState.experimentType.startsWith('1P')) {
      // Single player experiments - just need player1 to reach any goal
      return player1AtGoal;
    } else {
      // 2P experiments - both players must reach goals
      if (player1AtGoal && player2AtGoal) {
        // For 2P2G and 2P3G, collaboration success means both players reach the SAME goal
        const p1Goal = this.trialData.player1FinalReachedGoal;
        const p2Goal = this.trialData.player2FinalReachedGoal;

        // Collaboration succeeds when both players reach the same goal
        this.trialData.collaborationSucceeded = (p1Goal === p2Goal && p1Goal !== null);

        // For 2P experiments, trial is complete when both players reach goals
        // but the success depends on whether they reached the same goal
        return true;
      }
    }

    // Check for timeout
    return this.stepCount >= CONFIG.game.maxGameLength;
  }

  finalizeTrial(success) {
    // Prevent duplicate finalization
    if (this.trialData._finalized) {
      console.warn('Trial already finalized, skipping duplicate finalization');
      return;
    }

    // Ensure collaborationSucceeded is explicitly boolean for 2P experiments
    try {
      const is2P = this.currentState && typeof this.currentState.experimentType === 'string' && this.currentState.experimentType.includes('2P');
      if (is2P && typeof this.trialData.collaborationSucceeded !== 'boolean') {
        this.trialData.collaborationSucceeded = false;
      }
    } catch (_) { /* noop */ }

    this.trialData.completed = !!success;
    this.trialData.endTime = Date.now();
    this.trialData.totalSteps = this.stepCount;

    // Normalize partnerAgentType just before saving to ensure it reflects current AI model/mode
    try {
      const is2P = this.currentState && String(this.currentState.experimentType || '').includes('2P');
      if (is2P) {
        const recorded = String(this.trialData.partnerAgentType || '').trim();
        const computed = this.getPartnerAgentType(this.currentState.experimentType);
        // If computed differs and is non-empty, prefer the computed (ensures exact GPT model string)
        if (computed && recorded !== computed) {
          this.trialData.partnerAgentType = computed;
        }
        // Upgrade fallback AI type to exact GPT model string if still generic 'gpt'
        const model = CONFIG?.game?.agent?.gpt?.model;
        if (this.trialData.partnerFallbackOccurred && model && /^gpt$/i.test(String(this.trialData.partnerFallbackAIType || ''))) {
          this.trialData.partnerFallbackAIType = model;
        }
      }
    } catch (_) { /* noop */ }

    // Ensure newGoalPosition is recorded if a new goal was presented but position is missing
    try {
      if (this.trialData.newGoalPresented && (!this.trialData.newGoalPosition || this.trialData.newGoalPosition.length < 2)) {
        const goals = Array.isArray(this.currentState?.currentGoals) ? this.currentState.currentGoals : [];
        if (goals.length >= 3) {
          // Heuristic: the last goal in the list is the newly added one
          const last = goals[goals.length - 1];
          if (Array.isArray(last) && last.length >= 2) {
            this.trialData.newGoalPosition = [last[0], last[1]];
          }
        }
      }
    } catch (_) { /* noop */ }

    // Fix missing goal values before saving
    this.fixMissingGoalValues();

    // Add to experiment data
    this.experimentData.allTrialsData.push({ ...this.trialData });

    // Mark as finalized to prevent duplicates
    this.trialData._finalized = true;

    // Update success threshold tracking
    this.updateSuccessThreshold(success);
  }

  fixMissingGoalValues() {
    const experimentType = this.currentState?.experimentType || '';

    // For single-player experiments (1P1G, 1P2G), player2 doesn't exist
    if (experimentType.startsWith('1P')) {
      // Set player2FinalReachedGoal to -1 (not applicable)
      this.trialData.player2FinalReachedGoal = -1;
    } else if (experimentType.startsWith('2P')) {
      // For 2-player experiments, if a player didn't reach any goal, set to -1
      if (this.trialData.player1GoalReachedStep === -1 && this.trialData.player1FinalReachedGoal === null) {
        this.trialData.player1FinalReachedGoal = -1;
      }
      if (this.trialData.player2GoalReachedStep === -1 && this.trialData.player2FinalReachedGoal === null) {
        this.trialData.player2FinalReachedGoal = -1;
      }
    }
  }

  // Normalize AI type names for consistent recording
  normalizeAITypeName(aiType) {
    if (!aiType || typeof aiType !== 'string') {
      return 'unknown';
    }

    const normalized = aiType.toLowerCase().trim();

    switch (normalized) {
      case 'gpt':
        // Try to get specific GPT model
        const model = CONFIG?.game?.agent?.gpt?.model;
        return (model && String(model).trim()) ? String(model) : 'gpt-4o';
      case 'rl_joint':
      case 'joint':
        return 'joint-rl';
      case 'rl_individual':
      case 'individual':
        return 'individual-rl';
      case 'ai':
        // Default AI type based on config
        return (CONFIG?.game?.agent?.type === 'individual') ? 'individual-rl' : 'joint-rl';
      case 'human':
        // This should never be used for fallback AI type!
        console.error('❌ BUG: Attempted to set partnerFallbackAIType to "human" - using default instead');
        const defaultFallback = CONFIG?.multiplayer?.fallbackAIType || 'rl_joint';
        // Avoid infinite recursion by handling the default directly
        if (defaultFallback === 'rl_joint') return 'joint-rl';
        if (defaultFallback === 'rl_individual') return 'individual-rl';
        if (defaultFallback === 'gpt') {
          const model = CONFIG?.game?.agent?.gpt?.model;
          return (model && String(model).trim()) ? String(model) : 'gpt-4o';
        }
        return 'joint-rl'; // ultimate fallback
      default:
        // Return as-is for specific models (e.g., 'gpt-4o-mini')
        return aiType;
    }
  }

  updateSuccessThreshold(success) {
    const threshold = this.experimentData.successThreshold;

    threshold.totalTrialsCompleted++;
    threshold.successHistory.push(success);

    if (success) {
      threshold.consecutiveSuccesses++;
      threshold.lastSuccessTrial = threshold.totalTrialsCompleted - 1;
    } else {
      threshold.consecutiveSuccesses = 0;
    }

    // Check if threshold reached
    if (threshold.consecutiveSuccesses >= CONFIG.game.successThreshold.consecutiveSuccessesRequired &&
        threshold.totalTrialsCompleted >= CONFIG.game.successThreshold.minTrialsBeforeCheck) {
      threshold.experimentEndedEarly = true;
    }
  }

  // Distance condition helpers
  getPartnerAgentType(experimentType) {
    // Determine partner agent description for recording/export
    try {
      if (!String(experimentType || '').includes('2P')) return 'none';
      const p1 = CONFIG?.game?.players?.player1?.type;
      const p2 = CONFIG?.game?.players?.player2?.type;
      // Prefer whichever side is non-human as the partner agent type
      const t = (p1 !== 'human') ? p1 : ((p2 !== 'human') ? p2 : 'human');
      if (t === 'human') return 'human';
      if (t === 'gpt') {
        // Prefer exact GPT model name if available
        const model = CONFIG?.game?.agent?.gpt?.model;
        if (model && String(model).trim().length > 0) {
          return String(model);
        } else {
          // If model not cached, try to fetch it synchronously as fallback
          console.warn('⚠️ GPT model not cached in CONFIG, using fallback logic');
          // For now, return a more specific default that matches the configured model
          // This should be rarely hit if logCurrentAIModel() is properly awaited
          return 'gpt-4o'; // matches the configured GPT_MODEL in .env
        }
      }
      if (t === 'rl_joint') return 'joint-rl';
      if (t === 'rl_individual') return 'individual-rl';
      if (t === 'ai') return (CONFIG?.game?.agent?.type === 'individual') ? 'individual-rl' : 'joint-rl'; // legacy safety
      return String(t || 'unknown');
    } catch (_) {
      return 'unknown';
    }
  }
  // Seeded PRNG utils for deterministic sequences in human-human mode
  getSessionSeedInt() {
    try {
      if (typeof window !== 'undefined' && Number.isInteger(window.__SESSION_SEED__)) {
        return window.__SESSION_SEED__;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  seededShuffle(array, seed) {
    if (!Array.isArray(array) || array.length <= 1) return array;
    if (!Number.isInteger(seed)) return this.randomShuffle(array);
    const out = array.slice();
    // LCG parameters (Numerical Recipes)
    let state = (seed >>> 0) || 1;
    const m = 0x100000000; // 2^32
    const a = 1664525;
    const c = 1013904223;
    const rand = () => {
      state = (Math.imul(a, state) + c) >>> 0;
      return state / m;
    };
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  randomShuffle(array) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  getRandomDistanceConditionFor2P3G(trialIndex) {
    // Use or create a balanced sequence for the experiment
    const key = '2P3G';
    const numTrials = (CONFIG.game.experiments?.numTrials?.[key]) || 12;
    if (!this.conditionSequences[key]) {
      // If human-human mode, use a shared seed so both clients get identical sequences
      const isHumanHuman = (CONFIG?.game?.players?.player2?.type === 'human');
      const seed = isHumanHuman ? (this.getSessionSeedInt() ?? null) : null;
      this.conditionSequences[key] = this.generateBalancedConditionSequence(
        Object.values(CONFIG.twoP3G.distanceConditions),
        numTrials,
        seed
      );
      console.log(`🎲 Generated balanced condition sequence for ${key}:`, this.conditionSequences[key]);
    }
    const seq = this.conditionSequences[key];
    return seq[trialIndex % seq.length];
  }

  getRandomDistanceConditionFor1P2G(trialIndex) {
    const key = '1P2G';
    const numTrials = (CONFIG.game.experiments?.numTrials?.[key]) || 12;
    if (!this.conditionSequences[key]) {
      this.conditionSequences[key] = this.generateBalancedConditionSequence(
        Object.values(CONFIG.oneP2G.distanceConditions),
        numTrials
      );
      console.log(`🎲 Generated balanced condition sequence for ${key}:`, this.conditionSequences[key]);
    }
    const seq = this.conditionSequences[key];
    return seq[trialIndex % seq.length];
  }

  // Create a balanced randomized sequence from a set of conditions
  generateBalancedConditionSequence(conditions, numTrials, seed = null) {
    if (!Array.isArray(conditions) || conditions.length === 0 || numTrials <= 0) {
      return [];
    }
    const n = conditions.length;
    const per = Math.floor(numTrials / n);
    let rem = numTrials % n;

    const seq = [];
    // Equal representation
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < per; j++) seq.push(conditions[i]);
    }
    // Distribute remainder using deterministic or random order
    let idxOrder = [...Array(n).keys()];
    idxOrder = (Number.isInteger(seed)) ? this.seededShuffle(idxOrder, seed) : this.randomShuffle(idxOrder);
    let k = 0;
    while (rem > 0) {
      seq.push(conditions[idxOrder[k % n]]);
      k++;
      rem--;
    }
    // Final shuffle (deterministic if seed provided)
    const final = (Number.isInteger(seed)) ? this.seededShuffle(seq, seed ^ 0x9E3779B9) : this.randomShuffle(seq);
    return final;
  }

  // State synchronization for multiplayer
  syncState(remoteState) {
    // Before merging, detect if a new goal was added remotely so we can mirror trial flags
    try {
      const localGoals = Array.isArray(this.currentState?.currentGoals) ? this.currentState.currentGoals : [];
      const remoteGoals = Array.isArray(remoteState?.currentGoals) ? remoteState.currentGoals : null;

      if (
        remoteGoals &&
        Array.isArray(remoteGoals) &&
        Array.isArray(localGoals) &&
        remoteGoals.length > localGoals.length &&
        // Only for 2P3G trials where third goal can appear
        (this.currentState?.experimentType === '2P3G' || remoteState?.experimentType === '2P3G') &&
        this.trialData && this.trialData.newGoalPresented === false
      ) {
        // Find the newly added goal position present in remote but not in local
        const isSamePos = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
        const newOnRemote = remoteGoals.find(rg => !localGoals.some(lg => isSamePos(lg, rg)));
        if (Array.isArray(newOnRemote) && newOnRemote.length === 2) {
          // Mark as presented using remote state's legacy condition field when available
          const cond = (remoteState && (remoteState.distanceCondition || remoteState.newGoalConditionType))
            || this.trialData.distanceCondition || this.trialData.newGoalConditionType || null;
          this.markNewGoalPresented([...newOnRemote], cond, {});
        }
      }
    } catch (_) {
      // Swallow sync inference errors to avoid destabilizing gameplay
    }

    // Merge remote state with local state, preserving goals that exist locally but not remotely
    const mergedState = { ...this.currentState, ...remoteState };

    // Special handling for currentGoals to prevent goal disappearance in 2P3G
    if (this.currentState?.experimentType === '2P3G' || remoteState?.experimentType === '2P3G') {
      const localGoals = Array.isArray(this.currentState?.currentGoals) ? this.currentState.currentGoals : [];
      const remoteGoals = Array.isArray(remoteState?.currentGoals) ? remoteState.currentGoals : [];

      // Use the version with more goals (prevents regression)
      if (localGoals.length > remoteGoals.length) {
        console.log(`🔧 [SYNC FIX] Preserving local goals (${localGoals.length}) over remote goals (${remoteGoals.length})`);
        mergedState.currentGoals = localGoals;
        // Also preserve the grid matrix with local goals
        if (this.currentState?.gridMatrix) {
          mergedState.gridMatrix = this.currentState.gridMatrix;
        }
      } else if (remoteGoals.length > localGoals.length) {
        console.log(`🔧 [SYNC FIX] Accepting remote goals (${remoteGoals.length}) over local goals (${localGoals.length})`);
        // Remote has more goals, ensure the grid matrix is updated to match
        if (remoteState?.gridMatrix) {
          mergedState.gridMatrix = remoteState.gridMatrix;
        }
      }
    }

    this.currentState = mergedState;
  }

  getCurrentState() {
    return { ...this.currentState };
  }

  // Real-time movement synchronization methods

  /**
   * Process player move with throttling for real-time mode
   */
  processPlayerMoveRealTime(playerIndex, direction, timestamp = Date.now(), isLocal = false, currentPlayerIndex = null) {
    const rtConfig = CONFIG.multiplayer.realTimeMovement;

    // Check throttling
    const lastMoveTime = this.lastMoveTime.get(playerIndex) || 0;
    if (timestamp - lastMoveTime < rtConfig.moveThrottleDelay) {
      return { success: false, reason: 'throttled' };
    }

    // Update last move time
    this.lastMoveTime.set(playerIndex, timestamp);

    // Process move immediately - no queuing
    const result = this.processPlayerMove(playerIndex, direction, currentPlayerIndex);

    // Add metadata
    result.timestamp = timestamp;
    result.isLocal = isLocal;
    result.moveId = `move_${this.moveCounter++}_${playerIndex}_${timestamp}`;

    return result;
  }

  /**
   * Check if state sync is needed
   */
  shouldSyncState() {
    const rtConfig = CONFIG.multiplayer.realTimeMovement;
    const now = Date.now();
    return now - this.lastSyncTime > rtConfig.stateSyncInterval;
  }

  /**
   * Mark that state sync occurred
   */
  markStateSynced() {
    this.lastSyncTime = Date.now();
  }

  /**
   * Clear real-time synchronization state
   */
  clearRealTimeSync() {
    this.lastMoveTime.clear();
    this.moveCounter = 0;
    this.lastSyncTime = 0;
    this.syncPending = false;
  }

  getCurrentTrialData() {
    return { ...this.trialData };
  }

  getTrialData() {
    return { ...this.trialData };
  }

  getExperimentData() {
    return { ...this.experimentData };
  }
}
