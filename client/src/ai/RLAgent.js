import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';
import { GameHelpers } from '../utils/GameHelpers.js';

// RL Agent Configuration
const RL_CONFIG = {
  gridSize: CONFIG.game.matrixSize,
  noise: 0.0,
  gamma: 0.9,
  goalReward: 30,
  stepCost: -1,
  softmaxBeta: 3.0,
  proximityRewardWeight: 0.01,
  coordinationRewardWeight: 0.02,
  maxPolicyIterations: 15,
  debugMode: false
};

// Actions for the RL agent
const ACTIONS = [
  [-1, 0], // up
  [1, 0],  // down
  [0, -1], // left
  [0, 1]   // right
];

export class RLAgent {
  constructor() {
    this.policyCache = new Map();
    this.isPreCalculating = false;
  }

  /**
   * Get AI action based on current state
   */
  getAIAction(gridMatrix, currentPos, goals, playerPos = null) {
    if (!goals || goals.length === 0) return [0, 0];

    try {
      // Use joint RL if player position is provided
      if (playerPos && CONFIG.game.agent.type === 'joint') {
        return this.getJointRLAction(gridMatrix, currentPos, goals, playerPos);
      } else {
        return this.getIndividualRLAction(gridMatrix, currentPos, goals);
      }
    } catch (error) {
      console.error('Error in RL agent:', error);
      return this.getFallbackAction(currentPos, goals);
    }
  }

  /**
   * Individual RL action (AI acts independently)
   */
  getIndividualRLAction(gridMatrix, currentPos, goals) {
    // Simple greedy approach to closest goal
    let closestGoal = null;
    let minDistance = Infinity;

    for (const goal of goals) {
      const distance = GameHelpers.calculateGridDistance(currentPos, goal);
      if (distance < minDistance) {
        minDistance = distance;
        closestGoal = goal;
      }
    }

    if (!closestGoal) return [0, 0];

    // Get direction towards closest goal
    const deltaRow = closestGoal[0] - currentPos[0];
    const deltaCol = closestGoal[1] - currentPos[1];

    // Choose action based on largest delta
    if (Math.abs(deltaRow) > Math.abs(deltaCol)) {
      return deltaRow > 0 ? [1, 0] : [-1, 0]; // down or up
    } else if (Math.abs(deltaCol) > 0) {
      return deltaCol > 0 ? [0, 1] : [0, -1]; // right or left
    }

    return [0, 0];
  }

  /**
   * Joint RL action (AI considers human player)
   */
  getJointRLAction(gridMatrix, aiPos, goals, humanPos) {
    // Get or calculate policy for current goals
    const policy = this.getOrCalculatePolicy(goals);
    
    if (!policy) {
      return this.getFallbackAction(aiPos, goals);
    }

    // Get joint state key
    const stateKey = this.getJointStateKey(humanPos, aiPos);
    
    // Get action probabilities from policy
    const actionProbs = policy[stateKey];
    if (!actionProbs) {
      return this.getFallbackAction(aiPos, goals);
    }

    // Sample action from probability distribution
    return this.sampleAction(actionProbs);
  }

  /**
   * Get or calculate policy for given goals
   */
  getOrCalculatePolicy(goals) {
    const goalsKey = this.hashGoals(goals);
    
    if (this.policyCache.has(goalsKey)) {
      return this.policyCache.get(goalsKey);
    }

    // Calculate policy using simplified value iteration
    const policy = this.calculateJointPolicy(goals);
    this.policyCache.set(goalsKey, policy);
    
    return policy;
  }

  /**
   * Calculate joint policy using simplified value iteration
   */
  calculateJointPolicy(goals) {
    const gridSize = RL_CONFIG.gridSize;
    const policy = {};

    // Initialize value function
    let V = {};
    const Q = {};

    // Initialize all states
    for (let h1 = 0; h1 < gridSize; h1++) {
      for (let h2 = 0; h2 < gridSize; h2++) {
        for (let a1 = 0; a1 < gridSize; a1++) {
          for (let a2 = 0; a2 < gridSize; a2++) {
            const stateKey = this.getJointStateKey([h1, h2], [a1, a2]);
            V[stateKey] = 0;
            Q[stateKey] = {};
            
            // Initialize Q-values for all joint actions
            for (let hAction = 0; hAction < ACTIONS.length; hAction++) {
              for (let aAction = 0; aAction < ACTIONS.length; aAction++) {
                Q[stateKey][`${hAction},${aAction}`] = 0;
              }
            }
          }
        }
      }
    }

    // Simplified value iteration (fewer iterations for performance)
    for (let iter = 0; iter < RL_CONFIG.maxPolicyIterations; iter++) {
      const newV = { ...V };

      for (const stateKey in V) {
        const [humanPos, aiPos] = this.parseJointStateKey(stateKey);
        
        // Skip if either player is at a goal
        if (this.isAtGoal(humanPos, goals) || this.isAtGoal(aiPos, goals)) {
          continue;
        }

        let maxQ = -Infinity;

        // Consider all joint actions
        for (let hAction = 0; hAction < ACTIONS.length; hAction++) {
          for (let aAction = 0; aAction < ACTIONS.length; aAction++) {
            const jointActionKey = `${hAction},${aAction}`;
            
            // Calculate next states
            const nextHumanPos = GameHelpers.transition(humanPos, ACTIONS[hAction]);
            const nextAiPos = GameHelpers.transition(aiPos, ACTIONS[aAction]);
            
            // Check bounds
            if (!GameHelpers.isValidPosition(nextHumanPos) || 
                !GameHelpers.isValidPosition(nextAiPos)) {
              continue;
            }

            // Calculate reward
            const reward = this.calculateJointReward(humanPos, aiPos, nextHumanPos, nextAiPos, goals);
            
            // Get next state value
            const nextStateKey = this.getJointStateKey(nextHumanPos, nextAiPos);
            const nextValue = V[nextStateKey] || 0;
            
            // Update Q-value
            const qValue = reward + RL_CONFIG.gamma * nextValue;
            Q[stateKey][jointActionKey] = qValue;
            
            if (qValue > maxQ) {
              maxQ = qValue;
            }
          }
        }

        newV[stateKey] = maxQ;
      }

      V = newV;
    }

    // Convert Q-values to policy (softmax)
    for (const stateKey in Q) {
      policy[stateKey] = this.softmaxPolicy(Q[stateKey]);
    }

    return policy;
  }

