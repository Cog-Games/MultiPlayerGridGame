// =================================================================================================
// NodeGame Experiments Helper Functions
// =================================================================================================
//
// This file contains utility functions and helpers for the NodeGame experiments.
// These functions are separated from the main experimental logic for better organization.
//
// =================================================================================================

// =================================================================================================
// GAME LOGIC HELPER FUNCTIONS
// =================================================================================================

/**
 * Setup grid matrix for a trial
 */
function setupGridMatrixForTrial(design, experimentType) {

    // Check if design is valid
    if (!design) {
        console.error('Invalid design provided to setupGridMatrixForTrial:', design);
        alert('Error: No map data available. Please refresh the page and try again.');
        return;
    }

    // Validate design properties
    if (!design.initPlayerGrid || !Array.isArray(design.initPlayerGrid) || design.initPlayerGrid.length < 2) {
        console.error('Invalid initPlayerGrid in design:', design);
        alert('Error: Invalid map data. Please refresh the page and try again.');
        return;
    }

    if (experimentType.includes('2P') && (!design.initAIGrid || !Array.isArray(design.initAIGrid) || design.initAIGrid.length < 2)) {
        console.error('Invalid initAIGrid in design for 2P experiment:', design);
        alert('Error: Invalid map data for 2P experiment. Please refresh the page and try again.');
        return;
    }

    if (!design.target1 || !Array.isArray(design.target1) || design.target1.length < 2) {
        console.error('Invalid target1 in design:', design);
        alert('Error: Invalid map data. Please refresh the page and try again.');
        return;
    }

    gameData.gridMatrix = Array(EXPSETTINGS.matrixsize).fill(0).map(() => Array(EXPSETTINGS.matrixsize).fill(0));

    // Add player1
    gameData.gridMatrix[design.initPlayerGrid[0]][design.initPlayerGrid[1]] = OBJECT.player;
    gameData.player1 = [...design.initPlayerGrid];

    // Add player2 if needed (AI or human)
    if (experimentType.includes('2P')) {
        gameData.gridMatrix[design.initAIGrid[0]][design.initAIGrid[1]] = OBJECT.ai_player;
        gameData.player2 = [...design.initAIGrid];
    } else {
        // For 1P experiments, ensure player2 is not set
        gameData.player2 = null;
    }

    // Add goals
    console.log('Setting up goals for experiment:', experimentType);
    console.log('Design object:', design);
    console.log('target1:', design.target1);
    console.log('target2:', design.target2);

    if (design.target1 && Array.isArray(design.target1) && design.target1.length >= 2) {
        gameData.gridMatrix[design.target1[0]][design.target1[1]] = OBJECT.goal;
        gameData.currentGoals = [design.target1];
        console.log('✅ Goal 1 set at:', design.target1);
    } else {
        console.error('❌ Invalid target1 in design:', design.target1);
        gameData.currentGoals = [];
    }

    // Add second goal if available
    if (design.target2 && Array.isArray(design.target2) && design.target2.length >= 2) {
        gameData.gridMatrix[design.target2[0]][design.target2[1]] = OBJECT.goal;
        gameData.currentGoals.push(design.target2);
        console.log('✅ Goal 2 set at:', design.target2);
    } else if (design.target2) {
        console.error('❌ Invalid target2 in design:', design.target2);
    }

    // Pre-calculate joint-RL policy for human-AI initial goals to eliminate first-move lag
    // Note: This is only needed for human-AI experiments, not human-human experiments
    if (experimentType.includes('2P') && window.RLAgent && window.RLAgent.precalculatePolicyForGoals) {
        console.log('⚡ Pre-calculating joint-RL policy for human-AI initial goals:', gameData.currentGoals.map(g => `[${g}]`).join(', '));

        // Pre-calculate in background immediately after grid setup
        setTimeout(() => {
            window.RLAgent.precalculatePolicyForGoals(gameData.currentGoals, experimentType);
        }, 0);
    }
}

/**
 * State transition function for grid movement
 * @param {Array} state - Current position [row, col]
 * @param {Array} action - Action to take [deltaRow, deltaCol]
 * @returns {Array} - New position [row, col]
 */
function transition(state, action) {
    let [x, y] = state;
    let nextState = [x+action[0],y+action[1]]
    return nextState
}

/**
 * Calculate grid distance between two positions (Manhattan distance)
 * @param {Array} pos1 - First position [row, col]
 * @param {Array} pos2 - Second position [row, col]
 * @returns {number} - Manhattan distance between positions
 */
function calculatetGirdDistance(pos1, pos2) {
    if (!pos1 || !pos2 || !Array.isArray(pos1) || !Array.isArray(pos2) ||
        pos1.length < 2 || pos2.length < 2) {
        return Infinity; // Return large distance for invalid positions
    }
    return Math.abs(pos1[0] - pos2[0]) + Math.abs(pos1[1] - pos2[1]);
}

