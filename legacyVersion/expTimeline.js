/**
 * Create timeline stages for all experiments
 */
function createTimelineStages() {
    timeline.stages = [];
    timeline.mapData = {};

    // Add consent stage (only once at the beginning)
    timeline.stages.push({
        type: 'consent',
        handler: showConsentStage
    });

    timeline.stages.push({
        type: 'welcome_info',
        handler: showWelcomeInfoStage
    });


    // Add stages for each experiment in order
    for (var expIndex = 0; expIndex < NODEGAME_CONFIG.experimentOrder.length; expIndex++) {
        var experimentType = NODEGAME_CONFIG.experimentOrder[expIndex];
        var numTrials = NODEGAME_CONFIG.numTrials[experimentType];

        // Select maps for this experiment
        console.log(`📋 Creating timeline for experiment: ${experimentType}`);
        var experimentMaps = getMapsForExperiment(experimentType);
        console.log(`📋 Available maps for ${experimentType}:`, experimentMaps);
        var selectedMaps = selectRandomMaps(experimentMaps, numTrials);
        console.log(`📋 Selected ${selectedMaps.length} maps for ${experimentType}:`, selectedMaps);
        timeline.mapData[experimentType] = selectedMaps;

        // Generate randomized distance condition sequence for 1P2G experiments
        if (experimentType === '1P2G') {
            ONEP2G_CONFIG.distanceConditionSequence = generateRandomized1P2GDistanceSequence(numTrials);
        }

        // Generate randomized distance condition sequence for 2P3G experiments
        if (experimentType === '2P3G') {
            TWOP3G_CONFIG.distanceConditionSequence = generateRandomizedDistanceSequence(numTrials);
        }

        // Add welcome screen for this experiment (uncomment if needed)
        // timeline.stages.push({
        //     type: 'welcome',
        //     experimentType: experimentType,
        //     experimentIndex: expIndex,
        //     handler: showWelcomeStage
        // });

        // Add instructions stage for this experiment (uncomment if needed)
        timeline.stages.push({
            type: 'instructions',
            experimentType: experimentType,
            experimentIndex: expIndex,
            handler: showInstructionsStage
        });

        // Add waiting for partner stage only for 2P experiments (when starting 2P2G)
        if (experimentType.includes('2P2G')) {
            timeline.stages.push({
                type: 'waiting_for_partner',
                experimentType: experimentType,
                experimentIndex: expIndex,
                handler: showWaitingForPartnerStage
            });
        }

        // For collaboration games, create stages dynamically based on success threshold
        if (experimentType.includes('2P') && NODEGAME_CONFIG.successThreshold.enabled) {
            // Add a single trial stage that will be repeated dynamically
            addCollaborationExperimentStages(experimentType, expIndex, 0);
        } else {
            // Add trial stages for this experiment (fixed number)
            for (var i = 0; i < numTrials; i++) {
                addTrialStages(experimentType, expIndex, i);
            }
        }
    }
    // Add game feedback stage (only once at the end, before questionnaire)
    timeline.stages.push({
        type: 'game-feedback',
        handler: showGameFeedbackStage
    });

    // Add post-questionnaire stage (only once at the end, before completion)
    timeline.stages.push({
        type: 'questionnaire',
        handler: showQuestionnaireStage
    });

    // Add end experiment info stage
    timeline.stages.push({
        type: 'end-info',
        handler: showEndExperimentInfoStage
    });

    // Add Prolific redirect stage
    timeline.stages.push({
        type: 'prolific-redirect',
        handler: showProlificRedirectStage
    });


}

/**
 * Add trial stages for a specific trial
 * @param {string} experimentType - Type of experiment
 * @param {number} experimentIndex - Index of experiment
 * @param {number} trialIndex - Index of trial
 */
function addTrialStages(experimentType, experimentIndex, trialIndex) {
    // Fixation screen (500ms, matching jsPsych) - first thing shown for each trial
    timeline.stages.push({
        type: 'fixation',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: showFixationStage
    });

    // Main trial
    timeline.stages.push({
        type: 'trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: runTrialStage
    });

    // Post-trial feedback
    timeline.stages.push({
        type: 'post-trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: showPostTrialStage
    });
}

// Timeline Stage Handlers

/**
 * Show consent stage
 */
function showConsentStage(stage) {
    const container = document.getElementById('container');
    container.innerHTML = `
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

                    <button onclick="window.close()" style="background: #6c757d; color: white; border: none; padding: 12px 30px; font-size: 16px; border-radius: 5px; cursor: pointer;">
                        Decline and Exit
                    </button>
                </div>
            </div>
        </div>
    `;

    // Handle consent checkbox
    const checkbox = document.getElementById('consentCheckbox');
    const continueBtn = document.getElementById('continueBtn');

    checkbox.addEventListener('change', function () {
        if (this.checked) {
            continueBtn.disabled = false;
            continueBtn.style.cursor = 'pointer';
            continueBtn.style.background = '#28a745';
        } else {
            continueBtn.disabled = true;
            continueBtn.style.cursor = 'not-allowed';
            continueBtn.style.background = '#ccc';
        }
    });

    continueBtn.addEventListener('click', function () {
        if (!this.disabled) {
            nextStage();
        }
    });
}


/**
 * Show welcome info stage
 */
