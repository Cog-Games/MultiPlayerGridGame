import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';

export const GameHelpers = {
  /**
   * Check if a position is valid within the grid bounds
   */
  isValidPosition(position) {
    if (!position || !Array.isArray(position) || position.length < 2) {
      return false;
    }
    const [row, col] = position;
    return row >= 0 && row < CONFIG.game.matrixSize && col >= 0 && col < CONFIG.game.matrixSize;
  },

  /**
   * Check if a move is valid (within bounds and not blocked)
   */
  isValidMove(gridMatrix, currentPos, action) {
    const newPos = this.transition(currentPos, action);
    
    if (!this.isValidPosition(newPos)) {
      return [0, 0]; // No movement if invalid
    }
    
    // Check for obstacles (if any)
    const [row, col] = newPos;
    if (gridMatrix[row][col] === GAME_OBJECTS.obstacle) {
      return [0, 0]; // No movement if blocked
    }
    
    return action;
  },

  /**
   * State transition function for grid movement
   */
  transition(state, action) {
    const [x, y] = state;
    return [x + action[0], y + action[1]];
  },

  /**
   * Calculate Manhattan distance between two positions
   */
  calculateGridDistance(pos1, pos2) {
    if (!pos1 || !pos2 || !Array.isArray(pos1) || !Array.isArray(pos2) ||
        pos1.length < 2 || pos2.length < 2) {
      return Infinity;
    }
    return Math.abs(pos1[0] - pos2[0]) + Math.abs(pos1[1] - pos2[1]);
  },

  /**
   * Check if a player has reached any goal
   */
  isGoalReached(playerPos, goals) {
    if (!playerPos || !goals || !Array.isArray(goals)) {
      return false;
    }

    for (let i = 0; i < goals.length; i++) {
      if (playerPos[0] === goals[i][0] && playerPos[1] === goals[i][1]) {
        return true;
      }
    }
    return false;
  },

  /**
   * Check which goal a player has reached
   */
  whichGoalReached(playerPos, goals) {
    for (let i = 0; i < goals.length; i++) {
      if (this.isGoalReached(playerPos, [goals[i]])) {
        return i;
      }
    }
    return null;
  },

  /**
   * Detect which goal a player is heading towards
   */
  detectPlayerGoal(playerPos, action, goals, goalHistory) {
    if (!action) {
      return null;
    }

    // Convert string action to array format if needed
    let actionArray;
    if (typeof action === 'string') {
      switch (action) {
        case 'up':
          actionArray = [-1, 0];
          break;
        case 'down':
          actionArray = [1, 0];
          break;
        case 'left':
          actionArray = [0, -1];
          break;
        case 'right':
          actionArray = [0, 1];
          break;
        default:
          return null;
      }
    } else if (Array.isArray(action)) {
      actionArray = action;
    } else {
      return null;
    }

    if (actionArray[0] === 0 && actionArray[1] === 0) {
      return null; // No movement, can't determine goal
    }

    const nextPos = this.transition(playerPos, actionArray);
    let minDistance = Infinity;
    let closestGoal = null;
    const equidistantGoals = [];

    for (let i = 0; i < goals.length; i++) {
      const distance = this.calculateGridDistance(nextPos, goals[i]);
      if (distance < minDistance) {
        minDistance = distance;
        closestGoal = i;
        equidistantGoals.length = 0;
        equidistantGoals.push(i);
      } else if (distance === minDistance) {
        equidistantGoals.push(i);
      }
    }

    // If there are multiple equidistant goals, return last step's inferred goal
    if (equidistantGoals.length > 1) {
      if (goalHistory && goalHistory.length > 0) {
        return goalHistory[goalHistory.length - 1];
      } else {
        return null;
      }
    }

    return closestGoal;
  },

  /**
   * Update matrix at specific position
   */
  updateMatrix(matrix, row, col, value) {
    const newMatrix = matrix.map(row => [...row]);
    if (row >= 0 && row < newMatrix.length && col >= 0 && col < newMatrix[0].length) {
      newMatrix[row][col] = value;
    }
    return newMatrix;
  },

  /**
   * Generate random position within grid bounds
   */
  generateRandomPosition(excludePositions = []) {
    const size = CONFIG.game.matrixSize;
    let position;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      position = [
        Math.floor(Math.random() * size),
        Math.floor(Math.random() * size)
      ];
      attempts++;
    } while (
      attempts < maxAttempts &&
      excludePositions.some(pos => pos[0] === position[0] && pos[1] === position[1])
    );

    return position;
  },

  /**
   * Create fallback design when map data is not available
   */
  createFallbackDesign(experimentType) {
    console.log('Creating fallback design for:', experimentType);

    switch (experimentType) {
      case '1P1G':
        return {
          initPlayerGrid: [7, 2],
          target1: [7, 12],
          mapType: '1P1G'
        };

      case '1P2G':
        return {
          initPlayerGrid: [7, 7],
          target1: [2, 7],
          target2: [12, 7],
          mapType: '1P2G'
        };

      case '2P2G':
        return {
          initPlayerGrid: [7, 2],
          initAIGrid: [7, 12],
          target1: [2, 7],
          target2: [12, 7],
          mapType: '2P2G'
        };

      case '2P3G':
        return {
          initPlayerGrid: [7, 2],
          initAIGrid: [7, 12],
          target1: [2, 7],
          target2: [12, 7],
          mapType: '2P3G'
        };

      default:
        console.error('No fallback design for experiment type:', experimentType);
        return null;
    }
  },

  /**
   * Calculate success rate from trial data
   */
  calculateSuccessRate(trialsData) {
    if (!trialsData || trialsData.length === 0) return 0;

    const successful = trialsData.filter(trial =>
      trial.collaborationSucceeded === true || trial.completed === true
    ).length;

    return Math.round((successful / trialsData.length) * 100);
  },

  /**
   * Format time duration for display
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${remainingSeconds}s`;
  },

  /**
   * Deep clone object
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const cloned = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }
  }
};