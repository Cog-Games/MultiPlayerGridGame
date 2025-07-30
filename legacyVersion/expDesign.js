/**
 * Experimental Design Functions
 *
 * This file contains functions related to experimental design, goal generation,
 * and trial management that can be shared across different experiment types.
 *
 * Dependencies:
 * - experimentConfig.js (for TWOP3G_CONFIG, ONEP2G_CONFIG)
 * - utils.js (for calculatetGirdDistance)
 * - setup.js (for EXPSETTINGS, OBJECT)
 */

/**
 * Generate randomized distance condition sequence for 2P3G trials
 * Ensures equal representation of each condition in random order
 * @param {number} numTrials - Number of 2P3G trials
 * @returns {Array} - Randomized array of distance conditions
 */
function generateRandomizedDistanceSequence(numTrials) {
    var allConditions = [
        TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2,
        TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1,
        TWOP3G_CONFIG.distanceConditions.EQUAL_TO_BOTH,
        TWOP3G_CONFIG.distanceConditions.NO_NEW_GOAL
    ];

    var numConditions = allConditions.length;
    var trialsPerCondition = Math.floor(numTrials / numConditions);
    var remainingTrials = numTrials % numConditions;

    // Create array with equal representation of each condition
    var sequence = [];
    for (var i = 0; i < numConditions; i++) {
        for (var j = 0; j < trialsPerCondition; j++) {
            sequence.push(allConditions[i]);
        }
    }

    // Add remaining trials (if any) by cycling through conditions
    for (var k = 0; k < remainingTrials; k++) {
        sequence.push(allConditions[k]);
    }

    // Shuffle the sequence using Fisher-Yates algorithm
    for (var m = sequence.length - 1; m > 0; m--) {
        var randomIndex = Math.floor(Math.random() * (m + 1));
        var temp = sequence[m];
        sequence[m] = sequence[randomIndex];
        sequence[randomIndex] = temp;
    }

    console.log('Generated randomized distance condition sequence for', numTrials, 'trials:');
    console.log('Trials per condition:', trialsPerCondition, 'Remaining trials:', remainingTrials);
    console.log('Sequence:', sequence);

    return sequence;
}

/**
 * Generate randomized distance condition sequence for 1P2G trials
 * Ensures equal representation of each condition in random order
 * @param {number} numTrials - Number of 1P2G trials
 * @returns {Array} - Randomized array of distance conditions
 */
function generateRandomized1P2GDistanceSequence(numTrials) {
    var allConditions = [
        ONEP2G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1,
        ONEP2G_CONFIG.distanceConditions.FARTHER_TO_PLAYER1,
        ONEP2G_CONFIG.distanceConditions.EQUAL_TO_PLAYER1,
        ONEP2G_CONFIG.distanceConditions.NO_NEW_GOAL
    ];

    var numConditions = allConditions.length;
    var trialsPerCondition = Math.floor(numTrials / numConditions);
    var remainingTrials = numTrials % numConditions;

    // Create array with equal representation of each condition
    var sequence = [];
    for (var i = 0; i < numConditions; i++) {
        for (var j = 0; j < trialsPerCondition; j++) {
            sequence.push(allConditions[i]);
        }
    }

    // Add remaining trials (if any) by cycling through conditions
    for (var k = 0; k < remainingTrials; k++) {
        sequence.push(allConditions[k]);
    }

    // Shuffle the sequence using Fisher-Yates algorithm
    for (var m = sequence.length - 1; m > 0; m--) {
        var randomIndex = Math.floor(Math.random() * (m + 1));
        var temp = sequence[m];
        sequence[m] = sequence[randomIndex];
        sequence[randomIndex] = temp;
    }
    // console.log('Generated randomized distance condition sequence for', numTrials, 'trials:');
    // console.log('Trials per condition:', trialsPerCondition, 'Remaining trials:', remainingTrials);
    console.log('Sequence:', sequence);
    return sequence;
}

// =================================================================================================
// 2P3G Functions - Experimental Design Logic
// =================================================================================================

// Global variables for 2P3G goal tracking (matching original)
var humanInferredGoals = [];
var aiInferredGoals = [];
var newGoalPresented = false;
var newGoalPosition = null;
var isNewGoalCloserToAI = null;

/**
 * Get distance condition for a specific trial (helper function)
 * @param {number} trialIndex - Trial index (0-based)
 * @returns {string|null} - Distance condition for the trial, or null if not available
 */
function getDistanceCondition(trialIndex) {
    if (!TWOP3G_CONFIG.distanceConditionSequence || trialIndex >= TWOP3G_CONFIG.distanceConditionSequence.length) {
        return null;
    }
    return TWOP3G_CONFIG.distanceConditionSequence[trialIndex];
}

/**
 * Set a custom distance condition sequence (for testing or manual control)
 * @param {Array} newSequence - Array of distance conditions
 */
function setDistanceConditionSequence(newSequence) {
    TWOP3G_CONFIG.distanceConditionSequence = newSequence;
}

/**
 * Generate new goal with sophisticated constraints based on distance condition
 * @param {Array} player2Pos - Player2 position (AI or human partner) [row, col]
 * @param {Array} player1Pos - Player1 position (human player) [row, col]
 * @param {Array} oldGoals - Array of existing goal positions
 * @param {number} player2CurrentGoalIndex - Index of player2's current goal in oldGoals array
 * @param {string} distanceCondition - Distance condition type ('closer_to_player2', 'closer_to_player1', 'equal_to_both', 'no_new_goal')
 * @returns {Object|null} - Object with position and metadata, or null if no goal generated
 */
