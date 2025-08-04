// New goal generation for 2P3G experiments based on legacy version
import { CONFIG } from '../config/gameConfig.js';
import { GameHelpers } from './GameHelpers.js';

export class NewGoalGenerator {
  
  // Distance conditions for new goal generation (matching legacy)
  static DISTANCE_CONDITIONS = {
    CLOSER_TO_PLAYER2: 'closer_to_player2',
    CLOSER_TO_PLAYER1: 'closer_to_player1', 
    EQUAL_TO_BOTH: 'equal_to_both',
    NO_NEW_GOAL: 'no_new_goal'
  };

  // Generate randomized distance condition sequence for balanced experiments
  static generateRandomizedDistanceSequence(numTrials) {
    const allConditions = [
      this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2,
      this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER1,
      this.DISTANCE_CONDITIONS.EQUAL_TO_BOTH,
      this.DISTANCE_CONDITIONS.NO_NEW_GOAL
    ];

    const numConditions = allConditions.length;
    const trialsPerCondition = Math.floor(numTrials / numConditions);
    const remainingTrials = numTrials % numConditions;

    // Create array with equal representation of each condition
    const sequence = [];
    for (let i = 0; i < numConditions; i++) {
      for (let j = 0; j < trialsPerCondition; j++) {
        sequence.push(allConditions[i]);
      }
    }

    // Add remaining trials randomly
    for (let i = 0; i < remainingTrials; i++) {
      const randomCondition = allConditions[Math.floor(Math.random() * numConditions)];
      sequence.push(randomCondition);
    }

    // Shuffle using Fisher-Yates algorithm
    for (let i = sequence.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
    }

    return sequence;
  }

  // Generate new goal based on distance condition (main function from legacy)
  static generateNewGoal(player2Pos, player1Pos, oldGoals, sharedGoalIndex, distanceCondition) {
    // Check if no new goal should be generated
    if (distanceCondition === this.DISTANCE_CONDITIONS.NO_NEW_GOAL) {
      return null;
    }

    if (sharedGoalIndex === null || sharedGoalIndex >= oldGoals.length) {
      return null;
    }

    const sharedGoal = oldGoals[sharedGoalIndex];
    const player1DistanceToOldGoal = GameHelpers.calculateGridDistance(player1Pos, sharedGoal);
    const player2DistanceToOldGoal = GameHelpers.calculateGridDistance(player2Pos, sharedGoal);
    const oldDistanceSum = player1DistanceToOldGoal + player2DistanceToOldGoal;

    // Find all valid positions for the new goal based on distance condition
    const validPositions = [];
    const matrixSize = CONFIG.game.matrixSize;

    for (let row = 0; row < matrixSize; row++) {
      for (let col = 0; col < matrixSize; col++) {
        const newGoalPosition = [row, col];

        // Skip if position is already occupied by existing goals or players
        if (this.isPositionOccupied(newGoalPosition, oldGoals, player1Pos, player2Pos)) {
          continue;
        }

        const newGoalDistanceToPlayer1 = GameHelpers.calculateGridDistance(player1Pos, newGoalPosition);
        const newGoalDistanceToPlayer2 = GameHelpers.calculateGridDistance(player2Pos, newGoalPosition);
        const newDistanceSum = newGoalDistanceToPlayer1 + newGoalDistanceToPlayer2;

        // Check if this position meets the distance condition
        if (this.meetsDistanceCondition(
          distanceCondition,
          newGoalDistanceToPlayer1,
          newGoalDistanceToPlayer2,
          player1DistanceToOldGoal,
          player2DistanceToOldGoal,
          newDistanceSum,
          oldDistanceSum
        )) {
          validPositions.push({
            position: newGoalPosition,
            conditionType: distanceCondition,
            distanceToPlayer1: newGoalDistanceToPlayer1,
            distanceToPlayer2: newGoalDistanceToPlayer2,
            distanceSum: newDistanceSum
          });
        }
      }
    }

    console.log('generateNewGoal: Found', validPositions.length, 'valid positions');
    
    if (validPositions.length > 0) {
      const selectedGoalData = validPositions[Math.floor(Math.random() * validPositions.length)];
      console.log('generateNewGoal: Selected position:', selectedGoalData.position);
      return selectedGoalData;
    }

    // If no strict matches found, try relaxed constraints
    console.log('generateNewGoal: No valid goals found with strict constraints, trying relaxed constraints');
    const relaxedValidPositions = this.findRelaxedValidPositions(
      player1Pos, player2Pos, oldGoals, distanceCondition
    );

    if (relaxedValidPositions.length > 0) {
      const selectedRelaxedGoalData = relaxedValidPositions[Math.floor(Math.random() * relaxedValidPositions.length)];
      console.log('generateNewGoal: Selected relaxed position:', selectedRelaxedGoalData.position);
      return selectedRelaxedGoalData;
    }

    return null;
  }

