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

/**
 * Send Excel file to Google Drive
 */
function sendExcelToGoogleDrive(experimentData, questionnaireData, filename) {
    try {
        // Check if XLSX library is available
        if (typeof XLSX === 'undefined') {
            console.error('XLSX library not found. Please include the SheetJS library.');
            alert('Excel export requires the SheetJS library. Please refresh the page and try again.');
            return;
        }

        // Create a new workbook
        const wb = XLSX.utils.book_new();

        // Add experiment data sheet
        if (experimentData && experimentData.length > 0) {
            // Pre-process the data to handle complex objects and arrays
            const processedData = experimentData.map(trial => {
                const processedTrial = {};
                for (const key in trial) {
                    if (trial.hasOwnProperty(key)) {
                        let value = trial[key];
                        // Convert arrays and objects to JSON strings for Excel compatibility
                        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
                            processedTrial[key] = JSON.stringify(value);
                        } else if (value === null || value === undefined) {
                            processedTrial[key] = ''; // Keep empty for null/undefined
                        } else {
                            processedTrial[key] = value;
                        }
                    }
                }
                return processedTrial;
            });

            const experimentWS = XLSX.utils.json_to_sheet(processedData);
            XLSX.utils.book_append_sheet(wb, experimentWS, "Experiment Data");
        } else {
            // Create empty sheet with message
            const emptyWS = XLSX.utils.aoa_to_sheet([["No experiment data available - only questionnaire was run"]]);
            XLSX.utils.book_append_sheet(wb, emptyWS, "Experiment Data");
        }

        // Add questionnaire data sheet
        if (questionnaireData && questionnaireData.length > 1) {
            const questionnaireWS = XLSX.utils.aoa_to_sheet(questionnaireData);
            XLSX.utils.book_append_sheet(wb, questionnaireWS, "Questionnaire Data");
        } else {
            // Create empty questionnaire sheet
            const emptyQuestionnaireWS = XLSX.utils.aoa_to_sheet([["No questionnaire data available"]]);
            XLSX.utils.book_append_sheet(wb, emptyQuestionnaireWS, "Questionnaire Data");
        }

        // Convert workbook to binary array for sending to Google Drive
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        // Convert to base64 string for transmission
        const base64String = btoa(String.fromCharCode.apply(null, new Uint8Array(wbout)));

        // Create FormData to send file
        const formData = new FormData();
        formData.append('filename', filename);
        formData.append('filedata', base64String);
        formData.append('filetype', 'excel');

        // Send to Google Drive via Apps Script
        fetch("https://script.google.com/macros/s/AKfycbyfQ-XKsoFbmQZGM7c741rEXh2ZUpVK-uUIu9ycooXKnaxM5-hRSzIUhQ-uWZ668Qql/exec", {
            method: "POST",
            mode: "no-cors",  // Required for Google Apps Script from local files
            body: formData
        }).then(response => {
            console.log('Google Drive save successful');
            alert('Data saved successfully!');

            // Move to next stage after successful save
            if (typeof nextStage === 'function') {
                nextStage();
            }

        }).catch(error => {
            console.error('Error saving to Google Drive:', error);

            // Fallback: Download the file locally instead
            console.log('Google Drive save failed, falling back to local download...');
            downloadExcelFileLocally(wb, filename);

            // Still move to next stage even if Google Drive failed
            if (typeof nextStage === 'function') {
                nextStage();
            }
        });

    } catch (error) {
        console.error('Error creating Excel file for Google Drive:', error);

        // Fallback: Try to create and download file locally
        try {
            if (typeof XLSX !== 'undefined') {
                const wb = XLSX.utils.book_new();
                const emptyWS = XLSX.utils.aoa_to_sheet([["Error creating experiment data"], ["Error details:", error.message]]);
                XLSX.utils.book_append_sheet(wb, emptyWS, "Error Data");
                downloadExcelFileLocally(wb, filename);
            }
        } catch (fallbackError) {
            console.error('Fallback download also failed:', fallbackError);
        }

        alert('Error creating Excel file. Data will be downloaded locally instead.');
        if (typeof redirectToProlific === 'function') {
            redirectToProlific();
        }
    }
}

/**
 * Download Excel file locally as fallback when Google Drive fails
 */
function downloadExcelFileLocally(wb, filename) {
    try {
        // Convert workbook to blob
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('Excel file downloaded locally:', filename);
        alert('Data downloaded successfully! Please save this file.');
    } catch (error) {
        console.error('Error downloading Excel file locally:', error);
        alert('Error downloading data file. Please contact the experiment administrator.');
    }
}

/**
 * Convert questionnaire data to array format for Excel export
 */
function convertQuestionnaireToArray(questionnaireData) {
    if (!questionnaireData) {
        return [["No questionnaire data available"]];
    }

    try {
        // If questionnaireData is already an array, return it
        if (Array.isArray(questionnaireData)) {
            return questionnaireData;
        }

        // If it's an object, convert to array format
        if (typeof questionnaireData === 'object') {
            const array = [];

            // Add header row
            const headers = Object.keys(questionnaireData);
            array.push(headers);

            // Add data row
            const values = headers.map(header => questionnaireData[header]);
            array.push(values);

            return array;
        }

        // If it's a string, try to parse as JSON
        if (typeof questionnaireData === 'string') {
            try {
                const parsed = JSON.parse(questionnaireData);
                return convertQuestionnaireToArray(parsed);
            } catch (parseError) {
                return [["Questionnaire data (string):", questionnaireData]];
            }
        }

        // Fallback
        return [["Questionnaire data:", String(questionnaireData)]];
    } catch (error) {
        console.error('Error converting questionnaire data to array:', error);
        return [["Error converting questionnaire data:", error.message]];
    }
}

/**
 * Save data to Google Drive (matching jsPsych version)
 */
function saveDataToGoogleDrive() {
    try {
        // Get experiment data
        let experimentData = window.gameData.allTrialsData;

        // If no experiment data, create a placeholder
        if (!experimentData || experimentData.length === 0) {
            experimentData = [{
                trialIndex: 0,
                note: 'No experimental data collected - experiment may not have been completed',
                timestamp: new Date().toISOString()
            }];
        }

        // Convert questionnaire data to array format
        const questionnaireArray = convertQuestionnaireToArray(window.gameData.questionnaireData);

        // Create Excel file to send to Google Drive
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const excelFilename = `experiment_data_${timestamp}.xlsx`;

        sendExcelToGoogleDrive(experimentData, questionnaireArray, excelFilename);

    } catch (error) {
        console.error('Error in saveDataToGoogleDrive:', error);
        alert('Error saving data to Google Drive. Please try again.');
    }
}

// Export functions for module usage
window.DataRecording = {
    recordPlayer1Move: recordPlayer1Move,
    recordPlayer2Move: recordPlayer2Move,
    recordMoveMultiPlayer: recordMoveMultiPlayer,
    recordPlayerMove: recordPlayerMove,
    recordPartnerMove: recordPartnerMove,
    finalizeTrial: finalizeTrial,
    sendExcelToGoogleDrive: sendExcelToGoogleDrive,
    downloadExcelFileLocally: downloadExcelFileLocally,
    convertQuestionnaireToArray: convertQuestionnaireToArray,
    saveDataToGoogleDrive: saveDataToGoogleDrive
};