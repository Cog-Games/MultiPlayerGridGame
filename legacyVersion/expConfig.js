// Experiment configuration
const NODEGAME_CONFIG = {
    name: 'GridWorldExperiment',
    version: '1.0.0',
    treatments: ['1P1G', '1P2G', '2P2G', '2P3G'],

    // =================================================================================================
    // PLAYER CONFIGURATION
    // =================================================================================================
    playerConfig: {
        player1: {
            type: 'human',
            color: 'red',
            description: 'Human player (you)'
        },
        player2: {
            type: 'ai', // Can be 'ai' or 'human'
            color: 'orange',
            description: 'AI agent or human partner'
        }
    },

    // =================================================================================================
    // EXPERIMENT SELECTION
    // =================================================================================================

    // Current test configuration (2P3G only)
    // experimentOrder: ['2P3G'],
    // experimentOrder: ['1P2G'],           // Test 1P2G only

    // Alternative configurations (uncomment to use):
    // experimentOrder: ['1P1G'],           // Test 1P1G only
    // experimentOrder: ['2P2G'],           // Test 2P2G only
    // experimentOrder: ['1P1G', '1P2G'],   // Test 1P1G and 1P2G
    // experimentOrder: ['2P2G', '2P3G'],   // Test 2P2G and 2P3G
    experimentOrder: ['1P1G', '1P2G', '2P2G', '2P3G'], // Test all experiments
    // experimentOrder: ['1P2G', '2P3G'],

    // =================================================================================================
    // TRIAL COUNTS
    // =================================================================================================
    numTrials: {
        '1P1G': 3,    // Number of 1P1G trials, formal=3
        '1P2G': 12,    // Number of 1P2G trials, formal=12
        '2P2G': 8,    // Number of 2P2G trials, formal=8
        '2P3G': 12    // Number of 2P3G trials, formal=12
    },

    // =================================================================================================
    // SUCCESS THRESHOLD CONFIGURATION - FOR COLLABORATION GAMES (2P2G, 2P3G)
    // =================================================================================================
    successThreshold: {
        enabled: false,                    // Enable success threshold for collaboration games
        consecutiveSuccessesRequired: 5,  // Number of consecutive successes required, formal=5
        minTrialsBeforeCheck: 12,         // Minimum trials before checking for success threshold
        maxTrials: 24,                    // Maximum trials regardless of success
        randomSamplingAfterTrial: 12      // After this trial, use random sampling for maps and conditions
    },

    // =================================================================================================
    // RL AGENT CONFIGURATION
    // =================================================================================================
    rlAgent: {
        type: 'joint', // Default agent type: 'individual' or 'joint'
        agentDelay: 500,
        independentAgentDelay: 300, // Slower delay for independent AI movement after human reaches goal

        // AI Movement Mode Configuration
        movementMode: {
            enabled: false, // Enable independent AI movement mode
            decisionTimeRange: {
                min: 100, // Minimum decision time in milliseconds
                max: 500  // Maximum decision time in milliseconds
            },
            // When enabled, AI moves independently with random intervals
            // When disabled, AI moves only when human makes a move
        }
    },

    // =================================================================================================
    // GAME SETTINGS
    // =================================================================================================
    maxGameLength: 50, // Max steps per trial
    enableProlificRedirect: true, // Set to false for testing without redirect
    prolificCompletionCode: 'CBBOSCQO', // Prolific completion code

    // Timing configurations for easy manipulation
    timing: {
        trialToFeedbackDelay: 500,    // Delay from trial completion to feedback (ms)
        feedbackDisplayDuration: 2000, // How long to show feedback (ms)
        preTrialDisplayDuration: 2000, // How long to show pre-trial map (ms)
        fixationDuration: 1000,         // Fixation cross duration (ms)
        newGoalMessageDuration: 0,    // New goal message and freeze duration (ms)
        waitingForPartnerDuration: 9000, // How long to show "waiting for partner" simulation (ms)
        movementDelay: 100             // Delay to prevent rapid successive movements (ms)
    }
};

// Human-Human specific configuration (only unique keys)
const NODEGAME_HUMAN_HUMAN_CONFIG = {
    // Multiplayer settings (unique to human-human)
    multiplayer: {
        maxWaitTime: 60000,      // 60 seconds to wait for partner
        roomTimeout: 300000,     // 5 minutes room timeout
        reconnectAttempts: 3,
        syncInterval: 100,
        moveTimeout: 10000       // 10 seconds for move timeout
    }
};


// Configuration object for easy manipulation of 1P2G timing and positioning
var ONEP2G_CONFIG = {
    // Timing options
    minStepsBeforeNewGoal: 1,            // Minimum steps before new goal can appear

    // Distance condition types for new goal generation
    distanceConditions: {
        CLOSER_TO_PLAYER1: 'closer_to_player1',     // New goal is closer to player1 than first goal
        FARTHER_TO_PLAYER1: 'farther_to_player1',   // New goal is farther to player1 than first goal
        EQUAL_TO_PLAYER1: 'equal_to_player1',       // New goal is equal distance to player1 as first goal
        NO_NEW_GOAL: 'no_new_goal'                  // No new goal will be generated
    },

    // Distance condition sequence will be generated dynamically based on number of trials
    distanceConditionSequence: null, // Will be set by generateRandomized1P2GDistanceSequence()

    // Positioning constraints
    distanceConstraint: {
        minDistanceDiff: 2,              // Minimum distance difference for new goal
        maxDistanceDiff: 4,              // Maximum distance difference for new goal
    },

    // Goal generation constraints
    goalConstraints: {
        minDistanceFromHuman: 2,         // Minimum distance from human player
        maxDistanceFromHuman: 15,        // Maximum distance from human player
        minDistanceBetweenGoals: 2,      // Minimum distance between first and new goals
        avoidRectangleArea: false,       // Avoid rectangular area between goals
        blockPathCheck: true            // Check if goal blocks path
    }
};


