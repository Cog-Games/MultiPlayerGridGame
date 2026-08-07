import { GameApplication } from './src/core/GameApplication.js';
import { CONFIG } from './src/config/gameConfig.js';
import {
  applyDirectHumanVlm2P3GTest,
  applyFormalHumanHumanStudy,
  applyTestHumanHumanStudy,
  isDirectHumanVlm2P3GTest,
  isFormalHumanHumanStudy,
  isTestHumanHumanStudy
} from './src/config/formalHumanHumanStudy.js';

// Handle different startup modes
const urlParams = new URLSearchParams(window.location.search);
const formalHumanHumanStudy = isFormalHumanHumanStudy(window.location.search);
const testHumanHumanStudy = isTestHumanHumanStudy(window.location.search);
const directHumanVlm2P3GTest = isDirectHumanVlm2P3GTest(window.location.search);
if (formalHumanHumanStudy) {
  applyFormalHumanHumanStudy(CONFIG);
} else if (testHumanHumanStudy) {
  applyTestHumanHumanStudy(CONFIG);
} else if (directHumanVlm2P3GTest) {
  applyDirectHumanVlm2P3GTest(CONFIG);
}
const humanHumanStudyPreset = formalHumanHumanStudy || testHumanHumanStudy;

// Initialize only after the formal preset is applied: constructors cache some
// timing and fallback settings.
const app = new GameApplication(document.getElementById('app'));
const mode = humanHumanStudyPreset
  ? 'human-human'
  : (directHumanVlm2P3GTest ? 'human-ai' : (urlParams.get('mode') || 'human-ai'));
const experimentType = humanHumanStudyPreset
  ? '1P1G'
  : (directHumanVlm2P3GTest ? '2P3G' : (urlParams.get('experiment') || '2P2G'));
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
