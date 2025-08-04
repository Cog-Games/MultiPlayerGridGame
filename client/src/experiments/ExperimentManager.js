import { CONFIG } from '../config/gameConfig.js';
import { RLAgent } from '../ai/RLAgent.js';
import { GameHelpers } from '../utils/GameHelpers.js';
import { mapLoader } from '../utils/MapLoader.js';

export class ExperimentManager {
  constructor(gameStateManager, uiManager, timelineManager = null) {
    this.gameStateManager = gameStateManager;
    this.uiManager = uiManager;
    this.timelineManager = timelineManager;
    this.rlAgent = new RLAgent();

    this.currentExperimentSequence = [];
    this.currentExperimentIndex = 0;
    this.currentTrialIndex = 0;
    this.isRunning = false;
    this.gameLoopInterval = null;
    this.aiMoveInterval = null;

    // Initialize map data with MapLoader
    this.mapLoader = mapLoader;
    console.log('🗺️ ExperimentManager initialized with MapLoader');

    // Ensure map data is loaded
    this.ensureMapDataLoaded();

    // Set up timeline event handlers if timeline manager is provided
    this.setupTimelineIntegration();
  }

  async startExperiment(experimentType) {
    // Single experiment wrapper
    await this.startExperimentSequence([experimentType]);
  }

  async startExperimentSequence(experiments) {
    this.currentExperimentSequence = experiments || CONFIG.game.experiments.order;
    this.currentExperimentIndex = 0;
    this.isRunning = true;

    console.log('Starting experiment sequence:', this.currentExperimentSequence);

    // Start first experiment
    await this.startNextExperiment();
  }

  async startNextExperiment() {
    if (this.currentExperimentIndex >= this.currentExperimentSequence.length) {
      this.completeAllExperiments();
      return;
    }

    const experimentType = this.currentExperimentSequence[this.currentExperimentIndex];
    console.log(`Starting experiment ${this.currentExperimentIndex + 1}/${this.currentExperimentSequence.length}: ${experimentType}`);

    this.currentTrialIndex = 0;

    // Show consent or instruction if needed
    await this.showExperimentIntroduction(experimentType);

    // Start first trial
    await this.startNextTrial(experimentType);
  }

  async showExperimentIntroduction(experimentType) {
    // For now, just proceed directly to the game
    // In the future, you might want to show instructions specific to each experiment type
    return Promise.resolve();
  }

  async startNextTrial(experimentType) {
    const maxTrials = CONFIG.game.experiments.numTrials[experimentType] || 12;

    // Check if experiment should end early due to success threshold
    if (this.shouldEndExperimentEarly(experimentType)) {
      console.log(`Experiment ${experimentType} ended early due to success threshold`);
      this.currentExperimentIndex++;
      await this.startNextExperiment();
      return;
    }

    // Check if we've completed all trials
    if (this.currentTrialIndex >= maxTrials) {
      console.log(`Completed all trials for ${experimentType}`);
      this.currentExperimentIndex++;
      await this.startNextExperiment();
      return;
    }

    console.log(`Starting trial ${this.currentTrialIndex + 1}/${maxTrials} for ${experimentType}`);

    // Get trial design
    let design = this.getTrialDesign(experimentType, this.currentTrialIndex);
    if (!design) {
      console.error('Failed to get trial design, using fallback');
      design = GameHelpers.createFallbackDesign(experimentType);
    }

    // Initialize trial
    this.gameStateManager.initializeTrial(this.currentTrialIndex, experimentType, design);

    // Update UI
    this.uiManager.updateGameInfo(this.currentExperimentIndex, this.currentTrialIndex, experimentType);
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    // Start trial based on experiment type
    this.startTrialExecution(experimentType);
  }