function generateNewGoal(player2Pos, player1Pos, oldGoals, player2CurrentGoalIndex, distanceCondition) {
    // Check if no new goal should be generated
    if (distanceCondition === TWOP3G_CONFIG.distanceConditions.NO_NEW_GOAL) {
        return null;
    }

    if (player2CurrentGoalIndex === null || player2CurrentGoalIndex >= oldGoals.length) {
        return null;
    }

    var player2CurrentGoal = oldGoals[player2CurrentGoalIndex];
    var oldDistanceSum = calculatetGirdDistance(player2Pos, player2CurrentGoal) +
                        calculatetGirdDistance(player1Pos, player2CurrentGoal);

    // Find all valid positions for the new goal based on distance condition
    var validPositions = [];
    for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
        for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
            var newGoal = [row, col];

            // Check if position is not occupied by players or obstacles
            if (gameData.gridMatrix[row][col] === OBJECT.blank || gameData.gridMatrix[row][col] === OBJECT.goal) {
                var newGoalDistanceToPlayer2 = calculatetGirdDistance(player2Pos, newGoal);
                var newGoalDistanceToPlayer1 = calculatetGirdDistance(player1Pos, newGoal);
                var newDistanceSum = newGoalDistanceToPlayer2 + newGoalDistanceToPlayer1;

                var player2DistanceToOldGoal = calculatetGirdDistance(player2Pos, player2CurrentGoal);
                var player1DistanceToOldGoal = calculatetGirdDistance(player1Pos, player2CurrentGoal);

                // Basic constraints that apply to all conditions
                var sumConstraint = TWOP3G_CONFIG.goalConstraints.maintainDistanceSum ?
                    Math.abs(newDistanceSum - oldDistanceSum) < 0.1 : true;
                var blockingConstraint = TWOP3G_CONFIG.goalConstraints.blockPathCheck ?
                    !isGoalBlockingPath(player1Pos, newGoal, oldGoals) : true;
                var rectangleConstraint = TWOP3G_CONFIG.goalConstraints.avoidRectangleArea ?
                    !isInRectangleBetween(newGoal, player2Pos, player2CurrentGoal) : true;
                var player1DistanceConstraint = newGoalDistanceToPlayer1 >= TWOP3G_CONFIG.goalConstraints.minDistanceFromHuman &&
                                            newGoalDistanceToPlayer1 <= TWOP3G_CONFIG.goalConstraints.maxDistanceFromHuman;

                // Distance condition-specific constraints
                var distanceConditionMet = false;
                var conditionType = '';

                switch (distanceCondition) {
                    case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2:
                        // New goal closer to player2, equal joint distance
                        distanceConditionMet = newGoalDistanceToPlayer2 < player2DistanceToOldGoal - TWOP3G_CONFIG.distanceConstraint.closerThreshold &&
                                             Math.abs(newDistanceSum - oldDistanceSum) < 0.1;
                        conditionType = 'closer_to_player2';
                        break;

                    case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
                        // New goal closer to player1, equal joint distance
                        distanceConditionMet = newGoalDistanceToPlayer1 < player1DistanceToOldGoal - TWOP3G_CONFIG.distanceConstraint.closerThreshold &&
                                             Math.abs(newDistanceSum - oldDistanceSum) < 0.1;
                        conditionType = 'closer_to_player1';
                        break;

                    case TWOP3G_CONFIG.distanceConditions.EQUAL_TO_BOTH:
                        // New goal equal distance to both player1 and player2, equal joint distance
                        var distanceDifference = Math.abs(newGoalDistanceToPlayer2 - newGoalDistanceToPlayer1);
                        distanceConditionMet = distanceDifference < 0.1 && // Equal distance to both players
                                             Math.abs(newDistanceSum - oldDistanceSum) < 0.1; // Equal sum distance
                        conditionType = 'equal_to_both';
                        break;

                    default:
                        return null;
                }

                if (distanceConditionMet && sumConstraint && blockingConstraint && rectangleConstraint && player1DistanceConstraint) {
                    validPositions.push({
                        position: newGoal,
                        conditionType: conditionType,
                        distanceToPlayer2: newGoalDistanceToPlayer2,
                        distanceToPlayer1: newGoalDistanceToPlayer1,
                        distanceSum: newDistanceSum
                    });
                }
            }
        }
    }

    // Return a random valid position, or null if none found
    console.log('generateNewGoal: Found', validPositions.length, 'valid positions');
    if (validPositions.length > 0) {
        var selectedGoalData = validPositions[Math.floor(Math.random() * validPositions.length)];
        console.log('generateNewGoal: Selected position:', selectedGoalData.position);
        return {
            position: selectedGoalData.position,
            conditionType: selectedGoalData.conditionType,
            distanceToPlayer2: selectedGoalData.distanceToPlayer2,
            distanceToPlayer1: selectedGoalData.distanceToPlayer1,
            distanceSum: selectedGoalData.distanceSum
        };
    }

    var relaxedValidPositions = [];
    for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
        for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
            var newGoal = [row, col];

            // Only check basic constraints: not occupied and reasonable distance from human
            if (gameData.gridMatrix[row][col] === OBJECT.blank || gameData.gridMatrix[row][col] === OBJECT.goal) {
                var newGoalDistanceToPlayer2 = calculatetGirdDistance(player2Pos, newGoal);
                var newGoalDistanceToPlayer1 = calculatetGirdDistance(player1Pos, newGoal);
                var newDistanceSum = newGoalDistanceToPlayer2 + newGoalDistanceToPlayer1;

                // Relaxed constraints: maintain equal sum but with larger tolerance
                var player1DistanceOk = newGoalDistanceToPlayer1 >= 1; // Minimum 1 distance from player1
                var relaxedSumConstraint = Math.abs(newDistanceSum - oldDistanceSum) <= 1; // More relaxed tolerance for sum
                var distanceConditionMet = false;

                switch (distanceCondition) {
                    case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2:
                        // Require new goal to be closer to player2 AND maintain approximately equal sum
                        distanceConditionMet = newGoalDistanceToPlayer2 < calculatetGirdDistance(player2Pos, player2CurrentGoal) && relaxedSumConstraint;
                        break;

                    case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
                        // Require new goal to be closer to player1 AND maintain approximately equal sum
                        distanceConditionMet = newGoalDistanceToPlayer1 < calculatetGirdDistance(player1Pos, player2CurrentGoal) && relaxedSumConstraint;
                        break;

                    case TWOP3G_CONFIG.distanceConditions.EQUAL_TO_BOTH:
                        // Allow larger tolerance for equal distance but still maintain equal sum
                        var distanceDifference = Math.abs(newGoalDistanceToPlayer2 - newGoalDistanceToPlayer1);
                        distanceConditionMet = distanceDifference <= 2 && relaxedSumConstraint; // More relaxed tolerance
                        break;

                    default:
                        distanceConditionMet = relaxedSumConstraint; // At minimum, maintain approximately equal sum
                        break;
                }

                if (player1DistanceOk && distanceConditionMet) {
                    relaxedValidPositions.push({
                        position: newGoal,
                        conditionType: distanceCondition,
                        distanceToPlayer2: newGoalDistanceToPlayer2,
                        distanceToPlayer1: newGoalDistanceToPlayer1,
                        distanceSum: newDistanceSum
                    });
                }
            }
        }
    }

    console.log('generateNewGoal: Found', relaxedValidPositions.length, 'relaxed valid positions');
    if (relaxedValidPositions.length > 0) {
        var selectedRelaxedGoalData = relaxedValidPositions[Math.floor(Math.random() * relaxedValidPositions.length)];
        console.log('generateNewGoal: Selected relaxed position:', selectedRelaxedGoalData.position);
        return {
            position: selectedRelaxedGoalData.position,
            conditionType: selectedRelaxedGoalData.conditionType,
            distanceToPlayer2: selectedRelaxedGoalData.distanceToPlayer2,
            distanceToPlayer1: selectedRelaxedGoalData.distanceToPlayer1,
            distanceSum: selectedRelaxedGoalData.distanceSum
        };
    }

    return null;
}

