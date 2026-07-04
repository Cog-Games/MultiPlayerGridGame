import { CONFIG, PLAYER_CONTROLS } from '../config/gameConfig.js';
import { GameRenderer } from './GameRenderer.js';

export class UIManager {
  constructor(container) {
    this.container = container;
    this.renderer = new GameRenderer();
    this.canvas = null;
    this.infoPanel = null;
    this.overlayPanel = null;
    this.onPlayerAction = null;
    this.signalEnabled = false;
  }

  initialize({ signalEnabled = false, phase = 'dyadic' } = {}) {
    this.destroy();
    this.signalEnabled = signalEnabled;
    this.container.innerHTML = '';
    this.container.style.cssText = `
      display:flex; flex-direction:column; align-items:center;
      justify-content:flex-start; min-height:100vh; height:auto; gap:14px;
      box-sizing:border-box; padding:16px 12px; overflow:auto;
    `;

    // Title
    const title = document.createElement('h1');
    title.textContent = phase === 'group' ? 'Phase 2: Group Foraging' : 'Dynamic Stag Hunt';
    title.style.cssText = 'margin:0; color:#e0e0e0; font-size:24px;';
    this.container.appendChild(title);

    // Info panel (round, score, instructions)
    this.infoPanel = document.createElement('div');
    this.infoPanel.style.cssText = `
      color:#ccc; font-size:14px; text-align:center;
      min-height:40px; line-height:1.4;
    `;
    this.container.appendChild(this.infoPanel);

    this.overlayPanel = document.createElement('div');
    this.overlayPanel.id = 'game-overlay';
    this.overlayPanel.style.cssText = `
      display:none;
      width:min(100%, 620px);
      box-sizing:border-box;
    `;
    this.container.appendChild(this.overlayPanel);

    // Canvas
    this.canvas = this.renderer.createCanvas();
    this.container.appendChild(this.canvas);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'color:#aaa; font-size:12px; text-align:center; margin-top:8px;';
    legend.innerHTML = phase === 'group'
      ? `
        <span style="color:${CONFIG.visual.colors.player1};">&#9679;</span> P1 &nbsp;
        <span style="color:${CONFIG.visual.colors.player2};">&#9679;</span> P2 &nbsp;
        <span style="color:${CONFIG.visual.colors.player3};">&#9679;</span> P3 auto &nbsp;
        <span style="color:${CONFIG.visual.colors.player4};">&#9679;</span> P4 auto &nbsp;
        <span style="color:${CONFIG.visual.colors.stag};">&#9650;</span> large target &nbsp;
        <span style="color:${CONFIG.visual.colors.rabbit};">&#9632;</span> small target
      `
      : `
        <span style="color:${CONFIG.visual.colors.player1};">&#9679;</span> Player 1 (WASD) &nbsp;
        <span style="color:${CONFIG.visual.colors.player2};">&#9679;</span> Player 2 (arrows) &nbsp;
        <span style="color:${CONFIG.visual.colors.stag};">&#9650;</span> Stag (cooperate!) &nbsp;
        <span style="color:${CONFIG.visual.colors.rabbit};">&#9632;</span> Rabbit (solo)
      `;
    this.container.appendChild(legend);

    // Controls info
    const controls = document.createElement('div');
    controls.style.cssText = 'color:#777; font-size:11px; margin-top:4px;';
    controls.textContent = phase === 'group'
      ? 'Collection phase: Player 1 uses WASD, Player 2 uses arrow keys, Player 3 and Player 4 move automatically. Sharing choices follow collection.'
      : signalEnabled
      ? 'Turn order: Player 1 uses WASD, then Player 2 uses arrow keys, then the stag moves. Press Space on your turn to signal stag.'
      : 'Turn order: Player 1 uses WASD, then Player 2 uses arrow keys, then the stag moves.';
    this.container.appendChild(controls);

    // Set up keyboard listener
    this._keyHandler = (e) => {
      if (e.repeat) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (this.signalEnabled && this.onPlayerAction) {
          this.onPlayerAction({
            player: null,
            type: 'signal',
            direction: 'signal stag',
          });
        }
        return;
      }

      const key = e.key.toLowerCase();
      const control = PLAYER_CONTROLS[key];
      if (control) {
        e.preventDefault();
        if (this.onPlayerAction) {
          this.onPlayerAction({
            player: control.player,
            type: control.type,
            movement: [...control.movement],
            direction: control.name,
          });
        }
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  renderGame(gameState) {
    this.renderer.render(gameState);
  }

  getBoardImageDataUrl() {
    return this.renderer.toDataURL();
  }

  updateInfo(text) {
    if (this.infoPanel) {
      this.infoPanel.innerHTML = text;
    }
  }

  // Show a result banner above the game canvas.
  showOverlay(html) {
    this.removeOverlay();
    if (!this.overlayPanel) return;
    this.overlayPanel.style.display = 'block';
    this.overlayPanel.innerHTML = `
      <div style="
        background:#1e1e2e; border:2px solid #444; border-radius:12px;
        padding:20px 28px; text-align:center; color:#e0e0e0;
        box-shadow:0 8px 24px rgba(0,0,0,0.35);
      ">
        ${html}
      </div>
    `;
  }

  removeOverlay() {
    if (!this.overlayPanel) return;
    this.overlayPanel.innerHTML = '';
    this.overlayPanel.style.display = 'none';
  }

  showScreen(html) {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#e0e0e0;text-align:center;padding:20px;">
        ${html}
      </div>
    `;
  }

  destroy() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }
}