  startTrialExecution(experimentType) {
    // Clear any existing intervals
    this.clearGameIntervals();

    // Start appropriate trial type
    switch (experimentType) {
      case '1P1G':
        this.runTrial1P1G();
        break;
      case '1P2G':
        this.runTrial1P2G();
        break;
      case '2P2G':
        this.runTrial2P2G();
        break;
      case '2P3G':
        this.runTrial2P3G();
        break;
      default:
        console.error('Unknown experiment type:', experimentType);
    }

    // Set up game timeout
    this.setupGameTimeout();
  }

  runTrial1P1G() {
    // Single player, single goal - just wait for player to reach goal
    // The GameStateManager handles move processing and goal checking
  }

  runTrial1P2G() {
    // Single player, two goals - handle new goal presentation
    this.setupNewGoalCheck1P2G();
  }

  runTrial2P2G() {
    // Two players, two goals - check if AI or human player 2
    if (CONFIG.game.players.player2.type === 'ai') {
      this.setupAIMovement();
    } else {
      // Human-human mode - no AI movement setup needed
      console.log('2P2G: Human-human mode - waiting for network player actions');
    }
  }

  runTrial2P3G() {
    // Two players, three goals - check if AI or human player 2
    if (CONFIG.game.players.player2.type === 'ai') {
      this.setupAIMovement();
    } else {
      // Human-human mode - no AI movement setup needed
      console.log('2P3G: Human-human mode - waiting for network player actions');
    }
    this.setupNewGoalCheck2P3G();
  }

  setupAIMovement() {
    // Skip AI movement setup if no AI agent available
    if (!this.rlAgent) return;

    const aiMoveDelay = CONFIG.game.agent.delay;
    let player1AtGoal = false;

    // AI moves with human initially
    this.uiManager.on('player-move', () => {
      // Check if this is a multiplayer game and AI should move
      const gameState = this.gameStateManager.getCurrentState();
      if (!gameState.player2) return;

      // Don't move AI if it's already at a goal
      if (GameHelpers.isGoalReached(gameState.player2, gameState.currentGoals)) {
        return;
      }

      setTimeout(() => {
        this.makeAIMove();
      }, aiMoveDelay);
    });

    // Monitor for when player1 reaches goal to start independent AI movement
    const checkPlayerGoal = setInterval(() => {
      const gameState = this.gameStateManager.getCurrentState();
      if (!gameState.player1 || !gameState.player2) return;

      const currentPlayer1AtGoal = GameHelpers.isGoalReached(gameState.player1, gameState.currentGoals);

      if (!player1AtGoal && currentPlayer1AtGoal) {
        // Player1 just reached goal
        player1AtGoal = true;
        this.startIndependentAIMovement();
      }
    }, 100);

    // Store interval for cleanup
    this.gameLoopInterval = checkPlayerGoal;
  }

  makeAIMove() {
    const gameState = this.gameStateManager.getCurrentState();
    if (!gameState.player2 || !gameState.currentGoals || !this.rlAgent) return;

    // Don't move if AI is already at a goal
    if (GameHelpers.isGoalReached(gameState.player2, gameState.currentGoals)) {
      return;
    }

    // Get AI action
    const aiAction = this.rlAgent.getAIAction(
      gameState.gridMatrix,
      gameState.player2,
      gameState.currentGoals,
      gameState.player1
    );

    if (aiAction[0] === 0 && aiAction[1] === 0) {
      return; // No movement
    }

    // Convert action to direction string
    const direction = this.actionToDirection(aiAction);
    if (direction) {
      const moveResult = this.gameStateManager.processPlayerMove(2, direction);
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

      if (moveResult.trialComplete) {
        this.handleTrialComplete(moveResult);
      }
    }
  }

  startIndependentAIMovement() {
    // Clear any existing AI interval
    if (this.aiMoveInterval) {
      clearInterval(this.aiMoveInterval);
    }

    // Start independent AI movement at slower pace
    this.aiMoveInterval = setInterval(() => {
      const gameState = this.gameStateManager.getCurrentState();
      if (!gameState.player2) return;

      // Stop if AI reached a goal
      if (GameHelpers.isGoalReached(gameState.player2, gameState.currentGoals)) {
        clearInterval(this.aiMoveInterval);
        this.aiMoveInterval = null;
        return;
      }

      this.makeAIMove();
    }, CONFIG.game.agent.independentDelay);
  }

