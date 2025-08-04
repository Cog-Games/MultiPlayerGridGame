import { CONFIG, GameConfigUtils } from '../config/gameConfig.js';

/**
 * Timeline Manager - Orchestrates the complete experiment flow
 * Matches the legacy expTimeline.js structure exactly
 */
export class TimelineManager {
  constructor(container) {
    this.container = container;
    this.stages = [];
    this.currentStageIndex = 0;
    this.mapData = {};
    this.experimentData = {
      participantId: this.generateParticipantId(),
      startTime: new Date().toISOString(),
      consentTime: null,
      experiments: {},
      questionnaire: {},
      totalScore: 0,
      completed: false
    };
    this.eventHandlers = new Map();

    // Success threshold tracking for collaboration experiments
    this.successThreshold = {
      consecutiveSuccesses: 0,
      totalTrialsCompleted: 0,
      experimentEndedEarly: false,
      lastSuccessTrial: -1,
      successHistory: []
    };

    // Map synchronization for multiplayer
    this.sharedMapData = {};
    this.isMapHost = false;
    this.pendingMapSync = false;

    // Player information for multiplayer games
    this.playerIndex = 0; // Default to player 0 (red)
    this.gameMode = 'human-ai'; // Default game mode
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
          console.error(`Error in timeline event handler for ${event}:`, error);
        }
      });
    }
  }

  // Set player information for multiplayer games
  setPlayerInfo(playerIndex, gameMode) {
    this.playerIndex = playerIndex;
    this.gameMode = gameMode;
    console.log(`🎮 TimelineManager: Set player info - Player ${playerIndex + 1} (${playerIndex === 0 ? 'red' : 'orange'}) in ${gameMode} mode`);
  }

  /**
   * Create the complete timeline stages matching legacy structure
   */
  createTimelineStages() {
    this.stages = [];

    console.log('📋 Creating comprehensive timeline stages...');

    // 1. Consent form
    // this.stages.push({
    //   type: 'consent',
    //   handler: () => this.showConsentStage()
    // });

    // 2. Welcome info
    this.stages.push({
      type: 'welcome_info',
      handler: () => this.showWelcomeInfoStage()
    });

    // 3-6. Add stages for each experiment in order
    const experimentOrder = CONFIG.game.experiments.order;
    for (let expIndex = 0; expIndex < experimentOrder.length; expIndex++) {
      const experimentType = experimentOrder[expIndex];
      const numTrials = CONFIG.game.experiments.numTrials[experimentType];

      console.log(`📋 Adding stages for experiment: ${experimentType}`);

      // Instructions for this experiment
      this.stages.push({
        type: 'instructions',
        experimentType: experimentType,
        experimentIndex: expIndex,
        handler: () => this.showInstructionsStage(experimentType, expIndex)
      });

      // Waiting room only for true human-human multiplayer experiments
      // For human-AI mode, 2P experiments run with AI as the second player
      const isMultiplayer = experimentType.includes('2P');
      const isHumanHuman = this.isHumanHumanMode();
      console.log(`🔍 Experiment ${experimentType}: isMultiplayer=${isMultiplayer}, isHumanHuman=${isHumanHuman}`);

      if (isMultiplayer && isHumanHuman) {
        console.log(`➕ Adding waiting room stage for ${experimentType}`);
        this.stages.push({
          type: 'waiting_for_partner',
          experimentType: experimentType,
          experimentIndex: expIndex,
          handler: () => this.showWaitingForPartnerStage(experimentType, expIndex)
        });
      } else {
        console.log(`⏭️  Skipping waiting room for ${experimentType} (isMultiplayer=${isMultiplayer}, isHumanHuman=${isHumanHuman})`);
      }

      // Add trial stages (fixation -> trial -> feedback sequence)
      if (experimentType.includes('2P') && CONFIG.game.successThreshold.enabled) {
        // Dynamic collaboration stages
        this.addCollaborationExperimentStages(experimentType, expIndex);
      } else {
        // Fixed number of trials
        for (let i = 0; i < numTrials; i++) {
          this.addTrialStages(experimentType, expIndex, i);
        }
      }
    }

    // 7. Game performance feedback
    this.stages.push({
      type: 'game-feedback',
      handler: () => this.showGameFeedbackStage()
    });

    // 8. Post-questionnaire
    this.stages.push({
      type: 'questionnaire',
      handler: () => this.showQuestionnaireStage()
    });

    // 9. End info with data saving
    this.stages.push({
      type: 'end-info',
      handler: () => this.showEndExperimentInfoStage()
    });

    // 10. Prolific redirect
    this.stages.push({
      type: 'prolific-redirect',
      handler: () => this.showProlificRedirectStage()
    });

    console.log(`📋 Timeline created with ${this.stages.length} total stages`);
    console.log('📋 Stages:', this.stages.map((stage, index) => `${index}: ${stage.type}`).join(', '));
  }

  /**
   * Add trial stages: fixation -> trial -> post-trial feedback
   */
  addTrialStages(experimentType, experimentIndex, trialIndex) {
    // Fixation screen
    this.stages.push({
      type: 'fixation',
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      trialIndex: trialIndex,
      handler: () => this.showFixationStage(experimentType, experimentIndex, trialIndex)
    });

    // Main trial
    this.stages.push({
      type: 'trial',
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      trialIndex: trialIndex,
      handler: () => this.runTrialStage(experimentType, experimentIndex, trialIndex)
    });

    // Post-trial feedback
    this.stages.push({
      type: 'post-trial',
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      trialIndex: trialIndex,
      handler: () => this.showPostTrialStage(experimentType, experimentIndex, trialIndex)
    });
  }

  /**
   * Add collaboration experiment stages with dynamic success threshold
   */
  addCollaborationExperimentStages(experimentType, experimentIndex) {
    // Initialize success threshold tracking for this experiment
    this.initializeSuccessThresholdTracking();

    // Add initial trial stages - more will be added dynamically based on performance
    this.addTrialStages(experimentType, experimentIndex, 0);
  }

  /**
   * Start the timeline
   */
  start() {
    this.createTimelineStages();
    this.currentStageIndex = 0;
    this.runCurrentStage();
  }

  /**
   * Run the current stage
   */
  runCurrentStage() {
    if (this.currentStageIndex >= this.stages.length) {
      console.log('🏁 Timeline completed!');
      return;
    }

    const stage = this.stages[this.currentStageIndex];
    console.log(`🎬 Running stage ${this.currentStageIndex}: ${stage.type}`);

    try {
      stage.handler();
    } catch (error) {
      console.error(`❌ Error running stage ${stage.type}:`, error);
      this.nextStage();
    }
  }

  /**
   * Advance to next stage
   */
  nextStage() {
    console.log(`➡️ Advancing from stage ${this.currentStageIndex} to ${this.currentStageIndex + 1}`);
    this.currentStageIndex++;
    this.runCurrentStage();
  }

  /**
   * Stage Implementations
   */

  showConsentStage() {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="max-width: 800px; margin: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px;">
          <h1 style="color: #333; text-align: center; margin-bottom: 30px;">Informed Consent for Research Participation</h1>

          <div style="max-height: 400px; overflow-y: auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 30px; background: #fafafa;">
            <h3>Key Information</h3>
            <p>This consent form asks you to take part in a research study. This study is conducted by researchers at Duke University and UCLA.</p>

            <h4>Purpose</h4>
            <p>The purpose of this study is to investigate how people make decisions.</p>

            <h4>What you will be asked to do</h4>
            <p>You will be playing a series of navigation games on a 2D grid map. Afterward, you will complete some questionnaires regarding your game experience. The study will take approximately 10 minutes to complete.</p>

            <h4>Benefits and Risks</h4>
            <p>There are no foreseen risks or benefits for participating in this study. Should any of the content cause you distress at any point throughout the study, you may stop at any time.</p>

            <h4>Confidentiality</h4>
            <p>We do not ask for your name or any other information that might identify you. Although collected data may be made public or used for future research purposes, your identity will always remain confidential.</p>

            <h4>Voluntary nature of participation</h4>
            <p>Your participation in this research study is voluntary. You may withdraw at any time and you may choose not to answer any question, but you must proceed to the final screen of the study in order to receive your completion code, which you must submit in order to be paid.</p>

            <h4>Compensation</h4>
            <p>You will receive $2 for your participation in this study, and an additional $0.50 bonus if you finish the task beyond a certain threshold.</p>

            <h4>Contact Information</h4>
            <p>For questions about the study or for research-related complaints, concerns or suggestions about the research, contact Dr. Tamar Kushnir at (919) 660-5640 during regular business hours. For questions about your rights as a participant contact the Duke Campus Institutional Review Board at campusirb@duke.edu. Please reference Protocol ID# 2024-0427 in your email.</p>

            <h4>Agreement</h4>
            <p>By clicking the button below, you acknowledge that your participation in the study is voluntary, you are 18 years of age or older, and that you are aware that you may choose to terminate your participation in the study at any time and for any reason.</p>
          </div>

          <div style="text-align: center;">
            <label style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 16px;">
              <input type="checkbox" id="consentCheckbox" style="margin-right: 10px; transform: scale(1.2);">
              I have read and understood the above information, and I consent to participate in this study.
            </label>

            <button id="continueBtn" disabled style="background: #28a745; color: white; border: none; padding: 12px 30px; font-size: 16px; border-radius: 5px; cursor: not-allowed; margin-right: 10px;">
              Continue to Experiment
            </button>

            <button onclick="window.close()" style="background: #dc3545; color: white; border: none; padding: 12px 30px; font-size: 16px; border-radius: 5px; cursor: pointer;">
              Decline and Exit
            </button>
          </div>
        </div>
      </div>
    `;

    // Add interactivity
    const checkbox = document.getElementById('consentCheckbox');
    const continueBtn = document.getElementById('continueBtn');

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        continueBtn.disabled = false;
        continueBtn.style.cursor = 'pointer';
        continueBtn.style.background = '#28a745';
      } else {
        continueBtn.disabled = true;
        continueBtn.style.cursor = 'not-allowed';
        continueBtn.style.background = '#6c757d';
      }
    });

    continueBtn.addEventListener('click', () => {
      if (!checkbox.checked) return;

      this.experimentData.consentTime = new Date().toISOString();
      console.log('✅ Consent obtained');
      this.nextStage();
    });
  }

  showWelcomeInfoStage() {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px;">Welcome to the Game!</h2>

          <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
            <div style="text-align: center; line-height: 1.6; margin-bottom: 30px; font-size: 18px; max-width: 600px;">
              <p style="margin-bottom: 10px;">
                You will be playing a navigation game where there are hungry travelers who need to reach a restaurant as soon as possible to get some food.
              </p>
              <p style="margin-bottom: 20px;">
                <span style="color: #007bff; font-weight: bold;">
                  Your goal is to use the arrow keys on the computer to control one of the travelers to reach one of the restaurants for a meal as quickly as possible, using the shortest path.
                </span>
              </p>
              <p style="margin-bottom: 20px;">
                Next, let's see how to play the game and practice for a few rounds!
              </p>
            </div>
          </div>

          <div style="margin-top: 30px;">
            <p style="font-size: 20px; font-weight: bold; color: #333; margin-bottom: 20px;">
              Press the <span style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-family: monospace;">spacebar</span> to continue!
            </p>
          </div>
        </div>
      </div>
    `;

    // Handle spacebar to continue (matching legacy)
    const handleSpacebar = (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        document.removeEventListener('keydown', handleSpacebar);
        console.log('🎮 Starting game sequence');
        this.nextStage();
      }
    };

    document.addEventListener('keydown', handleSpacebar);
    document.body.focus();
  }

  showInstructionsStage(experimentType, experimentIndex) {
    const instructions = this.getInstructionsForExperiment(experimentType);

    this.container.innerHTML = instructions.html;

    // Handle spacebar to continue (matching legacy)
    const handleSpacebar = (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        document.removeEventListener('keydown', handleSpacebar);
        console.log(`📋 Instructions completed for ${experimentType}`);
        this.nextStage();
      }
    };

    document.addEventListener('keydown', handleSpacebar);
    document.body.focus();
  }

  showWaitingForPartnerStage(experimentType, experimentIndex) {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div id="waiting-room" style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px;">Waiting for Partner</h2>

          <div style="margin-bottom: 30px;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          </div>

          <p style="font-size: 18px; color: #666; margin-bottom: 20px;">
            Connecting you with another player...
          </p>

          <p style="font-size: 14px; color: #999;">
            This may take a few moments.
          </p>

          <div id="ready-section" style="display: none; margin-top: 30px;">
            <p style="font-size: 16px; color: #333; margin-bottom: 15px;">
              Partner found! Click ready when you're prepared to start.
            </p>
            <button id="ready-btn" style="background: #28a745; color: white; border: none; padding: 12px 30px; border-radius: 5px; font-size: 16px; cursor: pointer;">
              Ready to Play
            </button>
          </div>

          <div style="margin-top: 20px; font-size: 12px; color: #666;">
            <p>For testing: Press <strong>SPACE</strong> to skip waiting and continue with AI partner</p>
          </div>
        </div>
      </div>

      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        #ready-btn:hover {
          background: #218838 !important;
        }
      </style>
    `;

    // Add spacebar skip option for testing
    const handleSkipWaiting = (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        document.removeEventListener('keydown', handleSkipWaiting);
        console.log('⏭️ Skipping multiplayer waiting - continuing with AI partner');

        // Convert to AI mode and continue
        CONFIG.game.players.player2.type = 'ai';
        this.nextStage();
      }
    };
    document.addEventListener('keydown', handleSkipWaiting);

    // Emit event to start multiplayer connection
    this.emit('waiting-for-partner', { experimentType, experimentIndex });

    // Store handlers for cleanup
    const partnerConnectedHandler = () => {
      console.log('👥 Partner connected - showing ready button');
      const readySection = document.getElementById('ready-section');
      const loadingDiv = document.querySelector('div[style*="spin"]');
      if (readySection && loadingDiv) {
        loadingDiv.style.display = 'none';
        readySection.style.display = 'block';

        // Add click handler for ready button
        const readyBtn = document.getElementById('ready-btn');
        if (readyBtn) {
          readyBtn.onclick = () => {
            readyBtn.disabled = true;
            readyBtn.textContent = 'Waiting for partner...';
            readyBtn.style.background = '#6c757d';
            this.emit('player-ready');
          };
        }
      }
    };

    const allPlayersReadyHandler = () => {
      console.log('🎮 All players ready - starting game');
      document.removeEventListener('keydown', handleSkipWaiting);
      // Clean up these specific handlers
      this.off('partner-connected', partnerConnectedHandler);
      this.off('all-players-ready', allPlayersReadyHandler);
      this.nextStage();
    };

    // Remove any existing handlers for this stage before adding new ones
    this.eventHandlers.delete('partner-connected');
    this.eventHandlers.delete('all-players-ready');

    // Register the handlers
    this.on('partner-connected', partnerConnectedHandler);
    this.on('all-players-ready', allPlayersReadyHandler);
  }

  showFixationStage(experimentType, experimentIndex, trialIndex) {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center;">
          <div id="fixation-canvas-container"></div>
          <div style="margin-top: 20px; font-size: 14px; color: #666;">
            <p>Fixation stage - auto-advancing in ${CONFIG.game.timing.fixationDuration/1000} seconds</p>
            <p style="font-size: 12px;">Or press SPACE to skip</p>
          </div>
        </div>
      </div>
    `;

    // Emit event to show fixation display
    this.emit('show-fixation', { experimentType, experimentIndex, trialIndex });

    // Add spacebar skip option for testing
    const handleSkip = (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        document.removeEventListener('keydown', handleSkip);
        console.log('⏭️ Fixation skipped by user');
        this.nextStage();
      }
    };
    document.addEventListener('keydown', handleSkip);

    // Auto-advance after fixation duration
    console.log(`⏰ Setting fixation timeout for ${CONFIG.game.timing.fixationDuration}ms`);
    const timeoutId = setTimeout(() => {
      document.removeEventListener('keydown', handleSkip);
      console.log(`⚡ Fixation completed for trial ${trialIndex} - advancing to next stage`);
      this.nextStage();
    }, CONFIG.game.timing.fixationDuration);

    // Store timeout ID for potential cleanup
    this.currentFixationTimeout = timeoutId;
  }

  runTrialStage(experimentType, experimentIndex, trialIndex) {
    console.log(`🎮 Starting trial ${trialIndex} of ${experimentType}`);

    // Determine player color and name for multiplayer games
    let playerColor = CONFIG.visual.colors.player1; // Default red
    let playerName = 'Player 1 (Red)';

    if (this.gameMode === 'human-human' && experimentType.includes('2P')) {
      playerColor = this.playerIndex === 0 ? CONFIG.visual.colors.player1 : CONFIG.visual.colors.player2;
      playerName = this.playerIndex === 0 ? 'Player 1 (Red)' : 'Player 2 (Orange)';
    }

    // Create trial container with game canvas area
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center; max-width: 800px; width: 100%;">
          <h3 style="margin-bottom: 20px;">Game ${experimentIndex + 1} - Trial ${trialIndex + 1}</h3>
          <div id="game-canvas-container" style="margin: 0 auto; position: relative; display: flex; justify-content: center;">
            <!-- Game canvas will be inserted here by ExperimentManager -->
          </div>
          <div style="margin-top: 20px; font-size: 14px; color: #666;">
            <p>You are ${playerName} <span style="display: inline-block; width: 18px; height: 18px; background-color: ${playerColor}; border-radius: 50%; vertical-align: middle;"></span>. Use arrow keys to move.</p>
          </div>
        </div>
      </div>
    `;

    // Emit event to start trial
    this.emit('start-trial', {
      experimentType,
      experimentIndex,
      trialIndex,
      onComplete: (result) => {
        // Store trial result
        if (!this.experimentData.experiments[experimentType]) {
          this.experimentData.experiments[experimentType] = [];
        }
        this.experimentData.experiments[experimentType].push(result);

        // Update success threshold tracking for collaboration experiments
        if (experimentType.includes('2P') && CONFIG.game.successThreshold.enabled) {
          this.updateSuccessThresholdTracking(result.success, trialIndex);
        }

        console.log(`✅ Trial ${trialIndex} completed`);
        this.nextStage();
      }
    });
  }

  showPostTrialStage(experimentType, experimentIndex, trialIndex) {
    // Get the last trial result
    const trialResult = this.experimentData.experiments[experimentType]?.[trialIndex];
    const success = trialResult?.success || false;

    // Instead of creating a new page, show feedback as overlay on the current game canvas
    // Find the existing game canvas container
    const gameCanvasContainer = document.getElementById('game-canvas-container');

    if (gameCanvasContainer) {
      // Show feedback overlay on the existing game canvas
      this.emit('show-trial-feedback', {
        success,
        experimentType,
        trialIndex,
        canvasContainer: gameCanvasContainer
      });
    } else {
      // Fallback: create a new container if game canvas not found
      this.container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
          <div style="text-align: center; max-width: 600px; width: 100%;">
            <h3 style="margin-bottom: 10px;">Game ${experimentIndex + 1}</h3>
            <h4 style="margin-bottom: 20px;">Round ${trialIndex + 1} Results</h4>
            <div id="feedbackCanvasContainer" style="margin: 0 auto 20px auto; position: relative; display: flex; justify-content: center;"></div>
          </div>
        </div>
      `;

      this.emit('show-trial-feedback', {
        success,
        experimentType,
        trialIndex,
        canvasContainer: document.getElementById('feedbackCanvasContainer')
      });
    }

    // Auto-advance after feedback duration
    setTimeout(() => {
      console.log(`📊 Post-trial feedback completed for trial ${trialIndex}`);

      // Check if we should continue to next trial or end the experiment
      if (experimentType.includes('2P') && CONFIG.game.successThreshold.enabled) {
        // Dynamic trial progression for collaboration experiments
        if (this.shouldContinueToNextTrial(experimentType, trialIndex)) {
          console.log(`Continuing to next trial for ${experimentType}`);
          // Add the next trial stages dynamically
          this.addNextTrialStages(experimentType, experimentIndex, trialIndex + 1);
          this.nextStage();
        } else {
          console.log(`Ending ${experimentType} experiment`);
          // Skip to next experiment or completion stage
          this.skipToNextExperimentOrCompletion(experimentType);
        }
      } else {
        // Normal progression for non-collaboration experiments
        this.nextStage();
      }
    }, CONFIG.game.timing.feedbackDisplayDuration);
  }

  showGameFeedbackStage() {
    // Calculate overall performance
    const totalTrials = Object.values(this.experimentData.experiments)
      .flat().length;
    const successfulTrials = Object.values(this.experimentData.experiments)
      .flat().filter(trial => trial.success).length;
    const successRate = totalTrials > 0 ? Math.round((successfulTrials / totalTrials) * 100) : 0;

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px;">🎮 Game Performance</h2>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <h3 style="margin-bottom: 20px;">Your Results:</h3>
            <p><strong>Total Trials:</strong> ${totalTrials}</p>
            <p><strong>Successful Trials:</strong> ${successfulTrials}</p>
            <p><strong>Success Rate:</strong> ${successRate}%</p>
          </div>

          <p style="font-size: 16px; margin-bottom: 30px;">
            ${successRate >= 70 ?
              '🌟 Excellent performance! You\'ve earned a bonus.' :
              '👍 Good effort! Thanks for participating.'}
          </p>

          <button id="continueBtn" style="background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer;">
            Continue to Questionnaire
          </button>
        </div>
      </div>
    `;

    document.getElementById('continueBtn').addEventListener('click', () => {
      console.log('📊 Game feedback completed');
      this.nextStage();
    });
  }

  showQuestionnaireStage() {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 700px;">
          <h2 style="color: #333; text-align: center; margin-bottom: 30px;">📝 Post-Game Questionnaire</h2>

          <form id="questionnaireForm">
            <div style="margin-bottom: 25px;">
              <label style="display: block; margin-bottom: 8px; font-weight: bold;">
                How challenging did you find the game overall? (1 = Very Easy, 5 = Very Hard)
              </label>
              <div style="display: flex; gap: 15px;">
                ${[1,2,3,4,5].map(n => `
                  <label style="display: flex; flex-direction: column; align-items: center;">
                    <input type="radio" name="difficulty" value="${n}" required>
                    <span style="margin-top: 5px;">${n}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div style="margin-bottom: 25px;">
              <label style="display: block; margin-bottom: 8px; font-weight: bold;">
                How much did you enjoy playing the game? (1 = Not at all, 5 = Very much)
              </label>
              <div style="display: flex; gap: 15px;">
                ${[1,2,3,4,5].map(n => `
                  <label style="display: flex; flex-direction: column; align-items: center;">
                    <input type="radio" name="enjoyment" value="${n}" required>
                    <span style="margin-top: 5px;">${n}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div style="margin-bottom: 25px;">
              <label style="display: block; margin-bottom: 8px; font-weight: bold;">
                Do you have any comments or feedback about the game?
              </label>
              <textarea name="comments" style="width: 100%; height: 100px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
            </div>

            <div style="text-align: center;">
              <button type="submit" style="background: #28a745; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer;">
                Submit Questionnaire
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('questionnaireForm').addEventListener('submit', (event) => {
      event.preventDefault();

      const formData = new FormData(event.target);
      this.experimentData.questionnaire = {
        difficulty: parseInt(formData.get('difficulty')),
        enjoyment: parseInt(formData.get('enjoyment')),
        comments: formData.get('comments') || '',
        completedTime: new Date().toISOString()
      };

      console.log('📝 Questionnaire completed');
      this.nextStage();
    });
  }

  showEndExperimentInfoStage() {
    const completionCode = this.generateCompletionCode();

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
          <h2 style="color: #28a745; margin-bottom: 30px;">🎉 Experiment Complete!</h2>

          <p style="font-size: 18px; margin-bottom: 20px;">
            Thank you for participating in our study!
          </p>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <p style="font-weight: bold; margin-bottom: 10px;">Your completion code is:</p>
            <div style="background: white; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 24px; letter-spacing: 2px; border: 2px solid #007bff;">
              ${completionCode}
            </div>
            <p style="margin-top: 10px; font-size: 14px; color: #666;">
              Please copy this code and submit it to complete your participation.
            </p>
          </div>

          <div style="margin-bottom: 30px;">
            <div style="display: inline-block; margin: 10px;">📊 Saving your data...</div>
          </div>

          <button id="continueBtn" style="background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer;">
            Continue
          </button>
        </div>
      </div>
    `;

    // Save data (emit event for external handler)
    this.experimentData.completed = true;
    this.experimentData.completionCode = completionCode;
    this.experimentData.endTime = new Date().toISOString();

    this.emit('save-data', this.experimentData);

    document.getElementById('continueBtn').addEventListener('click', () => {
      console.log('💾 Data saving initiated');
      this.nextStage();
    });
  }

  showProlificRedirectStage() {
    const prolificUrl = 'https://app.prolific.co/submissions/complete?cc=' + this.experimentData.completionCode;

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px;">🔗 Redirecting to Prolific</h2>

          <p style="font-size: 16px; margin-bottom: 30px;">
            You will be automatically redirected to Prolific to complete your submission.
          </p>

          <div style="margin-bottom: 30px;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          </div>

          <p style="font-size: 14px; color: #666; margin-bottom: 20px;">
            If you are not redirected automatically, please click the button below:
          </p>

          <a href="${prolificUrl}" style="display: inline-block; background: #007bff; color: white; text-decoration: none; padding: 15px 30px; font-size: 18px; border-radius: 5px;">
            Complete Submission
          </a>
        </div>
      </div>

      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;

    // Auto-redirect after 3 seconds
    setTimeout(() => {
      window.location.href = prolificUrl;
    }, 3000);
  }

  /**
   * Helper methods
   */

  isHumanHumanMode() {
    // Check if we're in true human-human multiplayer mode
    // For this implementation, we default to human-AI mode unless explicitly configured
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const isHumanHuman = mode === 'human-human';
    console.log('🔍 URL search params:', window.location.search);
    console.log('🔍 Mode parameter:', mode);
    console.log('🔍 Is human-human mode:', isHumanHuman);
    return isHumanHuman;
  }

  getInstructionsForExperiment(experimentType) {
    const instructions = {
      '1P1G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px;">Game 1</h2>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  In this practice, you are the traveler <span style="display: inline-block; width: 20px; height: 20px; background-color: red; border-radius: 50%; vertical-align: middle; margin: 0 4px;"></span>, and there will be one restaurant <span style="display: inline-block; width: 20px; height: 20px; background-color: #007bff; border-radius: 3px; vertical-align: middle; margin: 0 4px;"></span> on the map. Navigate to the restaurant (using ↑ ↓ ← →) as quickly as possible using the shortest path.
                </p>
              </div>
              <p style="font-size: 20px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      },
      '1P2G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px;">Game 2</h2>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  Good job!
                </p>
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  Let's continue. Now, there will be several identical restaurants <span style="display: inline-block; width: 20px; height: 20px; background-color: #007bff; border-radius: 3px; vertical-align: middle; margin: 0 4px;"></span> on the map. Note that some restaurants are already open before you start. During the game, other restaurants may open and appear on the map. All restaurants are identical, and your goal is to navigate to one of them as quickly as possible using the shortest path.
                </p>
              </div>
              <p style="font-size: 20px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      },
      '2P2G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px;">Game 3</h2>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  Good job! Now, you will be playing with another player!
                </p>
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  In this new game, there are only tables for two at these restaurants <span style="display: inline-block; width: 20px; height: 20px; background-color: #007bff; border-radius: 3px; vertical-align: middle; margin: 0 4px;"></span>, so you and another player have to go together in order to eat. You can also cross paths or touch sometimes on your way to your destination, and that's okay too!
                </p>
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  Let's practice first!
                </p>
              </div>
              <p style="font-size: 20px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      },
      '2P3G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px;">Game 4</h2>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  Good job! Now, let's start the final game.
                </p>
                <p style="font-size: 18px; color: #155724; margin-bottom: 15px; line-height: 1.6;">
                  You will still be playing the same player in the previous game. But now, there may be several identical restaurants <span style="display: inline-block; width: 20px; height: 20px; background-color: #007bff; border-radius: 3px; vertical-align: middle; margin: 0 4px;"></span> on the map. Note that some restaurants are already open before you start. During the game, other restaurants may open and appear on the map. All restaurants are identical, but you and the other player need to navigate to one of them together as quickly as possible using the shortest path.
                </p>
              </div>
              <p style="font-size: 20px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      }
    };

    return instructions[experimentType] || {
      html: `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
          <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
            <h2 style="color: #333; margin-bottom: 30px;">Game Instructions</h2>
            <p style="font-size: 18px; margin-bottom: 30px;">Use arrow keys to navigate and reach the goals.</p>
            <p style="font-size: 20px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
          </div>
        </div>
      `
    };
  }

  generateParticipantId() {
    return 'P' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  generateCompletionCode() {
    return 'GRID' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
  }

  /**
   * Initialize success threshold tracking for a new experiment
   */
  initializeSuccessThresholdTracking() {
    this.successThreshold.consecutiveSuccesses = 0;
    this.successThreshold.totalTrialsCompleted = 0;
    this.successThreshold.experimentEndedEarly = false;
    this.successThreshold.lastSuccessTrial = -1;
    this.successThreshold.successHistory = [];
  }

  /**
   * Update success threshold tracking after a trial
   */
  updateSuccessThresholdTracking(success, trialIndex) {
    this.successThreshold.totalTrialsCompleted++;
    this.successThreshold.successHistory.push(success);

    if (success) {
      this.successThreshold.consecutiveSuccesses++;
      this.successThreshold.lastSuccessTrial = trialIndex;
    } else {
      this.successThreshold.consecutiveSuccesses = 0;
    }

    console.log(`Success threshold update - Trial ${trialIndex + 1}: ${success ? 'SUCCESS' : 'FAILURE'}`);
    console.log(`  Consecutive successes: ${this.successThreshold.consecutiveSuccesses}/${CONFIG.game.successThreshold.consecutiveSuccessesRequired}`);
    console.log(`  Total trials: ${this.successThreshold.totalTrialsCompleted}/${CONFIG.game.successThreshold.maxTrials}`);
  }

  /**
   * Check if experiment should end due to success threshold
   */
  shouldEndExperimentDueToSuccessThreshold() {
    if (!CONFIG.game.successThreshold.enabled) {
      return false;
    }

    const config = CONFIG.game.successThreshold;
    const tracking = this.successThreshold;

    // Check if we've reached the maximum trials
    if (tracking.totalTrialsCompleted >= config.maxTrials) {
      console.log(`Experiment ending: Reached maximum trials (${config.maxTrials})`);
      return true;
    }

    // Check if we have enough trials and consecutive successes
    if (tracking.totalTrialsCompleted >= config.minTrialsBeforeCheck &&
        tracking.consecutiveSuccesses >= config.consecutiveSuccessesRequired) {
      console.log(`Experiment ending: Success threshold met (${tracking.consecutiveSuccesses} consecutive successes after ${tracking.totalTrialsCompleted} trials)`);
      this.successThreshold.experimentEndedEarly = true;
      return true;
    }

    return false;
  }

  /**
   * Check if we should continue to next trial
   */
  shouldContinueToNextTrial(experimentType, trialIndex) {
    // Only apply to collaboration games
    if (!experimentType.includes('2P')) {
      return trialIndex < CONFIG.game.experiments.numTrials[experimentType] - 1;
    }

    // Check if experiment should end due to success threshold
    if (this.shouldEndExperimentDueToSuccessThreshold()) {
      console.log(`Ending ${experimentType} experiment due to success threshold`);
      return false;
    }

    // Check if we've reached the configured number of trials
    if (trialIndex >= CONFIG.game.successThreshold.maxTrials - 1) {
      console.log(`Ending ${experimentType} experiment: Completed ${CONFIG.game.successThreshold.maxTrials} trials`);
      return false;
    }

    return true;
  }

  /**
   * Add next trial stages dynamically (similar to legacy addNextTrialStages)
   */
  addNextTrialStages(experimentType, experimentIndex, trialIndex) {
    // Find the current post-trial stage index
    const currentStageIndex = this.currentStageIndex;

    // Insert the next trial stages after the current post-trial stage
    const stagesToInsert = [
      {
        type: 'fixation',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: () => this.showFixationStage(experimentType, experimentIndex, trialIndex)
      },
      {
        type: 'trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: () => this.runTrialStage(experimentType, experimentIndex, trialIndex)
      },
      {
        type: 'post-trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: () => this.showPostTrialStage(experimentType, experimentIndex, trialIndex)
      }
    ];

    // Insert stages after current stage
    this.stages.splice(currentStageIndex + 1, 0, ...stagesToInsert);

    console.log(`Added next trial stages for ${experimentType} trial ${trialIndex + 1}`);
  }

  /**
   * Skip to next experiment or completion stage (similar to legacy)
   */
  skipToNextExperimentOrCompletion(currentExperimentType) {
    console.log(`Skipping to next experiment or completion from ${currentExperimentType}`);

    // Find the next stage that's either a different experiment or completion
    let nextStageIndex = this.currentStageIndex + 1;
    console.log(`Starting search from stage ${nextStageIndex}`);
    console.log(`Total stages in timeline: ${this.stages.length}`);

    while (nextStageIndex < this.stages.length) {
      const nextStage = this.stages[nextStageIndex];
      console.log(`Checking stage ${nextStageIndex}: ${nextStage.type}`);

      // If it's a different experiment type, game-feedback stage, questionnaire stage, or completion stage, stop here
      if (nextStage.type === 'game-feedback' ||
          nextStage.type === 'questionnaire' ||
          nextStage.type === 'completion' ||
          (nextStage.experimentType && nextStage.experimentType !== currentExperimentType)) {
        console.log(`Found stopping point: ${nextStage.type}`);
        break;
      }
      nextStageIndex++;
    }

    // Set the current stage to the found stage
    this.currentStageIndex = nextStageIndex;

    // If we found a valid next stage and it's a different experiment, reset success threshold
    if (this.currentStageIndex < this.stages.length) {
      const nextStage = this.stages[this.currentStageIndex];
      if (nextStage.experimentType && nextStage.experimentType !== currentExperimentType) {
        console.log(`Switching from ${currentExperimentType} to ${nextStage.experimentType} - resetting success threshold`);
        this.initializeSuccessThresholdTracking();
      }
      console.log(`Skipped to stage ${this.currentStageIndex}: ${nextStage.type}`);
      this.runCurrentStage();
    } else {
      console.log('No more stages to run');
    }
  }
}