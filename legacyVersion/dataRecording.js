/**
 * Data Recording Module
 *
 * Handles all data recording and trial finalization logic.
 * Extracted from human-AI-version.js for better organization.
 */

/**
 * Record player1 move
 */
function recordPlayer1Move(action, reactionTime) {
    window.gameData.currentTrialData.player1Actions.push(action);
    window.gameData.currentTrialData.player1RT.push(reactionTime);
    window.gameData.currentTrialData.player1Trajectory.push([...window.gameData.player1]);
}

/**
 * Record player2 move (AI or human)
 */
function recordPlayer2Move(action, reactionTime = null) {
    window.gameData.currentTrialData.player2Actions.push(action);
    if (reactionTime !== null) {
        window.gameData.currentTrialData.player2RT = window.gameData.currentTrialData.player2RT || [];
        window.gameData.currentTrialData.player2RT.push(reactionTime);
    }
    // Record the trajectory after the move (new position)
    // This will be called after the player2 position is updated
    window.gameData.currentTrialData.player2Trajectory.push([...window.gameData.player2]);
}

/**
 * Record a move in multiplayer mode
 */
function recordMoveMultiPlayer(data) {
    if (!window.gameData.currentTrialData) {
        console.warn('No current trial data available');
        return;
    }

    console.log('=== RECORD MOVE DEBUG ===');
    console.log('Current experiment type:', window.gameData.currentExperiment);
    console.log('Move data:', data);
    console.log('myPlayerId:', window.myPlayerId);
    console.log('data.playerId:', data.playerId);

    // Determine which action belongs to the current player vs partner
    let currentPlayerAction = null;
    let partnerAction = null;

    if (data.playerId === window.myPlayerId) {
        // This move was made by the current player
        currentPlayerAction = data.action;
        partnerAction = null; // No partner action in this move
        console.log('Move was made by current player');
    } else {
        // This move was made by the partner
        currentPlayerAction = null; // Current player didn't move
        partnerAction = data.action;
        console.log('Move was made by partner');
    }

    console.log('currentPlayerAction:', currentPlayerAction);
    console.log('partnerAction:', partnerAction);

    // Record player move if current player made a move
    if (currentPlayerAction) {
        var reactionTime = data.reactionTime || 0;
        recordPlayerMove(currentPlayerAction, reactionTime);
    }

    // Record partner move if partner made a move
    if (partnerAction) {
        var reactionTime = data.reactionTime || 0;
        recordPartnerMove(partnerAction, reactionTime);
    }

    // Update step count
    window.gameData.stepCount++;
}

/**
 * Record player move
 */
function recordPlayerMove(action, reactionTime) {
    // Safety check: ensure currentTrialData exists and has required arrays
    if (!window.gameData.currentTrialData) {
        console.error('currentTrialData is not initialized - cannot record player move');
        return;
    }

    // Ensure required arrays exist
    if (!window.gameData.currentTrialData.aimAction) {
        console.warn('aimAction array not initialized, creating it');
        window.gameData.currentTrialData.aimAction = [];
    }
    if (!window.gameData.currentTrialData.RT) {
        console.warn('RT array not initialized, creating it');
        window.gameData.currentTrialData.RT = [];
    }
    if (!window.gameData.currentTrialData.trajectory) {
        console.warn('trajectory array not initialized, creating it');
        window.gameData.currentTrialData.trajectory = [];
    }

    // Record the move
    window.gameData.currentTrialData.aimAction.push(action);
    window.gameData.currentTrialData.RT.push(reactionTime);

    console.log(`Player move recorded: action=${action}, RT=${reactionTime}, aimAction length=${window.gameData.currentTrialData.aimAction.length}, RT length=${window.gameData.currentTrialData.RT.length}`);

    // Safety check: ensure currentPlayerPos is defined and is an array
    if (window.gameData.currentPlayerPos && Array.isArray(window.gameData.currentPlayerPos)) {
        window.gameData.currentTrialData.trajectory.push([...window.gameData.currentPlayerPos]);
    } else {
        console.warn('currentPlayerPos is not properly initialized:', window.gameData.currentPlayerPos);
        console.log('Available fallbacks:');
        console.log('  - playerStartPos:', window.gameData.playerStartPos);
        console.log('  - gameData.currentPlayerPos:', window.gameData.currentPlayerPos);
        console.log('  - gameData:', window.gameData);

        // Use playerStartPos as fallback if available
        if (window.gameData.playerStartPos && Array.isArray(window.gameData.playerStartPos)) {
            window.gameData.currentTrialData.trajectory.push([...window.gameData.playerStartPos]);
        } else {
            window.gameData.currentTrialData.trajectory.push([0, 0]); // Default fallback
        }
    }
}

