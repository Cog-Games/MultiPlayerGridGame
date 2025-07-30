import { GameApplication } from './src/core/GameApplication.js';
import { CONFIG } from './src/config/gameConfig.js';

// Initialize the application
const app = new GameApplication(document.getElementById('app'));

// Handle different startup modes
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'human-ai';
const experimentType = urlParams.get('experiment') || '2P2G';
const roomId = urlParams.get('room');

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