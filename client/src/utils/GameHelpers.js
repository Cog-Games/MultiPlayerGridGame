import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';

export const GameHelpers = {
  // Check if position is within grid bounds
  isValidPosition(pos) {
    const size = CONFIG.game.matrixSize;
    return pos[0] >= 0 && pos[0] < size && pos[1] >= 0 && pos[1] < size;
  },

  // Check if a move is valid (within bounds, not obstacle)
  isValidMove(gridMatrix, pos, action) {
    const newPos = [pos[0] + action[0], pos[1] + action[1]];
    if (!this.isValidPosition(newPos)) return false;
    const cell = gridMatrix[newPos[0]][newPos[1]];
    if (cell === GAME_OBJECTS.obstacle) return false;
    return true;
  },

  // Apply action to position
  transition(pos, action) {
    return [pos[0] + action[0], pos[1] + action[1]];
  },

  // Manhattan distance
  manhattanDistance(pos1, pos2) {
    return Math.abs(pos1[0] - pos2[0]) + Math.abs(pos1[1] - pos2[1]);
  },

  getStagCaptureState(player1Pos, player2Pos, stagPos) {
    const d1 = this.manhattanDistance(player1Pos, stagPos);
    const d2 = this.manhattanDistance(player2Pos, stagPos);
    const player1OnStag = d1 === 0;
    const player2OnStag = d2 === 0;
    const cooperativeTrap = d1 === 1 && d2 === 1;

    return {
      player1OnStag,
      player2OnStag,
      cooperativeTrap,
      captured: player1OnStag || player2OnStag || cooperativeTrap,
    };
  },

  // Stag capture ends the round if either hunter overlaps it or both hunters surround it.
  isStagCaptured(player1Pos, player2Pos, stagPos) {
    return this.getStagCaptureState(player1Pos, player2Pos, stagPos).captured;
  },

  // Check if a player reached a rabbit
  isRabbitReached(playerPos, rabbits) {
    for (let i = 0; i < rabbits.length; i++) {
      if (playerPos[0] === rabbits[i][0] && playerPos[1] === rabbits[i][1]) {
        return i;
      }
    }
    return -1;
  },

  // Create empty grid
  createEmptyGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(GAME_OBJECTS.blank));
  },

  // Build grid matrix from game state
  buildGridMatrix(state) {
    const size = CONFIG.game.matrixSize;
    const grid = this.createEmptyGrid(size);

    // Place obstacles
    if (state.obstacles) {
      for (const obs of state.obstacles) {
        grid[obs[0]][obs[1]] = GAME_OBJECTS.obstacle;
      }
    }

    // Place rabbits
    for (const rabbit of state.rabbits) {
      if (rabbit) grid[rabbit[0]][rabbit[1]] = GAME_OBJECTS.rabbit;
    }

    // Place stag
    if (state.stag) {
      grid[state.stag[0]][state.stag[1]] = GAME_OBJECTS.stag;
    }

    // Place players
    grid[state.player1[0]][state.player1[1]] = GAME_OBJECTS.player1;
    grid[state.player2[0]][state.player2[1]] = GAME_OBJECTS.player2;

    return grid;
  },

  // Get available moves from a position
  getAvailableMoves(gridMatrix, pos) {
    const actions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    return actions.filter(a => this.isValidMove(gridMatrix, pos, a));
  },
};