  /**
   * Calculate reward for joint state transition
   */
  calculateJointReward(humanPos, aiPos, nextHumanPos, nextAiPos, goals) {
    let reward = RL_CONFIG.stepCost * 2; // Cost for both players moving

    // Goal rewards
    for (const goal of goals) {
      if (nextHumanPos[0] === goal[0] && nextHumanPos[1] === goal[1]) {
        reward += RL_CONFIG.goalReward;
      }
      if (nextAiPos[0] === goal[0] && nextAiPos[1] === goal[1]) {
        reward += RL_CONFIG.goalReward;
      }
      
      // Collaboration bonus if both reach same goal
      if (nextHumanPos[0] === goal[0] && nextHumanPos[1] === goal[1] &&
          nextAiPos[0] === goal[0] && nextAiPos[1] === goal[1]) {
        reward += RL_CONFIG.goalReward; // Collaboration bonus
      }
    }

    // Proximity rewards (encouraging coordination)
    const proximity = GameHelpers.calculateGridDistance(nextHumanPos, nextAiPos);
    reward += RL_CONFIG.proximityRewardWeight * (RL_CONFIG.gridSize - proximity);

    return reward;
  }

  /**
   * Convert Q-values to softmax policy
   */
  softmaxPolicy(qValues) {
    const actionKeys = Object.keys(qValues);
    const values = actionKeys.map(key => qValues[key]);
    const maxValue = Math.max(...values);
    
    // Subtract max for numerical stability
    const expValues = values.map(v => Math.exp(RL_CONFIG.softmaxBeta * (v - maxValue)));
    const sumExp = expValues.reduce((sum, exp) => sum + exp, 0);
    
    const policy = {};
    actionKeys.forEach((key, i) => {
      policy[key] = expValues[i] / sumExp;
    });
    
    return policy;
  }

  /**
   * Sample action from probability distribution
   */
  sampleAction(actionProbs) {
    const rand = Math.random();
    let cumulative = 0;
    
    for (const [actionKey, prob] of Object.entries(actionProbs)) {
      cumulative += prob;
      if (rand < cumulative) {
        const [hAction, aAction] = actionKey.split(',').map(Number);
        return ACTIONS[aAction]; // Return AI action
      }
    }
    
    // Fallback to random action
    return ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  }

  /**
   * Fallback action when RL fails
   */
  getFallbackAction(currentPos, goals) {
    // Simple greedy approach
    let closestGoal = null;
    let minDistance = Infinity;

    for (const goal of goals) {
      const distance = GameHelpers.calculateGridDistance(currentPos, goal);
      if (distance < minDistance) {
        minDistance = distance;
        closestGoal = goal;
      }
    }

    if (!closestGoal) return [0, 0];

    const deltaRow = closestGoal[0] - currentPos[0];
    const deltaCol = closestGoal[1] - currentPos[1];

    if (Math.abs(deltaRow) > Math.abs(deltaCol)) {
      return deltaRow > 0 ? [1, 0] : [-1, 0];
    } else if (Math.abs(deltaCol) > 0) {
      return deltaCol > 0 ? [0, 1] : [0, -1];
    }

    return [0, 0];
  }

  /**
   * Pre-calculate policy for goals (for performance)
   */
  precalculatePolicyForGoals(goals, experimentType) {
    if (this.isPreCalculating) return;
    
    this.isPreCalculating = true;
    
    setTimeout(() => {
      try {
        this.getOrCalculatePolicy(goals);
        console.log('✅ Pre-calculated policy for goals:', goals);
      } catch (error) {
        console.error('Error pre-calculating policy:', error);
      } finally {
        this.isPreCalculating = false;
      }
    }, 0);
  }

  /**
   * Utility functions
   */
  hashGoals(goals) {
    return goals.map(g => `${g[0]},${g[1]}`).sort().join('|');
  }

  getJointStateKey(humanPos, aiPos) {
    return `${humanPos[0]},${humanPos[1]},${aiPos[0]},${aiPos[1]}`;
  }

  parseJointStateKey(stateKey) {
    const parts = stateKey.split(',').map(Number);
    return [[parts[0], parts[1]], [parts[2], parts[3]]];
  }

  isAtGoal(pos, goals) {
    return goals.some(goal => pos[0] === goal[0] && pos[1] === goal[1]);
  }

  /**
   * Clear policy cache
   */
  clearCache() {
    this.policyCache.clear();
  }

  /**
   * Enable auto policy pre-calculation
   */
  enableAutoPolicyPrecalculation() {
    console.log('✅ Auto policy pre-calculation enabled');
  }

  /**
   * Reset new goal pre-calculation flag
   */
  resetNewGoalPreCalculationFlag() {
    // Placeholder for compatibility
  }
}