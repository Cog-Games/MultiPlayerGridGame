import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';

export class GameRenderer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.cellSize = CONFIG.visual.cellSize;
    this.padding = CONFIG.visual.padding;
    this.effectiveCellSize = this.cellSize + this.padding;
    this.gameState = null;
  }

  createCanvas() {
    this.canvas = document.createElement('canvas');
    this.applySize();
    this.canvas.style.border = '2px solid #555';
    this.canvas.style.borderRadius = '4px';
    this.ctx = this.canvas.getContext('2d');
    return this.canvas;
  }

  applySize() {
    if (!this.canvas) return;
    const gridSize = this.gameState?.size || CONFIG.game.matrixSize;
    const dpr = window.devicePixelRatio || 1;
    const maxCanvasSize = CONFIG.visual.canvasSize || 620;

    this.padding = gridSize > CONFIG.game.matrixSize ? 1 : CONFIG.visual.padding;
    this.cellSize = gridSize > CONFIG.game.matrixSize
      ? Math.max(20, Math.floor((maxCanvasSize - this.padding) / gridSize) - this.padding)
      : CONFIG.visual.cellSize;
    this.effectiveCellSize = this.cellSize + this.padding;

    const canvasSize = gridSize * this.effectiveCellSize + this.padding;

    this.canvas.style.width = `${canvasSize}px`;
    this.canvas.style.height = `${canvasSize}px`;

    const backing = Math.floor(canvasSize * dpr);
    this.canvas.width = backing;
    this.canvas.height = backing;

    if (!this.ctx) this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.canvasSize = canvasSize;
  }

  render(gameState) {
    if (!this.canvas || !gameState) return;
    this.gameState = gameState;
    this.ctx = this.canvas.getContext('2d');
    this.applySize();

    // Background (grid lines show through as padding color)
    this.ctx.fillStyle = CONFIG.visual.colors.grid;
    this.ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);

    // Draw cells
    this.drawGrid();

    // Draw game objects in layers
    this.drawObstacles();
    this.drawRabbits();
    this.drawStags();
    this.drawPlayers();
  }

  toDataURL() {
    if (!this.canvas) return null;
    return this.canvas.toDataURL('image/png');
  }

  drawGrid() {
    const size = this.gameState?.size || CONFIG.game.matrixSize;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const x = col * this.effectiveCellSize + this.padding;
        const y = row * this.effectiveCellSize + this.padding;
        this.ctx.fillStyle = CONFIG.visual.colors.background;
        this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
      }
    }
  }

  drawObstacles() {
    if (!this.gameState.obstacles) return;
    for (const obs of this.gameState.obstacles) {
      const x = obs[1] * this.effectiveCellSize + this.padding;
      const y = obs[0] * this.effectiveCellSize + this.padding;
      this.ctx.fillStyle = CONFIG.visual.colors.obstacle;
      this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
    }
  }

  drawRabbits() {
    if (!this.gameState.rabbits) return;
    for (const rabbit of this.gameState.rabbits) {
      if (!rabbit) continue;
      const x = rabbit[1] * this.effectiveCellSize + this.padding;
      const y = rabbit[0] * this.effectiveCellSize + this.padding;

      const squareSize = this.cellSize * 0.42;
      const inset = (this.cellSize - squareSize) / 2;
      this.ctx.fillStyle = CONFIG.visual.colors.rabbit;
      this.ctx.fillRect(x + inset, y + inset, squareSize, squareSize);
    }
  }

  drawStags() {
    const stags = this.gameState.stags || (this.gameState.stag ? [this.gameState.stag] : []);
    for (const stag of stags) {
      if (stag) this.drawStagAt(stag);
    }
  }

  drawStagAt(stag) {
    const x = stag[1] * this.effectiveCellSize + this.padding;
    const y = stag[0] * this.effectiveCellSize + this.padding;
    const cx = x + this.cellSize / 2;
    const cy = y + this.cellSize / 2;

    // Draw green triangle (pointing up)
    const size = this.cellSize * 0.4;
    this.ctx.save();
    this.ctx.fillStyle = CONFIG.visual.colors.stag;
    this.ctx.strokeStyle = CONFIG.visual.colors.stagOutline;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - size);              // top
    this.ctx.lineTo(cx - size * 0.9, cy + size * 0.7); // bottom-left
    this.ctx.lineTo(cx + size * 0.9, cy + size * 0.7); // bottom-right
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawPlayers() {
    const state = this.gameState;
    const players = state.players || {
      player1: state.player1,
      player2: state.player2,
    };
    const entries = Object.entries(players).filter(([, pos]) => Array.isArray(pos));
    if (!entries.length) return;

    const byCell = new Map();
    for (const [player, pos] of entries) {
      const key = `${pos[0]},${pos[1]}`;
      const group = byCell.get(key) || [];
      group.push([player, pos]);
      byCell.set(key, group);
    }

    for (const group of byCell.values()) {
      const offsetStep = group.length > 1 ? this.cellSize * 0.16 : 0;
      group.forEach(([player, pos], index) => {
        const offset = (index - (group.length - 1) / 2) * offsetStep;
        const color = CONFIG.visual.colors[player] || '#777777';
        const label = player.replace('player', '');
        this.drawPlayer(pos[0], pos[1], color, offset, state.signals?.[player], label);
      });
    }
  }

  drawPlayer(row, col, color, xOffset, hasSignal, label = '') {
    const center = this.drawCircle(row, col, color, xOffset);
    if (label) this.drawPlayerLabel(center.x, center.y, label);
    if (hasSignal) this.drawSignalMarker(center.x, center.y);
  }

  drawCircle(row, col, color, xOffset) {
    const x = col * this.effectiveCellSize + this.padding + this.cellSize / 2 + xOffset;
    const y = row * this.effectiveCellSize + this.padding + this.cellSize / 2;
    const radius = this.cellSize * 0.35;

    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
    this.ctx.fill();

    // Subtle border
    this.ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
    this.ctx.restore();

    return { x, y };
  }

  drawPlayerLabel(cx, cy, label) {
    this.ctx.save();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = `700 ${Math.max(10, this.cellSize * 0.34)}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, cx, cy);
    this.ctx.restore();
  }

  drawSignalMarker(cx, cy) {
    const size = this.cellSize * 0.16;

    this.ctx.save();
    this.ctx.fillStyle = CONFIG.visual.colors.signal;
    this.ctx.strokeStyle = CONFIG.visual.colors.signalOutline;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - size);
    this.ctx.lineTo(cx - size * 0.9, cy + size * 0.75);
    this.ctx.lineTo(cx + size * 0.9, cy + size * 0.75);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
  }
}