/**
 * Check if a new goal would block the path from human to the goal (matching original)
 */
function isGoalBlockingPath(player1Pos, newGoal, existingGoals) {
    // Check if the new goal is directly adjacent to the player1
    // If so, it might block movement (though goals are passable, this could cause issues)
    var distanceToPlayer1 = calculatetGirdDistance(player1Pos, newGoal);
    if (distanceToPlayer1 <= 1) {
        return true; // Too close, might cause blocking issues
    }

    // Check if the new goal is in a position that would make it impossible to reach
    // by creating a "dead end" situation
    var hasValidPath = false;

    // Check if there's at least one valid path to the goal (not blocked by other goals)
    for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
        for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
            var testPos = [row, col];
            if (gameData.gridMatrix[row][col] === OBJECT.blank) {
                var pathToGoal = calculatetGirdDistance(testPos, newGoal);
                var pathFromPlayer1 = calculatetGirdDistance(player1Pos, testPos);
                var totalPath = pathFromPlayer1 + pathToGoal;

                // If this path is reasonable and doesn't go through other goals
                if (totalPath <= distanceToPlayer1 + 2) { // Allow some flexibility
                    var pathBlocked = false;
                    for (var i = 0; i < existingGoals.length; i++) {
                        if (calculatetGirdDistance(testPos, existingGoals[i]) <= 1) {
                            pathBlocked = true;
                            break;
                        }
                    }
                    if (!pathBlocked) {
                        hasValidPath = true;
                        break;
                    }
                }
            }
        }
        if (hasValidPath) break;
    }

    return !hasValidPath; // Return true if no valid path exists
}

/**
 * Check if a position is in the rectangular area between two points (matching original)
 */
function isInRectangleBetween(position, point1, point2) {
    var posRow = position[0];
    var posCol = position[1];
    var p1Row = point1[0];
    var p1Col = point1[1];
    var p2Row = point2[0];
    var p2Col = point2[1];

    // Define the rectangular area boundaries
    var minRow = Math.min(p1Row, p2Row);
    var maxRow = Math.max(p1Row, p2Row);
    var minCol = Math.min(p1Col, p2Col);
    var maxCol = Math.max(p1Col, p2Col);

    // Check if the position is within the rectangular area (inclusive of boundaries)
    return (posRow >= minRow && posRow <= maxRow && posCol >= minCol && posCol <= maxCol);
}

/**
 * Check for new goal presentation - Unified version supporting both human-AI and human-human modes
 * @param {Object} [options={}] - Configuration options for different experiment versions
 * @param {Function} [options.callback] - Callback function after goal presentation
 * @param {boolean} [options.isHumanHuman] - Whether this is human-human mode (vs human-AI)
 * @param {Function} [options.serverRequestHandler] - Handler for server-side goal generation (human-human mode)
 * @param {Function} [options.displayUpdater] - Custom display update function
 */
