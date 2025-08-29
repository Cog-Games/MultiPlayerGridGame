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
 * Generate randomized distance condition sequence for experiments
 * Ensures equal representation of each condition in random order
 * @param {number} numTrials - Number of trials
 * @param {Object} CONFIG - Configuration object containing distanceConditions
 * @returns {Array} - Randomized array of distance conditions
 */
function generateRandomizedDistanceSequence(numTrials, CONFIG) {
    // Dynamically get all distance conditions from the config
    var allConditions = Object.values(CONFIG.distanceConditions);

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


// =================================================================================================
// 1P2G Functions - Experimental Design Logic
// =================================================================================================

/**
 * Generate new goal for 1P2G based on distance condition
 * @param {Array} firstGoal - Position of the first goal [row, col]
 * @param {string} distanceCondition - Distance condition type
 * @returns {Array|null} - Position of the new goal or null if not found
 */
function generateNewGoalFor1P2G(firstGoal, distanceCondition) {
    if (!firstGoal || !Array.isArray(firstGoal) || firstGoal.length < 2) {
        console.error('Invalid first goal provided to generateNewGoalFor1P2G:', firstGoal);
        return null;
    }

    var player1Pos = gameData.player1 || gameData.currentPlayerPos;
    var distanceCalculator = getDistanceCalculator();

    if (!distanceCalculator) {
        console.error('1P2G: No distance calculator available in generateNewGoalFor1P2G');
        return null;
    }

    var player1DistanceToFirstGoal = distanceCalculator(player1Pos, firstGoal);

    function isValidPosition(row, col) {
        return gameData.gridMatrix[row][col] === OBJECT.blank &&
               !gameData.currentGoals.some(goal => goal[0] === row && goal[1] === col);
    }

    function checkDistanceCondition(player1DistanceToSecondGoal, isRelaxed) {
        var distanceDiff = Math.abs(player1DistanceToSecondGoal - player1DistanceToFirstGoal);

        switch (distanceCondition) {
            case ONEP2G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
                var minDiff = ONEP2G_CONFIG.distanceConstraint.minDistanceDiff;
                var maxDiff = ONEP2G_CONFIG.distanceConstraint.maxDistanceDiff;
                return player1DistanceToSecondGoal < player1DistanceToFirstGoal &&
                       distanceDiff >= minDiff && distanceDiff <= maxDiff;

            case ONEP2G_CONFIG.distanceConditions.FARTHER_TO_PLAYER1:
                var minDiff = ONEP2G_CONFIG.distanceConstraint.minDistanceDiff;
                var maxDiff = ONEP2G_CONFIG.distanceConstraint.maxDistanceDiff;
                return player1DistanceToSecondGoal > player1DistanceToFirstGoal &&
                       distanceDiff >= minDiff && distanceDiff <= maxDiff;

            case ONEP2G_CONFIG.distanceConditions.EQUAL_TO_PLAYER1:
                return Math.abs(player1DistanceToSecondGoal - player1DistanceToFirstGoal) === 0;

            default:
                return isRelaxed;
        }
    }

    function findValidPositions(isRelaxed) {
        var validPositions = [];

        for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
            for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
                if (!isValidPosition(row, col)) continue;

                var secondGoal = [row, col];
                var player1DistanceToSecondGoal = distanceCalculator(player1Pos, secondGoal);
                var distanceBetweenGoals = distanceCalculator(firstGoal, secondGoal);

                var constraints = isRelaxed ? {
                    minPlayer1Distance: 1,
                    minGoalDistance: 2
                } : {
                    minPlayer1Distance: ONEP2G_CONFIG.goalConstraints.minDistanceFromHuman,
                    maxPlayer1Distance: ONEP2G_CONFIG.goalConstraints.maxDistanceFromHuman,
                    minGoalDistance: ONEP2G_CONFIG.goalConstraints.minDistanceBetweenGoals
                };

                var meetsConstraints = player1DistanceToSecondGoal >= constraints.minPlayer1Distance &&
                                     (!constraints.maxPlayer1Distance || player1DistanceToSecondGoal <= constraints.maxPlayer1Distance) &&
                                     distanceBetweenGoals >= constraints.minGoalDistance &&
                                     checkDistanceCondition(player1DistanceToSecondGoal, isRelaxed);

                if (meetsConstraints) {
                    validPositions.push(secondGoal);
                }
            }
        }

        return validPositions;
    }

    var validPositions = findValidPositions(false);
    if (validPositions.length > 0) {
        var selectedGoal = validPositions[Math.floor(Math.random() * validPositions.length)];
        var player1DistanceToNewGoal = distanceCalculator(player1Pos, selectedGoal);

        console.log('1P2G: Distance to OLD goal (first):', player1DistanceToFirstGoal);
        console.log('1P2G: Distance to NEW goal:', player1DistanceToNewGoal);

        return selectedGoal;
    }

    console.log('generateNewGoal: No valid goals found with strict constraints, trying relaxed constraints');

    var relaxedValidPositions = findValidPositions(true);
    if (relaxedValidPositions.length > 0) {
        var selectedRelaxedGoal = relaxedValidPositions[Math.floor(Math.random() * relaxedValidPositions.length)];
        var player1DistanceToNewGoal = distanceCalculator(player1Pos, selectedRelaxedGoal);

        console.log('1P2G: Distance to OLD goal (first):', player1DistanceToFirstGoal);
        console.log('1P2G: Distance to NEW goal:', player1DistanceToNewGoal);

        return selectedRelaxedGoal;
    }

    console.log('generateSecondGoalFor1P2G: No valid goals found even with relaxed constraints');
    return null;
}