  setupNewGoalCheck1P2G() {
    // Implementation for 1P2G new goal logic would go here
    // This is simplified for the refactor
  }

  setupNewGoalCheck2P3G() {
    // Implementation for 2P3G new goal logic would go here
    // This is simplified for the refactor
  }

  actionToDirection(action) {
    const [deltaRow, deltaCol] = action;

    if (deltaRow === -1 && deltaCol === 0) return 'up';
    if (deltaRow === 1 && deltaCol === 0) return 'down';
    if (deltaRow === 0 && deltaCol === -1) return 'left';
    if (deltaRow === 0 && deltaCol === 1) return 'right';

    return null;
  }

  setupGameTimeout() {
    const timeout = setTimeout(() => {
      console.log('Game timeout reached');
      this.handleTrialComplete({ success: false, timeout: true });
    }, CONFIG.game.maxGameLength * 1000); // Convert to milliseconds

    this.gameTimeoutId = timeout;
  }

  handleTrialComplete(result) {
    console.log('Trial completed:', result);

    // If we're using timeline manager, delegate to timeline handler
    if (this.timelineManager && this.currentTrialCompleteCallback) {
      this.handleTimelineTrialComplete(result);
      return;
    }

    // Original standalone logic
    // Clear intervals
    this.clearGameIntervals();

    // Finalize trial data
    this.gameStateManager.finalizeTrial(result.success || result.trialComplete);

    // Show feedback
    this.uiManager.showTrialFeedback(result);

    // Move to next trial after delay
    setTimeout(() => {
      this.currentTrialIndex++;
      const currentExperiment = this.currentExperimentSequence[this.currentExperimentIndex];
      this.startNextTrial(currentExperiment);
    }, CONFIG.game.timing.trialToFeedbackDelay + CONFIG.game.timing.feedbackDisplayDuration);
  }

  shouldEndExperimentEarly(experimentType) {
    if (!CONFIG.game.successThreshold.enabled) return false;

    const experimentData = this.gameStateManager.getExperimentData();
    const threshold = experimentData.successThreshold;

    return threshold.consecutiveSuccesses >= CONFIG.game.successThreshold.consecutiveSuccessesRequired &&
           threshold.totalTrialsCompleted >= CONFIG.game.successThreshold.minTrialsBeforeCheck;
  }

  completeAllExperiments() {
    console.log('All experiments completed');
    this.isRunning = false;

    // Get final results
    const experimentData = this.gameStateManager.getExperimentData();
    const results = {
      totalTrials: experimentData.allTrialsData.length,
      successfulTrials: experimentData.allTrialsData.filter(t => t.completed || t.collaborationSucceeded).length,
      successRate: GameHelpers.calculateSuccessRate(experimentData.allTrialsData),
      totalTime: GameHelpers.formatDuration(Date.now() - (experimentData.allTrialsData[0]?.trialStartTime || Date.now()))
    };

    // Show completion screen
    this.uiManager.showExperimentComplete(results);

    // Export data if needed
    this.exportExperimentData(experimentData);
  }