function checkNewGoalPresentation2P3G(options) {
    // Handle both old callback-only signature and new options signature
    if (typeof options === 'function') {
        options = { callback: options };
    }
    options = options || {};

    // Only proceed if this is actually a 2P3G experiment
    if (gameData.currentExperiment !== '2P3G') {
        return;
    }

    // Detect version automatically if not specified
    var isHumanHuman = options.isHumanHuman;
    if (isHumanHuman === undefined) {
        // Auto-detect based on available data structures
        isHumanHuman = (typeof socket !== 'undefined' && socket &&
                       gameData.currentTrialData.player1CurrentGoal !== undefined) ||
                      (gameData.multiplayer && gameData.multiplayer.myPlayerId);
    }

    console.log('Detected mode:', isHumanHuman ? 'Human-Human' : 'Human-AI');

    // Get goal tracking arrays based on version
    var player1Goals, player2Goals, player1InferredGoals, player2InferredGoals;

    if (!gameData.currentTrialData.player1CurrentGoal) {
        gameData.currentTrialData.player1CurrentGoal = [];
        gameData.currentTrialData.player2CurrentGoal = [];
        if (typeof window !== 'undefined') {
            window.player1InferredGoals = window.player1InferredGoals || [];
            window.player2InferredGoals = window.player2InferredGoals || [];
        }
    }
    player1Goals = gameData.currentTrialData.player1CurrentGoal;
    player2Goals = gameData.currentTrialData.player2CurrentGoal;
    player1InferredGoals = (typeof window !== 'undefined') ? window.player1InferredGoals : [];
    player2InferredGoals = (typeof window !== 'undefined') ? window.player2InferredGoals : [];

    // Check minimum steps requirement
    if (gameData.stepCount < TWOP3G_CONFIG.minStepsBeforeNewGoal) {
        console.log('Minimum steps not met:', gameData.stepCount, '<', TWOP3G_CONFIG.minStepsBeforeNewGoal);
        return;
    }

    // Get current goals for both players
    var player1CurrentGoal = player1Goals.length > 0 ?
        player1Goals[player1Goals.length - 1] : null;
    var player2CurrentGoal = player2Goals.length > 0 ?
        player2Goals[player2Goals.length - 1] : null;

    console.log('Current goals - Player1:', player1CurrentGoal, 'Player2:', player2CurrentGoal);
    console.log('New goal presented (local):', (typeof newGoalPresented !== 'undefined') ? newGoalPresented : 'undefined');
    console.log('New goal presented (window):', (typeof window.newGoalPresented !== 'undefined') ? window.newGoalPresented : 'undefined');
    console.log('New goal presented (trial data):', gameData.currentTrialData.newGoalPresented);
    console.log('Goal arrays - Player1:', player1Goals, 'Player2:', player2Goals);
    console.log('Step count:', gameData.stepCount, 'Min required:', TWOP3G_CONFIG.minStepsBeforeNewGoal);

    // Check if both players are heading to the same goal and new goal hasn't been presented yet
    console.log('Condition check:');
    console.log('  - Player1 goal null?', player1CurrentGoal === null);
    console.log('  - Player2 goal null?', player2CurrentGoal === null);
    console.log('  - Goals same?', player1CurrentGoal === player2CurrentGoal);
    console.log('  - Already presented (local)?', (typeof newGoalPresented !== 'undefined') ? newGoalPresented : 'undefined');
    console.log('  - Already presented (window)?', (typeof window.newGoalPresented !== 'undefined') ? window.newGoalPresented : 'undefined');
    console.log('  - Already presented (trial data)?', gameData.currentTrialData.newGoalPresented);

    // Check if new goal has already been presented (check all possible sources)
    var alreadyPresented = (typeof newGoalPresented !== 'undefined' && newGoalPresented) ||
                          (typeof window.newGoalPresented !== 'undefined' && window.newGoalPresented) ||
                          (gameData.currentTrialData.newGoalPresented === true);

    if (player1CurrentGoal !== null && player2CurrentGoal !== null &&
        player1CurrentGoal === player2CurrentGoal &&
        !alreadyPresented) {

        console.log('=== BOTH PLAYERS HEADING TO SAME GOAL ===');
        console.log('Shared goal index:', player1CurrentGoal);

        // Get player positions based on version
        var player1Pos, player2Pos;
        if (isHumanHuman) {
            player1Pos = gameData.currentPlayerPos;
            player2Pos = gameData.currentPartnerPos;
        } else {
            player1Pos = gameData.player1;
            player2Pos = gameData.player2;
        }

        console.log('Player positions - Player1:', player1Pos, 'Player2:', player2Pos);

        // Handle server-side goal generation for human-human mode
        if (isHumanHuman && options.serverRequestHandler &&
            typeof socket !== 'undefined' && socket && gameData.currentPartnerPos) {

            console.log('=== USING SERVER-SIDE GOAL GENERATION ===');

            // Get or generate distance condition
            var distanceCondition = gameData.currentTrialData.distanceCondition;

            if (!distanceCondition) {
                // Try to get the function from various sources
                var getRandomDistanceCondition = window.getRandomDistanceConditionFor2P3G ||
                                               (window.GameState && window.GameState.getRandomDistanceConditionFor2P3G) ||
                                               function(trialIndex) {
                                                   // Fallback: return a default condition
                                                   console.warn('getRandomDistanceConditionFor2P3G not available, using fallback');
                                                   return TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2;
                                               };
                distanceCondition = getRandomDistanceCondition(gameData.currentTrial);
                gameData.currentTrialData.distanceCondition = distanceCondition;
                console.log('Generated distance condition:', distanceCondition);
            }

            // Map distance conditions to server format
            var serverDistanceCondition = mapDistanceConditionToServer(distanceCondition);
            console.log('Mapped distance condition:', distanceCondition, '->', serverDistanceCondition);

            // Call the server request handler
            options.serverRequestHandler({
                sharedGoalIndex: player1CurrentGoal,
                stepCount: gameData.stepCount,
                trialIndex: gameData.currentTrialIndex || gameData.currentTrial,
                player1Pos: player1Pos,
                player2Pos: player2Pos,
                currentGoals: gameData.currentGoals,
                distanceCondition: serverDistanceCondition
            });

            console.log('=== SERVER REQUEST SENT VIA HANDLER ===');
            return; // Server will handle the rest
        }

        // Local goal generation (human-AI mode or human-human fallback)
        console.log('=== USING LOCAL GOAL GENERATION ===');

        // Get distance condition for this trial
        var distanceCondition = gameData.currentTrialData.distanceCondition;

        console.log('Using distance condition:', distanceCondition);

        // Generate new goal using current positions and distance condition
        var newGoalResult = generateNewGoal(player2Pos, player1Pos, gameData.currentGoals, player1CurrentGoal, distanceCondition);

        console.log('generateNewGoal result:', newGoalResult);
        console.log('Parameters passed to generateNewGoal:');
        console.log('  - player2Pos:', player2Pos);
        console.log('  - player1Pos:', player1Pos);
        console.log('  - currentGoals:', gameData.currentGoals);
        console.log('  - player1CurrentGoal (index):', player1CurrentGoal);
        console.log('  - distanceCondition:', distanceCondition);

        if (newGoalResult) {
            console.log('=== NEW GOAL GENERATED LOCALLY ===');

            // Set global variables for compatibility
            if (typeof window !== 'undefined') {
                if (isHumanHuman) {
                    window.isNewGoalCloserToPlayer2 = newGoalResult.conditionType === TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2;
                    window.newGoalPosition = newGoalResult.position;
                    window.newGoalPresented = true;
                } else {
                    window.isNewGoalCloserToPlayer2 = newGoalResult.conditionType === TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2;
                    window.newGoalPosition = newGoalResult.position;
                    window.newGoalPresented = true;
                }
            }

            // Set local variable and trial data flag
            newGoalPresented = true;
            gameData.currentTrialData.newGoalPresented = true;

            // Add new goal to the grid and goals list
            var goalValue = (typeof OBJECT !== 'undefined') ? OBJECT.goal : 2;
            gameData.gridMatrix[newGoalResult.position[0]][newGoalResult.position[1]] = goalValue;
            gameData.currentGoals.push(newGoalResult.position);

            // Reset pre-calculation flag for AI version
            if (!isHumanHuman && window.RLAgent && window.RLAgent.resetNewGoalPreCalculationFlag) {
                window.RLAgent.resetNewGoalPreCalculationFlag();
            }

            // Record in trial data with proper naming based on version
            if (isHumanHuman) {
                gameData.currentTrialData.isNewGoalCloserToPlayer2 = newGoalResult.conditionType === TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2;
                gameData.currentTrialData.newGoalDistanceToPlayer1 = newGoalResult.distanceToPlayer1;
                gameData.currentTrialData.newGoalDistanceToPlayer2 = newGoalResult.distanceToPlayer2;
            } else {
                gameData.currentTrialData.isNewGoalCloserToPlayer2 = newGoalResult.conditionType === TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2;
                gameData.currentTrialData.newGoalDistanceToPlayer1 = newGoalResult.distanceToPlayer1;
                gameData.currentTrialData.newGoalDistanceToPlayer2 = newGoalResult.distanceToPlayer2;
            }

            // Common trial data
            gameData.currentTrialData.newGoalPresentedTime = gameData.stepCount;
            gameData.currentTrialData.newGoalPosition = newGoalResult.position;
            gameData.currentTrialData.newGoalConditionType = newGoalResult.conditionType;
            gameData.currentTrialData.newGoalDistanceSum = newGoalResult.distanceSum;

            // Calculate and record distances to old goal
            if (gameData.currentGoals && gameData.currentGoals[player1CurrentGoal]) {
                var oldGoal = gameData.currentGoals[player1CurrentGoal];
                var distance1ToOldGoal = calculatetGirdDistance(player1Pos, oldGoal);
                var distance2ToOldGoal = calculatetGirdDistance(player2Pos, oldGoal);

                if (isHumanHuman) {
                    gameData.currentTrialData.player1DistanceToOldGoal = distance1ToOldGoal;
                    gameData.currentTrialData.player2DistanceToOldGoal = distance2ToOldGoal;
                } else {
                    gameData.currentTrialData.humanDistanceToOldGoal = distance1ToOldGoal;
                    gameData.currentTrialData.aiDistanceToOldGoal = distance2ToOldGoal;
                }
            }

            console.log('New goal created at:', newGoalResult.position);
            console.log('Trial data updated with distances');

            // Update display
            if (options.displayUpdater) {
                options.displayUpdater();
            } else if (!isHumanHuman && typeof nodeGameUpdateGameDisplay !== 'undefined') {
                nodeGameUpdateGameDisplay();
            } else if (isHumanHuman && typeof updateGameVisualization !== 'undefined') {
                updateGameVisualization();
            }

            // Call callback
            if (options.callback) {
                options.callback();
            }

            console.log('=== NEW GOAL PRESENTATION COMPLETE ===');
        } else {
            console.error('Failed to generate new goal locally');
        }
    } else {
        console.log('=== NEW GOAL CONDITIONS NOT MET ===');
        console.log('  - Player1 goal null?', player1CurrentGoal === null);
        console.log('  - Player2 goal null?', player2CurrentGoal === null);
        console.log('  - Goals same?', player1CurrentGoal === player2CurrentGoal);
        console.log('  - Already presented?', (typeof newGoalPresented !== 'undefined') ? newGoalPresented : 'undefined');
    }
}