/**
 * Check if a position is valid within the grid bounds
 * @param {Array} position - Position to check [row, col]
 * @returns {boolean} - True if position is valid
 */
function isValidPosition(position) {
    if (!position || !Array.isArray(position) || position.length < 2) {
        return false;
    }
    const [row, col] = position;
    return row >= 0 && row < EXPSETTINGS.matrixsize && col >= 0 && col < EXPSETTINGS.matrixsize;
}

/**
 * Check if a player has reached any goal
 * @param {Array} playerPos - Player position [row, col]
 * @param {Array} goals - Array of goal positions [[row, col], ...]
 * @returns {boolean} - True if player is at any goal
 */
function isGoalReached(playerPos, goals) {
    if (!playerPos || !goals || !Array.isArray(goals)) {
        return false;
    }

    for (let i = 0; i < goals.length; i++) {
        if (playerPos[0] === goals[i][0] && playerPos[1] === goals[i][1]) {
            return true;
        }
    }
    return false;
}

/**
 * Check which goal a player has reached
 * @param {Array} playerPos - Player position [row, col]
 * @param {Array} goals - Array of goal positions [[row, col], ...]
 * @returns {number|null} - Index of reached goal, or null if none reached
 */
function whichGoalReached(playerPos, goals) {
    for (var i = 0; i < goals.length; i++) {
        if (isGoalReached(playerPos, [goals[i]])) {
            return i;
        }
    }
    return null;
}

/**
 * Detect which goal a player is heading towards
 * @param {Array} playerPos - Current player position [row, col]
 * @param {Array|string} action - Action being taken (array or string)
 * @param {Array} goals - Array of goal positions [[row, col], ...]
 * @param {Array} goalHistory - History of previously inferred goals
 * @returns {number|null} - Index of goal being approached, or null if unclear
 */
function detectPlayerGoal(playerPos, action, goals, goalHistory) {
    if (!action) {
        return null;
    }

    // Convert string action to array format
    let actionArray;
    if (typeof action === 'string') {
        switch (action) {
            case 'up':
                actionArray = [-1, 0];
                break;
            case 'down':
                actionArray = [1, 0];
                break;
            case 'left':
                actionArray = [0, -1];
                break;
            case 'right':
                actionArray = [0, 1];
                break;
            default:
                return null;
        }
    } else if (Array.isArray(action)) {
        actionArray = action;
    } else {
        return null;
    }

    if (actionArray[0] === 0 && actionArray[1] === 0) {
        return null; // No movement, can't determine goal
    }

    var nextPos = transition(playerPos, actionArray);
    var minDistance = Infinity;
    var closestGoal = null;
    var equidistantGoals = [];

    for (var i = 0; i < goals.length; i++) {
        var distance = calculatetGirdDistance(nextPos, goals[i]);
        if (distance < minDistance) {
            minDistance = distance;
            closestGoal = i;
            equidistantGoals = [i]; // Reset equidistant goals
        } else if (distance === minDistance) {
            equidistantGoals.push(i); // Add to equidistant goals
        }
    }

    // If there are multiple equidistant goals, return last step's inferred goal
    if (equidistantGoals.length > 1) {
        if (goalHistory && goalHistory.length > 0) {
            return goalHistory[goalHistory.length - 1]; // Return last step's inferred goal
        } else {
            return null; // No prior goal history
        }
    }

    return closestGoal;
}

// =================================================================================================
// MAP AND DISTANCE CONDITION HELPER FUNCTIONS
// =================================================================================================

/**
 * Get maps for a specific experiment type
 * @param {string} experimentType - Type of experiment
 * @returns {Object} - Map data for the experiment
 */
function getMapsForExperiment(experimentType) {
    console.log(`🔍 Getting maps for experiment: ${experimentType}`);
    console.log(`🔍 Available global maps:`, {
        MapsFor1P1G: typeof window.MapsFor1P1G,
        MapsFor1P2G: typeof window.MapsFor1P2G,
        MapsFor2P2G: typeof window.MapsFor2P2G,
        MapsFor2P3G: typeof window.MapsFor2P3G
    });

    var mapData;
    switch (experimentType) {
        case '1P1G':
            mapData = window.MapsFor1P1G || MapsFor1P1G;
            break;
        case '1P2G':
            mapData = window.MapsFor1P2G || MapsFor1P2G;
            break;
        case '2P2G':
            mapData = window.MapsFor2P2G || MapsFor2P2G;
            break;
        case '2P3G':
            mapData = window.MapsFor2P3G || MapsFor2P3G;
            break;
        default:
            mapData = window.MapsFor1P1G || MapsFor1P1G;
            break;
    }

    console.log(`🔍 Returning map data for ${experimentType}:`, mapData);
    return mapData;
}

