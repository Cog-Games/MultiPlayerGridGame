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

    this.trialData = {
      trialIndex: 0,
      experimentType: null,
      partnerAgentType: null,
      player1Trajectory: [],
      player2Trajectory: [],
      player1Actions: [],
      player2Actions: [],
      player1RT: [],
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
      collaborationSucceeded: undefined
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
      }
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
    this.trialData.newGoalPresented = false;
    this.trialData.isNewGoalCloserToPlayer2 = null;
    this.trialData.collaborationSucceeded = undefined;

    // Add distance condition for 2P3G and 1P2G trials (balanced sequence)
    if (experimentType === '2P3G') {
      this.trialData.distanceCondition = this.getRandomDistanceConditionFor2P3G(trialIndex);
    } else if (experimentType === '1P2G') {
      this.trialData.distanceCondition = this.getRandomDistanceConditionFor1P2G(trialIndex);
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
    if (experimentType.includes('2P') && design.initAIGrid && design.initAIGrid.length >= 2) {
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
    if (this.currentState.currentGoals.some(g => g[0] === row && g[1] === col)) return;
    this.currentState.gridMatrix[row][col] = GAME_OBJECTS.goal;
    this.currentState.currentGoals.push([row, col]);
  }

  // Record trial metadata for a newly presented goal
  markNewGoalPresented(position, conditionType, extra = {}) {
    if (!this.trialData) return;
    this.trialData.newGoalPresented = true;
    this.trialData.newGoalPresentedTime = this.stepCount;
    this.trialData.newGoalPosition = position ? [...position] : null;
    this.trialData.newGoalConditionType = conditionType || this.trialData.distanceCondition || null;
    if (typeof extra.isNewGoalCloserToPlayer2 === 'boolean') {
      this.trialData.isNewGoalCloserToPlayer2 = extra.isNewGoalCloserToPlayer2;
    }
  }

  processPlayerMove(playerIndex, direction) {
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
      this.recordPlayerMove(playerIndex, movement, reactionTime);

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

  recordPlayerMove(playerIndex, action, reactionTime) {
    const player = playerIndex === 1 ? this.currentState.player1 : this.currentState.player2;

    if (playerIndex === 1) {
      this.trialData.player1Actions.push(action);
      this.trialData.player1Trajectory.push([...player]);
      this.trialData.player1RT.push(reactionTime);
    } else {
      this.trialData.player2Actions.push(action);
      this.trialData.player2Trajectory.push([...player]);
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
    this.trialData.completed = success;
    this.trialData.endTime = Date.now();
    this.trialData.totalSteps = this.stepCount;

    // Add to experiment data
    this.experimentData.allTrialsData.push({ ...this.trialData });

    // Update success threshold tracking
    this.updateSuccessThreshold(success);
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
      const p2 = CONFIG?.game?.players?.player2?.type;
      if (p2 === 'human') return 'human';
      if (p2 === 'gpt') return 'gpt';
      if (p2 === 'rl_joint') return 'joint-rl';
      if (p2 === 'rl_individual') return 'individual-rl';
      if (p2 === 'ai') return (CONFIG?.game?.agent?.type === 'individual') ? 'individual-rl' : 'joint-rl'; // legacy safety
      return String(p2 || 'unknown');
    } catch (_) {
      return 'unknown';
    }
  }
  getRandomDistanceConditionFor2P3G(trialIndex) {
    // Use or create a balanced sequence for the experiment
    const key = '2P3G';
    const numTrials = (CONFIG.game.experiments?.numTrials?.[key]) || 12;
    if (!this.conditionSequences[key]) {
      this.conditionSequences[key] = this.generateBalancedConditionSequence(
        Object.values(CONFIG.twoP3G.distanceConditions),
        numTrials
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
  generateBalancedConditionSequence(conditions, numTrials) {
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
    // Distribute remainder starting from random offset to avoid bias
    let idxOrder = [...Array(n).keys()];
    // Fisher-Yates shuffle index order
    for (let i = idxOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxOrder[i], idxOrder[j]] = [idxOrder[j], idxOrder[i]];
    }
    let k = 0;
    while (rem > 0) {
      seq.push(conditions[idxOrder[k % n]]);
      k++;
      rem--;
    }
    // Final shuffle
    for (let i = seq.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seq[i], seq[j]] = [seq[j], seq[i]];
    }
    return seq;
  }

  // State synchronization for multiplayer
  syncState(remoteState) {
    // Merge remote state with local state
    this.currentState = { ...this.currentState, ...remoteState };
  }

  getCurrentState() {
    return { ...this.currentState };
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