/**
 * Map distance conditions from human-AI format to server format
 */
function mapDistanceConditionToServer(distanceCondition) {
    switch (distanceCondition) {
        case 'closer_to_player2':
        case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2:
            return 'closer_to_player2';
        case 'closer_to_player1':
        case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
            return 'closer_to_player1';
        case 'equal_to_both':
        case TWOP3G_CONFIG.distanceConditions.EQUAL_TO_BOTH:
            return 'equal_to_both';
        case 'no_new_goal':
        case TWOP3G_CONFIG.distanceConditions.NO_NEW_GOAL:
            return 'no_new_goal';
        default:
            console.warn('Unknown distance condition, using equal_to_both as fallback:', distanceCondition);
            return 'equal_to_both';
    }
}

/**
 * Check trial end for 2P3G (matching original)
 */
function checkTrialEnd2P3G(callback) {
            var player1AtGoal = isGoalReached(gameData.player1, gameData.currentGoals);
        var player2AtGoal = isGoalReached(gameData.player2, gameData.currentGoals);

            if (player1AtGoal && player2AtGoal) {
        var player1Goal = whichGoalReached(gameData.player1, gameData.currentGoals);
        var player2Goal = whichGoalReached(gameData.player2, gameData.currentGoals);

        // ADD THIS: Record final reached goals
        gameData.currentTrialData.player1FinalReachedGoal = player1Goal;
        gameData.currentTrialData.player2FinalReachedGoal = player2Goal;
        console.log(`Final goals - Player1: ${player1Goal}, Player2: ${player2Goal}`);

        // Collaboration is successful if both players reached the same goal
        // Note: Using 0-based indexing from gameHelpers.js (goal 0, 1, 2...)
        var collaboration = (player1Goal === player2Goal && player1Goal !== null);

        console.log(`2P3G Collaboration check: Player1 goal=${player1Goal}, Player2 goal=${player2Goal}, Collaboration=${collaboration}`);

        gameData.currentTrialData.collaborationSucceeded = collaboration;
        finalizeTrial(true);

        // Reset 2P3G specific variables for next trial
        newGoalPresented = false;
        newGoalPosition = null;
        isNewGoalCloserToPlayer2 = null;
        player1InferredGoals = [];
        player2InferredGoals = [];

        if (callback) callback();
    } else if (player1AtGoal && !player2AtGoal) {
        // Show wait message when player1 reached goal but player2 hasn't
        showWaitMessage();
    }
}

// =================================================================================================
// 1P2G Functions - Experimental Design Logic
// =================================================================================================

/**
 * Check for new goal presentation in 1P2G based on distance condition (supports both human-AI and human-human versions)
 * @param {Object} [options={}] - Configuration options for different experiment versions
 * @param {Array} [options.playerPosition] - Override player position (defaults to gameData.player1 or gameData.currentPlayerPos)
 * @param {Function} [options.distanceCalculator] - Custom distance calculation function
 * @param {Function} [options.displayUpdater] - Custom display update function
 * @param {Function} [options.callback] - Callback function after goal presentation
 */
