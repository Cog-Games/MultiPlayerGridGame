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
  }

  initializeTrial(trialIndex, experimentType, design) {
    this.trialData.trialIndex = trialIndex;
    this.trialData.experimentType = experimentType;
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

    // Add distance condition for 2P3G and 1P2G trials
    if (experimentType === '2P3G') {
      this.trialData.distanceCondition = this.getRandomDistanceConditionFor2P3G(trialIndex);
    } else if (experimentType === '1P2G') {
      this.trialData.distanceCondition = this.getRandomDistanceConditionFor1P2G(trialIndex);
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
      return player1AtGoal;
    } else {
      // 2P experiments - both players must reach goals
      if (player1AtGoal && player2AtGoal) {
        // Check collaboration success
        const p1Goal = this.trialData.player1FinalReachedGoal;
        const p2Goal = this.trialData.player2FinalReachedGoal;
        this.trialData.collaborationSucceeded = (p1Goal === p2Goal && p1Goal !== null);
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
  getRandomDistanceConditionFor2P3G(trialIndex) {
    if (trialIndex >= CONFIG.game.successThreshold.randomSamplingAfterTrial) {
      const conditions = Object.values(CONFIG.twoP3G.distanceConditions);
      return conditions[Math.floor(Math.random() * conditions.length)];
    } else {
      // Use predefined sequence (would need to be implemented)
      return CONFIG.twoP3G.distanceConditions.CLOSER_TO_PLAYER2;
    }
  }

  getRandomDistanceConditionFor1P2G(trialIndex) {
    if (trialIndex >= CONFIG.game.successThreshold.randomSamplingAfterTrial) {
      const conditions = Object.values(CONFIG.oneP2G.distanceConditions);
      return conditions[Math.floor(Math.random() * conditions.length)];
    } else {
      // Use predefined sequence (would need to be implemented)
      return CONFIG.oneP2G.distanceConditions.CLOSER_TO_PLAYER1;
    }
  }

  // State synchronization for multiplayer
  syncState(remoteState) {
    // Merge remote state with local state
    this.currentState = { ...this.currentState, ...remoteState };
  }

  getCurrentState() {
    return { ...this.currentState };
  }

  getTrialData() {
    return { ...this.trialData };
  }

  getExperimentData() {
    return { ...this.experimentData };
  }
}