/**
 * Select random maps from map data
 */
function selectRandomMaps(mapData, nTrials) {
    if (!mapData || typeof mapData !== 'object') {
        console.error('Invalid map data provided:', mapData);
        return [];
    }

    var keys = Object.keys(mapData);

    if (keys.length === 0) {
        console.error('No keys found in map data');
        return [];
    }

    var selectedMaps = [];

    for (var i = 0; i < nTrials; i++) {
        var randomKey = keys[Math.floor(Math.random() * keys.length)];

        // Map data structure is: { "key": [{ designObject }] }
        // We need to get the first element of the array
        var mapArray = mapData[randomKey];

        if (Array.isArray(mapArray) && mapArray.length > 0) {
            var design = mapArray[0];
            selectedMaps.push(design); // Get the actual design object
        } else {
            console.error('Invalid map structure for key:', randomKey, mapArray);
        }
    }

    return selectedMaps;
}

/**
 * Get random map for collaboration games after trial 12
 * @param {string} experimentType - Type of experiment (2P2G or 2P3G)
 * @param {number} trialIndex - Current trial index
 * @returns {Object} - Random map design
 */
function getRandomMapForCollaborationGame(experimentType, trialIndex) {
    console.log(`🔍 Getting map for ${experimentType} trial ${trialIndex}`);

    // If we're past the random sampling threshold, use random sampling
    if (trialIndex >= NODEGAME_CONFIG.successThreshold.randomSamplingAfterTrial) {
        var mapData = getMapsForExperiment(experimentType);
        console.log(`Getting random map for ${experimentType} trial ${trialIndex + 1}, mapData:`, mapData);

        if (!mapData || Object.keys(mapData).length === 0) {
            console.error(`No map data available for ${experimentType}`);
            // Fallback to timeline map data if available
            if (timeline.mapData[experimentType] && timeline.mapData[experimentType].length > 0) {
                console.log(`Falling back to timeline map data for ${experimentType}`);
                return timeline.mapData[experimentType][0];
            }
            // If no fallback available, return null
            return null;
        }

        var randomMaps = selectRandomMaps(mapData, 1);
        console.log(`Selected random maps:`, randomMaps);

        if (!randomMaps || randomMaps.length === 0) {
            console.error(`No random maps selected for ${experimentType}`);
            return null;
        }

        console.log(`Using random map for ${experimentType} trial ${trialIndex + 1} (after trial ${NODEGAME_CONFIG.successThreshold.randomSamplingAfterTrial})`);
        console.log('Selected random map structure:', randomMaps[0]);
        return randomMaps[0];
    } else {
        // Use the pre-selected map from timeline
        console.log(`Using timeline map data for ${experimentType} trial ${trialIndex}`);
        console.log('Timeline map data:', timeline.mapData);
        console.log('Available experiment types:', Object.keys(timeline.mapData));

        if (!timeline.mapData[experimentType] || !timeline.mapData[experimentType][trialIndex]) {
            console.error(`No timeline map data available for ${experimentType} trial ${trialIndex}`);
            console.log('Timeline map data for this experiment:', timeline.mapData[experimentType]);
            return null;
        }

        var selectedDesign = timeline.mapData[experimentType][trialIndex];
        console.log('Selected design from timeline:', selectedDesign);
        return selectedDesign;
    }
}

/**
 * Calculate success rate for stats
 */
function calculateSuccessRate() {
    if (!window.gameData || !window.gameData.allTrialsData || window.gameData.allTrialsData.length === 0) return 0;

    var successful = window.gameData.allTrialsData.filter(trial =>
        trial.collaborationSucceeded === true || trial.completed === true
    ).length;

    return Math.round((successful / window.gameData.allTrialsData.length) * 100);
}

// =================================================================================================
// GLOBAL EXPORTS
// =================================================================================================

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Game logic helpers
        setupGridMatrixForTrial,
        transition,
        calculatetGirdDistance,
        isValidPosition,
        isGoalReached,
        whichGoalReached,
        detectPlayerGoal,

        // Map and distance condition helpers
        getMapsForExperiment,
        selectRandomMaps,
        getRandomMapForCollaborationGame
    };
}

// Global functions for easy access
window.NodeGameHelpers = {
    // Game logic helpers
    setupGridMatrixForTrial,
    transition,
    calculatetGirdDistance,
    isValidPosition,
    isGoalReached,
    whichGoalReached,
    detectPlayerGoal,

    // Map and distance condition helpers
    getMapsForExperiment,
    selectRandomMaps,
    getRandomMapForCollaborationGame
};