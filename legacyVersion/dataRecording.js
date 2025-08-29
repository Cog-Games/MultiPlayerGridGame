/**
 * Data Recording Module
 *
 * Handles all data recording and trial finalization logic.
 * Extracted from human-AI-version.js for better organization.
 */

// Participant ID storage
var participantId = null;

/**
 * Extract Prolific participant ID from URL parameters
 */
function extractProlificId() {
    const urlParams = new URLSearchParams(window.location.search);
    const prolificPid = urlParams.get('PROLIFIC_PID') || urlParams.get('prolific_pid');
    
    if (prolificPid) {
        participantId = prolificPid;
        console.log('Prolific participant ID extracted:', participantId);
        return participantId;
    } else {
        console.warn('No PROLIFIC_PID found in URL parameters');
        // For testing/development, generate a test ID
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            participantId = 'TEST_' + Math.random().toString(36).substr(2, 9);
            console.log('Generated test participant ID:', participantId);
            return participantId;
        }
        return null;
    }
}

/**
 * Get current participant ID
 */
function getParticipantId() {
    if (!participantId) {
        extractProlificId();
    }
    return participantId;
}

/**
 * Validate that participant ID exists
 */
function validateParticipantId() {
    const id = getParticipantId();
    if (!id) {
        console.error('No participant ID available - experiment cannot proceed');
        return false;
    }
    return true;
}

/**
 * Record player1 move
 */
function recordPlayer1Move(action, reactionTime) {
    gameData.currentTrialData.player1Actions.push(action);
    gameData.currentTrialData.player1RT.push(reactionTime);
    gameData.currentTrialData.player1Trajectory.push([...gameData.player1]);
}

/**
 * Record player2 move (AI or human)
 */
function recordPlayer2Move(action, reactionTime = null) {
    gameData.currentTrialData.player2Actions.push(action);
    if (reactionTime !== null) {
        gameData.currentTrialData.player2RT = gameData.currentTrialData.player2RT || [];
        gameData.currentTrialData.player2RT.push(reactionTime);
    }
    // Record the trajectory after the move (new position)
    // This will be called after the player2 position is updated
    gameData.currentTrialData.player2Trajectory.push([...gameData.player2]);
}

/**
 * Finalize trial data
 */
function finalizeTrial(completed) {
    gameData.currentTrialData.trialEndTime = Date.now();
    gameData.currentTrialData.trialDuration = gameData.currentTrialData.trialEndTime - gameData.currentTrialData.trialStartTime;
    gameData.currentTrialData.completed = completed;
    gameData.currentTrialData.stepCount = gameData.stepCount;

    // Determine if trial was successful for collaboration games
    var trialSuccess = false;
    if (gameData.currentExperiment && gameData.currentExperiment.includes('2P')) {
        // For collaboration games, success is based on collaboration
        trialSuccess = gameData.currentTrialData.collaborationSucceeded === true;
    } else {
        // For single player games, success is based on completion
        trialSuccess = completed;
    }

    // Update success threshold tracking for collaboration games
    window.ExpDesign.updateSuccessThresholdTracking(trialSuccess, gameData.currentTrial);

    gameData.allTrialsData.push({...gameData.currentTrialData});

    // Reset movement flags to prevent issues in next trial
    timeline.isMoving = false;
    timeline.keyListenerActive = false;

    console.log('Trial finalized:', gameData.currentTrialData);
    console.log(`Trial success: ${trialSuccess} (${gameData.currentExperiment})`);
}

// Export functions for module usage
window.DataRecording = {
    recordPlayer1Move: recordPlayer1Move,
    recordPlayer2Move: recordPlayer2Move,
    finalizeTrial: finalizeTrial,
    extractProlificId: extractProlificId,
    getParticipantId: getParticipantId,
    validateParticipantId: validateParticipantId
};