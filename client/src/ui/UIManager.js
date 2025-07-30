import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';
import { GameRenderer } from './GameRenderer.js';

export class UIManager {
  constructor(container) {
    this.container = container;
    this.renderer = new GameRenderer();
    this.eventHandlers = new Map();
    this.currentScreen = null;
    this.gameCanvas = null;
    this.keyboardHandler = null;
    this.playerIndex = 0; // 0 = red player, 1 = orange player
    this.gameMode = 'human-ai'; // 'human-ai' or 'human-human'
  }

  // Event system
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in UI event handler for ${event}:`, error);
        }
      });
    }
  }

  // Player configuration
  setPlayerInfo(playerIndex, gameMode) {
    this.playerIndex = playerIndex;
    this.gameMode = gameMode;
  }

  // Screen management
  showMainScreen() {
    this.currentScreen = 'main';
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center; max-width: 600px; padding: 20px;">
          <h1 style="margin-bottom: 20px;">Grid World Collaboration Experiment</h1>
          <p style="font-size: 18px; margin-bottom: 30px;">
            Welcome to the grid-based collaboration game. You'll work with an AI partner 
            to navigate through different scenarios and reach goals together.
          </p>
          <div style="margin-bottom: 30px;">
            <h3>Instructions:</h3>
            <ul style="text-align: left; display: inline-block;">
              <li>Use arrow keys (↑ ↓ ← →) to move</li>
              <li>You are the red player ⚫</li>
              <li>Your AI partner is the orange player ⚫</li>
              <li>Work together to reach the green goals ⚫</li>
            </ul>
          </div>
          <button id="start-experiment" style="
            padding: 15px 30px; 
            font-size: 18px; 
            background: #007bff; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer;
          ">
            Start Experiment
          </button>
        </div>
      </div>
    `;

