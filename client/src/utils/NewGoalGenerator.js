// New goal generation for 2P3G experiments based on legacy version
import { CONFIG } from '../config/gameConfig.js';
import { GameHelpers } from './GameHelpers.js';

export class NewGoalGenerator {

  // Version saved with every generated 2P3G goal so analyses can distinguish
  // these RL-aligned trials from data produced by earlier fallback rules.
  static GOAL_GEOMETRY_RULE_VERSION = 'kids-vlm-aligned-balanced-tolerance-v1';

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
  static generateNewGoal(player2Pos, player1Pos, oldGoals, sharedGoalIndex, distanceCondition, options = {}) {
    // Check if no new goal should be generated
    if (distanceCondition === this.DISTANCE_CONDITIONS.NO_NEW_GOAL) {
      return null;
    }

    if (!Number.isInteger(sharedGoalIndex) || sharedGoalIndex < 0 || sharedGoalIndex >= oldGoals.length) {
      return null;
    }

    const sharedGoal = oldGoals[sharedGoalIndex];
    const player1DistanceToOldGoal = GameHelpers.calculateGridDistance(player1Pos, sharedGoal);
    const player2DistanceToOldGoal = GameHelpers.calculateGridDistance(player2Pos, sharedGoal);
    const oldDistanceSum = player1DistanceToOldGoal + player2DistanceToOldGoal;

    // Find all valid positions for the new goal based on distance condition
    const validPositions = [];
    const relaxedPositions = [];
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
        if (options.gridMatrix?.[row]?.[col] === 4) continue;

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

        const strict = this.meetsDistanceCondition(
          distanceCondition,
          newGoalDistanceToPlayer1,
          newGoalDistanceToPlayer2,
          player1DistanceToOldGoal,
          player2DistanceToOldGoal,
          newDistanceSum,
          oldDistanceSum
        );
        const candidate = {
            position: newGoalPosition,
            conditionType: distanceCondition,
            distanceToPlayer1: newGoalDistanceToPlayer1,
            distanceToPlayer2: newGoalDistanceToPlayer2,
            distanceSum: newDistanceSum,
            oldDistanceToPlayer1: player1DistanceToOldGoal,
            oldDistanceToPlayer2: player2DistanceToOldGoal,
            oldDistanceSum,
            jointDistanceDelta: newDistanceSum - oldDistanceSum,
            distanceDifferenceBetweenPlayers: newGoalDistanceToPlayer1 - newGoalDistanceToPlayer2,
            targetedDistanceImprovement: this.getTargetedDistanceImprovement(
              distanceCondition,
              newGoalDistanceToPlayer1,
              newGoalDistanceToPlayer2,
              player1DistanceToOldGoal,
              player2DistanceToOldGoal
            ),
            geometryRuleVersion: this.GOAL_GEOMETRY_RULE_VERSION,
            generationReferenceGoal: sharedGoalIndex,
            meanDistanceDelta: (newDistanceSum - oldDistanceSum) / 2,
            generationMode: strict ? 'strict' : 'bounded-tolerance'
        };
        if (strict) validPositions.push(candidate);
        else if (options.allowTolerance && this.meetsBoundedTolerance(candidate)) relaxedPositions.push(candidate);
      }
    }

    // console.log('generateNewGoal: Found', validPositions.length, 'valid positions');

    if (options.diagnostics) Object.assign(options.diagnostics, {
      strictCandidateCount: validPositions.length, relaxedCandidateCount: relaxedPositions.length
    });
    // Prefer an exact candidate even when tolerance could repay an earlier debt.
    const pool = validPositions.length ? validPositions : relaxedPositions;
    if (pool.length) return this.selectBalancedCandidate(pool, options.balance, {
      strictCandidateCount: validPositions.length, relaxedCandidateCount: relaxedPositions.length
    });

    // Do not relabel an arbitrary position as closer/equal. The caller checks
    // again as players move. An empty bounded set is logged, never replaced by
    // an arbitrary position carrying a misleading condition label.
    return null;
  }

  static emptyBalance() {
    return { meanDistanceDelta: 0, equalDistanceGap: 0, generatedCount: 0, relaxedCount: 0 };
  }

  static meetsBoundedTolerance(candidate) {
    const cfg = CONFIG.twoP3G.generationTolerance || {};
    if (!cfg.enabled) return false;
    if (Math.abs(candidate.meanDistanceDelta) > (cfg.maxMeanDistanceDelta ?? 1)) return false;
    if (candidate.conditionType === this.DISTANCE_CONDITIONS.EQUAL_TO_BOTH) {
      return Math.abs(candidate.distanceDifferenceBetweenPlayers) <= (cfg.maxEqualDistanceGap ?? 1);
    }
    const improvement = candidate.targetedDistanceImprovement;
    const maxImprovement = CONFIG.twoP3G.distanceConstraint.maxDistanceImprovement;
    if (!Number.isFinite(improvement) || improvement < (cfg.minRelaxedDistanceImprovement ?? 1)) return false;
    if (Number.isFinite(maxImprovement) && improvement > maxImprovement) return false;
    // Preserve the direction of the manipulation: the other player may not
    // also benefit. Never turn a closer-to-one condition into closer-to-both.
    const otherDelta = candidate.conditionType === this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER1
      ? candidate.distanceToPlayer2 - candidate.oldDistanceToPlayer2
      : candidate.distanceToPlayer1 - candidate.oldDistanceToPlayer1;
    return otherDelta >= 0;
  }

  static selectBalancedCandidate(candidates, balance = {}, counts = {}) {
    const before = { ...this.emptyBalance(), ...balance };
    const balanceEnabled = CONFIG.twoP3G.generationTolerance?.balanceAcrossTrials !== false;
    const delta = c => ({
      meanDistanceDelta: c.meanDistanceDelta,
      equalDistanceGap: c.conditionType === this.DISTANCE_CONDITIONS.EQUAL_TO_BOTH
        ? c.distanceDifferenceBetweenPlayers : 0
    });
    const score = c => {
      const e = delta(c);
      const debt = Math.abs(before.meanDistanceDelta + e.meanDistanceDelta) +
                   Math.abs(before.equalDistanceGap + e.equalDistanceGap);
      return [balanceEnabled ? debt : 0, Math.abs(e.meanDistanceDelta) + Math.abs(e.equalDistanceGap)];
    };
    const compare = (a,b) => a[0]-b[0] || a[1]-b[1];
    let best = score(candidates[0]);
    for (const c of candidates) if (compare(score(c),best)<0) best=score(c);
    const ties = candidates.filter(c=>compare(score(c),best)===0);
    const selected = ties[Math.floor(Math.random()*ties.length)];
    const e = delta(selected);
    return { ...selected, ...counts, balanceBefore: before,
      balanceAfter: {
        meanDistanceDelta: before.meanDistanceDelta + e.meanDistanceDelta,
        equalDistanceGap: before.equalDistanceGap + e.equalDistanceGap,
        generatedCount: before.generatedCount + 1,
        relaxedCount: before.relaxedCount + Number(selected.generationMode !== 'strict')
      },
      balanceScope: 'session-by-condition',
      // Best effort: a one-sided candidate set can leave an unpaid signed debt.
      balanceDebtIncreased: Math.abs(before.meanDistanceDelta + e.meanDistanceDelta) +
        Math.abs(before.equalDistanceGap + e.equalDistanceGap) >
        Math.abs(before.meanDistanceDelta) + Math.abs(before.equalDistanceGap)
    };
  }

  static getTargetedDistanceImprovement(
    condition,
    newGoalDistanceToPlayer1,
    newGoalDistanceToPlayer2,
    player1DistanceToOldGoal,
    player2DistanceToOldGoal
  ) {
    if (condition === this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER1) {
      return player1DistanceToOldGoal - newGoalDistanceToPlayer1;
    }
    if (condition === this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2) {
      return player2DistanceToOldGoal - newGoalDistanceToPlayer2;
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
    // Match the geometry of the adult individual-/joint-RL conditions.
    const dc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.distanceConstraint) || {};
    const gc = (CONFIG && CONFIG.twoP3G && CONFIG.twoP3G.goalConstraints) || {};
    const minDistanceImprovement = Number.isFinite(dc.minDistanceImprovement)
      ? dc.minDistanceImprovement
      : 2;
    const maxDistanceImprovement = Number.isFinite(dc.maxDistanceImprovement)
      ? dc.maxDistanceImprovement
      : Infinity;
    const exactJointDistance = gc.maintainDistanceSum !== false;
    const jointDistanceOK = exactJointDistance
      ? newDistanceSum === oldDistanceSum
      : true;

    switch (condition) {
      case this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER2: {
        const improvement = player2DistanceToOldGoal - newGoalDistanceToPlayer2;
        return improvement >= minDistanceImprovement &&
               improvement <= maxDistanceImprovement &&
               jointDistanceOK;
      }
      case this.DISTANCE_CONDITIONS.CLOSER_TO_PLAYER1: {
        const improvement = player1DistanceToOldGoal - newGoalDistanceToPlayer1;
        return improvement >= minDistanceImprovement &&
               improvement <= maxDistanceImprovement &&
               jointDistanceOK;
      }
      case this.DISTANCE_CONDITIONS.EQUAL_TO_BOTH: {
        // The RL conditions constrained the NEW goal to be equidistant from
        // both players while preserving joint distance. Requiring each new
        // individual distance to equal its own old distance over-constrains the
        // geometry whenever the players were not already equidistant.
        return newGoalDistanceToPlayer1 === newGoalDistanceToPlayer2 &&
               jointDistanceOK;
      }
      default:
        return false;
    }
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

        return { ...newGoalResult };
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