function checkNewGoalPresentation1P2G(options) {
    console.log('=== 1P2G NEW GOAL CHECK START ===');

    // Handle both old callback-only signature and new options signature
    if (typeof options === 'function') {
        options = { callback: options };
    }
    options = options || {};

    console.log('1P2G: Current stepCount:', gameData.stepCount, 'Required minimum:', ONEP2G_CONFIG.minStepsBeforeNewGoal);

    // Check minimum steps requirement
    if (gameData.stepCount < ONEP2G_CONFIG.minStepsBeforeNewGoal) {
        console.log('1P2G: Minimum steps not met, returning early');
        return;
    }

    // Get current player1 goal
    var player1CurrentGoal = gameData.currentTrialData.player1CurrentGoal && gameData.currentTrialData.player1CurrentGoal.length > 0 ?
        gameData.currentTrialData.player1CurrentGoal[gameData.currentTrialData.player1CurrentGoal.length - 1] : null;

    console.log('1P2G: player1CurrentGoal:', player1CurrentGoal);
    console.log('1P2G: player1CurrentGoal array:', gameData.currentTrialData.player1CurrentGoal);
    console.log('1P2G: newGoalPresented:', gameData.currentTrialData.newGoalPresented);

    // Check if player1 goal is detected and new goal hasn't been presented yet
    if (player1CurrentGoal !== null && gameData.currentTrialData.newGoalPresented !== true) {
        console.log('1P2G: Conditions met for new goal presentation!');
        // Get distance condition for this trial
        var distanceCondition = gameData.currentTrialData.distanceCondition || ONEP2G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1;

        // Check if no new goal condition
        if (distanceCondition === ONEP2G_CONFIG.distanceConditions.NO_NEW_GOAL) {
            console.log('1P2G: No new goal condition - no new goal will be presented');
            gameData.currentTrialData.newGoalPresented = true; // Mark as handled
            return;
        }

        // Present new goal when human goal is detected (similar to 2P3G logic)
        if (gameData.currentGoals.length >= 2) {
            var firstGoal = gameData.currentGoals[0];

            // Generate new goal position based on distance condition
            var newGoal = generateNewGoalFor1P2G(firstGoal, distanceCondition);

            if (newGoal) {
                // Add new goal to the grid and goals list (like 2P3G)
                gameData.gridMatrix[newGoal[0]][newGoal[1]] = OBJECT.goal;
                gameData.currentGoals.push(newGoal);

                // Reset pre-calculation flag when new goal is added (human-AI specific)
                if (window.RLAgent && window.RLAgent.resetNewGoalPreCalculationFlag) {
                    window.RLAgent.resetNewGoalPreCalculationFlag();
                }

                // Mark as presented
                gameData.currentTrialData.newGoalPresented = true;

                // Record in trial data
                gameData.currentTrialData.newGoalPresentedTime = gameData.stepCount;
                gameData.currentTrialData.newGoalPosition = newGoal;
                gameData.currentTrialData.newGoalConditionType = distanceCondition;

                // Get player position (support both versions)
                var playerPosition = options.playerPosition ||
                                   gameData.player1 ||
                                   gameData.currentPlayerPos;

                if (!playerPosition) {
                    console.error('1P2G: No player position available for distance calculation');
                    if (options.callback) options.callback();
                    return;
                }

                // Calculate and record distances using appropriate function
                var distanceCalculator = options.distanceCalculator;
                if (!distanceCalculator) {
                    // Try to find appropriate distance calculator
                    if (typeof calculatetGirdDistance === 'function') {
                        distanceCalculator = calculatetGirdDistance; // Human-AI version
                    } else if (window.NodeGameHelpers && window.NodeGameHelpers.calculatetGirdDistance) {
                        distanceCalculator = window.NodeGameHelpers.calculatetGirdDistance; // Human-Human version
                    } else if (window.calculatetGirdDistance) {
                        distanceCalculator = window.calculatetGirdDistance; // Global alias
                    } else {
                        console.error('1P2G: No distance calculator available');
                        distanceCalculator = function() { return 0; }; // Fallback
                    }
                }

                var humanDistanceToFirstGoal = distanceCalculator(playerPosition, firstGoal);
                var humanDistanceToNewGoal = distanceCalculator(playerPosition, newGoal);
                gameData.currentTrialData.humanDistanceToFirstGoal = humanDistanceToFirstGoal;
                gameData.currentTrialData.humanDistanceToNewGoal = humanDistanceToNewGoal;

                console.log('1P2G: New goal presented at step', gameData.stepCount, ':', newGoal, 'Condition:', distanceCondition);
                console.log('  - Distance to FIRST goal:', humanDistanceToFirstGoal);
                console.log('  - Distance to NEW goal:', humanDistanceToNewGoal);

                // Update display using appropriate function
                var displayUpdater = options.displayUpdater;
                if (!displayUpdater) {
                    // Try to find appropriate display updater
                    if (typeof nodeGameUpdateGameDisplay === 'function') {
                        displayUpdater = nodeGameUpdateGameDisplay; // Human-AI version
                    } else if (window.nodeGameUpdateGameDisplay) {
                        displayUpdater = window.nodeGameUpdateGameDisplay; // Global alias
                    } else {
                        console.log('1P2G: No display updater available, skipping display update');
                        displayUpdater = function() {}; // Fallback
                    }
                }

                displayUpdater();

                if (options.callback) options.callback();
            } else {
                console.log('checkNewGoalPresentation1P2G: Failed to generate new goal');
            }
        } else {
            console.log('1P2G: Not presenting new goal - not enough goals:', gameData.currentGoals.length);
        }
    } else {
        console.log('1P2G: Conditions NOT met for new goal presentation:');
        console.log('  - player1CurrentGoal is null?', player1CurrentGoal === null);
        console.log('  - newGoalPresented?', gameData.currentTrialData.newGoalPresented);
    }
    console.log('=== 1P2G NEW GOAL CHECK END ===');
}

/**
 * Generate new goal for 1P2G based on distance condition (similar to 2P3G)
 * @param {Array} firstGoal - Position of the first goal [row, col]
 * @param {string} distanceCondition - Distance condition type
 * @returns {Array|null} - Position of the new goal or null if not found
 */