function showWelcomeInfoStage(stage) {
    var container = document.getElementById('container');

    container.innerHTML = `
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

    // Handle spacebar to continue
    function handleSpacebar(event) {
        if (event.code === 'Space' || event.key === ' ') {
            event.preventDefault();
            document.removeEventListener('keydown', handleSpacebar);
            nextStage();
        }
    }

    document.addEventListener('keydown', handleSpacebar);
    document.body.focus();
}



/**
 * Show instructions stage
 */
function showInstructionsStage(stage) {
    var container = document.getElementById('container');
    var experimentType = stage.experimentType;
    var experimentIndex = stage.experimentIndex;

    // Update current experiment state
    gameData.currentExperiment = experimentType;
    gameData.currentExperimentIndex = experimentIndex;

    // Initialize success threshold tracking for collaboration games
    if (experimentType.includes('2P')) {
        console.log(`Initializing success threshold tracking for ${experimentType}`);

        // Try to find the appropriate initialization function
        if (typeof initializeSuccessThresholdTracking === 'function') {
            initializeSuccessThresholdTracking();
        } else if (window.ExpDesign && typeof window.ExpDesign.initializeSuccessThresholdTracking === 'function') {
            window.ExpDesign.initializeSuccessThresholdTracking();
        } else {
            console.warn('initializeSuccessThresholdTracking function not available');
        }
    }

    container.innerHTML = getInstructionsForExperiment(experimentType);

    // Handle spacebar to continue
    function handleSpacebar(event) {
        if (event.code === 'Space') {
            event.preventDefault();
            document.removeEventListener('keydown', handleSpacebar);
            nextStage();
        }
    }

    document.addEventListener('keydown', handleSpacebar);
    document.body.focus();
}



/**
 * Show fixation stage (configurable duration)
 */
function showFixationStage(stage) {
    var container = document.getElementById('container');
    var trialIndex = stage.trialIndex;
    var experimentType = stage.experimentType;
    var experimentIndex = stage.experimentIndex;
    var currentDesign = timeline.mapData[experimentType][trialIndex];

    // Create empty grid matrix for fixation (no objects)
    gameData.gridMatrix = Array(EXPSETTINGS.matrixsize).fill(0).map(() => Array(EXPSETTINGS.matrixsize).fill(0));

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="text-align: center;">
                <div id="gameCanvas" style="margin-bottom: 20px;"></div>
            </div>
        </div>
    `;

    // Create and draw canvas with fixation
    var canvas = nodeGameCreateGameCanvas();
    document.getElementById('gameCanvas').appendChild(canvas);
    nodeGameDrawFixationDisplay(canvas);

    // Pre-calculate joint-RL policy for human-AI collaboration games during fixation to eliminate initial lag
    // Note: This is only needed for human-AI experiments, not human-human experiments
    if (experimentType.includes('2P') && window.RLAgent && window.RLAgent.precalculatePolicyForGoals) {
        // Get the design for this trial to extract goals
        var design = getRandomMapForCollaborationGame(experimentType, trialIndex);
        if (design) {
            var goals = [design.target1];
            if (design.target2) {
                goals.push(design.target2);
            }

            console.log('⚡ Pre-calculating joint-RL policy during fixation for human-AI goals:', goals.map(g => `[${g}]`).join(', '));

            // Pre-calculate in background during fixation
            setTimeout(() => {
                window.RLAgent.precalculatePolicyForGoals(goals, experimentType);
            }, 100); // Small delay to ensure UI is rendered first
        }
    }

    // Auto-advance after configurable duration
    setTimeout(() => {
        nextStage();
    }, NODEGAME_CONFIG.timing.fixationDuration);
}





/**
 * Show post-trial feedback stage
 */