function getDistanceCalculator() {
    if (typeof calculatetGirdDistance === 'function') {
        return calculatetGirdDistance;
    }
    if (window.NodeGameHelpers && window.NodeGameHelpers.calculatetGirdDistance) {
        return window.NodeGameHelpers.calculatetGirdDistance;
    }
    if (window.calculatetGirdDistance) {
        return window.calculatetGirdDistance;
    }
    return null;
}
/**
 * Check for new goal presentation in 1P2G based on distance condition
 * @param {Object|Function} [options={}] - Configuration options or callback function
 */
function checkNewGoalPresentation1P2G(options) {
    if (typeof options === 'function') {
        options = { callback: options };
    }
    options = options || {};

    if (gameData.stepCount < ONEP2G_CONFIG.minStepsBeforeNewGoal) {
        return;
    }

    var player1CurrentGoal = getLatestPlayer1Goal();

    if (player1CurrentGoal === null || gameData.currentTrialData.newGoalPresented === true) {
        return;
    }

    var distanceCondition = gameData.currentTrialData.distanceCondition || ONEP2G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1;

    if (distanceCondition === ONEP2G_CONFIG.distanceConditions.NO_NEW_GOAL) {
        gameData.currentTrialData.newGoalPresented = true;
        return;
    }

    if (gameData.currentGoals.length < 2) {
        return;
    }

    var newGoal = generateNewGoalFor1P2G(gameData.currentGoals[0], distanceCondition);

    if (newGoal) {
        addNewGoalToGame(newGoal, distanceCondition, options);
        if (options.callback) options.callback();
    }
}

function getLatestPlayer1Goal() {
    var goals = gameData.currentTrialData.player1CurrentGoal;
    return goals && goals.length > 0 ? goals[goals.length - 1] : null;
}

function addNewGoalToGame(newGoal, distanceCondition, options) {
    gameData.gridMatrix[newGoal[0]][newGoal[1]] = OBJECT.goal;
    gameData.currentGoals.push(newGoal);

    if (window.RLAgent && window.RLAgent.resetNewGoalPreCalculationFlag) {
        window.RLAgent.resetNewGoalPreCalculationFlag();
    }

    gameData.currentTrialData.newGoalPresented = true;
    gameData.currentTrialData.newGoalPresentedTime = gameData.stepCount;
    gameData.currentTrialData.newGoalPosition = newGoal;
    gameData.currentTrialData.newGoalConditionType = distanceCondition;

    recordDistances(newGoal, options);
    updateDisplay(options);
}