function generateNewGoalFor1P2G(firstGoal, distanceCondition) {
    if (!firstGoal || !Array.isArray(firstGoal) || firstGoal.length < 2) {
        console.error('Invalid first goal provided to generateNewGoalFor1P2G:', firstGoal);
        return null;
    }

    // Get human player position (support both human-AI and human-human versions)
            var player1Pos = gameData.player1 || gameData.currentPlayerPos;
    if (!player1Pos || !Array.isArray(player1Pos) || player1Pos.length < 2) {
        console.error('Invalid player1 position for 1P2G goal generation');
        console.error('  - gameData.player1:', gameData.player1);
        console.error('  - gameData.currentPlayerPos:', gameData.currentPlayerPos);
        return null;
    }

    // Get distance calculator (support both human-AI and human-human versions)
    var distanceCalculator;
    if (typeof calculatetGirdDistance === 'function') {
        distanceCalculator = calculatetGirdDistance; // Human-AI version
    } else if (window.NodeGameHelpers && window.NodeGameHelpers.calculatetGirdDistance) {
        distanceCalculator = window.NodeGameHelpers.calculatetGirdDistance; // Human-Human version
    } else if (window.calculatetGirdDistance) {
        distanceCalculator = window.calculatetGirdDistance; // Global alias
    } else {
        console.error('1P2G: No distance calculator available in generateNewGoalFor1P2G');
        return null;
    }

    var player1DistanceToFirstGoal = distanceCalculator(player1Pos, firstGoal);

    // Find all valid positions for the second goal based on distance condition
    var validPositions = [];
    for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
        for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
            var secondGoal = [row, col];

            // Check if position is not occupied by players, obstacles, or existing goals
            if (gameData.gridMatrix[row][col] === OBJECT.blank) {
                // Skip if this position is already occupied by any existing goal
                var isOccupiedByGoal = false;
                for (var i = 0; i < gameData.currentGoals.length; i++) {
                    if (row === gameData.currentGoals[i][0] && col === gameData.currentGoals[i][1]) {
                        isOccupiedByGoal = true;
                        break;
                    }
                }
                if (isOccupiedByGoal) {
                    continue;
                }

                var player1DistanceToSecondGoal = distanceCalculator(player1Pos, secondGoal);
                var distanceBetweenGoals = distanceCalculator(firstGoal, secondGoal);

                // Basic constraints that apply to all conditions
                var player1DistanceConstraint = player1DistanceToSecondGoal >= ONEP2G_CONFIG.goalConstraints.minDistanceFromHuman &&
                                            player1DistanceToSecondGoal <= ONEP2G_CONFIG.goalConstraints.maxDistanceFromHuman;
                var goalDistanceConstraint = distanceBetweenGoals >= ONEP2G_CONFIG.goalConstraints.minDistanceBetweenGoals;

                // Distance condition-specific constraints
                var distanceConditionMet = false;
                var conditionType = '';

                switch (distanceCondition) {
                    case ONEP2G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
                        // Second goal closer to player1 than first goal
                        distanceConditionMet = player1DistanceToSecondGoal < player1DistanceToFirstGoal - ONEP2G_CONFIG.distanceConstraint.closerThreshold;
                        conditionType = 'closer_to_player1';
                        break;

                    case ONEP2G_CONFIG.distanceConditions.FARTHER_TO_PLAYER1:
                        // Second goal farther to player1 than first goal
                        distanceConditionMet = player1DistanceToSecondGoal > player1DistanceToFirstGoal + ONEP2G_CONFIG.distanceConstraint.fartherThreshold;
                        conditionType = 'farther_to_player1';
                        break;

                    case ONEP2G_CONFIG.distanceConditions.EQUAL_TO_PLAYER1:
                        // Second goal equal distance to player1 as first goal
                        var distanceDifference = Math.abs(player1DistanceToSecondGoal - player1DistanceToFirstGoal);
                        distanceConditionMet = distanceDifference <= ONEP2G_CONFIG.distanceConstraint.equalTolerance;
                        conditionType = 'equal_to_player1';
                        break;

                    default:
                        return null;
                }

                if (distanceConditionMet && player1DistanceConstraint && goalDistanceConstraint) {
                    validPositions.push({
                        position: secondGoal,
                        conditionType: conditionType,
                        distanceToPlayer1: player1DistanceToSecondGoal,
                        distanceToFirstGoal: player1DistanceToFirstGoal,
                        distanceBetweenGoals: distanceBetweenGoals
                    });
                }
            }
        }
    }

    // Return a random valid position, or null if none found
    if (validPositions.length > 0) {
        var selectedGoalData = validPositions[Math.floor(Math.random() * validPositions.length)];
        return selectedGoalData.position;
    }

    // Fallback: Try with relaxed constraints if no valid positions found
    console.log('generateNewGoal: No valid goals found with strict constraints, trying relaxed constraints');

    var relaxedValidPositions = [];
    for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
        for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
            var secondGoal = [row, col];

            // Only check basic constraints: not occupied and reasonable distance from human
            if (gameData.gridMatrix[row][col] === OBJECT.blank) {
                // Skip if this position is already occupied by any existing goal
                var isOccupiedByGoal = false;
                for (var i = 0; i < gameData.currentGoals.length; i++) {
                    if (row === gameData.currentGoals[i][0] && col === gameData.currentGoals[i][1]) {
                        isOccupiedByGoal = true;
                        break;
                    }
                }
                if (isOccupiedByGoal) {
                    continue;
                }

                var player1DistanceToSecondGoal = distanceCalculator(player1Pos, secondGoal);
                var distanceBetweenGoals = distanceCalculator(firstGoal, secondGoal);

                // Relaxed constraints
                var player1DistanceOk = player1DistanceToSecondGoal >= 1; // Minimum 1 distance from player1
                var goalDistanceOk = distanceBetweenGoals >= 2; // Minimum 2 distance between goals
                var distanceConditionMet = false;

                switch (distanceCondition) {
                    case ONEP2G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
                        // Require new goal to be closer to player1 (with more relaxed threshold)
                        distanceConditionMet = player1DistanceToSecondGoal < player1DistanceToFirstGoal;
                        break;

                    case ONEP2G_CONFIG.distanceConditions.FARTHER_TO_PLAYER1:
                        // Require new goal to be farther to player1 (with more relaxed threshold)
                        distanceConditionMet = player1DistanceToSecondGoal > player1DistanceToFirstGoal;
                        break;

                    case ONEP2G_CONFIG.distanceConditions.EQUAL_TO_PLAYER1:
                        // Allow larger tolerance for equal distance
                        var distanceDifference = Math.abs(player1DistanceToSecondGoal - player1DistanceToFirstGoal);
                        distanceConditionMet = distanceDifference <= 3; // More relaxed tolerance
                        break;

                    default:
                        distanceConditionMet = true; // Accept any position
                        break;
                }

                if (player1DistanceOk && goalDistanceOk && distanceConditionMet) {
                    relaxedValidPositions.push({
                        position: secondGoal,
                        conditionType: distanceCondition,
                        distanceToPlayer1: player1DistanceToSecondGoal,
                        distanceToFirstGoal: player1DistanceToFirstGoal,
                        distanceBetweenGoals: distanceBetweenGoals
                    });
                }
            }
        }
    }

    if (relaxedValidPositions.length > 0) {
        var selectedRelaxedGoalData = relaxedValidPositions[Math.floor(Math.random() * relaxedValidPositions.length)];
        return selectedRelaxedGoalData.position;
    }

    console.log('generateSecondGoalFor1P2G: No valid goals found even with relaxed constraints');

    return null;
}