function showPostTrialStage(stage) {
    var container = document.getElementById('container');
    var trialIndex = stage.trialIndex;
    var experimentType = stage.experimentType;
    var experimentIndex = stage.experimentIndex;
    var lastTrialData = gameData.allTrialsData[gameData.allTrialsData.length - 1];

    var success = lastTrialData.completed;
    var message = success ? 'Goal reached!' : 'Time up!';
    var color = success ? 'blue' : 'orange';

    // For collaboration games, show dynamic trial count
    var trialCountDisplay = '';
    if (experimentType.includes('2P') && NODEGAME_CONFIG.successThreshold.enabled) {
        trialCountDisplay = `Round ${trialIndex + 1}`;
    } else {
        trialCountDisplay = `Round ${trialIndex + 1}`;
    }

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="text-align: center; max-width: 600px; width: 100%;">
                <h3 style="margin-bottom: 10px;">Game ${experimentIndex + 1}</h3>
                <h4 style="margin-bottom: 20px;">${trialCountDisplay} Results</h4>
                <div id="gameCanvas" style="margin: 0 auto 20px auto; position: relative; display: flex; justify-content: center;"></div>
            </div>
        </div>
    `;

    // Create and draw canvas with final state
    var canvas;
    if (typeof nodeGameCreateGameCanvas === 'function') {
        canvas = nodeGameCreateGameCanvas();
    } else if (typeof createGameCanvas === 'function') {
        canvas = createGameCanvas();
    } else {
        console.error('No canvas creation function available');
        return;
    }
    var canvasContainer = document.getElementById('gameCanvas');
    canvasContainer.appendChild(canvas);

    // Use the appropriate rendering function based on experiment type
    if (experimentType.includes('1P') || experimentType.includes('2P')) {
        // For human-human experiments, use the fallback rendering
        if (typeof renderGameBoardFallback === 'function') {
            renderGameBoardFallback();
        } else {
            console.warn('renderGameBoardFallback not available, using nodeGameUpdateGameDisplay');
            nodeGameUpdateGameDisplay();
        }
    } else {
        // For human-AI experiments, use the original function
        nodeGameUpdateGameDisplay();
    }

    // Add visual feedback overlay on top of the canvas
    if (experimentType.includes('2P') && lastTrialData.collaborationSucceeded !== undefined) {
        // For 2P experiments, use collaboration feedback overlay
        createTrialFeedbackOverlay(canvasContainer, lastTrialData.collaborationSucceeded, 'collaboration');
    } else if (experimentType.includes('1P')) {
        // For 1P experiments, use single player feedback overlay
        createTrialFeedbackOverlay(canvasContainer, success, 'single');
    }

    // Auto-advance after configurable duration
    setTimeout(() => {
        console.log(`Post-trial auto-advance: experimentType=${experimentType}, trialIndex=${trialIndex}`);

        // Check if we should end the experiment early due to success threshold
        var shouldEndDueToThreshold = false;
        if (typeof shouldEndExperimentDueToSuccessThreshold === 'function') {
            shouldEndDueToThreshold = shouldEndExperimentDueToSuccessThreshold();
        } else if (window.ExpDesign && typeof window.ExpDesign.shouldEndExperimentDueToSuccessThreshold === 'function') {
            shouldEndDueToThreshold = window.ExpDesign.shouldEndExperimentDueToSuccessThreshold();
        }

        if (shouldEndDueToThreshold) {
            console.log('Ending experiment due to success threshold - will skip to game-feedback or next experiment');
            // Skip to the end of this experiment by finding the next experiment or completion stage
            skipToNextExperimentOrCompletion();
        } else {
            // For collaboration games, check if we should continue to next trial
            if (experimentType.includes('2P') && NODEGAME_CONFIG.successThreshold.enabled) {
                var shouldContinue = true;
                if (typeof shouldContinueToNextTrial === 'function') {
                    shouldContinue = shouldContinueToNextTrial(experimentType, trialIndex);
                } else if (window.ExpDesign && typeof window.ExpDesign.shouldContinueToNextTrial === 'function') {
                    shouldContinue = window.ExpDesign.shouldContinueToNextTrial(experimentType, trialIndex);
                }

                console.log(`Should continue to next trial: ${shouldContinue}`);

                if (shouldContinue) {
                    console.log('Continuing to next trial for collaboration game');
                    // Add the next trial stages dynamically
                    addNextTrialStages(experimentType, experimentIndex, trialIndex + 1);
                    nextStage();
                } else {
                    console.log('Ending collaboration experiment - will skip to game-feedback or next experiment');
                    // End this experiment and move to next
                    skipToNextExperimentOrCompletion();
                }
            } else {
                console.log('Continuing to next stage normally');
                nextStage();
            }
        }
    }, NODEGAME_CONFIG.timing.feedbackDisplayDuration);
}



/**
 * Skip to the next experiment or completion stage
 */
function skipToNextExperimentOrCompletion() {
    var currentStage = timeline.stages[timeline.currentStage];
    var currentExperimentType = currentStage.experimentType;

    console.log(`Skipping to next experiment or completion from ${currentExperimentType}`);

    // Find the next stage that's either a different experiment, end-info, or completion
    var nextStageIndex = timeline.currentStage + 1;
    console.log(`Starting search from stage ${nextStageIndex}`);
    console.log(`Total stages in timeline: ${timeline.stages.length}`);

    while (nextStageIndex < timeline.stages.length) {
        var nextStage = timeline.stages[nextStageIndex];
        console.log(`Checking stage ${nextStageIndex}: ${nextStage.type} - ${nextStage.handler ? nextStage.handler.name : 'no handler'}`);

        // If it's a different experiment type, game-feedback stage, questionnaire stage, end-info stage, or completion stage, stop here
        if (nextStage.type === 'complete' || nextStage.type === 'end-info' || nextStage.type === 'game-feedback' || nextStage.type === 'questionnaire' ||
            (nextStage.experimentType && nextStage.experimentType !== currentExperimentType)) {
            console.log(`Found stopping point: ${nextStage.type}`);
            break;
        }
        nextStageIndex++;
    }

    // Set the current stage to the found stage
    timeline.currentStage = nextStageIndex;

    // If we found a valid next stage and it's a different experiment, reset success threshold
    if (timeline.currentStage < timeline.stages.length) {
        var nextStage = timeline.stages[timeline.currentStage];
        if (nextStage.experimentType && nextStage.experimentType !== currentExperimentType) {
            console.log(`Switching from ${currentExperimentType} to ${nextStage.experimentType} - resetting success threshold`);

            // Try to find the appropriate initialization function
            if (typeof initializeSuccessThresholdTracking === 'function') {
                initializeSuccessThresholdTracking();
            } else if (window.ExpDesign && typeof window.ExpDesign.initializeSuccessThresholdTracking === 'function') {
                window.ExpDesign.initializeSuccessThresholdTracking();
            } else {
                console.warn('initializeSuccessThresholdTracking function not available');
            }
        }
        console.log(`Skipped to stage ${timeline.currentStage}: ${nextStage.type}`);
        if (nextStage.handler) {
            nextStage.handler(nextStage);
        } else {
            console.warn(`No handler for stage: ${nextStage.type}`);
            nextStage();
        }
    } else {
        console.log('No more stages to run');
    }
}

/**
 * Add next trial stages
 */
function addNextTrialStages(experimentType, experimentIndex, trialIndex) {
    // Find the current post-trial stage index
    var currentStageIndex = timeline.currentStage;

    // Insert the next trial stages after the current post-trial stage
    var stagesToInsert = [
        {
            type: 'fixation',
            experimentType: experimentType,
            experimentIndex: experimentIndex,
            trialIndex: trialIndex,
            handler: showFixationStage
        },
        {
            type: 'trial',
            experimentType: experimentType,
            experimentIndex: experimentIndex,
            trialIndex: trialIndex,
            handler: runTrialStage
        },
        {
            type: 'post-trial',
            experimentType: experimentType,
            experimentIndex: experimentIndex,
            trialIndex: trialIndex,
            handler: showPostTrialStage
        }
    ];

    // Insert stages after current stage
    timeline.stages.splice(currentStageIndex + 1, 0, ...stagesToInsert);

    console.log(`Added next trial stages for ${experimentType} trial ${trialIndex + 1}`);
}

function addCollaborationExperimentStages(experimentType, experimentIndex, trialIndex) {
    // Fixation screen
    timeline.stages.push({
        type: 'fixation',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: showFixationStage
    });

    // Main trial
    timeline.stages.push({
        type: 'trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: runTrialStage
    });

    // Post-trial feedback with dynamic continuation
    timeline.stages.push({
        type: 'post-trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: showPostTrialStage
    });
}

/**
 * Show post-questionnaire stage (matching testExpWithAI.js)
 */
function showQuestionnaireStage(stage) {
    var container = document.getElementById('container');

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; width: 100%;">
                <h2 style="color: #333; margin-bottom: 30px; text-align: center;">Post-Experiment Questionnaire</h2>

                <form id="questionnaireForm">
                    <div id="questionnairePage1">
                        <h3 style="color: #666; margin-bottom: 20px;">Page 1 of 2</h3>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                Do you think the other player is a person or an AI?
                            </label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="ai_detection" value="Definitely a person" required style="margin-right: 10px;">
                                    Definitely a person
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="ai_detection" value="Probably a person" required style="margin-right: 10px;">
                                    Probably a person
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="ai_detection" value="Not sure" required style="margin-right: 10px;">
                                    Not sure
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="ai_detection" value="Probably an AI" required style="margin-right: 10px;">
                                    Probably an AI
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="ai_detection" value="Definitely an AI" required style="margin-right: 10px;">
                                    Definitely an AI
                                </label>
                            </div>
                        </div>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                To what extent do you think the other player was a good collaborator?
                            </label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="collaboration_rating" value="Very poor collaborator" required style="margin-right: 10px;">
                                    Very poor collaborator
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="collaboration_rating" value="Poor collaborator" required style="margin-right: 10px;">
                                    Poor collaborator
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="collaboration_rating" value="Neutral" required style="margin-right: 10px;">
                                    Neutral
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="collaboration_rating" value="Good collaborator" required style="margin-right: 10px;">
                                    Good collaborator
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="collaboration_rating" value="Very good collaborator" required style="margin-right: 10px;">
                                    Very good collaborator
                                </label>
                            </div>
                        </div>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                Have you ever told a lie?
                            </label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="attention_check" value="Definitely yes" required style="margin-right: 10px;">
                                    Definitely yes
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="attention_check" value="Probably yes" required style="margin-right: 10px;">
                                    Probably yes
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="attention_check" value="Not sure" required style="margin-right: 10px;">
                                    Not sure
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="attention_check" value="Probably not" required style="margin-right: 10px;">
                                    Probably not
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="attention_check" value="Definitely not" required style="margin-right: 10px;">
                                    Definitely not
                                </label>
                            </div>
                        </div>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                Will you play with the other player again?
                            </label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="play_again" value="Definitely not play again" required style="margin-right: 10px;">
                                    Definitely not play again
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="play_again" value="Probably not play again" required style="margin-right: 10px;">
                                    Probably not play again
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="play_again" value="Not sure" required style="margin-right: 10px;">
                                    Not sure
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="play_again" value="Probably play again" required style="margin-right: 10px;">
                                    Probably play again
                                </label>
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="radio" name="play_again" value="Definitely play again" required style="margin-right: 10px;">
                                    Definitely play again
                                </label>
                            </div>
                        </div>
                        <div style="text-align: center; margin-top: 30px;">
                            <button type="button" id="nextPageBtn" style="
                                background: #007bff;
                                color: white;
                                border: none;
                                padding: 12px 24px;
                                font-size: 16px;
                                border-radius: 5px;
                                cursor: pointer;
                            ">Next Page</button>
                        </div>
                    </div>

                    <div id="questionnairePage2" style="display: none;">
                        <h3 style="color: #666; margin-bottom: 20px;">Page 2 of 2</h3>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                Did you use any strategy in the game? If yes, what was it?
                            </label>
                            <textarea name="strategy" rows="4" style="
                                width: 100%;
                                padding: 10px;
                                border: 1px solid #ddd;
                                border-radius: 5px;
                                font-family: inherit;
                                resize: vertical;
                            " placeholder="Please describe your strategy..."></textarea>
                        </div>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                Is this your first time using a computer?
                            </label>
                            <textarea name="computer_experience_page2" rows="4" style="
                                width: 100%;
                                padding: 10px;
                                border: 1px solid #ddd;
                                border-radius: 5px;
                                font-family: inherit;
                                resize: vertical;
                            " placeholder="Please answer yes or no..."></textarea>
                        </div>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                What do you think the purpose of this experiment is?
                            </label>
                            <textarea name="purpose" rows="4" style="
                                width: 100%;
                                padding: 10px;
                                border: 1px solid #ddd;
                                border-radius: 5px;
                                font-family: inherit;
                                resize: vertical;
                            " placeholder="Please share your thoughts..."></textarea>
                        </div>

                        <div style="margin-bottom: 25px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                                Do you have any questions or comments?
                            </label>
                            <textarea name="comments" rows="4" style="
                                width: 100%;
                                padding: 10px;
                                border: 1px solid #ddd;
                                border-radius: 5px;
                                font-family: inherit;
                                resize: vertical;
                            " placeholder="Any additional feedback..."></textarea>
                        </div>

                        <div style="text-align: center; margin-top: 30px;">
                            <button type="button" id="prevPageBtn" style="
                                background: #6c757d;
                                color: white;
                                border: none;
                                padding: 12px 24px;
                                font-size: 16px;
                                border-radius: 5px;
                                cursor: pointer;
                                margin-right: 10px;
                            ">Previous Page</button>
                            <button type="submit" id="submitBtn" style="
                                background: #28a745;
                                color: white;
                                border: none;
                                padding: 12px 24px;
                                font-size: 16px;
                                border-radius: 5px;
                                cursor: pointer;
                            ">Submit</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Handle page navigation
    document.getElementById('nextPageBtn').addEventListener('click', function () {
        // Validate required fields on page 1
        var requiredFields = ['ai_detection', 'collaboration_rating', 'attention_check', 'play_again'];
        var isValid = true;

        requiredFields.forEach(function (field) {
            var element = document.querySelector('input[name="' + field + '"]:checked');
            if (!element) {
                isValid = false;
                // Highlight missing field - only if the field exists
                var fieldInput = document.querySelector('input[name="' + field + '"]');
                if (fieldInput) {
                    var fieldGroup = fieldInput.closest('div').parentElement;
                    fieldGroup.style.border = '2px solid #dc3545';
                    fieldGroup.style.borderRadius = '5px';
                    fieldGroup.style.padding = '10px';
                }
            }
        });

        if (isValid) {
            document.getElementById('questionnairePage1').style.display = 'none';
            document.getElementById('questionnairePage2').style.display = 'block';
        } else {
            alert('Please answer all required questions before proceeding.');
        }
    });

    document.getElementById('prevPageBtn').addEventListener('click', function () {
        document.getElementById('questionnairePage2').style.display = 'none';
        document.getElementById('questionnairePage1').style.display = 'block';
    });

    // Handle form submission
    document.getElementById('questionnaireForm').addEventListener('submit', function (e) {
        e.preventDefault();

        var formData = new FormData(this);
        var questionnaireData = {};

        for (var [key, value] of formData.entries()) {
            questionnaireData[key] = value;
        }

        // Store questionnaire data
        gameData.questionnaireData = questionnaireData;

        // Proceed to next stage
        nextStage();
    });
}

/**
 * Show end experiment info stage (matching testExpWithAI.js)
 */
function showEndExperimentInfoStage(stage) {
    var container = document.getElementById('container');

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
                <h2 style="color: #333; margin-bottom: 30px;">🎉 Experiment Complete!</h2>
                <p style="font-size: 18px; color: #666; margin-bottom: 30px;">You have finished all the tasks!</p>
                <p style="font-size: 16px; color: #666; margin-bottom: 30px;">Please wait a few seconds. Your data is being saved to our secure server.</p>
                <div style="margin: 30px 0;">
                    <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #f3f3f3; border-top: 3px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin-top: 15px; color: #666; font-size: 16px;">Saving data...</p>
                </div>
                <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; margin-top: 20px;">
                    <p style="font-size: 14px; color: #6c757d; margin: 0;">
                        <strong>Note:</strong> Please do not close this window while data is being saved.
                    </p>
                </div>
            </div>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;

    // Save data to Google Drive (this will handle the redirect to Prolific)
    saveDataToGoogleDrive();
}

/**
 * Show Prolific redirect stage
 */
function showProlificRedirectStage(stage) {
    var container = document.getElementById('container');
    var completionCode = NODEGAME_CONFIG.prolificCompletionCode || 'COMPLETION_CODE';

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="text-align: center; max-width: 600px; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h2 style="color: #333; margin-bottom: 20px;">🎉 Experiment Complete!</h2>
                <p style="font-size: 18px; margin-bottom: 20px;">Thank you for completing the experiment!</p>

                <div style="background: #e8f5e8; border: 2px solid #28a745; border-radius: 8px; padding: 20px; margin: 30px 0;">
                    <h3 style="color: #28a745; margin-bottom: 15px;">Your Completion Code</h3>
                    <div style="background: white; border: 2px dashed #28a745; border-radius: 5px; padding: 15px; margin: 10px 0;">
                        <p style="font-size: 24px; font-weight: bold; color: #28a745; margin: 0; font-family: monospace; letter-spacing: 2px;">
                            ${completionCode}
                        </p>
                    </div>
                    <p style="font-size: 14px; color: #666; margin: 10px 0 0 0;">
                        Please copy this code and paste it in Prolific to complete your submission.
                    </p>
                </div>

                <div style="margin: 30px 0;">
                    <p style="font-size: 16px; color: #666; margin-bottom: 20px;">
                        Click the button below to go to Prolific and submit your completion code.
                    </p>
                    <button id="prolificRedirectBtn" style="
                        background: #007bff;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        border-radius: 5px;
                        cursor: pointer;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        transition: all 0.3s ease;
                    " onmouseover="this.style.background='#0056b3'" onmouseout="this.style.background='#007bff'">
                        📋 Go to Prolific
                    </button>
                </div>

                <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; margin-top: 20px;">
                    <p style="font-size: 14px; color: #6c757d; margin: 0;">
                        <strong>Note:</strong> Make sure to copy your completion code before clicking the button.
                    </p>
                </div>
            </div>
        </div>
    `;

    // Handle Prolific redirect button
    document.getElementById('prolificRedirectBtn').addEventListener('click', function () {
        // Show loading state
        this.disabled = true;
        this.textContent = 'Redirecting...';
        this.style.background = '#6c757d';

        // Redirect to Prolific
        redirectToProlific();
    });
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
            nextStage();

        }).catch(error => {
            console.error('Error saving to Google Drive:', error);

            // Fallback: Download the file locally instead
            console.log('Google Drive save failed, falling back to local download...');
            downloadExcelFileLocally(wb, filename);

            // Still move to next stage even if Google Drive failed
            nextStage();
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
        redirectToProlific();
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
 * Redirect to Prolific completion page
 */
function redirectToProlific() {
    try {
        // Check if we're in a testing environment (no Prolific redirect needed)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('Running locally - skipping Prolific redirect');
            // Show completion message instead
            showCompletionStage();
            return;
        }

        // Redirect to Prolific completion page
        const completionCode = NODEGAME_CONFIG.prolificCompletionCode || 'COMPLETION_CODE';
        const redirectUrl = `https://app.prolific.co/submissions/complete?cc=${completionCode}`;

        console.log('Redirecting to Prolific:', redirectUrl);
        window.location.href = redirectUrl;
    } catch (error) {
        console.error('Error redirecting to Prolific:', error);
        // Fallback: show completion message
        showCompletionStage();
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
        let experimentData = gameData.allTrialsData;

        // If no experiment data, create a placeholder
        if (!experimentData || experimentData.length === 0) {
            experimentData = [{
                trialIndex: 0,
                note: 'No experimental data collected - experiment may not have been completed',
                timestamp: new Date().toISOString()
            }];
        }

        // Convert questionnaire data to array format
        const questionnaireArray = convertQuestionnaireToArray(gameData.questionnaireData);

        // Create Excel file to send to Google Drive
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const excelFilename = `experiment_data_${timestamp}.xlsx`;

        sendExcelToGoogleDrive(experimentData, questionnaireArray, excelFilename);

    } catch (error) {
        console.error('Error in saveDataToGoogleDrive:', error);
        alert('Error saving data to Google Drive. Please try again.');
    }
}

/**
 * Show completion stage
 */
function showCompletionStage(stage) {
    var container = document.getElementById('container');
    var successRate = calculateSuccessRate();

    // Calculate results by experiment type
    var resultsByExperiment = {};
    NODEGAME_CONFIG.experimentOrder.forEach(expType => {
        var expTrials = gameData.allTrialsData.filter(trial => trial.experimentType === expType);
        var expSuccessful = expTrials.filter(trial => trial.completed || trial.collaborationSucceeded).length;
        resultsByExperiment[expType] = {
            completed: expTrials.length,
            successful: expSuccessful,
            successRate: expTrials.length > 0 ? Math.round((expSuccessful / expTrials.length) * 100) : 0
        };
    });

    var experimentResultsHTML = NODEGAME_CONFIG.experimentOrder.map(expType => {
        var result = resultsByExperiment[expType];
        return `
            <div style="background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #007bff;">
                <strong>${expType}:</strong> ${result.successful}/${result.completed} trials successful (${result.successRate}%)
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 700px; text-align: center;">
                <h2 style="color: green; margin-bottom: 30px;">🎉 All Experiments Complete!</h2>
                <div style="margin-bottom: 30px;">
                    <p style="font-size: 18px; margin-bottom: 20px;"><strong>Total Trials Completed:</strong> ${gameData.allTrialsData.length}</p>
                    <p style="font-size: 18px; margin-bottom: 20px;"><strong>Overall Success Rate:</strong> ${successRate}%</p>

                    <h3 style="margin-bottom: 15px; color: #333;">Results by Experiment:</h3>
                    <div style="text-align: left;">
                        ${experimentResultsHTML}
                    </div>
                </div>
                <div>
                    <button onclick="exportExperimentData()" style="
                        background: #007bff;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        border-radius: 5px;
                        cursor: pointer;
                        margin: 10px;
                    ">📥 Download Data</button>
                    <button onclick="location.reload()" style="
                        background: #28a745;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        border-radius: 5px;
                        cursor: pointer;
                        margin: 10px;
                    ">🔄 Run Another Session</button>
                </div>
                ${gameData.questionnaireData ? '<p style="color: #28a745; margin-top: 20px;">✅ Questionnaire data collected and included in export</p>' : ''}
            </div>
        </div>
    `;
}

/**
 * Get welcome message for experiment type
 */
function getInstructionsForExperiment(experimentType) {
    switch (experimentType) {
        case '1P1G':
            return `
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
            `;
        case '1P2G':
            return `
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
            `;
        case '2P2G':
            return `
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
            `;
        case '2P3G':
            return `
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
            `;
        default:
            return '<p style="font-size:30px;">Welcome to the task. Press space bar to begin.</p>';
    }
}


/**
 * Show waiting for partner stage (unified for both human-AI and human-human versions)
 * This shows a waiting screen and either:
 * - For human-human: Actually connects to find a real partner
 * - For human-AI: Simulates waiting and then prompts for space bar to start
 */
function showWaitingForPartnerStage(stage) {
    const container = document.getElementById('container');
    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="max-width: 600px; margin: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px; text-align: center;">
                <h1 style="color: #333; margin-bottom: 30px;">Finding another player ...</h1>

                <div style="margin: 40px 0;">
                    <div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                </div>

                <div style="font-size: 18px; color: #666; margin-bottom: 20px;">
                    <p>Please wait while we match you with another player.</p>
                    <p>This usually takes just a few moments...</p>
                </div>

                <div id="waitingStatus" style="font-size: 16px; color: #007bff; margin-bottom: 30px;">
                    Connecting to matching service...
                </div>

                <div style="background: #e9ecef; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                    <p style="margin: 0; font-size: 14px; color: #6c757d;">
                        <strong>Tip:</strong> Keep this window open and active. You'll automatically proceed once a partner is found.
                    </p>
                </div>

                <div id="cancelButtonContainer" style="display: none;">
                    <button onclick="handleWaitingCancel()" style="background: #6c757d; color: white; border: none; padding: 10px 20px; font-size: 14px; border-radius: 5px; cursor: pointer;">
                        Cancel and Exit
                    </button>
                </div>
            </div>
        </div>

        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;

    // Check if this is human-human mode (socket.io available) or human-AI mode (simulated)
    const isHumanHumanMode = typeof io !== 'undefined';

    if (isHumanHumanMode) {
        // Human-human mode: Actually try to connect to multiplayer
        console.log('Human-human mode detected: Attempting real multiplayer connection');

        // Show cancel button for human-human mode
        const cancelButtonContainer = document.getElementById('cancelButtonContainer');
        if (cancelButtonContainer) {
            cancelButtonContainer.style.display = 'block';
        }

        // Make cancel function globally available
        window.handleWaitingCancel = function () {
            if (window.socket) {
                window.socket.disconnect();
            }
            window.close();
        };

        // Try to join multiplayer room
        setTimeout(() => {
            // Set the experiment type from the stage before joining
            if (stage && stage.experimentType) {
                console.log('🎮 Setting experiment type from stage:', stage.experimentType);
                if (typeof gameData !== 'undefined') {
                    gameData.currentExperiment = stage.experimentType;
                    gameData.currentExperimentIndex = stage.experimentIndex;
                }
                if (typeof window.gameData !== 'undefined') {
                    window.gameData.currentExperiment = stage.experimentType;
                    window.gameData.currentExperimentIndex = stage.experimentIndex;
                }
            }

            // Access the global joinMultiplayerRoom function if available
            if (typeof window.joinMultiplayerRoom === 'function') {
                if (window.joinMultiplayerRoom()) {
                    updateWaitingStatus('Looking for another participant...');
                } else {
                    updateWaitingStatus('Connection failed. Please refresh the page.');
                }
            } else if (typeof joinMultiplayerRoom === 'function') {
                if (joinMultiplayerRoom()) {
                    updateWaitingStatus('Looking for another participant...');
                } else {
                    updateWaitingStatus('Connection failed. Please refresh the page.');
                }
            } else {
                console.warn('joinMultiplayerRoom function not available');
                updateWaitingStatus('Connection failed. Please refresh the page.');
            }
        }, 1000); // Wait a moment for socket to be ready

        // Note: For human-human mode, the advancement to next stage is handled by
        // socket events (game_started, room_full, etc.) rather than a timer

    } else {
        // Human-AI mode: Simulate waiting process
        console.log('Human-AI mode detected: Simulating partner matching');

        // Simulate waiting process with status updates
        const statusMessages = [
            'Connecting to matching service...',
            'Looking for another participant...',
            'Found a participant!',
            'Establishing connection...',
            'Connection established!'
        ];

        let messageIndex = 0;
        const statusElement = document.getElementById('waitingStatus');

        const updateStatus = () => {
            if (statusElement && messageIndex < statusMessages.length) {
                statusElement.textContent = statusMessages[messageIndex];
                messageIndex++;
            }
        };

        // Update status every 2 seconds
        const statusInterval = setInterval(updateStatus, 2000);

        // After configured duration, show "Game is ready" message and wait for space bar
        setTimeout(() => {
            clearInterval(statusInterval);

            // Update the display to show "Game is ready" message
            container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
                    <div style="max-width: 600px; margin: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px; text-align: center;">
                        <h1 style="color: #28a745; margin-bottom: 30px;">✅ Game is Ready!</h1>

                        <div style="margin: 40px 0;">
                            <div style="width: 80px; height: 80px; background-color: #28a745; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto;">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="white"/>
                                </svg>
                            </div>
                        </div>

                        <div style="font-size: 20px; color: #333; margin-bottom: 20px;">
                            <p><strong>Another player found and connection established!</strong></p>
                            <p>The game is ready to begin.</p>
                        </div>

                        <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                            <p style="margin: 0; font-size: 16px; color: #155724;">
                                <strong>Press the space bar to start the game.</strong>
                            </p>
                        </div>
                    </div>
                </div>
            `;

            // Add event listener for space bar to continue
            function handleSpacebar(event) {
                if (event.code === 'Space' || event.key === ' ') {
                    event.preventDefault();
                    document.removeEventListener('keydown', handleSpacebar);
                    nextStage();
                }
            }

            document.addEventListener('keydown', handleSpacebar);
            document.body.focus();

        }, NODEGAME_CONFIG.timing.waitingForPartnerDuration);
    }
}

/**
 * Update waiting status message
 */
function updateWaitingStatus(message) {
    const statusElement = document.getElementById('waitingStatus');
    if (statusElement) {
        statusElement.textContent = message;
    }
}




// =================================================================================================
// MAKE FUNCTIONS GLOBALLY AVAILABLE FOR NON-MODULE SCRIPTS
// =================================================================================================

// Make createTimelineStages available globally
window.createTimelineStages = createTimelineStages;

// Make other important functions available globally
window.showQuestionnaireStage = showQuestionnaireStage;
window.showGameFeedbackStage = showGameFeedbackStage;
window.showEndExperimentInfoStage = showEndExperimentInfoStage;
window.showProlificRedirectStage = showProlificRedirectStage;
window.showWaitingForPartnerStage = showWaitingForPartnerStage;
window.updateWaitingStatus = updateWaitingStatus;

window.exportExperimentData = exportExperimentData;

// Make timeline navigation functions available globally
window.nextStage = function() {
    timeline.currentStage++;
    if (timeline.currentStage < timeline.stages.length) {
        var stage = timeline.stages[timeline.currentStage];
        console.log(`Moving to stage ${timeline.currentStage}: ${stage.type}`);
        stage.handler(stage);
    } else {
        console.log('Timeline complete');
    }
};

/**
 * Export experiment data as JSON file
 */
function exportExperimentData() {
    try {
        // Prepare experiment data
        const experimentData = {
            participantId: gameData.participantId || `participant_${Date.now()}`,
            timestamp: new Date().toISOString(),
            experimentOrder: NODEGAME_CONFIG.experimentOrder,
            allTrialsData: gameData.allTrialsData || [],
            questionnaireData: gameData.questionnaireData || null,
            successThreshold: gameData.successThreshold || {},
            completionCode: NODEGAME_CONFIG.prolificCompletionCode,
            version: NODEGAME_CONFIG.version,
            experimentType: 'human-AI'
        };

        // Create and download JSON file
        const blob = new Blob([JSON.stringify(experimentData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // Generate safe filename
        const participantId = experimentData.participantId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `experiment_data_${participantId}_${new Date().toISOString().slice(0, 10)}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('Experiment data exported successfully:', filename);
        alert('Data exported successfully!');
    } catch (error) {
        console.error('Error exporting experiment data:', error);
        alert('Error exporting data: ' + error.message);
    }
}

/**
 * Show game feedback stage
 */
function showGameFeedbackStage(stage) {
    console.log('🎮 Game Feedback Stage: Starting...');
    var container = document.getElementById('container');

    // Calculate metrics
    var totalTrials = gameData.allTrialsData.length;
    var successRate = calculateSuccessRate();

    // Calculate total time in minutes
    var totalTimeMinutes = 0;
    if (gameData.allTrialsData.length > 0) {
        var firstTrialStart = gameData.allTrialsData[0].trialStartTime;
        var lastTrialEnd = gameData.allTrialsData[gameData.allTrialsData.length - 1].trialEndTime;
        var totalTimeMs = lastTrialEnd - firstTrialStart;
        totalTimeMinutes = Math.round(totalTimeMs / (1000 * 60));
    }

    // Determine what type of experiments were run
    var hasCollaborationTrials = gameData.allTrialsData.some(trial =>
        trial.experimentType && trial.experimentType.includes('2P')
    );
    var hasSinglePlayerTrials = gameData.allTrialsData.some(trial =>
        trial.experimentType && trial.experimentType.includes('1P')
    );

    // Calculate different success rates based on experiment types
    var singlePlayerSuccessRate = 0;
    var collaborationSuccessRate = 0;

    if (hasSinglePlayerTrials) {
        var singlePlayerTrials = gameData.allTrialsData.filter(trial =>
            trial.experimentType && trial.experimentType.includes('1P')
        );
        var successfulSinglePlayer = singlePlayerTrials.filter(trial =>
            trial.completed === true
        ).length;
        singlePlayerSuccessRate = Math.round((successfulSinglePlayer / singlePlayerTrials.length) * 100);
    }

    if (hasCollaborationTrials) {
        var collaborationTrials = gameData.allTrialsData.filter(trial =>
            trial.experimentType && trial.experimentType.includes('2P')
        );
        var successfulCollaborations = collaborationTrials.filter(trial =>
            trial.collaborationSucceeded === true
        ).length;
        collaborationSuccessRate = Math.round((successfulCollaborations / collaborationTrials.length) * 100);
    }

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 700px; width: 100%; text-align: center;">
                <h2 style="color: #333; margin-bottom: 30px;">🎮 Game Performance Summary</h2>

                <div style="background: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 30px;">
                    <h3 style="color: #666; margin-bottom: 20px;">Your Results</h3>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
                        <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
                            <h4 style="color: #007bff; margin-bottom: 10px; font-size: 18px;">📊 Total Trials</h4>
                            <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${totalTrials}</p>
                        </div>

                        <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
                            <h4 style="color: #28a745; margin-bottom: 10px; font-size: 18px;">⏱️ Total Time</h4>
                            <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${totalTimeMinutes} min</p>
                        </div>

                        ${hasSinglePlayerTrials ? `
                            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
                                <h4 style="color: #ffc107; margin-bottom: 10px; font-size: 18px;">🎯 Single Player Success</h4>
                                <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${singlePlayerSuccessRate}%</p>
                                <p style="font-size: 14px; color: #666; margin: 5px 0 0 0;">(${gameData.allTrialsData.filter(t => t.experimentType && t.experimentType.includes('1P')).length} single player trials)</p>
                            </div>
                        ` : ''}

                        ${hasCollaborationTrials ? `
                            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
                                <h4 style="color: #dc3545; margin-bottom: 10px; font-size: 18px;">🤝 Collaboration Success</h4>
                                <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${collaborationSuccessRate}%</p>
                                <p style="font-size: 14px; color: #666; margin: 5px 0 0 0;">(${gameData.allTrialsData.filter(t => t.experimentType && t.experimentType.includes('2P')).length} collaboration trials)</p>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div style="background: #e8f5e8; border: 2px solid #28a745; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                    <h3 style="color: #28a745; margin-bottom: 15px;">📝 Almost Done!</h3>
                    <p style="font-size: 18px; color: #333; margin-bottom: 15px;">
                        Thank you for completing the game trials!
                    </p>
                    <p style="font-size: 16px; color: #666; margin-bottom: 0;">
                        To finish the experiment, we kindly ask you to fill out a short questionnaire about your experience.
                        This will help us understand your thoughts and improve our research.
                    </p>
                </div>

                <div style="text-align: center;">
                    <button id="continueToQuestionnaireBtn" style="
                        background: #28a745;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 18px;
                        border-radius: 8px;
                        cursor: pointer;
                        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                        transition: all 0.3s ease;
                    " onmouseover="this.style.background='#218838'" onmouseout="this.style.background='#28a745'">
                        📋 Continue to Questionnaire
                    </button>
                </div>
            </div>
        </div>
    `;

        // Handle button click to continue to questionnaire
    document.getElementById('continueToQuestionnaireBtn').addEventListener('click', function() {
        console.log('🎮 Game Feedback Stage: Continue button clicked');
        // Add questionnaire stage to timeline if it doesn't exist
        var hasQuestionnaireStage = timeline.stages.some(stage => stage.type === 'questionnaire');
        if (!hasQuestionnaireStage) {
            console.log('🎮 Game Feedback Stage: Adding questionnaire stage to timeline');
            timeline.stages.push({
                type: 'questionnaire',
                handler: showQuestionnaireStage
            });
        }

        // Proceed to next stage (which should be the questionnaire)
        console.log('🎮 Game Feedback Stage: Proceeding to next stage');
        nextStage();
    });

    console.log('🎮 Game Feedback Stage: Setup complete');
}

/**
 * Create unified trial feedback overlay
 * @param {HTMLElement} canvasContainer - Container to append overlay to
 * @param {boolean} success - Whether the trial was successful
 * @param {string} messageType - Type of feedback: 'single' or 'collaboration'
 * @param {number} duration - How long to show overlay (optional, defaults to not auto-remove)
 * @returns {HTMLElement} - The created overlay element
 */
function createTrialFeedbackOverlay(canvasContainer, success, messageType, duration = null) {
    if (!canvasContainer) {
        console.warn('No canvas container provided for trial feedback overlay');
        return null;
    }

    // Validate messageType
    if (messageType !== 'single' && messageType !== 'collaboration') {
        console.warn('Invalid messageType. Must be "single" or "collaboration"');
        return null;
    }

    // Create visual feedback based on success
    let visualFeedback;
    if (success) {
        // Smile face for success
        visualFeedback = `
            <div style="display: flex; justify-content: center; margin: 30px 0;">
                <div style="
                    width: 120px;
                    height: 120px;
                    background-color: #28a745;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                ">
                    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12,1A11,11,0,1,0,23,12,11.013,11.013,0,0,0,12,1Zm0,20a9,9,0,1,1,9-9A9.011,9.011,0,0,1,12,21Zm6-8A6,6,0,0,1,6,13a1,1,0,0,1,2,0,4,4,0,0,0,8,0,1,1,0,0,1,2,0ZM8,10V9a1,1,0,0,1,2,0v1a1,1,0,0,1-2,0Zm6,0V9a1,1,0,0,1,2,0v1a1,1,0,0,1-2,0Z" fill="white"/>
                    </svg>
                </div>
            </div>
        `;
    } else {
        // Sad face for failure
        visualFeedback = `
            <div style="display: flex; justify-content: center; margin: 30px 0;">
                <div style="
                    width: 120px;
                    height: 120px;
                    background-color: #dc3545;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                ">
                    <svg width="80" height="80" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19.5 10c.277 0 .5.223.5.5v3c0 .277-.223.5-.5.5s-.5-.223-.5-.5v-3c0-.277.223-.5.5-.5zm-9 0c.277 0 .5.223.5.5v3c0 .277-.223.5-.5.5s-.5-.223-.5-.5v-3c0-.277.223-.5.5-.5zM15 20c-2.104 0-4.186.756-5.798 2.104-.542.4.148 1.223.638.76C11.268 21.67 13.137 21 15 21s3.732.67 5.16 1.864c.478.45 1.176-.364.638-.76C19.186 20.756 17.104 20 15 20zm0-20C6.722 0 0 6.722 0 15c0 8.278 6.722 15 15 15 8.278 0 15-6.722 15-15 0-8.278-6.722-15-15-15zm0 1c7.738 0 14 6.262 14 14s-6.262 14-14 14S1 22.738 1 15 7.262 1 15 1z" fill="white"/>
                    </svg>
                </div>
            </div>
        `;
    }

    // Determine message based on messageType
    let message;
    if (messageType === 'single') {
        message = success ? 'Goal reached!' : 'Time up!';
    } else if (messageType === 'collaboration') {
        message = success ? 'Collaboration succeeded!' : 'Collaboration failed!';
    }

    // Create overlay div positioned absolutely over the canvas
    const overlay = document.createElement('div');
    overlay.innerHTML = `
        <div style="
            text-align: center;
            background: rgba(255, 255, 255, 0.95);
            border: 3px solid ${success ? '#28a745' : '#dc3545'};
            border-radius: 15px;
            padding: 30px 40px;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(5px);
        ">
            <div style="font-size: 32px; font-weight: bold; margin-bottom: 20px; color: ${success ? '#28a745' : '#dc3545'};">
                ${message}
            </div>
            ${visualFeedback}
        </div>
    `;
    overlay.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
        pointer-events: none;
        width: auto;
        height: auto;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Add overlay to canvas container
    canvasContainer.appendChild(overlay);

    // Auto-remove after duration if specified
    if (duration && duration > 0) {
        setTimeout(() => {
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, duration);
    }

    return overlay;
}