    // Add event listener
    document.getElementById('start-experiment').addEventListener('click', () => {
      this.emit('start-experiment', CONFIG.game.experiments.order[0]);
    });
  }

  showLobbyScreen() {
    this.currentScreen = 'lobby';
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center; max-width: 500px; padding: 20px;">
          <h1 style="margin-bottom: 20px;">Multiplayer Lobby</h1>
          <div id="lobby-info" style="margin-bottom: 30px;">
            <p>Connecting to game room...</p>
          </div>
          <div id="player-list" style="margin-bottom: 30px;">
            <!-- Player list will be populated here -->
          </div>
          <button id="ready-button" style="
            padding: 15px 30px; 
            font-size: 18px; 
            background: #28a745; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer;
            display: none;
          ">
            Ready to Play
          </button>
          <div id="waiting-message" style="display: none; color: #666; margin-top: 20px;">
            Waiting for other player to be ready...
          </div>
        </div>
      </div>
    `;

    // Add event listener
    document.getElementById('ready-button').addEventListener('click', () => {
      this.emit('player-ready');
      document.getElementById('ready-button').style.display = 'none';
      document.getElementById('waiting-message').style.display = 'block';
    });
  }

  showGameScreen() {
    this.currentScreen = 'game';
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center;">
          <div id="game-header" style="margin-bottom: 20px;">
            <h3 id="game-title">Game</h3>
            <h4 id="trial-info">Round 1</h4>
          </div>
          <div id="game-canvas-container" style="margin-bottom: 20px;">
            <!-- Canvas will be inserted here -->
          </div>
          <div id="game-instructions" style="font-size: 20px;">
            <!-- Instructions will be set by updateGameInstructions method -->
          </div>
          <div id="game-status" style="margin-top: 20px; min-height: 30px;">
            <!-- Status messages will appear here -->
          </div>
        </div>
      </div>
    `;

    // Create game canvas
    this.createGameCanvas();
    this.setupKeyboardControls();
    
    // Update instructions based on player role
    this.updateGameInstructions();
  }

  updateGameInstructions() {
    const instructionsElement = document.getElementById('game-instructions');
    if (!instructionsElement) return;

    let playerColor, partnerColor, playerRole, partnerRole;
    
    if (this.playerIndex === 0) {
      playerColor = 'red';
      partnerColor = 'orange';
      playerRole = 'Player 1';
      partnerRole = 'Player 2';
    } else {
      playerColor = 'orange';
      partnerColor = 'red';
      playerRole = 'Player 2';
      partnerRole = 'Player 1';
    }

    if (this.gameMode === 'human-human') {
      instructionsElement.innerHTML = `
        You are ${playerRole} <span style="display: inline-block; width: 18px; height: 18px; background-color: ${playerColor}; border-radius: 50%; vertical-align: middle;"></span>. 
        Your partner is ${partnerRole} <span style="display: inline-block; width: 18px; height: 18px; background-color: ${partnerColor}; border-radius: 50%; vertical-align: middle;"></span>.
        <br>Press ↑ ↓ ← → to move.
      `;
    } else {
      instructionsElement.innerHTML = `
        You are the player <span style="display: inline-block; width: 18px; height: 18px; background-color: red; border-radius: 50%; vertical-align: middle;"></span>. 
        Press ↑ ↓ ← → to move.
      `;
    }
  }

  createGameCanvas() {
    const container = document.getElementById('game-canvas-container');
    this.gameCanvas = this.renderer.createCanvas();
    container.appendChild(this.gameCanvas);
  }

  setupKeyboardControls() {
    // Remove existing handler if any
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
    }

    this.keyboardHandler = (event) => {
      const key = event.code;
      const validKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      
      if (validKeys.includes(key)) {
        event.preventDefault();
        const direction = key.replace('Arrow', '').toLowerCase();
        this.emit('player-move', direction);
      }
    };

    document.addEventListener('keydown', this.keyboardHandler);
    document.body.focus();
  }

  // Lobby updates
  updateLobbyInfo(roomData) {
    const lobbyInfo = document.getElementById('lobby-info');
    if (lobbyInfo) {
      lobbyInfo.innerHTML = `
        <h3>Room: ${roomData.roomId.substring(0, 8)}...</h3>
        <p>Game Mode: ${roomData.gameMode === 'human-human' ? 'Human vs Human' : 'Human vs AI'}</p>
        <p>Experiment: ${roomData.experimentType}</p>
      `;
      
      // Show ready button if room has players
      if (roomData.players && roomData.players.length > 0) {
        document.getElementById('ready-button').style.display = 'inline-block';
      }
    }
  }

  updatePlayerList(players) {
    const playerList = document.getElementById('player-list');
    if (playerList && players) {
      playerList.innerHTML = `
        <h4>Players (${players.length}/2):</h4>
        <div style="text-align: left; display: inline-block;">
          ${players.map((player, index) => `
            <div style="margin: 5px 0;">
              Player ${index + 1}: ${player.id.substring(0, 8)}... 
              ${player.isReady ? '✅ Ready' : '⏳ Not Ready'}
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  // Game display updates
  updateGameDisplay(gameState) {
    if (this.gameCanvas && gameState) {
      this.renderer.render(this.gameCanvas, gameState);
    }
  }

  updateGameInfo(experimentIndex, trialIndex, experimentType) {
    const gameTitle = document.getElementById('game-title');
    const trialInfo = document.getElementById('trial-info');
    
    if (gameTitle) {
      gameTitle.textContent = `Game ${experimentIndex + 1}`;
    }
    
    if (trialInfo) {
      trialInfo.textContent = `Round ${trialIndex + 1}`;
    }
  }

  showGameStatus(message, type = 'info') {
    const statusElement = document.getElementById('game-status');
    if (statusElement) {
      const colors = {
        info: '#666',
        success: '#28a745',
        warning: '#ffc107',
        error: '#dc3545'
      };
      
      statusElement.innerHTML = `
        <div style="color: ${colors[type] || colors.info}; font-weight: bold;">
          ${message}
        </div>
      `;
    }
  }

  showWaitingMessage() {
    this.showGameStatus('Waiting for partner to finish...', 'info');
  }

  // Feedback and results
  showTrialFeedback(result) {
    const success = result.success || result.collaborationSucceeded;
    const message = success ? 
      '🎉 Trial completed successfully!' : 
      '❌ Trial completed - try again next time!';
    
    this.showGameStatus(message, success ? 'success' : 'warning');
    
    // Auto-hide after delay
    setTimeout(() => {
      this.showGameStatus('');
    }, CONFIG.game.timing.feedbackDisplayDuration);
  }

  showExperimentComplete(results) {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center; max-width: 600px; padding: 20px;">
          <h1 style="margin-bottom: 20px;">🎉 Experiment Complete!</h1>
          <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 30px;">
            <h3>Results Summary:</h3>
            <p><strong>Total Trials:</strong> ${results.totalTrials}</p>
            <p><strong>Successful Trials:</strong> ${results.successfulTrials}</p>
            <p><strong>Success Rate:</strong> ${results.successRate}%</p>
            <p><strong>Total Time:</strong> ${results.totalTime}</p>
          </div>
          <button onclick="window.location.reload()" style="
            padding: 15px 30px; 
            font-size: 18px; 
            background: #007bff; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer;
          ">
            Start New Experiment
          </button>
        </div>
      </div>
    `;
  }

  // Notifications and errors
  showNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #007bff;
      color: white;
      padding: 15px;
      border-radius: 5px;
      z-index: 1000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, duration);
  }

  showError(message) {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh;">
        <div style="text-align: center; color: #dc3545; max-width: 500px; padding: 20px;">
          <h2>⚠️ Error</h2>
          <p style="margin: 20px 0;">${message}</p>
          <button onclick="window.location.reload()" style="
            padding: 10px 20px; 
            font-size: 16px; 
            background: #dc3545; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer;
          ">
            Retry
          </button>
        </div>
      </div>
    `;
  }

  // Cleanup
  destroy() {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
    }
    
    this.eventHandlers.clear();
    this.gameCanvas = null;
    this.keyboardHandler = null;
  }
}