/**
 * Record partner move
 */
function recordPartnerMove(action, reactionTime) {
    // Safety check: ensure currentTrialData exists and has required arrays
    if (!window.gameData.currentTrialData) {
        console.error('currentTrialData is not initialized - cannot record partner move');
        return;
    }

    // Ensure required arrays exist
    if (!window.gameData.currentTrialData.partnerAction) {
        console.warn('partnerAction array not initialized, creating it');
        window.gameData.currentTrialData.partnerAction = [];
    }
    if (!window.gameData.currentTrialData.partnerTrajectory) {
        console.warn('partnerTrajectory array not initialized, creating it');
        window.gameData.currentTrialData.partnerTrajectory = [];
    }
    if (!window.gameData.currentTrialData.partnerRT) {
        console.warn('partnerRT array not initialized, creating it');
        window.gameData.currentTrialData.partnerRT = [];
    }

    // Record the move and reaction time
    window.gameData.currentTrialData.partnerAction.push(action);
    window.gameData.currentTrialData.partnerRT.push(reactionTime);

    console.log(`Partner move recorded: action=${action}, RT=${reactionTime}, partnerAction length=${window.gameData.currentTrialData.partnerAction.length}, partnerRT length=${window.gameData.currentTrialData.partnerRT.length}`);

    // Safety check: ensure currentPartnerPos is defined and is an array
    if (window.gameData.currentPartnerPos && Array.isArray(window.gameData.currentPartnerPos)) {
        window.gameData.currentTrialData.partnerTrajectory.push([...window.gameData.currentPartnerPos]);
    } else {
        console.warn('currentPartnerPos is not properly initialized:', window.gameData.currentPartnerPos);
        console.log('Available fallbacks:');
        console.log('  - partnerStartPos:', window.gameData.partnerStartPos);
        console.log('  - gameData.currentPartnerPos:', window.gameData.currentPartnerPos);
        console.log('  - gameData:', window.gameData);

        // Use partnerStartPos as fallback if available
        if (window.gameData.partnerStartPos && Array.isArray(window.gameData.partnerStartPos)) {
            window.gameData.currentTrialData.partnerTrajectory.push([...window.gameData.partnerStartPos]);
        } else {
            window.gameData.currentTrialData.partnerTrajectory.push([0, 0]); // Default fallback
        }
    }
}

/**
 * Finalize trial data
 */
function finalizeTrial(completed) {
    window.gameData.currentTrialData.trialEndTime = Date.now();
    window.gameData.currentTrialData.trialDuration = window.gameData.currentTrialData.trialEndTime - window.gameData.currentTrialData.trialStartTime;
    window.gameData.currentTrialData.completed = completed;
    window.gameData.currentTrialData.stepCount = window.gameData.stepCount;

    // Determine if trial was successful for collaboration games
    var trialSuccess = false;
    if (window.gameData.currentExperiment && window.gameData.currentExperiment.includes('2P')) {
        // For collaboration games, success is based on collaboration
        trialSuccess = window.gameData.currentTrialData.collaborationSucceeded === true;
    } else {
        // For single player games, success is based on completion
        trialSuccess = completed;
    }

    // Update success threshold tracking for collaboration games
    window.ExpDesign.updateSuccessThresholdTracking(trialSuccess, window.gameData.currentTrial);

    window.gameData.allTrialsData.push({...window.gameData.currentTrialData});

    // Reset movement flags to prevent issues in next trial
    if (window.timeline) {
        window.timeline.isMoving = false;
        window.timeline.keyListenerActive = false;
    }

    console.log('Trial finalized:', window.gameData.currentTrialData);
    console.log(`Trial success: ${trialSuccess} (${window.gameData.currentExperiment})`);
}

// Export functions for module usage
window.DataRecording = {
    recordPlayer1Move: recordPlayer1Move,
    recordPlayer2Move: recordPlayer2Move,
    recordMoveMultiPlayer: recordMoveMultiPlayer,
    recordPlayerMove: recordPlayerMove,
    recordPartnerMove: recordPartnerMove,
    finalizeTrial: finalizeTrial
};