function recordDistances(newGoal, options) {
    var playerPosition = options.playerPosition || gameData.player1 || gameData.currentPlayerPos;
    var distanceCalculator = options.distanceCalculator || getDistanceCalculator();

    if (playerPosition && distanceCalculator) {
        var firstGoal = gameData.currentGoals[0];
        gameData.currentTrialData.humanDistanceToFirstGoal = distanceCalculator(playerPosition, firstGoal);
        gameData.currentTrialData.humanDistanceToNewGoal = distanceCalculator(playerPosition, newGoal);
    }
}

function updateDisplay(options) {
    var displayUpdater = options.displayUpdater ||
                        (typeof nodeGameUpdateGameDisplay === 'function' ? nodeGameUpdateGameDisplay :
                         window.nodeGameUpdateGameDisplay);

    if (displayUpdater) {
        displayUpdater();
    }
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
 * Generate new goal with constraints based on distance condition
 * @param {Array} player2Pos - Player2 position [row, col]
 * @param {Array} player1Pos - Player1 position [row, col]
 * @param {Array} oldGoals - Array of existing goal positions
 * @param {number} player2CurrentGoalIndex - Index of player2's current goal
 * @param {string} distanceCondition - Distance condition type
 * @returns {Object|null} - Object with position and metadata, or null
 */
function generateNewGoalFor2P3G(player2Pos, player1Pos, oldGoals, player2CurrentGoalIndex, distanceCondition) {
    if (distanceCondition === TWOP3G_CONFIG.distanceConditions.NO_NEW_GOAL ||
        player2CurrentGoalIndex === null || player2CurrentGoalIndex >= oldGoals.length) {
        return null;
    }

    var player2CurrentGoal = oldGoals[player2CurrentGoalIndex];
    var oldDistanceSum = calculatetGirdDistance(player2Pos, player2CurrentGoal) +
                        calculatetGirdDistance(player1Pos, player2CurrentGoal);
    var player2DistanceToOldGoal = calculatetGirdDistance(player2Pos, player2CurrentGoal);
    var player1DistanceToOldGoal = calculatetGirdDistance(player1Pos, player2CurrentGoal);

    function checkDistanceCondition2P3G(newGoalDistanceToPlayer1, newGoalDistanceToPlayer2, newDistanceSum, isRelaxed) {
        var tolerance = isRelaxed ? 1 : 0.1;
        var minDiff = isRelaxed ? 0 : TWOP3G_CONFIG.distanceConstraint.minDistanceDiff;
        var maxDiff = isRelaxed ? 30 : TWOP3G_CONFIG.distanceConstraint.maxDistanceDiff;

        switch (distanceCondition) {
            case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2:
                var distanceDiff = Math.abs(newGoalDistanceToPlayer2 - player2DistanceToOldGoal);
                return newGoalDistanceToPlayer2 < player2DistanceToOldGoal &&
                       distanceDiff >= minDiff && distanceDiff <= maxDiff &&
                       Math.abs(newDistanceSum - oldDistanceSum) <= tolerance;

            case TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER1:
                var distanceDiff = Math.abs(newGoalDistanceToPlayer1 - player1DistanceToOldGoal);
                return newGoalDistanceToPlayer1 < player1DistanceToOldGoal &&
                       distanceDiff >= minDiff && distanceDiff <= maxDiff &&
                       Math.abs(newDistanceSum - oldDistanceSum) <= tolerance;

            case TWOP3G_CONFIG.distanceConditions.EQUAL_TO_BOTH:
                var distanceDiff = Math.abs(newGoalDistanceToPlayer2 - newGoalDistanceToPlayer1);
                var equalTolerance = isRelaxed ? 2 : 1; // Increased tolerance for equal distance
                var sumTolerance = isRelaxed ? 2 : 1; // More relaxed sum tolerance for EQUAL_TO_BOTH
                var meetsEqualCondition = distanceDiff <= equalTolerance &&
                                        Math.abs(newDistanceSum - oldDistanceSum) <= sumTolerance;


                return meetsEqualCondition;

            default:
                return Math.abs(newDistanceSum - oldDistanceSum) <= tolerance;
        }
    }

    function meetsBasicConstraints2P3G(newGoalDistanceToPlayer1, newGoal, isRelaxed) {
        if (isRelaxed) {
            // When relaxed, only check that the goal is not too close to player1 (minimum safety distance)
            return newGoalDistanceToPlayer1 >= 1;
        }

        var config = TWOP3G_CONFIG.goalConstraints;
        return newGoalDistanceToPlayer1 >= config.minDistanceFromHuman &&
               newGoalDistanceToPlayer1 <= config.maxDistanceFromHuman &&
               (!config.blockPathCheck || !isGoalBlockingPath(player1Pos, newGoal, oldGoals)) &&
               (!config.avoidRectangleArea || !isInRectangleBetween(newGoal, player2Pos, player2CurrentGoal));
    }

    function isValidPosition2P3G(row, col) {
        return gameData.gridMatrix[row][col] === OBJECT.blank &&
               !oldGoals.some(goal => goal[0] === row && goal[1] === col);
    }

    function findValidPositions2P3G(isRelaxed) {
        var validPositions = [];

        for (var row = 0; row < EXPSETTINGS.matrixsize; row++) {
            for (var col = 0; col < EXPSETTINGS.matrixsize; col++) {
                if (!isValidPosition2P3G(row, col)) continue;

                var newGoal = [row, col];
                var newGoalDistanceToPlayer2 = calculatetGirdDistance(player2Pos, newGoal);
                var newGoalDistanceToPlayer1 = calculatetGirdDistance(player1Pos, newGoal);
                var newDistanceSum = newGoalDistanceToPlayer2 + newGoalDistanceToPlayer1;

                if (meetsBasicConstraints2P3G(newGoalDistanceToPlayer1, newGoal, isRelaxed) &&
                    checkDistanceCondition2P3G(newGoalDistanceToPlayer1, newGoalDistanceToPlayer2, newDistanceSum, isRelaxed)) {

                    validPositions.push({
                        position: newGoal,
                        conditionType: distanceCondition,
                        distanceToPlayer2: newGoalDistanceToPlayer2,
                        distanceToPlayer1: newGoalDistanceToPlayer1,
                        distanceSum: newDistanceSum
                    });

                }
            }
        }

        return validPositions;
    }

    var validPositions = findValidPositions2P3G(false);


    if (validPositions.length > 0) {
        var selectedGoalResult = validPositions[Math.floor(Math.random() * validPositions.length)];

        console.log('Player1 and Player2 distance to OLD goal:', player1DistanceToOldGoal, player2DistanceToOldGoal);
        console.log('Player1 and Player2 distance to NEW goal:', selectedGoalResult.distanceToPlayer1, selectedGoalResult.distanceToPlayer2);

        return selectedGoalResult;
    }
    console.log('No valid goals found with strict constraints, trying relaxed constraints');

    var relaxedValidPositions = findValidPositions2P3G(true);
    if (relaxedValidPositions.length > 0) {
        var selectedRelaxedResult = relaxedValidPositions[Math.floor(Math.random() * relaxedValidPositions.length)];

        console.log('Player1 and Player2 distance to OLD goal:', player1DistanceToOldGoal, player2DistanceToOldGoal);
        console.log('Player1 and Player2 distance to NEW goal:', selectedRelaxedResult.distanceToPlayer1, selectedRelaxedResult.distanceToPlayer2);

        return selectedRelaxedResult;
    }
    console.log('No valid goals found with relaxed constraints');

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
 * Check for new goal presentation in 2P3G
 * @param {Object|Function} [options={}] - Configuration options or callback function
 */
function checkNewGoalPresentation2P3G(options) {
    if (typeof options === 'function') {
        options = { callback: options };
    }
    options = options || {};

    if (gameData.currentExperiment !== '2P3G' ||
        gameData.stepCount < TWOP3G_CONFIG.minStepsBeforeNewGoal) {
        return;
    }

    var isHumanHuman = detectHumanHumanMode(options);
    var playerGoals = initializePlayerGoals();
    var currentGoals = getCurrentGoals(playerGoals);

    if (!shouldPresentNewGoal(currentGoals)) {
        return;
    }

    var playerPositions = getPlayerPositions(isHumanHuman);

    if (isHumanHuman && options.serverRequestHandler) {
        handleServerSideGoalGeneration(currentGoals, playerPositions, options);
    } else {
        handleLocalGoalGeneration(currentGoals, playerPositions, isHumanHuman, options);
    }
}

function detectHumanHumanMode(options) {
    if (options.isHumanHuman !== undefined) {
        return options.isHumanHuman;
    }
    return (typeof socket !== 'undefined' && socket &&
            gameData.currentTrialData.player1CurrentGoal !== undefined) ||
           (gameData.multiplayer && gameData.multiplayer.myPlayerId);
}

function initializePlayerGoals() {
    if (!gameData.currentTrialData.player1CurrentGoal) {
        gameData.currentTrialData.player1CurrentGoal = [];
        gameData.currentTrialData.player2CurrentGoal = [];
    }
    return {
        player1Goals: gameData.currentTrialData.player1CurrentGoal,
        player2Goals: gameData.currentTrialData.player2CurrentGoal
    };
}

function getCurrentGoals(playerGoals) {
    return {
        player1: playerGoals.player1Goals.length > 0 ?
                playerGoals.player1Goals[playerGoals.player1Goals.length - 1] : null,
        player2: playerGoals.player2Goals.length > 0 ?
                playerGoals.player2Goals[playerGoals.player2Goals.length - 1] : null
    };
}

function shouldPresentNewGoal(currentGoals) {
    var alreadyPresented = newGoalPresented ||
                          (typeof window !== 'undefined' && window.newGoalPresented) ||
                          gameData.currentTrialData.newGoalPresented;

    return currentGoals.player1 !== null &&
           currentGoals.player2 !== null &&
           currentGoals.player1 === currentGoals.player2 &&
           !alreadyPresented;
}

function getPlayerPositions(isHumanHuman) {
    return isHumanHuman ? {
        player1: gameData.currentPlayerPos,
        player2: gameData.currentPartnerPos
    } : {
        player1: gameData.player1,
        player2: gameData.player2
    };
}

function handleServerSideGoalGeneration(currentGoals, playerPositions, options) {
    var distanceCondition = getOrGenerateDistanceCondition();

    options.serverRequestHandler({
        sharedGoalIndex: currentGoals.player1,
        stepCount: gameData.stepCount,
        trialIndex: gameData.currentTrialIndex || gameData.currentTrial,
        player1Pos: playerPositions.player1,
        player2Pos: playerPositions.player2,
        currentGoals: gameData.currentGoals,
        distanceCondition: mapDistanceConditionToServer(distanceCondition)
    });
}

function handleLocalGoalGeneration(currentGoals, playerPositions, isHumanHuman, options) {
    var distanceCondition = gameData.currentTrialData.distanceCondition;
    var newGoalResult = generateNewGoalFor2P3G(
        playerPositions.player2,
        playerPositions.player1,
        gameData.currentGoals,
        currentGoals.player1,
        distanceCondition
    );

    if (newGoalResult) {
        addNewGoalToGame2P3G(newGoalResult, currentGoals, playerPositions, isHumanHuman, options);
    }
}

function getOrGenerateDistanceCondition() {
    var distanceCondition = gameData.currentTrialData.distanceCondition;
    if (!distanceCondition) {
        var generator = window.getRandomDistanceConditionFor2P3G ||
                       (window.GameState && window.GameState.getRandomDistanceConditionFor2P3G) ||
                       function() { return TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2; };
        distanceCondition = generator(gameData.currentTrial);
        gameData.currentTrialData.distanceCondition = distanceCondition;
    }
    return distanceCondition;
}

function addNewGoalToGame2P3G(newGoalResult, currentGoals, playerPositions, isHumanHuman, options) {
    updateGlobalState(newGoalResult);
    addGoalToGrid(newGoalResult);
    resetAIPreCalculation(isHumanHuman);
    recordTrialData(newGoalResult, currentGoals, playerPositions, isHumanHuman);
    updateDisplay2P3G(options, isHumanHuman);

    if (options.callback) options.callback();
}

function updateGlobalState(newGoalResult) {
    if (typeof window !== 'undefined') {
        window.newGoalPresented = true;
        window.newGoalPosition = newGoalResult.position;
    }
    newGoalPresented = true;
    gameData.currentTrialData.newGoalPresented = true;
}

function addGoalToGrid(newGoalResult) {
    var goalValue = (typeof OBJECT !== 'undefined') ? OBJECT.goal : 2;
    gameData.gridMatrix[newGoalResult.position[0]][newGoalResult.position[1]] = goalValue;
    gameData.currentGoals.push(newGoalResult.position);
}

function resetAIPreCalculation(isHumanHuman) {
    if (!isHumanHuman && window.RLAgent && window.RLAgent.resetNewGoalPreCalculationFlag) {
        window.RLAgent.resetNewGoalPreCalculationFlag();
    }
}

function recordTrialData(newGoalResult, currentGoals, playerPositions, isHumanHuman) {
    var trialData = gameData.currentTrialData;

    trialData.isNewGoalCloserToPlayer2 = newGoalResult.conditionType === TWOP3G_CONFIG.distanceConditions.CLOSER_TO_PLAYER2;
    trialData.newGoalPresentedTime = gameData.stepCount;
    trialData.newGoalPosition = newGoalResult.position;
    trialData.newGoalConditionType = newGoalResult.conditionType;
    trialData.newGoalDistanceSum = newGoalResult.distanceSum;
    trialData.newGoalDistanceToPlayer1 = newGoalResult.distanceToPlayer1;
    trialData.newGoalDistanceToPlayer2 = newGoalResult.distanceToPlayer2;

    if (gameData.currentGoals[currentGoals.player1]) {
        var oldGoal = gameData.currentGoals[currentGoals.player1];
        var distance1 = calculatetGirdDistance(playerPositions.player1, oldGoal);
        var distance2 = calculatetGirdDistance(playerPositions.player2, oldGoal);

        if (isHumanHuman) {
            trialData.player1DistanceToOldGoal = distance1;
            trialData.player2DistanceToOldGoal = distance2;
        } else {
            trialData.humanDistanceToOldGoal = distance1;
            trialData.aiDistanceToOldGoal = distance2;
        }
    }
}

function updateDisplay2P3G(options, isHumanHuman) {
    if (options.displayUpdater) {
        options.displayUpdater();
    } else if (!isHumanHuman && typeof nodeGameUpdateGameDisplay !== 'undefined') {
        nodeGameUpdateGameDisplay();
    } else if (isHumanHuman && typeof updateGameVisualization !== 'undefined') {
        updateGameVisualization();
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
    } else if (player1AtGoal && player2AtGoal) {
        // Both players reached goals - restore movement instructions if they were hidden
        if (typeof showMovementInstructions === 'function') {
            showMovementInstructions();
        }
    }
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
    generateNewGoalFor2P3G: generateNewGoalFor2P3G ,
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