// =================================================================================================
// SUCCESS THRESHOLD FUNCTIONS
// =================================================================================================

/**
 * Initialize success threshold tracking for a new experiment
 */
function initializeSuccessThresholdTracking() {
    gameData.successThreshold.consecutiveSuccesses = 0;
    gameData.successThreshold.totalTrialsCompleted = 0;
    gameData.successThreshold.experimentEndedEarly = false;
    gameData.successThreshold.lastSuccessTrial = -1;
    gameData.successThreshold.successHistory = [];
}

/**
 * Update success threshold tracking after a trial
 * @param {boolean} success - Whether the trial was successful
 * @param {number} trialIndex - Current trial index
 */
function updateSuccessThresholdTracking(success, trialIndex) {
    // Only track for collaboration games
    if (!gameData.currentExperiment || !gameData.currentExperiment.includes('2P')) {
        return;
    }

    gameData.successThreshold.totalTrialsCompleted++;
    gameData.successThreshold.successHistory.push(success);

    if (success) {
        gameData.successThreshold.consecutiveSuccesses++;
        gameData.successThreshold.lastSuccessTrial = trialIndex;
    } else {
        gameData.successThreshold.consecutiveSuccesses = 0;
    }

    console.log(`Success threshold update - Trial ${trialIndex + 1}: ${success ? 'SUCCESS' : 'FAILURE'}`);
    console.log(`  Consecutive successes: ${gameData.successThreshold.consecutiveSuccesses}/${NODEGAME_CONFIG.successThreshold.consecutiveSuccessesRequired}`);
    console.log(`  Total trials: ${gameData.successThreshold.totalTrialsCompleted}/${NODEGAME_CONFIG.successThreshold.maxTrials}`);
}

/**
 * Check if experiment should end due to success threshold
 * @returns {boolean} - True if experiment should end
 */
function shouldEndExperimentDueToSuccessThreshold() {
    // Only apply to collaboration games
    if (!gameData.currentExperiment || !gameData.currentExperiment.includes('2P')) {
        return false;
    }

    // Check if success threshold is enabled
    if (!NODEGAME_CONFIG.successThreshold.enabled) {
        return false;
    }

    var config = NODEGAME_CONFIG.successThreshold;
    var tracking = gameData.successThreshold;

    // Check if we've reached the maximum trials
    if (tracking.totalTrialsCompleted >= config.maxTrials) {
        console.log(`Experiment ending: Reached maximum trials (${config.maxTrials})`);
        return true;
    }

    // Check if we have enough trials and consecutive successes
    if (tracking.totalTrialsCompleted >= config.minTrialsBeforeCheck &&
        tracking.consecutiveSuccesses >= config.consecutiveSuccessesRequired) {
        console.log(`Experiment ending: Success threshold met (${tracking.consecutiveSuccesses} consecutive successes after ${tracking.totalTrialsCompleted} trials)`);
        gameData.successThreshold.experimentEndedEarly = true;
        return true;
    }

    return false;
}

/**
 * Check if should continue to next trial for given experiment
 * @param {string} experimentType - Type of experiment
 * @param {number} trialIndex - Current trial index
 * @returns {boolean} - True if should continue
 */
function shouldContinueToNextTrial(experimentType, trialIndex) {
    // Only apply to collaboration games
    if (!experimentType.includes('2P')) {
        return true; // Always continue for non-collaboration games
    }

    // Check if experiment should end due to success threshold
    if (shouldEndExperimentDueToSuccessThreshold()) {
        console.log(`Ending ${experimentType} experiment due to success threshold`);
        return false;
    }

    // Check if we've reached the configured number of trials
    if (trialIndex >= NODEGAME_CONFIG.successThreshold.maxTrials - 1) {
        console.log(`Ending ${experimentType} experiment: Completed ${NODEGAME_CONFIG.successThreshold.maxTrials} trials`);
        return false;
    }

    return true;
}

// =================================================================================================
// GLOBAL EXPORTS
// =================================================================================================

// Export functions globally for use in other files
window.ExpDesign = {
    // 2P3G functions
    getDistanceCondition: getDistanceCondition,
    setDistanceConditionSequence: setDistanceConditionSequence,
    generateNewGoal: generateNewGoal,
    isGoalBlockingPath: isGoalBlockingPath,
    isInRectangleBetween: isInRectangleBetween,
    checkNewGoalPresentation2P3G: checkNewGoalPresentation2P3G,
    checkTrialEnd2P3G: checkTrialEnd2P3G,

    // 1P2G functions
    checkNewGoalPresentation1P2G: checkNewGoalPresentation1P2G,
    generateNewGoalFor1P2G: generateNewGoalFor1P2G,

    // Success threshold functions
    initializeSuccessThresholdTracking: initializeSuccessThresholdTracking,
    updateSuccessThresholdTracking: updateSuccessThresholdTracking,
    shouldEndExperimentDueToSuccessThreshold: shouldEndExperimentDueToSuccessThreshold,
    shouldContinueToNextTrial: shouldContinueToNextTrial,

    // Global variables (for reset purposes)
    reset2P3GGlobals: function() {
        humanInferredGoals = [];
        aiInferredGoals = [];
        newGoalPresented = false;
        newGoalPosition = null;
        isNewGoalCloserToAI = null;
    }
};

