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

  // 1P2G: generate a second goal based on distance condition relative to player1 and first goal
  static generateNewGoal1P2G(player1Pos, firstGoal, existingGoals, distanceCondition) {
    if (!player1Pos || !firstGoal) return null;

    // Do not add if condition is no-new-goal
    const oneCfg = CONFIG.oneP2G;
    if (!oneCfg || distanceCondition === oneCfg?.distanceConditions?.NO_NEW_GOAL) {
      return null;
    }

    const player1DistanceToFirst = GameHelpers.calculateGridDistance(player1Pos, firstGoal);
    const matrixSize = CONFIG.game.matrixSize;

    // Constraints
    const minDistFromHuman = oneCfg.goalConstraints?.minDistanceFromHuman ?? 1;
    const maxDistFromHuman = oneCfg.goalConstraints?.maxDistanceFromHuman ?? Infinity;
    const minDistBetweenGoals = oneCfg.goalConstraints?.minDistanceBetweenGoals ?? 2;

    const closerThreshold = oneCfg.distanceConstraint?.closerThreshold ?? 1;
    const fartherThreshold = oneCfg.distanceConstraint?.fartherThreshold ?? 1;
    const allowEqual = !!oneCfg.distanceConstraint?.allowEqualDistance;
    const equalTolerance = Number.isFinite(oneCfg.distanceConstraint?.equalTolerance) ? oneCfg.distanceConstraint.equalTolerance : 0;

    const isOccupied = (row, col) => {
      // Check existing goals
      if (Array.isArray(existingGoals)) {
        for (const g of existingGoals) {
          if (g[0] === row && g[1] === col) return true;
        }
      }
      // Check player position
      if (player1Pos[0] === row && player1Pos[1] === col) return true;
      return false;
    };

    const meetsDistanceCondition = (distNew) => {
      switch (distanceCondition) {
        case oneCfg.distanceConditions?.CLOSER_TO_PLAYER1:
          return distNew <= player1DistanceToFirst - closerThreshold;
        case oneCfg.distanceConditions?.FARTHER_TO_PLAYER1:
          return distNew >= player1DistanceToFirst + fartherThreshold;
        case oneCfg.distanceConditions?.EQUAL_TO_PLAYER1:
          return allowEqual && Math.abs(distNew - player1DistanceToFirst) <= equalTolerance;
        default:
          return false;
      }
    };

    const validPositions = [];
    for (let row = 0; row < matrixSize; row++) {
      for (let col = 0; col < matrixSize; col++) {
        if (isOccupied(row, col)) continue;

        const candidate = [row, col];
        const dHuman = GameHelpers.calculateGridDistance(player1Pos, candidate);
        if (dHuman < minDistFromHuman || dHuman > maxDistFromHuman) continue;

        const dBetween = GameHelpers.calculateGridDistance(firstGoal, candidate);
        if (dBetween < minDistBetweenGoals) continue;

        if (meetsDistanceCondition(dHuman)) {
          validPositions.push(candidate);
        }
      }
    }

    if (validPositions.length === 0) {
      // Relaxed criteria: only enforce occupancy and basic distance from human
      for (let row = 0; row < matrixSize; row++) {
        for (let col = 0; col < matrixSize; col++) {
          if (isOccupied(row, col)) continue;
          const candidate = [row, col];
          const dHuman = GameHelpers.calculateGridDistance(player1Pos, candidate);
          if (dHuman >= 1 && dHuman <= Math.max(10, maxDistFromHuman)) {
            validPositions.push(candidate);
          }
        }
      }
    }

    if (validPositions.length === 0) return null;
    const selected = validPositions[Math.floor(Math.random() * validPositions.length)];
    return {
      position: selected,
      conditionType: distanceCondition,
      distanceToPlayer1: GameHelpers.calculateGridDistance(player1Pos, selected)
    };
  }

  // 1P2G: check whether to present a new goal during play
  static checkNewGoalPresentation1P2G(gameState, trialData, distanceCondition) {
    if (!gameState || !trialData) return null;

    // Only when we have exactly 2 goals (we are adding the third)
    if (!gameState.currentGoals || gameState.currentGoals.length !== 2) return null;

    if (trialData.newGoalPresented) return null;

    // Need a current inferred goal and to pass the minimum step threshold
    const minSteps = CONFIG.oneP2G?.minStepsBeforeNewGoal ?? 0;
    // trialData may not track steps; ExperimentManager will gate by step count

    const history = trialData.player1CurrentGoal;
    const latest = Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null;
    if (latest === null) return null;

    const firstGoal = gameState.currentGoals[0];
    const result = this.generateNewGoal1P2G(gameState.player1, firstGoal, gameState.currentGoals, distanceCondition);
    if (!result) return null;

    return {
      position: result.position,
      conditionType: result.conditionType,
      distanceToPlayer1: result.distanceToPlayer1
    };
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
    const gc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.goalConstraints) || {};
    const minDistHuman = Number.isFinite(gc.minDistanceFromHuman) ? gc.minDistanceFromHuman : 1;
    const maxDistHuman = Number.isFinite(gc.maxDistanceFromHuman) ? gc.maxDistanceFromHuman : Infinity;

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

        // Apply goal constraints (distance from humans)
        if (newGoalDistanceToPlayer1 < minDistHuman || newGoalDistanceToPlayer1 > maxDistHuman) {
          continue;
        }
        if (newGoalDistanceToPlayer2 < minDistHuman || newGoalDistanceToPlayer2 > maxDistHuman) {
          continue;
        }

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

    // console.log('generateNewGoal: Found', validPositions.length, 'valid positions');

    if (validPositions.length > 0) {
      const selectedGoalData = validPositions[Math.floor(Math.random() * validPositions.length)];
      // console.log('generateNewGoal: Selected position:', selectedGoalData.position);
      return selectedGoalData;
    }

    // If no strict matches found, try relaxed constraints
    // console.log('generateNewGoal: No valid goals found with strict constraints, trying relaxed constraints');
    const relaxedValidPositions = this.findRelaxedValidPositions(
      player1Pos, player2Pos, oldGoals, distanceCondition
    );

    if (relaxedValidPositions.length > 0) {
      const selectedRelaxedGoalData = relaxedValidPositions[Math.floor(Math.random() * relaxedValidPositions.length)];
      // console.log('generateNewGoal: Selected relaxed position:', selectedRelaxedGoalData.position);
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
    // Read thresholds from config to avoid over‑restrictive defaults
    const dc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.distanceConstraint) || {};
    const gc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.goalConstraints) || {};
    const closerThreshold = Number.isFinite(dc.closerThreshold) ? dc.closerThreshold : 1;
    const allowEqualDistance = Boolean(dc.allowEqualDistance);
    const maxDistanceIncrease = Number.isFinite(dc.maxDistanceIncrease) ? dc.maxDistanceIncrease : 0; // 0 = do not allow increase by default

    const maintainEqualSum = Boolean(gc.maintainDistanceSum);
    const equalSumOk = maintainEqualSum
      ? (newDistanceSum === oldDistanceSum) // Manhattan distances are integers
      : (newDistanceSum <= (oldDistanceSum + maxDistanceIncrease));

    switch (condition) {
      case this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2: {
        const closerOK = allowEqualDistance
          ? (newGoalDistanceToPlayer2 <= player2DistanceToOldGoal - closerThreshold)
          : (newGoalDistanceToPlayer2 < player2DistanceToOldGoal - closerThreshold);
        return closerOK && equalSumOk;
      }
      case this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER1: {
        const closerOK = allowEqualDistance
          ? (newGoalDistanceToPlayer1 <= player1DistanceToOldGoal - closerThreshold)
          : (newGoalDistanceToPlayer1 < player1DistanceToOldGoal - closerThreshold);
        return closerOK && equalSumOk;
      }
      case this.DISTANCE_CONDITIONS.EQUAL_TO_BOTH: {
        // Match legacy implementation with 4 equal constraints
        const distanceDiff1 = Math.abs(newGoalDistanceToPlayer1 - player1DistanceToOldGoal);
        const distanceDiff2 = Math.abs(newGoalDistanceToPlayer2 - player2DistanceToOldGoal);
        const distanceDiff3 = Math.abs(newGoalDistanceToPlayer2 - newGoalDistanceToPlayer1);

        const equalTolerance = allowEqualDistance ? 1 : 0; // tolerance for equal distance
        const sumTolerance = allowEqualDistance ? 1 : 0; // relaxed sum tolerance for EQUAL_TO_BOTH

        const meetsEqualCondition = distanceDiff1 <= equalTolerance &&
                                  distanceDiff2 <= equalTolerance &&
                                  distanceDiff3 <= equalTolerance &&
                                  Math.abs(newDistanceSum - oldDistanceSum) <= sumTolerance;
        return meetsEqualCondition;
      }
      default:
        return false;
    }
  }

  // Find valid positions with relaxed constraints when strict matching fails
  static findRelaxedValidPositions(player1Pos, player2Pos, oldGoals, distanceCondition) {
    const relaxedValidPositions = [];
    const matrixSize = CONFIG.game.matrixSize;
    const dc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.distanceConstraint) || {};
    const gc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.goalConstraints) || {};
    const minD = Number.isFinite(gc.minDistanceFromHuman) ? gc.minDistanceFromHuman : 2;
    const maxD = Number.isFinite(gc.maxDistanceFromHuman) ? gc.maxDistanceFromHuman : (Number.isFinite(dc.maxDistanceIncrease) ? Math.max(10, 2 + dc.maxDistanceIncrease) : 10);

    for (let row = 0; row < matrixSize; row++) {
      for (let col = 0; col < matrixSize; col++) {
        const newGoalPosition = [row, col];

        // Only check basic constraints: not occupied and reasonable distance from players
        if (!this.isPositionOccupied(newGoalPosition, oldGoals, player1Pos, player2Pos)) {
          const distanceToPlayer1 = GameHelpers.calculateGridDistance(player1Pos, newGoalPosition);
          const distanceToPlayer2 = GameHelpers.calculateGridDistance(player2Pos, newGoalPosition);

          // Ensure reasonable distances (not too close, not too far)
          if (distanceToPlayer1 >= minD && distanceToPlayer1 <= maxD &&
              distanceToPlayer2 >= minD && distanceToPlayer2 <= maxD) {
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
