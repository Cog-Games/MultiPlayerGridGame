/**
 * Human-AI Version - Main Entry Point (Refactored)
 *
 * This file has been refactored to use modular components.
 * Game state, trial handlers, and data recording have been moved to separate modules.
 *
 * Dependencies:
 * - gameState.js - Game state and data management
 * - trialHandlers.js - Trial execution functions
 * - dataRecording.js - Data recording functions
 * - expDesign.js - Experimental design and success threshold logic
 * - gameHelpers.js - Game helper functions
 * - expTimeline.js - Timeline management functions
 * - All other existing dependencies (setup, viz, etc.)
 */

// Make imported functions globally available for non-module scripts
window.setupGridMatrixForTrial = setupGridMatrixForTrial;
window.transition = transition;
window.isValidPosition = isValidPosition;
window.isGoalReached = isGoalReached;
window.whichGoalReached = whichGoalReached;
window.detectPlayerGoal = detectPlayerGoal;
window.getMapsForExperiment = getMapsForExperiment;
window.generateRandomizedDistanceSequence = generateRandomizedDistanceSequence;
window.generateRandomized1P2GDistanceSequence = generateRandomized1P2GDistanceSequence;
window.selectRandomMaps = selectRandomMaps;
window.getRandomMapForCollaborationGame = getRandomMapForCollaborationGame;

// Make timeline-related functions globally available
window.addCollaborationExperimentStages = addCollaborationExperimentStages;
window.nextStage = nextStage;

/**
 * Initialize experiments
 */
function initializeNodeGameExperiments() {
    console.log('Initializing experiments...');

    // Ensure required dependencies are available
    if (typeof DIRECTIONS === 'undefined' || typeof OBJECT === 'undefined') {
        console.error('Required game dependencies not loaded');
        return false;
    }

    // Check if map data is available
    console.log('Checking map data availability...');
    var mapDataAvailable = true;
    var requiredMaps = ['MapsFor1P1G', 'MapsFor1P2G', 'MapsFor2P2G', 'MapsFor2P3G'];

    requiredMaps.forEach(function(mapName) {
        if (typeof window[mapName] === 'undefined') {
            console.error(`Map data not available: ${mapName}`);
            mapDataAvailable = false;
        } else {
            console.log(`Map data available: ${mapName} (${Object.keys(window[mapName]).length} maps)`);
        }
    });

    if (!mapDataAvailable) {
        console.error('Some map data is not available');
        return false;
    }

    console.log('Experiments ready');
    return true;
}

/**
 * Start a specific experiment
 */
function startNodeGameExperiment(experimentType) {
    // Always run in standalone mode
    console.log('Starting experiment in standalone mode:', experimentType);
    startStandaloneExperiment(experimentType);
}

/**
 * Start experiment in standalone mode
 */
function startStandaloneExperiment(experimentType) {
    try {
        // Clear any existing content
        document.getElementById('container').innerHTML = '';

        // Reset experiment state for continuous experiments
        gameData.currentTrial = 0;
        gameData.allTrialsData = [];

        // Initialize success threshold tracking
        window.ExpDesign.initializeSuccessThresholdTracking();

        // Enable automatic pre-calculation for joint-RL to eliminate lags
        if (window.RLAgent && window.RLAgent.enableAutoPolicyPrecalculation) {
            console.log('✅ Enabling automatic joint-RL policy pre-calculation');
            window.RLAgent.enableAutoPolicyPrecalculation();
        }

        // Initialize timeline
        timeline.currentStage = 0;

        // Create timeline stages for all experiments
        createTimelineStages();

        // Start timeline
        // console.log('Running continuous experiments');
        runNextStage();

    } catch (error) {
        console.error('Error starting experiment:', error);
    }
}

/**
 * Run the next stage in the timeline
 */
function runNextStage() {
    if (timeline.currentStage >= timeline.stages.length) {
        console.log('Timeline complete');
        return;
    }

    var stage = timeline.stages[timeline.currentStage];
    // console.log('Running stage:', stage.type, 'Index:', timeline.currentStage, 'Handler:', stage.handler.name);

    stage.handler(stage);
}

/**
 * Advance to the next stage
 */
function nextStage() {
    timeline.currentStage++;
    runNextStage();
}

/**
 * Check if should continue to next trial (wrapper function for compatibility)
 */
function shouldContinueToNextTrial(experimentType, trialIndex) {
    return window.ExpDesign.shouldContinueToNextTrial(experimentType, trialIndex);
}

// Global functions for easy access
window.NodeGameExperiments = {
    initialize: initializeNodeGameExperiments,
    start: startNodeGameExperiment,
};