  // Check if position is occupied by existing elements
  static isPositionOccupied(position, goals, player1Pos, player2Pos) {
    const [row, col] = position;

    // Check against existing goals
    for (const goal of goals) {
      if (goal[0] === row && goal[1] === col) {
        return true;
      }
    }

    // Check against player positions
    if ((player1Pos[0] === row && player1Pos[1] === col) ||
        (player2Pos[0] === row && player2Pos[1] === col)) {
      return true;
    }

    return false;
  }

  // Check if a position meets the specific distance condition
  static meetsDistanceCondition(
    condition,
    newGoalDistanceToPlayer1,
    newGoalDistanceToPlayer2,
    player1DistanceToOldGoal,
    player2DistanceToOldGoal,
    newDistanceSum,
    oldDistanceSum
  ) {
    const closerThreshold = 1; // Minimum distance improvement
    const equalThreshold = 0.1; // Tolerance for "equal" distances

    switch (condition) {
      case this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2:
        // New goal must be closer to Player2 than old goal, with equal total distance sum
        return newGoalDistanceToPlayer2 < player2DistanceToOldGoal - closerThreshold &&
               Math.abs(newDistanceSum - oldDistanceSum) < equalThreshold;

      case this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER1:
        // New goal must be closer to Player1 than old goal, with equal total distance sum
        return newGoalDistanceToPlayer1 < player1DistanceToOldGoal - closerThreshold &&
               Math.abs(newDistanceSum - oldDistanceSum) < equalThreshold;

      case this.DISTANCE_CONDITIONS.EQUAL_TO_BOTH:
        // New goal must be equidistant from both players and maintain equal total distance sum
        const distanceDifference = Math.abs(newGoalDistanceToPlayer2 - newGoalDistanceToPlayer1);
        return distanceDifference < equalThreshold && // Equal distance to both players
               Math.abs(newDistanceSum - oldDistanceSum) < equalThreshold; // Equal sum distance

      default:
        return false;
    }
  }

  // Find valid positions with relaxed constraints when strict matching fails
  static findRelaxedValidPositions(player1Pos, player2Pos, oldGoals, distanceCondition) {
    const relaxedValidPositions = [];
    const matrixSize = CONFIG.game.matrixSize;

    for (let row = 0; row < matrixSize; row++) {
      for (let col = 0; col < matrixSize; col++) {
        const newGoalPosition = [row, col];

        // Only check basic constraints: not occupied and reasonable distance from players
        if (!this.isPositionOccupied(newGoalPosition, oldGoals, player1Pos, player2Pos)) {
          const distanceToPlayer1 = GameHelpers.calculateGridDistance(player1Pos, newGoalPosition);
          const distanceToPlayer2 = GameHelpers.calculateGridDistance(player2Pos, newGoalPosition);
          
          // Ensure reasonable distances (not too close, not too far)
          if (distanceToPlayer1 >= 2 && distanceToPlayer1 <= 10 &&
              distanceToPlayer2 >= 2 && distanceToPlayer2 <= 10) {
            relaxedValidPositions.push({
              position: newGoalPosition,
              conditionType: distanceCondition,
              distanceToPlayer1: distanceToPlayer1,
              distanceToPlayer2: distanceToPlayer2,
              distanceSum: distanceToPlayer1 + distanceToPlayer2
            });
          }
        }
      }
    }

    return relaxedValidPositions;
  }

  // Check if both players are heading to the same goal (triggers new goal generation)
  static checkNewGoalPresentation2P3G(gameState, trialData, distanceCondition) {
    const { player1, player2, currentGoals } = gameState;
    
    if (!player1 || !player2 || !currentGoals || currentGoals.length < 2) {
      return null;
    }

    // Check if we already presented a new goal
    if (trialData.newGoalPresented) {
      return null;
    }

    // Get current inferred goals for both players
    const player1CurrentGoal = this.getPlayerCurrentGoal(trialData.player1CurrentGoal);
    const player2CurrentGoal = this.getPlayerCurrentGoal(trialData.player2CurrentGoal);

    // Check if both players are heading to the same goal
    if (player1CurrentGoal !== null && player2CurrentGoal !== null &&
        player1CurrentGoal === player2CurrentGoal) {
      
      console.log('=== SHARED GOAL DETECTED ===');
      console.log('Player1 goal:', player1CurrentGoal, 'Player2 goal:', player2CurrentGoal);
      
      // Generate new goal based on distance condition
      const newGoalResult = this.generateNewGoal(
        player2, player1, currentGoals, 
        player1CurrentGoal, distanceCondition
      );

      if (newGoalResult) {
        console.log('=== NEW GOAL GENERATED ===');
        console.log('New goal position:', newGoalResult.position);
        console.log('Distance condition:', distanceCondition);
        
        return {
          position: newGoalResult.position,
          conditionType: newGoalResult.conditionType,
          distanceToPlayer1: newGoalResult.distanceToPlayer1,
          distanceToPlayer2: newGoalResult.distanceToPlayer2
        };
      }
    }

    return null;
  }

  // Get the most recent goal inference for a player
  static getPlayerCurrentGoal(goalHistory) {
    if (!goalHistory || goalHistory.length === 0) {
      return null;
    }
    return goalHistory[goalHistory.length - 1];
  }
}