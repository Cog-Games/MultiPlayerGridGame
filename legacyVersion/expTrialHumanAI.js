/**
 * Trial Handlers Module
 *
 * Contains all trial execution functions for different experiment types.
 * Extracted from human-AI-version.js for better organization.
 */

/**
 * Get AI action
 */
function getAIAction(gridMatrix, currentPos, goals, playerPos = null) {
    if (!goals || goals.length === 0) return [0, 0];

    // Use the RL agent from rlAgent.js
    if (window.RLAgent && window.RLAgent.getAIAction) {
        return window.RLAgent.getAIAction(gridMatrix, currentPos, goals, playerPos);
    } else {
        console.error('RL Agent not loaded. Please ensure rlAgent.js is included before human-AI-version.js');
        return [0, 0];
    }
}

/**
 * Run trial stage (main game)
 */
function runTrialStage(stage) {
    var container = document.getElementById('container');
    var trialIndex = stage.trialIndex;
    var experimentType = stage.experimentType;
    var experimentIndex = stage.experimentIndex;

    // Set current experiment type
    gameData.currentExperiment = experimentType;

    // For collaboration games, show dynamic trial count
    var trialCountDisplay = '';
    if (experimentType.includes('2P') && NODEGAME_CONFIG.successThreshold.enabled) {
        trialCountDisplay = `Round ${trialIndex + 1}`;
    } else {
        trialCountDisplay = `Round ${trialIndex + 1}`;
    }

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="text-align: center;">
                <h3 style="margin-bottom: 10px;">Game ${experimentIndex + 1}</h3>
                <div id="gameCanvas" style="margin-bottom: 20px;"></div>
                <p style="font-size: 20px;">You are the player <span style="display: inline-block; width: 18px; height: 18px; background-color: red; border-radius: 50%; vertical-align: middle;"></span>. Press ↑ ↓ ← → to move.</p>
            </div>
        </div>
    `;

    // Create and draw canvas
    var canvas = nodeGameCreateGameCanvas();
    document.getElementById('gameCanvas').appendChild(canvas);

    // Get the appropriate design for this trial
    var design = getRandomMapForCollaborationGame(experimentType, trialIndex);

    // Check if design is valid
    if (!design) {
        console.error('Failed to get valid design for trial:', trialIndex, 'experiment:', experimentType);

        // Create a fallback design
        console.log('Creating fallback design for', experimentType);
        var fallbackDesign = window.GameState.createFallbackDesign(experimentType);

        if (fallbackDesign) {
            console.log('Using fallback design:', fallbackDesign);
            design = fallbackDesign;
        } else {
            // Skip this trial and move to next stage
            console.error('No fallback design available, skipping trial');
            setTimeout(() => nextStage(), 1000);
            return;
        }
    }

    // Initialize trial data
    window.GameState.initializeTrialData(trialIndex, experimentType, design);

    // Run the appropriate experiment
    runExperimentTrial(experimentType, trialIndex, design);
}

/**
 * Run experiment trial based on type
 */
function runExperimentTrial(experimentType, trialIndex, design) {
    gameData.stepCount = 0;
    gameData.gameStartTime = Date.now();
    timeline.isMoving = false;

    // For collaboration games, use random maps after trial x, but only if available
    var trialDesign = design;
    if (experimentType.includes('2P')) {
        var randomDesign = getRandomMapForCollaborationGame(experimentType, trialIndex);
        if (randomDesign) {
            trialDesign = randomDesign;
        }
    }
    // Setup grid matrix
    setupGridMatrixForTrial(trialDesign, experimentType);
    nodeGameUpdateGameDisplay();

    // Start appropriate experiment
    switch(experimentType) {
        case '1P1G':
            runTrial1P1G();
            break;
        case '1P2G':
            runTrial1P2G();
            break;
        case '2P2G':
            runTrial2P2G();
            break;
        case '2P3G':
            runTrial2P3G();
            break;
    }
}

/**
 * Run 1P1G trial
 */
function runTrial1P1G() {
    var gameLoopInterval = null;

    function handleKeyPress(event) {
        if (timeline.isMoving) {
            event.preventDefault();
            return; // Prevent multiple moves
        }

        var key = event.code;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

        // Check if player1 has already reached a goal - if so, don't allow further movement
        if (isGoalReached(gameData.player1, gameData.currentGoals)) {
            event.preventDefault();
            return;
        }

        timeline.isMoving = true;

        // Prevent default browser behavior for arrow keys and prevent key repeat
        event.preventDefault();
        event.stopPropagation();

        var direction = key.toLowerCase();
        var aimAction = DIRECTIONS[direction].movement;

        // Record move
        window.DataRecording.recordPlayer1Move(aimAction, Date.now() - gameData.gameStartTime);

        // Execute move
        var realAction = isValidMove(gameData.gridMatrix, gameData.player1, aimAction);
        var nextState = transition(gameData.player1, realAction);

        // Update grid using proper matrix update
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player1[0], gameData.player1[1], OBJECT.blank);
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, nextState[0], nextState[1], OBJECT.player);
        gameData.player1 = nextState;

        gameData.stepCount++;
        nodeGameUpdateGameDisplay();

        // Check win condition
        if (isGoalReached(gameData.player1, gameData.currentGoals)) {
            var finalGoal = whichGoalReached(gameData.player1, gameData.currentGoals);
            gameData.currentTrialData.player1FinalReachedGoal = finalGoal;
            console.log(`Player1 final reached goal: ${finalGoal}`);

            document.removeEventListener('keydown', handleKeyPress);
            if (gameLoopInterval) clearInterval(gameLoopInterval);

            window.DataRecording.finalizeTrial(true);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        }

        // Reset movement flag with a small delay to prevent rapid successive key presses
        setTimeout(() => {
            timeline.isMoving = false;
        }, NODEGAME_CONFIG.timing.movementDelay); // Configurable delay to prevent rapid successive movements
    }

    // Set up controls
    document.addEventListener('keydown', handleKeyPress);
    document.body.focus();

    // Game timeout
    gameLoopInterval = setInterval(() => {
        if (gameData.stepCount >= NODEGAME_CONFIG.maxGameLength) {
            document.removeEventListener('keydown', handleKeyPress);
            clearInterval(gameLoopInterval);

            window.DataRecording.finalizeTrial(false);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        }
    }, 100);
}

/**
 * Run 1P2G trial
 */
function runTrial1P2G() {
    var gameLoopInterval = null;

    function handleKeyPress(event) {
        if (timeline.isMoving) {
            event.preventDefault();
            return; // Prevent multiple moves
        }

        var key = event.code;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

        // Check if player1 has already reached a goal - if so, don't allow further movement
        if (isGoalReached(gameData.player1, gameData.currentGoals)) {
            event.preventDefault();
            return;
        }

        timeline.isMoving = true;

        // Prevent default browser behavior for arrow keys and prevent key repeat
        event.preventDefault();
        event.stopPropagation();

        var direction = key.toLowerCase();
        var aimAction = DIRECTIONS[direction].movement;

        // Record move
        window.DataRecording.recordPlayer1Move(aimAction, Date.now() - gameData.gameStartTime);

        // Execute move
        var realAction = isValidMove(gameData.gridMatrix, gameData.player1, aimAction);
        var nextState = transition(gameData.player1, realAction);

        // Update grid using proper matrix update
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player1[0], gameData.player1[1], OBJECT.blank);
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, nextState[0], nextState[1], OBJECT.player);
        gameData.player1 = nextState;

        // Detect player goal with history tracking (similar to 2P3G)
        var player1CurrentGoal = detectPlayerGoal(gameData.player1, aimAction, gameData.currentGoals, gameData.currentTrialData.player1CurrentGoal);
        gameData.currentTrialData.player1CurrentGoal.push(player1CurrentGoal);

        // ADD THIS: Record first detected goal
        if (player1CurrentGoal !== null && gameData.currentTrialData.player1FirstDetectedGoal === null) {
            gameData.currentTrialData.player1FirstDetectedGoal = player1CurrentGoal;
            console.log(`Player1 first detected goal: ${player1CurrentGoal}`);
        }

        gameData.stepCount++;
        nodeGameUpdateGameDisplay();

        // Check for new goal presentation based on distance condition (similar to 2P3G logic)
        window.ExpDesign.checkNewGoalPresentation1P2G();

        // Check win condition
        if (isGoalReached(gameData.player1, gameData.currentGoals)) {
            var finalGoal = whichGoalReached(gameData.player1, gameData.currentGoals);
            gameData.currentTrialData.player1FinalReachedGoal = finalGoal;
            console.log(`Player1 final reached goal: ${finalGoal}`);

            document.removeEventListener('keydown', handleKeyPress);
            if (gameLoopInterval) clearInterval(gameLoopInterval);

            window.DataRecording.finalizeTrial(true);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        }

        // Reset movement flag with a small delay to prevent rapid successive key presses
        setTimeout(() => {
            timeline.isMoving = false;
        }, NODEGAME_CONFIG.timing.movementDelay); // Configurable delay to prevent rapid successive movements
    }

    // Set up controls
    document.addEventListener('keydown', handleKeyPress);
    document.body.focus();

    // Game timeout
    gameLoopInterval = setInterval(() => {
        if (gameData.stepCount >= NODEGAME_CONFIG.maxGameLength) {
            document.removeEventListener('keydown', handleKeyPress);
            clearInterval(gameLoopInterval);

            window.DataRecording.finalizeTrial(false);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        }
    }, 100);
}

/**
 * Check trial end condition for 2P2G
 */
function checkTrialEnd2P2G(callback) {
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

        console.log(`2P2G Collaboration check: Player1 goal=${player1Goal}, Player2 goal=${player2Goal}, Collaboration=${collaboration}`);

        gameData.currentTrialData.collaborationSucceeded = collaboration;
        window.DataRecording.finalizeTrial(true);
        callback();
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

/**
 * Run 2P2G trial (AI moves simultaneously with human, but independently if human reaches goal)
 */
function runTrial2P2G() {
    var gameLoopInterval = null;
    var aiMoveInterval = null;
    var player1AtGoal = false;
    var independentAIMode = NodeGameConfig.isAIMovementModeEnabled();

    function handleKeyPress(event) {
        if (timeline.isMoving) {
            event.preventDefault();
            return; // Prevent multiple moves
        }

        var key = event.code;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

        // Check if player1 has already reached a goal - if so, don't allow further movement
        if (isGoalReached(gameData.player1, gameData.currentGoals)) {
            return;
        }

        timeline.isMoving = true;

        var direction = key.toLowerCase();
        var aimAction = DIRECTIONS[direction].movement;

        // Record move
        window.DataRecording.recordPlayer1Move(aimAction, Date.now() - gameData.gameStartTime);

        // Calculate player1 move
        var realAction = isValidMove(gameData.gridMatrix, gameData.player1, aimAction);
        var player1NextState = transition(gameData.player1, realAction);

        // Calculate player2 move simultaneously (before updating the grid)
        // Only if independent AI mode is disabled or if AI hasn't reached goal
        var player2Action = null;
        var player2NextState = null;
        // Only allow AI to move when human's action is valid (not a wall bump)
        var humanMoveIsValid = !(realAction[0] === 0 && realAction[1] === 0);
        if (!isGoalReached(gameData.player2, gameData.currentGoals) && !independentAIMode && humanMoveIsValid) {
            player2Action = getAIAction(gameData.gridMatrix, gameData.player2, gameData.currentGoals, gameData.player1);
            var player2RealAction = isValidMove(gameData.gridMatrix, gameData.player2, player2Action);
            player2NextState = transition(gameData.player2, player2RealAction);
        }

        // Execute both moves simultaneously
        // Update player1 position
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player1[0], gameData.player1[1], OBJECT.blank);
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player1NextState[0], player1NextState[1], OBJECT.player);
        gameData.player1 = player1NextState;

        // Update player2 position if player2 moved
        if (player2NextState) {
            gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player2[0], gameData.player2[1], OBJECT.blank);
            gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player2NextState[0], player2NextState[1], OBJECT.ai_player);
            gameData.player2 = player2NextState;
            window.DataRecording.recordPlayer2Move(player2Action); // Record player2 move after position is updated

            // Check if player2 reached goal and track when
            var player2AtGoal = isGoalReached(gameData.player2, gameData.currentGoals);
            if (player2AtGoal && gameData.currentTrialData.player2GoalReachedStep === -1) {
                // Player2 just reached goal - record the step
                gameData.currentTrialData.player2GoalReachedStep = gameData.stepCount;
                console.log(`Player2 reached goal at step ${gameData.stepCount}`);
            }
        }

        gameData.stepCount++;
        nodeGameUpdateGameDisplay();

        // ADD THIS: Detect and record first goals for both players
        var player1CurrentGoal = detectPlayerGoal(gameData.player1, aimAction, gameData.currentGoals, []);
        gameData.currentTrialData.player1CurrentGoal.push(player1CurrentGoal);
        
        var player2CurrentGoal = null;
        if (player2Action) {
            player2CurrentGoal = detectPlayerGoal(gameData.player2, player2Action, gameData.currentGoals, []);
        }

        // Record first detected goals
        if (player1CurrentGoal !== null && gameData.currentTrialData.player1FirstDetectedGoal === null) {
            gameData.currentTrialData.player1FirstDetectedGoal = player1CurrentGoal;
            console.log(`Player1 first detected goal: ${player1CurrentGoal}`);
        }
        if (player2CurrentGoal !== null && gameData.currentTrialData.player2FirstDetectedGoal === null) {
            gameData.currentTrialData.player2FirstDetectedGoal = player2CurrentGoal;
            console.log(`Player2 first detected goal: ${player2CurrentGoal}`);
        }

        // Check if player1 reached goal and track when
        var wasPlayer1AtGoal = player1AtGoal;
        player1AtGoal = isGoalReached(gameData.player1, gameData.currentGoals);
        if (!wasPlayer1AtGoal && player1AtGoal) {
            // Player1 just reached goal - record the step
            gameData.currentTrialData.player1GoalReachedStep = gameData.stepCount;
            console.log(`Player1 reached goal at step ${gameData.stepCount}`);
        }

        // Check win condition
        checkTrialEnd2P2G(() => {
            document.removeEventListener('keydown', handleKeyPress);
            if (gameLoopInterval) clearInterval(gameLoopInterval);
            if (aiMoveInterval) clearInterval(aiMoveInterval);
            if (goalCheckInterval) clearInterval(goalCheckInterval);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        });

        // Reset movement flag with a small delay to prevent rapid successive key presses
        setTimeout(() => {
            timeline.isMoving = false;
        }, NODEGAME_CONFIG.timing.movementDelay); // Configurable delay to prevent rapid successive movements
    }

    // Independent player2 movement when player1 has reached goal
    function makeIndependentPlayer2Move() {
        // Check if game data is valid
        if (!gameData || !gameData.player2 || !gameData.currentGoals || !gameData.gridMatrix) {
            return;
        }

        // Don't move if player2 has already reached a goal
        if (isGoalReached(gameData.player2, gameData.currentGoals)) {
            return;
        }

        var player2Action = getAIAction(gameData.gridMatrix, gameData.player2, gameData.currentGoals, gameData.player1);
        var player2RealAction = isValidMove(gameData.gridMatrix, gameData.player2, player2Action);
        var player2NextState = transition(gameData.player2, player2RealAction);

        window.DataRecording.recordPlayer2Move(player2Action);

        // Update player2 position
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player2[0], gameData.player2[1], OBJECT.blank);
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player2NextState[0], player2NextState[1], OBJECT.ai_player);
        gameData.player2 = player2NextState;

        gameData.stepCount++;
        nodeGameUpdateGameDisplay();

        // Check if player2 reached goal and track when
        var player2AtGoal = isGoalReached(gameData.player2, gameData.currentGoals);
        if (player2AtGoal && gameData.currentTrialData.player2GoalReachedStep === -1) {
            // Player2 just reached goal - record the step
            gameData.currentTrialData.player2GoalReachedStep = gameData.stepCount;
            console.log(`Player2 reached goal at step ${gameData.stepCount}`);
        }

        // Check win condition after AI move
        checkTrialEnd2P2G(() => {
            document.removeEventListener('keydown', handleKeyPress);
            if (gameLoopInterval) clearInterval(gameLoopInterval);
            if (aiMoveInterval) clearInterval(aiMoveInterval);
            if (goalCheckInterval) clearInterval(goalCheckInterval);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        });
    }

    // Start independent player2 movement when player1 reaches goal
    function startIndependentPlayer2Movement() {
        // Clear any existing interval
        if (aiMoveInterval) {
            clearInterval(aiMoveInterval);
            aiMoveInterval = null;
        }

        aiMoveInterval = setInterval(() => {
            // Check if game data is still valid
            if (!gameData || !gameData.player2 || !gameData.currentGoals) {
                console.log('Game data not available, clearing player2 movement interval');
                if (aiMoveInterval) {
                    clearInterval(aiMoveInterval);
                    aiMoveInterval = null;
                }
                return;
            }

            // Only move if player2 hasn't reached goal and player1 has reached goal
            if (!isGoalReached(gameData.player2, gameData.currentGoals) && player1AtGoal) {
                makeIndependentPlayer2Move();
            } else if (isGoalReached(gameData.player2, gameData.currentGoals)) {
                // Player2 reached goal, stop independent movement
                if (aiMoveInterval) {
                    clearInterval(aiMoveInterval);
                    aiMoveInterval = null;
                }
            }
        }, NODEGAME_CONFIG.rlAgent.independentAgentDelay);
    }

    // Start independent AI movement mode (AI moves freely with random intervals)
    function startIndependentAIMovement() {
        if (!independentAIMode) return;

        // Clear any existing interval
        if (aiMoveInterval) {
            clearInterval(aiMoveInterval);
            aiMoveInterval = null;
        }

        function scheduleNextAIMove() {
            if (!gameData || !gameData.player2 || !gameData.currentGoals) {
                return;
            }

            // Don't schedule if AI has reached goal
            if (isGoalReached(gameData.player2, gameData.currentGoals)) {
                return;
            }

            // Generate random delay within the configured range
            var minDelay = NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.min;
            var maxDelay = NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.max;
            var randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;

            setTimeout(() => {
                // Check if game is still active and AI hasn't reached goal
                if (gameData && gameData.player2 && gameData.currentGoals &&
                    !isGoalReached(gameData.player2, gameData.currentGoals)) {

                    // Make AI move
                    var player2Action = getAIAction(gameData.gridMatrix, gameData.player2, gameData.currentGoals, gameData.player1);
                    var player2RealAction = isValidMove(gameData.gridMatrix, gameData.player2, player2Action);
                    var player2NextState = transition(gameData.player2, player2RealAction);

                    window.DataRecording.recordPlayer2Move(player2Action);

                    // Update player2 position
                    gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player2[0], gameData.player2[1], OBJECT.blank);
                    gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player2NextState[0], player2NextState[1], OBJECT.ai_player);
                    gameData.player2 = player2NextState;

                    gameData.stepCount++;
                    nodeGameUpdateGameDisplay();

                    // Check if player2 reached goal and track when
                    var player2AtGoal = isGoalReached(gameData.player2, gameData.currentGoals);
                    if (player2AtGoal && gameData.currentTrialData.player2GoalReachedStep === -1) {
                        gameData.currentTrialData.player2GoalReachedStep = gameData.stepCount;
                        console.log(`Player2 reached goal at step ${gameData.stepCount}`);
                    }

                    // Check win condition after AI move
                    checkTrialEnd2P2G(() => {
                        document.removeEventListener('keydown', handleKeyPress);
                        if (gameLoopInterval) clearInterval(gameLoopInterval);
                        if (aiMoveInterval) clearInterval(aiMoveInterval);
                        if (goalCheckInterval) clearInterval(goalCheckInterval);
                        setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
                    });

                    // Schedule next move if game is still active
                    if (gameData && !isGoalReached(gameData.player2, gameData.currentGoals)) {
                        scheduleNextAIMove();
                    }
                }
            }, randomDelay);
        }

        // Start the independent AI movement
        scheduleNextAIMove();
    }

    // Set up controls
    document.addEventListener('keydown', handleKeyPress);
    document.body.focus();

    // Start independent AI movement if enabled
    if (independentAIMode) {
        console.log('Starting independent AI movement mode');
        startIndependentAIMovement();
    }

    // Game timeout
    gameLoopInterval = setInterval(() => {
        if (gameData.stepCount >= NODEGAME_CONFIG.maxGameLength) {
            document.removeEventListener('keydown', handleKeyPress);
            if (gameLoopInterval) clearInterval(gameLoopInterval);
            if (aiMoveInterval) clearInterval(aiMoveInterval);
            if (goalCheckInterval) clearInterval(goalCheckInterval);

            window.DataRecording.finalizeTrial(false);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        }
    }, 100);

    // Monitor for when player1 reaches goal to start independent player2 movement (only if not in independent AI mode)
    if (!independentAIMode) {
        var goalCheckInterval = setInterval(() => {
            // Check if game data is valid
            if (!gameData || !gameData.player1 || !gameData.player2 || !gameData.currentGoals) {
                return;
            }
            // Only start independent player2 movement if:
            // 1. Player1 has actually reached a goal (check current state, not just the flag)
            // 2. Player2 hasn't reached a goal yet
            // 3. Independent player2 movement isn't already running
            // 4. Player1 has made at least one move (stepCount > 0)
            if (gameData.stepCount > 0 &&
                isGoalReached(gameData.player1, gameData.currentGoals) &&
                !isGoalReached(gameData.player2, gameData.currentGoals) &&
                !aiMoveInterval) {
                startIndependentPlayer2Movement();
            }
        }, 100);
    }
}

/**
 * Run 2P3G trial
 */
function runTrial2P3G() {
    var gameLoopInterval = null;
    var aiMoveInterval = null;
    var player1AtGoal = false;
    var isFrozen = false; // Track if movement is frozen due to new goal
    var freezeTimeout = null; // Track freeze timeout
    var independentAIMode = NodeGameConfig.isAIMovementModeEnabled();

    // Reset 2P3G specific variables for new trial
    // Use global variables from expDesign.js
    newGoalPresented = false;
    newGoalPosition = null;
    isNewGoalCloserToPlayer2 = null;
    player1InferredGoals = [];
    player2InferredGoals = [];

    function handleKeyPress(event) {
        // Prevent multiple moves with more robust checking
        if (timeline.isMoving) {
            event.preventDefault();
            return; // Prevent multiple moves
        }

        var key = event.code;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

        // Check if movement is frozen due to new goal presentation
        if (isFrozen) {
            event.preventDefault();
            return;
        }

        // Check if player1 has already reached a goal - if so, don't allow further movement
        if (isGoalReached(gameData.player1, gameData.currentGoals)) {
            event.preventDefault();
            return;
        }

        // Set moving flag immediately to prevent race conditions
        timeline.isMoving = true;

        // Prevent default browser behavior for arrow keys and prevent key repeat
        event.preventDefault();
        event.stopPropagation();

        var direction = key.toLowerCase();
        var aimAction = DIRECTIONS[direction].movement;

        // Record move
        window.DataRecording.recordPlayer1Move(aimAction, Date.now() - gameData.gameStartTime);

        // Calculate player1 move
        var realAction = isValidMove(gameData.gridMatrix, gameData.player1, aimAction);
        var player1NextState = transition(gameData.player1, realAction);

        // Calculate player2 move simultaneously (before updating the grid)
        // Only if independent AI mode is disabled or if AI hasn't reached goal
        var player2Action = null;
        var player2NextState = null;
        // Only allow AI to move when human's action is valid (not a wall bump)
        var humanMoveIsValid = !(realAction[0] === 0 && realAction[1] === 0);
        if (!isGoalReached(gameData.player2, gameData.currentGoals) && !isFrozen && !independentAIMode && humanMoveIsValid) {
            player2Action = getAIAction(gameData.gridMatrix, gameData.player2, gameData.currentGoals, gameData.player1);
            var player2RealAction = isValidMove(gameData.gridMatrix, gameData.player2, player2Action);
            player2NextState = transition(gameData.player2, player2RealAction);
            window.DataRecording.recordPlayer2Move(player2Action);
        }

        // Execute both moves simultaneously
        // Update player1 position
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player1[0], gameData.player1[1], OBJECT.blank);
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player1NextState[0], player1NextState[1], OBJECT.player);
        gameData.player1 = player1NextState;

        // Update player2 position if player2 moved
        if (player2NextState) {
            gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player2[0], gameData.player2[1], OBJECT.blank);
            gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player2NextState[0], player2NextState[1], OBJECT.ai_player);
            gameData.player2 = player2NextState;
            window.DataRecording.recordPlayer2Move(player2Action); // Record player2 move after position is updated
        }

        // Detect player goals with history tracking (matching original)
        var player1CurrentGoal = detectPlayerGoal(gameData.player1, aimAction, gameData.currentGoals, player1InferredGoals);
        gameData.currentTrialData.player1CurrentGoal.push(player1CurrentGoal);

        // Update goal history
        if (player1CurrentGoal !== null) {
            player1InferredGoals.push(player1CurrentGoal);
        }

        // Detect player2 goals with history tracking (matching original)
        if (player2Action) {
            var player2CurrentGoal = detectPlayerGoal(gameData.player2, player2Action, gameData.currentGoals, player2InferredGoals);
            gameData.currentTrialData.player2CurrentGoal.push(player2CurrentGoal);

            // Update goal history
            if (player2CurrentGoal !== null) {
                player2InferredGoals.push(player2CurrentGoal);
            }
        }

        // ADD THIS: Record first detected goals and shared goal
        if (player1CurrentGoal !== null && gameData.currentTrialData.player1FirstDetectedGoal === null) {
            gameData.currentTrialData.player1FirstDetectedGoal = player1CurrentGoal;
            console.log(`Player1 first detected goal: ${player1CurrentGoal}`);
        }
        if (player2Action && player2CurrentGoal !== null && gameData.currentTrialData.player2FirstDetectedGoal === null) {
            gameData.currentTrialData.player2FirstDetectedGoal = player2CurrentGoal;
            console.log(`Player2 first detected goal: ${player2CurrentGoal}`);
        }
        // Record first detected shared goal (2P3G only)
        if (player1CurrentGoal !== null && player2Action && player2CurrentGoal !== null &&
            player1CurrentGoal === player2CurrentGoal &&
            gameData.currentTrialData.firstDetectedSharedGoal === null) {
            gameData.currentTrialData.firstDetectedSharedGoal = player1CurrentGoal;
            console.log(`First detected shared goal: ${player1CurrentGoal}`);
        }

        gameData.stepCount++;
        nodeGameUpdateGameDisplay();

        // Check for new goal presentation (matching original logic)
        window.ExpDesign.checkNewGoalPresentation2P3G();

        // Check if player1 reached goal
        player1AtGoal = isGoalReached(gameData.player1, gameData.currentGoals);

        // Check win condition
        window.ExpDesign.checkTrialEnd2P3G(() => {
            document.removeEventListener('keydown', handleKeyPress);
            timeline.keyListenerActive = false;
            if (gameLoopInterval) clearInterval(gameLoopInterval);
            if (aiMoveInterval) clearInterval(aiMoveInterval);
            if (goalCheckInterval) clearInterval(goalCheckInterval);
            if (freezeTimeout) clearTimeout(freezeTimeout);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        });

        // Reset movement flag with a small delay to prevent rapid successive key presses
        setTimeout(() => {
            timeline.isMoving = false;
        }, NODEGAME_CONFIG.timing.movementDelay); // Configurable delay to prevent rapid successive movements
    }

    // Function to start freeze period when new goal appears
    function startFreezePeriod() {
        isFrozen = true;

        // Clear any existing freeze timeout
        if (freezeTimeout) {
            clearTimeout(freezeTimeout);
        }

        // Set timeout to end freeze period - coordinate with message display duration
        freezeTimeout = setTimeout(() => {
            isFrozen = false;
        }, NODEGAME_CONFIG.timing.newGoalMessageDuration); // Use message duration instead of separate freeze duration
    }

    // Independent player2 movement when player1 has reached goal
    function makeIndependentPlayer2Move() {
        // Check if game data is valid
        if (!gameData || !gameData.player2 || !gameData.currentGoals || !gameData.gridMatrix) {
            return;
        }

        // Don't move if player2 has already reached a goal or if movement is frozen
        if (isGoalReached(gameData.player2, gameData.currentGoals) || isFrozen) {
            return;
        }

        var player2Action = getAIAction(gameData.gridMatrix, gameData.player2, gameData.currentGoals, gameData.player1);
        var player2RealAction = isValidMove(gameData.gridMatrix, gameData.player2, player2Action);
        var player2NextState = transition(gameData.player2, player2RealAction);

        window.DataRecording.recordPlayer2Move(player2Action);

        // Update player2 position
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player2[0], gameData.player2[1], OBJECT.blank);
        gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player2NextState[0], player2NextState[1], OBJECT.ai_player);
        gameData.player2 = player2NextState;

        // Detect player2 goals with history tracking (matching original)
        var player2CurrentGoal = detectPlayerGoal(gameData.player2, player2Action, gameData.currentGoals, player2InferredGoals);
        gameData.currentTrialData.player2CurrentGoal.push(player2CurrentGoal);

        // Update goal history
        if (player2CurrentGoal !== null) {
            player2InferredGoals.push(player2CurrentGoal);
        }

        gameData.stepCount++;
        nodeGameUpdateGameDisplay();

        // Check for new goal presentation (matching original logic)
        window.ExpDesign.checkNewGoalPresentation2P3G();

        // Check win condition after player2 move
        window.ExpDesign.checkTrialEnd2P3G(() => {
            document.removeEventListener('keydown', handleKeyPress);
            timeline.keyListenerActive = false;
            if (gameLoopInterval) clearInterval(gameLoopInterval);
            if (aiMoveInterval) clearInterval(aiMoveInterval);
            if (goalCheckInterval) clearInterval(goalCheckInterval);
            if (freezeTimeout) clearTimeout(freezeTimeout);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        });
    }

    // Start independent player2 movement when player1 reaches goal
    function startIndependentPlayer2Movement() {
        // Clear any existing interval
        if (aiMoveInterval) {
            clearInterval(aiMoveInterval);
            aiMoveInterval = null;
        }

        aiMoveInterval = setInterval(() => {
            // Check if game data is still valid
            if (!gameData || !gameData.player2 || !gameData.currentGoals) {
                console.log('Game data not available, clearing player2 movement interval');
                if (aiMoveInterval) {
                    clearInterval(aiMoveInterval);
                    aiMoveInterval = null;
                }
                return;
            }

            // Only move if player2 hasn't reached goal and player1 has reached goal
            if (!isGoalReached(gameData.player2, gameData.currentGoals) && player1AtGoal) {
                makeIndependentPlayer2Move();
            } else if (isGoalReached(gameData.player2, gameData.currentGoals)) {
                // Player2 reached goal, stop independent movement
                if (aiMoveInterval) {
                    clearInterval(aiMoveInterval);
                    aiMoveInterval = null;
                }
            }
        }, NODEGAME_CONFIG.rlAgent.independentAgentDelay);
    }

    // Start independent AI movement mode (AI moves freely with random intervals)
    function startIndependentAIMovement() {
        if (!independentAIMode) return;

        // Clear any existing interval
        if (aiMoveInterval) {
            clearInterval(aiMoveInterval);
            aiMoveInterval = null;
        }

        function scheduleNextAIMove() {
            if (!gameData || !gameData.player2 || !gameData.currentGoals) {
                return;
            }

            // Don't schedule if AI has reached goal or if movement is frozen
            if (isGoalReached(gameData.player2, gameData.currentGoals) || isFrozen) {
                return;
            }

            // Generate random delay within the configured range
            var minDelay = NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.min;
            var maxDelay = NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.max;
            var randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;

            setTimeout(() => {
                // Check if game is still active and AI hasn't reached goal and not frozen
                if (gameData && gameData.player2 && gameData.currentGoals &&
                    !isGoalReached(gameData.player2, gameData.currentGoals) && !isFrozen) {

                    // Make AI move
                    var player2Action = getAIAction(gameData.gridMatrix, gameData.player2, gameData.currentGoals, gameData.player1);
                    var player2RealAction = isValidMove(gameData.gridMatrix, gameData.player2, player2Action);
                    var player2NextState = transition(gameData.player2, player2RealAction);

                    window.DataRecording.recordPlayer2Move(player2Action);

                    // Update player2 position
                    gameData.gridMatrix = updateMatrix(gameData.gridMatrix, gameData.player2[0], gameData.player2[1], OBJECT.blank);
                    gameData.gridMatrix = updateMatrix(gameData.gridMatrix, player2NextState[0], player2NextState[1], OBJECT.ai_player);
                    gameData.player2 = player2NextState;

                    // Detect player2 goals with history tracking (matching original)
                    var player2CurrentGoal = detectPlayerGoal(gameData.player2, player2Action, gameData.currentGoals, player2InferredGoals);
                    gameData.currentTrialData.player2CurrentGoal.push(player2CurrentGoal);

                    // Update goal history
                    if (player2CurrentGoal !== null) {
                        player2InferredGoals.push(player2CurrentGoal);
                    }

                    // Record first detected goals for AI
                    if (player2CurrentGoal !== null && gameData.currentTrialData.player2FirstDetectedGoal === null) {
                        gameData.currentTrialData.player2FirstDetectedGoal = player2CurrentGoal;
                        console.log(`Player2 first detected goal: ${player2CurrentGoal}`);
                    }

                    gameData.stepCount++;
                    nodeGameUpdateGameDisplay();

                    // Check for new goal presentation (matching original logic)
                    window.ExpDesign.checkNewGoalPresentation2P3G();

                    // Check win condition after AI move
                    window.ExpDesign.checkTrialEnd2P3G(() => {
                        document.removeEventListener('keydown', handleKeyPress);
                        timeline.keyListenerActive = false;
                        if (gameLoopInterval) clearInterval(gameLoopInterval);
                        if (aiMoveInterval) clearInterval(aiMoveInterval);
                        if (goalCheckInterval) clearInterval(goalCheckInterval);
                        if (freezeTimeout) clearTimeout(freezeTimeout);
                        setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
                    });

                    // Schedule next move if game is still active
                    if (gameData && !isGoalReached(gameData.player2, gameData.currentGoals)) {
                        scheduleNextAIMove();
                    }
                }
            }, randomDelay);
        }

        // Start the independent AI movement
        scheduleNextAIMove();
    }

    // Set up controls - prevent multiple listeners
    if (timeline.keyListenerActive) {
        console.log('Removing existing key listener before adding new one');
        document.removeEventListener('keydown', handleKeyPress);
    }
    document.addEventListener('keydown', handleKeyPress);
    timeline.keyListenerActive = true;
    document.body.focus();

    // Start independent AI movement if enabled
    if (independentAIMode) {
        console.log('Starting independent AI movement mode for 2P3G');
        startIndependentAIMovement();
    }

    // Game timeout
    gameLoopInterval = setInterval(() => {
        if (gameData.stepCount >= NODEGAME_CONFIG.maxGameLength) {
            document.removeEventListener('keydown', handleKeyPress);
            timeline.keyListenerActive = false;
            if (gameLoopInterval) clearInterval(gameLoopInterval);
            if (aiMoveInterval) clearInterval(aiMoveInterval);
            if (goalCheckInterval) clearInterval(goalCheckInterval);
            if (freezeTimeout) clearTimeout(freezeTimeout);

            window.DataRecording.finalizeTrial(false);
            setTimeout(() => nextStage(), NODEGAME_CONFIG.timing.trialToFeedbackDelay);
        }
    }, 100);

    // Monitor for when player1 reaches goal to start independent player2 movement (only if not in independent AI mode)
    if (!independentAIMode) {
        var goalCheckInterval = setInterval(() => {
            // Check if game data is valid
            if (!gameData || !gameData.player1 || !gameData.player2 || !gameData.currentGoals) {
                return;
            }
            // Only start independent player2 movement if:
            // 1. Player1 has actually reached a goal (check current state, not just the flag)
            // 2. Player2 hasn't reached a goal yet
            // 3. Independent player2 movement isn't already running
            // 4. Player1 has made at least one move (stepCount > 0)
            if (gameData.stepCount > 0 &&
                isGoalReached(gameData.player1, gameData.currentGoals) &&
                !isGoalReached(gameData.player2, gameData.currentGoals) &&
                !aiMoveInterval) {
                console.log('2P2G: Starting independent player2 movement - player1 reached goal, player2 has not (slower pace: ' + NODEGAME_CONFIG.rlAgent.independentAgentDelay + 'ms)');
                startIndependentPlayer2Movement();
            }
        }, 100);
    }

    // Override the checkNewGoalPresentation2P3G function to trigger freeze
    var originalCheckNewGoal = checkNewGoalPresentation2P3G;
    checkNewGoalPresentation2P3G = function(callback) {
        var wasNewGoalPresented = newGoalPresented;

        // Call the original function
        originalCheckNewGoal(callback);

        // If a new goal was just presented, start the freeze period
        if (!wasNewGoalPresented && newGoalPresented) {
            startFreezePeriod();
        }
    };
}

// Export functions for module usage
window.TrialHandlers = {
    getAIAction: getAIAction,
    runTrialStage: runTrialStage,
    runExperimentTrial: runExperimentTrial,
    runTrial1P1G: runTrial1P1G,
    runTrial1P2G: runTrial1P2G,
    runTrial2P2G: runTrial2P2G,
    runTrial2P3G: runTrial2P3G,
    checkTrialEnd2P2G: checkTrialEnd2P2G
};