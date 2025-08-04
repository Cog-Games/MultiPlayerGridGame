import { NetworkManager } from '../network/NetworkManager.js';
import { GameStateManager } from '../game/GameStateManager.js';
import { UIManager } from '../ui/UIManager.js';
import { ExperimentManager } from '../experiments/ExperimentManager.js';
import { TimelineManager } from '../timeline/TimelineManager.js';
import { CONFIG } from '../config/gameConfig.js';

export class GameApplication {
  constructor(container) {
    this.container = container;
    this.networkManager = null;
    this.gameStateManager = null;
    this.uiManager = null;
    this.experimentManager = null;
    this.timelineManager = null;
    this.isInitialized = false;
    this.playerIndex = 0; // 0 = red player, 1 = orange player
    this.gameConfig = null; // Store game configuration from server
    this.useTimelineFlow = true; // Enable timeline flow by default
  }

  async start(options = {}) {
    const { mode = 'human-ai', experimentType = '2P2G', roomId = null, useTimeline = true } = options;

    // Check URL parameters for timeline preference
    const urlParams = new URLSearchParams(window.location.search);
    this.useTimelineFlow = urlParams.get('timeline') !== 'false' && useTimeline;

    console.log(`Starting application with timeline flow: ${this.useTimelineFlow}`);

    try {
      // Initialize components
      await this.initialize(mode, experimentType, roomId);

      // Start the appropriate flow
      if (this.useTimelineFlow) {
        await this.startTimelineFlow(mode, experimentType, roomId);
      } else {
        // Legacy flow
        if (mode === 'human-human') {
          await this.startMultiplayerMode(experimentType, roomId);
        } else {
          await this.startSinglePlayerMode(experimentType);
        }
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

    // Initialize timeline manager if using timeline flow
    if (this.useTimelineFlow) {
      this.timelineManager = new TimelineManager(this.container);
      this.setupTimelineEventHandlers();
    }

    // Initialize experiment manager with or without timeline
    this.experimentManager = new ExperimentManager(
      this.gameStateManager,
      this.uiManager,
      this.timelineManager
    );

    // Initialize network manager if needed
    const urlParams = new URLSearchParams(window.location.search);
    const skipNetwork = urlParams.get('skipNetwork') === 'true';

    if (mode === 'human-human' && !skipNetwork) {
      try {
        this.networkManager = new NetworkManager();
        await this.networkManager.connect();
        this.setupNetworkEventHandlers();
        console.log('✅ Network manager initialized');
      } catch (error) {
        console.warn('⚠️ Failed to initialize network manager:', error.message);
        console.log('💡 You can test timeline with mock multiplayer using: ?skipNetwork=true');
        this.networkManager = null;
      }
    } else if (skipNetwork) {
      console.log('⚠️ Network connection skipped for testing');
      this.networkManager = null;
    }

    // Set up UI event handlers
    this.setupUIEventHandlers();

    this.isInitialized = true;
  }

  async startTimelineFlow(mode, experimentType, roomId) {
    console.log(`🎬 Starting timeline flow for ${mode} mode`);

    // Check if we should skip network connection for testing
    const urlParams = new URLSearchParams(window.location.search);
    const skipNetwork = urlParams.get('skipNetwork') === 'true';

    // Configure game mode
    if (mode === 'human-human') {
      CONFIG.game.players.player2.type = 'human';

      if (!skipNetwork && this.networkManager) {
        console.log('🌐 Setting up real multiplayer timeline integration');
        this.setupMultiplayerTimelineIntegration(experimentType, roomId);
      } else {
        console.log('🤖 Using mock multiplayer for timeline (server not available or skipped)');
        this.setupMockMultiplayerForTimeline();
      }
    } else {
      CONFIG.game.players.player2.type = 'ai';
      this.uiManager.setPlayerInfo(0, 'human-ai');
    }

    // Start the complete timeline flow
    this.timelineManager.start();
  }

  setupMultiplayerTimelineIntegration(experimentType, roomId) {
    // Handle multiplayer connection within timeline flow
    this.timelineManager.on('waiting-for-partner', async (data) => {
      console.log('Timeline requesting partner connection...');

      // Ensure we're in human-human mode for this experiment
      CONFIG.game.players.player2.type = 'human';
      console.log('🎮 Set player2 type to human for multiplayer experiment');

      try {
        // Join or create room
        const room = await this.networkManager.joinRoom({
          roomId,
          gameMode: 'human-human',
          experimentType: data.experimentType
        });

        console.log('Joined room during timeline flow:', room);
      } catch (error) {
        console.error('Failed to join room during timeline:', error);
        // Could emit an error event back to timeline here
      }
    });

    // Handle player ready event from timeline
    this.timelineManager.on('player-ready', () => {
      console.log('🎮 Timeline player clicked ready - forwarding to network');
      if (this.networkManager && this.networkManager.isConnected) {
        this.networkManager.setPlayerReady();
      } else {
        console.warn('⚠️ Network manager not available for player ready');
      }
    });
  }

  setupMockMultiplayerForTimeline() {
    console.log('🤖 Setting up mock multiplayer timeline events...');

    // Mock multiplayer events for timeline testing when server isn't available
    this.timelineManager.on('waiting-for-partner', async (data) => {
      console.log('🤖 Mock: Timeline waiting for partner - simulating connection...');

      // Ensure we're in human-human mode for this experiment (even in mock mode)
      CONFIG.game.players.player2.type = 'human';
      console.log('🎮 Mock: Set player2 type to human for mock multiplayer experiment');

      // Simulate finding a partner after 2 seconds
      setTimeout(() => {
        console.log('🤖 Mock: Partner found, showing ready button');
        this.timelineManager.emit('partner-connected', {
          players: [
            { id: 'mock-player1', name: 'You' },
            { id: 'mock-player2', name: 'AI Partner' }
          ]
        });
      }, 2000);
    });

    this.timelineManager.on('player-ready', () => {
      console.log('🤖 Mock: Player clicked ready, simulating partner ready...');

      // Simulate both players ready after 1 second
      setTimeout(() => {
        console.log('🤖 Mock: Both players ready, starting game');
        this.uiManager.setPlayerInfo(0, 'human-human');
        this.timelineManager.emit('all-players-ready', {
          gameMode: 'human-human',
          players: [
            { id: 'mock-player1', playerIndex: 0 },
            { id: 'mock-player2', playerIndex: 1 }
          ]
        });
      }, 1000);
    });

    console.log('✅ Mock multiplayer timeline events registered');
  }

  setupTimelineEventHandlers() {
    if (!this.timelineManager) return;

    // Handle timeline save-data event
    this.timelineManager.on('save-data', (experimentData) => {
      console.log('💾 Timeline requesting data save:', experimentData);
      this.saveExperimentData(experimentData);
    });

    // Handle any multiplayer-specific timeline events
    this.timelineManager.on('partner-connected', () => {
      console.log('👥 Partner connected via timeline');
    });

    this.timelineManager.on('all-players-ready', () => {
      console.log('🎮 All players ready via timeline');
    });

    console.log('📡 Timeline event handlers setup completed');
  }

  saveExperimentData(data) {
    // Save experiment data (could be localStorage, server upload, etc.)
    try {
      const dataStr = JSON.stringify(data, null, 2);

      // Save to localStorage as backup
      localStorage.setItem('experimentData', dataStr);

      // Create downloadable file
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      console.log('💾 Experiment data saved:', data);

    } catch (error) {
      console.error('Failed to save experiment data:', error);
    }
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

      if (this.useTimelineFlow && this.timelineManager) {
        // Notify timeline that we have a partner
        this.timelineManager.emit('partner-connected', data);
      } else {
        // Legacy flow
        this.uiManager.updateLobbyInfo(data);
      }
    });

    this.networkManager.on('player-joined', (data) => {
      console.log('Player joined:', data);

      if (this.useTimelineFlow && this.timelineManager) {
        // Notify timeline about player changes
        this.timelineManager.emit('partner-connected', data);
      } else {
        // Legacy flow
        this.uiManager.updatePlayerList(data.players);
      }
    });

    this.networkManager.on('player-disconnected', (data) => {
      console.log('Player disconnected:', data);

      if (this.useTimelineFlow) {
        // Handle disconnection in timeline flow
        // Could pause timeline or show error
        console.log('Partner disconnected during timeline flow');
      } else {
        // Legacy flow
        this.uiManager.updatePlayerList(data.players);
        this.uiManager.showNotification('Partner disconnected');
      }
    });

    // Handle player ready status updates
    this.networkManager.on('player-ready-status', (data) => {
      console.log('Player ready status update:', data);

      if (this.useTimelineFlow && this.timelineManager) {
        // Check if all players are ready based on the updated player list
        const allReady = data.players && data.players.every(p => p.isReady);
        console.log(`All players ready: ${allReady}`, data.players);

        if (allReady) {
          // Only emit all-players-ready if we haven't already done so
          console.log('🎮 All players ready - emitting to timeline');
          this.timelineManager.emit('all-players-ready', {
            gameMode: 'human-human',
            players: data.players
          });
        }
      } else {
        // Legacy flow - update lobby info
        this.uiManager.updatePlayerReadyStatus(data.players);
      }
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

      if (this.useTimelineFlow) {
        // Set player info for timeline flow
        this.uiManager.setPlayerInfo(this.playerIndex, config.gameMode);
        this.timelineManager.setPlayerInfo(this.playerIndex, config.gameMode);
        // Notify timeline that both players are ready
        this.timelineManager.emit('all-players-ready', config);
      } else {
        // Legacy networked game flow
        this.startNetworkedGame(config);
      }
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

    // Set player info in timeline manager if using timeline flow
    if (this.timelineManager) {
      this.timelineManager.setPlayerInfo(this.playerIndex, config.gameMode);
    }

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