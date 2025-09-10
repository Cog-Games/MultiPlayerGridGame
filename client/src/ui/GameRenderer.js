import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';

export class GameRenderer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.cellSize = CONFIG.visual.cellSize;
    this.canvasSize = CONFIG.visual.canvasSize;
    this.padding = CONFIG.visual.padding;
    this.effectiveCellSize = this.cellSize + this.padding; // Cell + padding as used in legacy
  }

  createCanvas() {
    this.canvas = document.createElement('canvas');
    // Initial dimensions will be set responsively
    this.canvas.width = this.canvasSize;
    this.canvas.height = this.canvasSize;
    this.canvas.style.border = '2px solid #333';
    this.canvas.style.backgroundColor = CONFIG.visual.colors.background;

    this.ctx = this.canvas.getContext('2d');

    // Apply responsive sizing on creation
    try { this.applyResponsiveSizing(); } catch (_) { /* ignore until attached */ }

    return this.canvas;
  }

  // Resize canvas and cell metrics to fit viewport/container while staying square
  applyResponsiveSizing() {
    if (!this.canvas) return;

    const gridSize = CONFIG.game.matrixSize;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;

    // Determine maximum CSS size available (square) based on viewport and parent container
    const parent = this.canvas.parentElement;
    const viewportMin = (typeof window !== 'undefined') ? Math.min(window.innerWidth || 0, window.innerHeight || 0) : this.canvasSize;
    const parentWidth = parent ? parent.clientWidth : viewportMin;

    // Use 85% of the smaller dimension, but never exceed parent width
    const targetCssSize = Math.max(200, Math.floor(Math.min(viewportMin * 0.85, parentWidth - 16)));

    // Compute integer cellSize based on padding formula:
    // total = N*cellSize + (N+1)*padding  => cellSize = (total - (N+1)*padding)/N
    let proposedCellSize = Math.floor((targetCssSize - (gridSize + 1) * this.padding) / gridSize);
    proposedCellSize = Math.max(10, proposedCellSize); // enforce a minimum cell size

    // Recompute the exact canvas size that matches integer cellSize
    const exactCanvasSize = gridSize * proposedCellSize + (gridSize + 1) * this.padding;

    // Update renderer metrics
    this.cellSize = proposedCellSize;
    this.effectiveCellSize = this.cellSize + this.padding;
    this.canvasSize = exactCanvasSize;

    // Set CSS size for layout
    this.canvas.style.width = `${exactCanvasSize}px`;
    this.canvas.style.height = `${exactCanvasSize}px`;

    // Set backing store size for crisp rendering on high-DPI displays
    const backing = Math.floor(exactCanvasSize * dpr);
    if (this.canvas.width !== backing || this.canvas.height !== backing) {
      this.canvas.width = backing;
      this.canvas.height = backing;
    }

    // Ensure context exists and scale to match CSS pixels
    if (!this.ctx) this.ctx = this.canvas.getContext('2d');
    if (this.ctx && typeof this.ctx.setTransform === 'function') {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  render(canvas, gameState) {
    if (!canvas || !gameState || !gameState.gridMatrix) {
      return;
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gameState = gameState; // Save game state for player position access

    // Ensure sizing is up-to-date before drawing
    this.applyResponsiveSizing();

    // Draw background with padding (legacy style)
    this.ctx.fillStyle = CONFIG.visual.colors.grid; // Use grid color for background lines
    this.ctx.fillRect(0 - this.padding, 0 - this.padding,
                     this.canvasSize + this.padding, this.canvasSize + this.padding);

    // Draw game grid cells
    this.drawGrid();

    // Draw game objects
    this.drawGameObjects(gameState.gridMatrix);
  }

  drawGrid() {
    const gridSize = CONFIG.game.matrixSize;

    // Draw grid cells with padding (legacy style)
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        this.ctx.fillStyle = CONFIG.visual.colors.background; // White cell background
        this.ctx.fillRect(
          col * this.effectiveCellSize + this.padding,
          row * this.effectiveCellSize + this.padding,
          this.cellSize,
          this.cellSize
        );
      }
    }
  }

  drawGameObjects(gridMatrix) {
    const gridSize = CONFIG.game.matrixSize;

    // First pass: draw obstacles (background elements)
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cellValue = gridMatrix[row][col];

        if (cellValue === GAME_OBJECTS.obstacle) {
          this.drawCell(row, col, cellValue);
        }
      }
    }

    // Second pass: draw goals (middle layer) - always draw goals from gameState
    this.drawGoals();

    // Third pass: handle players with overlap detection (top layer)
    // This ensures players are always drawn on top of goals
    const playerPositions = this.getPlayerPositions(gridMatrix);
    this.drawPlayersWithOverlap(playerPositions);
  }

  drawGoals() {
    // Draw goals from gameState.currentGoals if available
    if (this.gameState && this.gameState.currentGoals && Array.isArray(this.gameState.currentGoals)) {
      for (const goal of this.gameState.currentGoals) {
        if (goal && Array.isArray(goal) && goal.length >= 2) {
          const [row, col] = goal;
          this.drawGoalWithPlayerCheck(row, col);
        }
      }
    } else {
      // Fallback to grid matrix if currentGoals not available
      const gridSize = CONFIG.game.matrixSize;
      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const cellValue = this.gameState.gridMatrix[row][col];
          if (cellValue === GAME_OBJECTS.goal) {
            this.drawGoalWithPlayerCheck(row, col);
          }
        }
      }
    }
  }

  drawGoalWithPlayerCheck(row, col) {
    // Check if any player is at this goal position
    const hasPlayer = this.isPlayerAtPosition(row, col);

    // Draw goal with transparency if player is on it
    const x = col * this.effectiveCellSize + this.padding;
    const y = row * this.effectiveCellSize + this.padding;

    this.ctx.save();
    this.ctx.fillStyle = CONFIG.visual.colors.goal;

    // Make goal more transparent if player is on it (like legacy version)
    if (hasPlayer) {
      this.ctx.globalAlpha = 0.7; // Same as legacy version
    }

    this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
    this.ctx.restore();
  }

  isPlayerAtPosition(row, col) {
    if (!this.gameState) return false;

    // Check player1
    if (this.gameState.player1 && this.gameState.player1.length === 2) {
      if (this.gameState.player1[0] === row && this.gameState.player1[1] === col) {
        return true;
      }
    }

    // Check player2
    if (this.gameState.player2 && this.gameState.player2.length === 2) {
      if (this.gameState.player2[0] === row && this.gameState.player2[1] === col) {
        return true;
      }
    }

    return false;
  }

  getPlayerPositions(gridMatrix) {
    const gridSize = CONFIG.game.matrixSize;
    const positions = [];

    // First, collect all player positions from the grid matrix
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cellValue = gridMatrix[row][col];
        if (cellValue === GAME_OBJECTS.player || cellValue === GAME_OBJECTS.ai_player) {
          positions.push({ row, col, type: cellValue });
        }
      }
    }

    // If we have gameState with player positions, use those instead
    // This handles the case where both players might be in the same position
    if (this.gameState) {
      positions.length = 0; // Clear existing positions

      // Add player1 if available
      if (this.gameState.player1 && this.gameState.player1.length === 2) {
        positions.push({
          row: this.gameState.player1[0],
          col: this.gameState.player1[1],
          type: GAME_OBJECTS.player
        });
      }

      // Add player2 if available
      if (this.gameState.player2 && this.gameState.player2.length === 2) {
        positions.push({
          row: this.gameState.player2[0],
          col: this.gameState.player2[1],
          type: GAME_OBJECTS.ai_player
        });
      }
    }

    return positions;
  }

  drawPlayersWithOverlap(playerPositions) {
    // Group players by position
    const positionMap = new Map();

    for (const pos of playerPositions) {
      const key = `${pos.row},${pos.col}`;
      if (!positionMap.has(key)) {
        positionMap.set(key, []);
      }
      positionMap.get(key).push(pos);
    }

    // Draw each position using the unified method
    for (const [key, players] of positionMap) {
      const [row, col] = key.split(',').map(Number);
      this.drawOverlappingPlayers(row, col, players);
    }
  }

  drawCell(row, col, cellType) {
    // Use legacy-style positioning with padding
    const x = col * this.effectiveCellSize + this.padding;
    const y = row * this.effectiveCellSize + this.padding;
    const centerX = x + this.cellSize / 2;
    const centerY = y + this.cellSize / 2;
    const radius = this.cellSize * 0.35;

    this.ctx.save();

    switch (cellType) {
      case GAME_OBJECTS.player:
      case GAME_OBJECTS.ai_player:
        // Players are handled separately in drawPlayersWithOverlap
        // This method should not be called for players anymore
        break;

      case GAME_OBJECTS.goal:
        // Draw goal (blue square) - no border, full cell size
        this.ctx.fillStyle = CONFIG.visual.colors.goal;
        this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
        break;

      case GAME_OBJECTS.obstacle:
        // Draw obstacle (dark square)
        this.ctx.fillStyle = CONFIG.visual.colors.obstacle;
        this.ctx.fillRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
        break;
    }

    this.ctx.restore();
  }



  drawOverlappingPlayers(row, col, players) {
    const x = col * this.effectiveCellSize + this.padding;
    const y = row * this.effectiveCellSize + this.padding;
    const centerX = x + this.cellSize / 2;
    const centerY = y + this.cellSize / 2;
    const radius = this.cellSize * 0.35;
    const offset = this.cellSize * 0.15; // Offset for overlap

    this.ctx.save();

    if (players.length === 1) {
      // Single player - draw normally
      const player = players[0];
      const color = player.type === GAME_OBJECTS.player ?
        CONFIG.visual.colors.player1 : CONFIG.visual.colors.player2;

      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      this.ctx.fill();
    } else if (players.length >= 2) {
      // Multiple players - draw overlapping circles with offset
      // First player (left side)
      const firstPlayer = players[0];
      const firstColor = firstPlayer.type === GAME_OBJECTS.player ?
        CONFIG.visual.colors.player1 : CONFIG.visual.colors.player2;

      this.ctx.fillStyle = firstColor;
      this.ctx.beginPath();
      this.ctx.arc(centerX - offset, centerY, radius, 0, 2 * Math.PI);
      this.ctx.fill();

      // Second player (right side)
      const secondPlayer = players[1];
      const secondColor = secondPlayer.type === GAME_OBJECTS.player ?
        CONFIG.visual.colors.player1 : CONFIG.visual.colors.player2;

      this.ctx.fillStyle = secondColor;
      this.ctx.beginPath();
      this.ctx.arc(centerX + offset, centerY, radius, 0, 2 * Math.PI);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  // Additional rendering methods for special effects
  highlightCell(row, col, color = '#ffff00', alpha = 0.3) {
    if (!this.ctx) return;

    const x = col * this.cellSize;
    const y = row * this.cellSize;

    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
    this.ctx.restore();
  }

  drawTrajectory(trajectory, color = '#ff0000', alpha = 0.5) {
    if (!this.ctx || !trajectory || trajectory.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = alpha;
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.beginPath();
    for (let i = 0; i < trajectory.length; i++) {
      const [row, col] = trajectory[i];
      const centerX = col * this.cellSize + this.cellSize / 2;
      const centerY = row * this.cellSize + this.cellSize / 2;

      if (i === 0) {
        this.ctx.moveTo(centerX, centerY);
      } else {
        this.ctx.lineTo(centerX, centerY);
      }
    }
    this.ctx.stroke();

    this.ctx.restore();
  }

  drawNewGoalIndicator(row, col) {
    if (!this.ctx) return;

    const x = col * this.cellSize;
    const y = row * this.cellSize;
    const centerX = x + this.cellSize / 2;
    const centerY = y + this.cellSize / 2;

    this.ctx.save();

    // Draw pulsing effect
    const time = Date.now() * 0.005;
    const alpha = (Math.sin(time) + 1) * 0.3 + 0.2;

    this.ctx.fillStyle = '#ffff00';
    this.ctx.globalAlpha = alpha;
    this.ctx.fillRect(x, y, this.cellSize, this.cellSize);

    // Draw "NEW!" text
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = '#ff0000';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('NEW!', centerX, centerY - 15);

    this.ctx.restore();
  }

  // Animation support
  animateMove(fromRow, fromCol, toRow, toCol, cellType, duration = 200) {
    return new Promise((resolve) => {
      if (!this.ctx) {
        resolve();
        return;
      }

      const startTime = Date.now();
      const fromX = fromCol * this.cellSize + this.cellSize / 2;
      const fromY = fromRow * this.cellSize + this.cellSize / 2;
      const toX = toCol * this.cellSize + this.cellSize / 2;
      const toY = toRow * this.cellSize + this.cellSize / 2;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out)
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        const currentX = fromX + (toX - fromX) * easeProgress;
        const currentY = fromY + (toY - fromY) * easeProgress;

        // Clear and redraw (you'd need to store the full game state for this)
        // For now, just draw the moving piece
        this.ctx.save();
        this.ctx.globalAlpha = 0.8;

        const radius = this.cellSize * 0.35;

        if (cellType === GAME_OBJECTS.player) {
          this.ctx.fillStyle = CONFIG.visual.colors.player1;
        } else if (cellType === GAME_OBJECTS.ai_player) {
          this.ctx.fillStyle = CONFIG.visual.colors.player2;
        }

        this.ctx.beginPath();
        this.ctx.arc(currentX, currentY, radius, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.restore();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      animate();
    });
  }

  // Utility methods
  getCellFromPixel(pixelX, pixelY) {
    const col = Math.floor(pixelX / this.cellSize);
    const row = Math.floor(pixelY / this.cellSize);

    if (row >= 0 && row < CONFIG.game.matrixSize &&
        col >= 0 && col < CONFIG.game.matrixSize) {
      return { row, col };
    }

    return null;
  }

  getPixelFromCell(row, col) {
    return {
      x: col * this.cellSize + this.cellSize / 2,
      y: row * this.cellSize + this.cellSize / 2
    };
  }
}
