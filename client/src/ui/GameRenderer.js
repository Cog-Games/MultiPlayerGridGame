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
    this.canvas.width = this.canvasSize;
    this.canvas.height = this.canvasSize;
    this.canvas.style.border = '2px solid #333';
    this.canvas.style.backgroundColor = CONFIG.visual.colors.background;
    
    this.ctx = this.canvas.getContext('2d');
    
    return this.canvas;
  }

  render(canvas, gameState) {
    if (!canvas || !gameState || !gameState.gridMatrix) {
      return;
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
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
    
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cellValue = gridMatrix[row][col];
        
        if (cellValue !== GAME_OBJECTS.blank) {
          this.drawCell(row, col, cellValue);
        }
      }
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
        // Draw human player (red circle)
        this.ctx.fillStyle = CONFIG.visual.colors.player1;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Add border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        break;
        
      case GAME_OBJECTS.ai_player:
        // Draw AI player (orange circle)
        this.ctx.fillStyle = CONFIG.visual.colors.player2;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Add border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        break;
        
      case GAME_OBJECTS.goal:
        // Draw goal (green square)
        this.ctx.fillStyle = CONFIG.visual.colors.goal;
        const goalSize = this.cellSize * 0.7;
        const goalX = x + (this.cellSize - goalSize) / 2;
        const goalY = y + (this.cellSize - goalSize) / 2;
        this.ctx.fillRect(goalX, goalY, goalSize, goalSize);
        
        // Add border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(goalX, goalY, goalSize, goalSize);
        break;
        
      case GAME_OBJECTS.obstacle:
        // Draw obstacle (dark square)
        this.ctx.fillStyle = CONFIG.visual.colors.obstacle;
        this.ctx.fillRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
        break;
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
        this.ctx.stroke();
        
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