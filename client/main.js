import { GameApplication } from './src/core/GameApplication.js';
import { CONFIG, GameConfigUtils } from './src/config/gameConfig.js';

// Initialize the application
const app = new GameApplication(document.getElementById('app'));

// Handle different startup modes
const urlParams = new URLSearchParams(window.location.search);
let mode = urlParams.get('mode') || 'human-ai';
const experimentType = urlParams.get('experiment') || CONFIG.game.experiments.order[0] || '2P3G';
const roomId = urlParams.get('room');

const kidModeParam = urlParams.get('kidMode');
if (kidModeParam === 'false') {
  CONFIG.kids.enabled = false;
}

if (CONFIG.kids.enabled) {
  const rawKidPartner = String(urlParams.get('kidPartner') || CONFIG.kids.partnerMode || 'human').toLowerCase();
  const kidPartner = rawKidPartner === 'committed' ? 'committed' : 'human';
  CONFIG.kids.partnerMode = kidPartner;
  CONFIG.multiplayer.fallbackAIType = 'committedAgent';

  if (kidPartner === 'committed') {
    mode = 'human-ai';
    GameConfigUtils.setPlayerType(2, 'committedAgent');
  } else {
    mode = 'human-human';
    GameConfigUtils.setPlayerType(2, 'human');
  }
}

console.log('Starting application with:', { mode, experimentType, roomId });

// Wait for DOM and dependencies to load
document.addEventListener('DOMContentLoaded', () => {
  // Start the application
  app.start({
    mode,
    experimentType,
    roomId
  }).catch(error => {
    console.error('Failed to start application:', error);
    document.getElementById('app').innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh;">
        <div style="text-align: center; color: #666;">
          <h2>Error</h2>
          <p>Failed to start the experiment: ${error.message}</p>
          <button onclick="window.location.reload()" style="padding: 10px 20px; font-size: 16px;">
            Retry
          </button>
        </div>
      </div>
    `;
  });
});