  exportExperimentData(data) {
    // Create downloadable JSON file
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `experiment-data-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Multiplayer experiment support
  async startMultiplayerExperiment(config) {
    console.log('Starting multiplayer experiment:', config);

    // Configure for multiplayer mode
    this.currentExperimentSequence = [config.experimentType];

    // Disable AI agent for human-human mode
    if (config.gameMode === 'human-human') {
      this.rlAgent = null;
    }

    await this.startExperimentSequence();
  }

  async getTrialDesign(experimentType, trialIndex) {
    console.log(`🗺️ Loading trial design for ${experimentType} trial ${trialIndex}`);

    // Ensure map data is loaded
    await this.ensureMapDataLoaded();

    try {
      // For collaboration experiments after trial 12, use random maps
      if (experimentType.includes('2P') && trialIndex >= CONFIG.game.successThreshold.randomSamplingAfterTrial) {
        const randomDesign = this.mapLoader.getRandomMapForCollaborationGame(experimentType, trialIndex);
        if (randomDesign) {
          console.log('✅ Loaded random map design:', randomDesign);
          return randomDesign;
        }
      }

      // Get maps for experiment type
      const mapsForExperiment = this.mapLoader.getMapsForExperiment(experimentType);
      console.log(`🗺️ Available maps for ${experimentType}:`, Object.keys(mapsForExperiment || {}).length);

      if (!mapsForExperiment || Object.keys(mapsForExperiment).length === 0) {
        console.warn('⚠️ No maps available, using fallback design');
        return this.mapLoader.createFallbackDesign(experimentType);
      }

      // Select map based on trial index (or randomly if too many trials)
      const mapKeys = Object.keys(mapsForExperiment);
      const selectedKey = mapKeys[trialIndex % mapKeys.length];
      const selectedMapArray = mapsForExperiment[selectedKey];

      if (Array.isArray(selectedMapArray) && selectedMapArray.length > 0) {
        const design = { ...selectedMapArray[0] }; // Clone the design
        console.log(`✅ Loaded map design for trial ${trialIndex}:`, design);
        return design;
      }

      console.warn('⚠️ Invalid map structure, using fallback design');
      return this.mapLoader.createFallbackDesign(experimentType);

    } catch (error) {
      console.error('❌ Error loading trial design:', error);
      return this.mapLoader.createFallbackDesign(experimentType);
    }
  }

  async ensureMapDataLoaded() {
    if (!this.mapLoader.mapData) {
      console.log('🗺️ Waiting for map data to load...');
      await this.mapLoader.initialize();
      console.log('✅ Map data loaded for ExperimentManager');
    }
  }

  clearGameIntervals() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }

    if (this.aiMoveInterval) {
      clearInterval(this.aiMoveInterval);
      this.aiMoveInterval = null;
    }

    if (this.gameTimeoutId) {
      clearTimeout(this.gameTimeoutId);
      this.gameTimeoutId = null;
    }
  }

  // Timeline Integration
  setupTimelineIntegration() {
    if (!this.timelineManager) return;

    // Handle timeline events
    this.timelineManager.on('show-fixation', (data) => {
      this.handleFixationDisplay(data);
    });

    this.timelineManager.on('start-trial', (data) => {
      this.handleTimelineTrialStart(data);
    });

    this.timelineManager.on('show-trial-feedback', (data) => {
      this.handleTrialFeedback(data);
    });

    console.log('✅ Timeline integration setup completed');
  }

  handleFixationDisplay(data) {
    const { experimentType, experimentIndex, trialIndex } = data;
    console.log(`⚡ Showing fixation for ${experimentType} trial ${trialIndex}`);

    // Find the fixation container that timeline created
    const fixationContainer = document.getElementById('fixation-canvas-container');
    if (fixationContainer) {
      // Add fixation cross to the timeline's container instead of replacing the whole page
      fixationContainer.innerHTML = `
        <div style="font-size: 48px; font-weight: bold; color: #333; padding: 50px;">
          +
        </div>
      `;
      console.log('✅ Fixation cross added to timeline container');
    } else {
      console.warn('⚠️ Fixation container not found, timeline may not be set up properly');
      // Fallback: use UIManager's method
      this.uiManager.showFixation();
    }
  }

  async handleTimelineTrialStart(data) {
    const { experimentType, experimentIndex, trialIndex, onComplete } = data;
    console.log(`🎮 Timeline starting trial ${trialIndex} of ${experimentType}`);

    // Store completion callback
    this.currentTrialCompleteCallback = onComplete;

    try {
      // Get trial design (now async)
      let design = await this.getTrialDesign(experimentType, trialIndex);
      if (!design) {
        console.error('Failed to get trial design, using fallback');
        design = GameHelpers.createFallbackDesign(experimentType);
      }

      // Initialize trial
      this.gameStateManager.initializeTrial(trialIndex, experimentType, design);

      // Update UI - use timeline's game container
      this.uiManager.updateGameInfo(experimentIndex, trialIndex, experimentType);

      // Set up game canvas in timeline's container
      const gameContainer = document.getElementById('game-canvas-container');
      if (gameContainer) {
        console.log('✅ Found timeline game container, setting up game canvas');
        this.uiManager.setupGameCanvasInContainer(gameContainer);
      } else {
        console.warn('⚠️ Timeline game container not found, using fallback');
      }

      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

      // Start trial execution
      this.startTimelineTrialExecution(experimentType);

    } catch (error) {
      console.error('❌ Error starting timeline trial:', error);
      // Use fallback design if everything fails
      const fallbackDesign = GameHelpers.createFallbackDesign(experimentType);
      this.gameStateManager.initializeTrial(trialIndex, experimentType, fallbackDesign);
      this.uiManager.updateGameInfo(experimentIndex, trialIndex, experimentType);
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
      this.startTimelineTrialExecution(experimentType);
    }
  }

  startTimelineTrialExecution(experimentType) {
    // Clear any existing intervals
    this.clearGameIntervals();

    // Start appropriate trial type
    switch (experimentType) {
      case '1P1G':
        this.runTrial1P1G();
        break;
      case '1P2G':
        this.runTrial1P2G();
        break;
      case '2P2G':
        this.runTrial2P2G();
        break;
      case '2P3G':
        this.runTrial2P3G();
        break;
      default:
        console.error('Unknown experiment type:', experimentType);
    }

    // Set up game timeout
    this.setupTimelineGameTimeout();
  }

  setupTimelineGameTimeout() {
    const timeout = setTimeout(() => {
      console.log('Game timeout reached');
      this.handleTimelineTrialComplete({ success: false, timeout: true });
    }, CONFIG.game.maxGameLength * 1000);

    this.gameTimeoutId = timeout;
  }

  handleTimelineTrialComplete(result) {
    console.log('Timeline trial completed:', result);

    // Clear intervals
    this.clearGameIntervals();

    // Determine success based on experiment type
    let success;
    const currentTrialData = this.gameStateManager.getCurrentTrialData();
    const experimentType = this.gameStateManager.getCurrentState().experimentType;

    if (experimentType.startsWith('1P')) {
      // Single player experiments - use the success flag
      success = result.success || result.trialComplete;
    } else {
      // 2P experiments - use collaboration success
      success = currentTrialData.collaborationSucceeded;
    }

    // Finalize trial data
    this.gameStateManager.finalizeTrial(success);

    // Get trial data for timeline
    const trialData = {
      ...result,
      success: success, // Override with correct success value
      trialData: this.gameStateManager.getCurrentTrialData(),
      gameState: this.gameStateManager.getCurrentState()
    };

    // Call timeline completion callback
    if (this.currentTrialCompleteCallback) {
      this.currentTrialCompleteCallback(trialData);
      this.currentTrialCompleteCallback = null;
    }
  }

  handleTrialFeedback(data) {
    const { success, experimentType, trialIndex, canvasContainer } = data;
    console.log(`📊 Showing trial feedback for ${experimentType} trial ${trialIndex}`);

    // Determine message type based on experiment type
    const messageType = experimentType.startsWith('1P') ? 'single' : 'collaboration';

    // Create feedback display in the provided container
    this.uiManager.showTrialFeedbackInContainer(success, canvasContainer, messageType);
  }

  // Public API
  restart() {
    this.clearGameIntervals();
    this.gameStateManager.reset();
    this.currentExperimentIndex = 0;
    this.currentTrialIndex = 0;
    this.isRunning = false;
  }

  pause() {
    this.clearGameIntervals();
  }

  resume() {
    if (this.isRunning) {
      const currentExperiment = this.currentExperimentSequence[this.currentExperimentIndex];
      this.startTrialExecution(currentExperiment);
    }
  }
}