// Configuration object for easy manipulation of 2P3G timing and positioning
var TWOP3G_CONFIG = {
    // Timing options
    minStepsBeforeNewGoal: 1,           // Minimum steps before new goal can appear
    newGoalMessageDuration: 5000,       // Duration of "New goal appeared!" message (ms)

    // Distance condition types for new goal generation
    distanceConditions: {
        CLOSER_TO_PLAYER2: 'closer_to_player2',           // New goal closer to player2, equal joint distance
        CLOSER_TO_PLAYER1: 'closer_to_player1',     // New goal closer to player1, equal joint distance
        EQUAL_TO_BOTH: 'equal_to_both',         // New goal equal distance to both player1 and player2
        NO_NEW_GOAL: 'no_new_goal'              // No new goal will be generated
    },

    // Distance condition sequence will be generated dynamically based on number of trials
    distanceConditionSequence: null, // Will be set by generateRandomizedDistanceSequence()

    // Positioning constraints
    distanceConstraint: {
        minDistanceDiff: 2,              // Minimum distance difference for new goal
        maxDistanceDiff: 4,              // Maximum distance difference for new goal
    },

    // Goal generation constraints
    goalConstraints: {
        minDistanceFromHuman: 2,         // Minimum distance from human player
        maxDistanceFromHuman: 15,        // Maximum distance from human player
        avoidRectangleArea: false,       // Avoid rectangular area between AI and current goal
        maintainDistanceSum: false,      // Maintain similar total distance sum
        blockPathCheck: true            // Check if goal blocks path
    }
};

/**
 * Set player2 type configuration
 * @param {string} type - 'ai' or 'human'
 */
function setPlayer2Type(type) {
    if (type === 'ai' || type === 'human') {
        NODEGAME_CONFIG.playerConfig.player2.type = type;
        console.log(`Player2 type set to: ${type}`);
    } else {
        console.error('Invalid player2 type. Must be "ai" or "human"');
    }
}

/**
 * Set the RL agent type
 * @param {string} agentType - 'individual' or 'joint'
 */
function setRLAgentType(agentType) {
    if (['individual', 'joint'].includes(agentType)) {
        NODEGAME_CONFIG.rlAgent.type = agentType;
        console.log(`RL Agent type set to: ${agentType}`);
    } else {
        console.error(`Invalid RL agent type: ${agentType}. Must be 'individual' or 'joint'`);
    }
}

/**
 * Get current RL agent type
 * @returns {string} Current RL agent type
 */
function getRLAgentType() {
    return NODEGAME_CONFIG.rlAgent.type;
}

/**
 * Enable independent AI movement mode
 * @param {boolean} enabled - Whether to enable independent AI movement
 * @param {object} decisionTimeRange - Optional decision time range {min, max} in milliseconds
 */
function setAIMovementMode(enabled, decisionTimeRange = null) {
    NODEGAME_CONFIG.rlAgent.movementMode.enabled = enabled;

    if (decisionTimeRange) {
        NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.min = decisionTimeRange.min;
        NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.max = decisionTimeRange.max;
    }

    console.log(`AI Movement Mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    if (enabled) {
        console.log(`Decision time range: ${NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.min}-${NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange.max}ms`);
    }
}

/**
 * Get current AI movement mode configuration
 * @returns {object} Current AI movement mode configuration
 */
function getAIMovementMode() {
    return {
        enabled: NODEGAME_CONFIG.rlAgent.movementMode.enabled,
        decisionTimeRange: { ...NODEGAME_CONFIG.rlAgent.movementMode.decisionTimeRange }
    };
}

/**
 * Check if independent AI movement is enabled
 * @returns {boolean} True if independent AI movement is enabled
 */
function isAIMovementModeEnabled() {
    return NODEGAME_CONFIG.rlAgent.movementMode.enabled;
}

// Export configuration for module usage
window.NodeGameConfig = {
    NODEGAME_CONFIG: NODEGAME_CONFIG,
    NODEGAME_HUMAN_HUMAN_CONFIG: NODEGAME_HUMAN_HUMAN_CONFIG,
    ONEP2G_CONFIG: ONEP2G_CONFIG,
    TWOP3G_CONFIG: TWOP3G_CONFIG,
    setPlayer2Type: setPlayer2Type,
    setRLAgentType: setRLAgentType,
    getRLAgentType: getRLAgentType,
    setAIMovementMode: setAIMovementMode,
    getAIMovementMode: getAIMovementMode,
    isAIMovementModeEnabled: isAIMovementModeEnabled
};

