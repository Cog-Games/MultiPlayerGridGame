import { NetworkManager } from '../network/NetworkManager.js';
import { GameStateManager } from '../game/GameStateManager.js';
import { UIManager } from '../ui/UIManager.js';
import { ExperimentManager } from '../experiments/ExperimentManager.js';
import { CONFIG } from '../config/gameConfig.js';

export class GameApplication {
  constructor(container) {
    this.container = container;
    this.networkManager = null;
    this.gameStateManager = null;
    this.uiManager = null;
    this.experimentManager = null;
    this.isInitialized = false;
    this.playerIndex = 0; // 0 = red player, 1 = orange player
    this.gameConfig = null; // Store game configuration from server
  }

  async start(options = {}) {
    const { mode = 'human-ai', experimentType = '2P2G', roomId = null } = options;
    
    try {
      // Initialize components
      await this.initialize(mode, experimentType, roomId);
      
      // Start the appropriate mode
      if (mode === 'human-human') {
        await this.startMultiplayerMode(experimentType, roomId);
      } else {
        await this.startSinglePlayerMode(experimentType);
      }
      
      console.log('Application started successfully');
    } catch (error) {
      console.error('Failed to start application:', error);
      throw error;
    }
  }

  async initialize(mode, experimentType, roomId) {
    if (this.isInitialized) return;

    // Initialize core managers
    this.gameStateManager = new GameStateManager();
    this.uiManager = new UIManager(this.container);
    this.experimentManager = new ExperimentManager(this.gameStateManager, this.uiManager);

    // Initialize network manager if needed
    if (mode === 'human-human') {
      this.networkManager = new NetworkManager();
      await this.networkManager.connect();
      this.setupNetworkEventHandlers();
    }

    // Set up UI event handlers
    this.setupUIEventHandlers();

    this.isInitialized = true;
  }

  async startSinglePlayerMode(experimentType) {
    // Configure for human-AI mode
    CONFIG.game.players.player2.type = 'ai';
    
    // Set player info for single player (always player 0 - red)
    this.uiManager.setPlayerInfo(0, 'human-ai');
    
    // Show main UI
    this.uiManager.showMainScreen();
    
    // Start experiment sequence
    await this.experimentManager.startExperimentSequence([experimentType]);
  }

  async startMultiplayerMode(experimentType, roomId) {
    // Configure for human-human mode
    CONFIG.game.players.player2.type = 'human';
    
    // Show lobby screen
    this.uiManager.showLobbyScreen();
    
    try {
      // Join or create room
      const room = await this.networkManager.joinRoom({
        roomId,
        gameMode: 'human-human',
        experimentType
      });
      
      console.log('Joined room:', room);
      
      // Update UI with room info
      this.uiManager.updateLobbyInfo(room);
      
    } catch (error) {
      console.error('Failed to join room:', error);
      this.uiManager.showError('Failed to join game room. Please try again.');
    }
  }

  setupNetworkEventHandlers() {
    if (!this.networkManager) return;

    // Room events
    this.networkManager.on('room-joined', (data) => {
      console.log('Room joined:', data);
      this.uiManager.updateLobbyInfo(data);
    });

    this.networkManager.on('player-joined', (data) => {
      console.log('Player joined:', data);
      this.uiManager.updatePlayerList(data.players);
    });

    this.networkManager.on('player-disconnected', (data) => {
      console.log('Player disconnected:', data);
      this.uiManager.updatePlayerList(data.players);
      this.uiManager.showNotification('Partner disconnected');
    });

    // Game events
    this.networkManager.on('game-started', (config) => {
      console.log('Game started:', config);
      this.gameConfig = config;
      
      // Find this player's index in the config
      const mySocketId = this.networkManager.socket.id;
      const myPlayerConfig = config.players.find(p => p.id === mySocketId);
      if (myPlayerConfig) {
        this.playerIndex = myPlayerConfig.playerIndex;
        console.log(`I am player ${this.playerIndex + 1} (${this.playerIndex === 0 ? 'red' : 'orange'})`);
      }
      
      this.startNetworkedGame(config);
    });

    this.networkManager.on('player-action', (data) => {
      console.log('Player action received:', data);
      this.handleRemotePlayerAction(data);
    });

    this.networkManager.on('game-state-update', (gameState) => {
      console.log('Game state update:', gameState);
      this.gameStateManager.syncState(gameState);
    });

    // Error handling
    this.networkManager.on('error', (error) => {
      console.error('Network error:', error);
      this.uiManager.showError(error.message);
    });

    this.networkManager.on('disconnect', () => {
      console.log('Disconnected from server');
      this.uiManager.showError('Connection lost. Please refresh the page.');
    });
  }

  setupUIEventHandlers() {
    // Player ready button
    this.uiManager.on('player-ready', () => {
      if (this.networkManager) {
        this.networkManager.setPlayerReady();
      }
    });

    // Game actions
    this.uiManager.on('player-move', (direction) => {
      this.handlePlayerMove(direction);
    });

    // Experiment controls
    this.uiManager.on('start-experiment', (experimentType) => {
      this.experimentManager.startExperiment(experimentType);
    });

    this.uiManager.on('restart-experiment', () => {
      this.experimentManager.restart();
    });
  }

  async startNetworkedGame(config) {
    // Set player info in UI manager
    this.uiManager.setPlayerInfo(this.playerIndex, config.gameMode);
    
    // Hide lobby, show game
    this.uiManager.showGameScreen();
    
    // Configure multiplayer experiment
    await this.experimentManager.startMultiplayerExperiment(config);
  }

  handlePlayerMove(direction) {
    // Use the correct player index (1-based for game logic, but add 1 since processPlayerMove expects 1 or 2)
    const playerNumber = this.playerIndex + 1; // Convert 0,1 to 1,2
    
    // Process move locally
    const moveResult = this.gameStateManager.processPlayerMove(playerNumber, direction);
    
    // Send to network if in multiplayer mode
    if (this.networkManager && this.networkManager.isConnected) {
      this.networkManager.sendGameAction({
        type: 'move',
        direction,
        playerIndex: this.playerIndex,
        timestamp: Date.now()
      });
    }
    
    // Update UI
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
    
    // Check for trial completion
    if (moveResult.trialComplete) {
      this.handleTrialComplete(moveResult);
    }
  }

  handleRemotePlayerAction(data) {
    const { action } = data;
    
    if (action.type === 'move') {
      // Determine which player this action is from (opposite of local player)
      const remotePlayerNumber = action.playerIndex + 1; // Convert 0,1 to 1,2
      
      // Only process if it's not from the same player (avoid duplicate processing)
      if (action.playerIndex !== this.playerIndex) {
        // Process remote player move
        const moveResult = this.gameStateManager.processPlayerMove(remotePlayerNumber, action.direction);
        
        // Update UI
        this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
        
        // Check for trial completion
        if (moveResult.trialComplete) {
          this.handleTrialComplete(moveResult);
        }
      }
    }
  }

  handleTrialComplete(result) {
    // Send completion to network if needed
    if (this.networkManager && this.networkManager.isConnected) {
      this.networkManager.sendTrialComplete(result);
    }
    
    // Let experiment manager handle the completion
    this.experimentManager.handleTrialComplete(result);
  }

  // Cleanup
  destroy() {
    if (this.networkManager) {
      this.networkManager.disconnect();
    }
    
    if (this.uiManager) {
      this.uiManager.destroy();
    }
    
    this.isInitialized = false;
  }
}