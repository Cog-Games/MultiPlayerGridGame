// Decision body copied verbatim from nsfExp1.1-nodeGameVersion/js/sharedAgencyAgent.js.
// A private window object isolates each agent; see source-manifest.json.
export function createSharedAgencyCore(window) {
/**
 * Shared Agency Agent
 *
 * Browser-side fallback implementation based on the kids branch fallback agency model:
 * an always-on communicative action mixture with a joint-RL base policy and a
 * lightweight legibility posterior over possible shared goals.
 */
(function() {
    'use strict';

    var ACTIONS = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
    ];

    var DEFAULT_CONFIG = {
        label: 'Communicative Action Mixture (Legibility Over Alternatives) shared-agency model',
        type: 'alwaysSignalAgent',
        fitSource: 'shared_agency_costly_mixture_rho_sweep',
        score: 'costly_mixture',
        horizon: 1,
        lambda: 0.2,
        alpha: 0.5,
        beta: 3.0,
        gridSize: 15,
        useUnshapedJointRL: true,
        everyStepResampling: true,
        jointPolicyKind: 'joint-rl-fast'
    };

    var config = Object.assign({}, DEFAULT_CONFIG);
    var state = {
        trialKey: null,
        pIntent: [],
        lastObservedStep: -1
    };

    function copyPosition(position) {
        return Array.isArray(position) ? [Number(position[0]), Number(position[1])] : null;
    }

    function positionKey(position) {
        return Array.isArray(position) ? position[0] + ',' + position[1] : '';
    }

    function samePosition(a, b) {
        return Array.isArray(a) && Array.isArray(b) && Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
    }

    function manhattan(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
        return Math.abs(Number(a[0]) - Number(b[0])) + Math.abs(Number(a[1]) - Number(b[1]));
    }

    function addAction(position, action) {
        return [Number(position[0]) + Number(action[0]), Number(position[1]) + Number(action[1])];
    }

    function isStayAction(action) {
        return !action || (Number(action[0]) === 0 && Number(action[1]) === 0);
    }

    function isActionEqual(a, b) {
        return Array.isArray(a) && Array.isArray(b) && Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
    }

    function getValidAction(gridMatrix, position, action) {
        if (!Array.isArray(position) || !Array.isArray(action)) return [0, 0];
        if (typeof window.isValidMove === 'function') {
            return window.isValidMove(gridMatrix, position, action);
        }

        var next = addAction(position, action);
        if (next[0] < 0 || next[1] < 0 || next[0] >= config.gridSize || next[1] >= config.gridSize) {
            return [0, 0];
        }
        return action;
    }

    function getValidActions(gridMatrix, position) {
        var valid = [];
        for (var i = 0; i < ACTIONS.length; i++) {
            var realAction = getValidAction(gridMatrix, position, ACTIONS[i]);
            if (!isStayAction(realAction)) {
                valid.push(ACTIONS[i]);
            }
        }
        return valid.length ? valid : [[0, 0]];
    }

    function normalizeWeights(weights) {
        var sum = weights.reduce(function(total, value) {
            return total + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);
        if (!sum) {
            var uniform = weights.length ? 1 / weights.length : 0;
            return weights.map(function() { return uniform; });
        }
        return weights.map(function(value) {
            return (Number.isFinite(value) && value > 0 ? value : 0) / sum;
        });
    }

    function softmax(scores, beta) {
        if (!scores.length) return [];
        var maxScore = Math.max.apply(null, scores);
        var weights = scores.map(function(score) {
            return Math.exp(Math.max(-700, Math.min(700, (Number(score) - maxScore) * beta)));
        });
        return normalizeWeights(weights);
    }

    function sampleIndex(probabilities) {
        if (!probabilities.length) return -1;
        var draw = Math.random();
        var cumulative = 0;
        for (var i = 0; i < probabilities.length; i++) {
            cumulative += probabilities[i];
            if (draw <= cumulative) return i;
        }
        return probabilities.length - 1;
    }

    function getTrialKey(gameState, trialData) {
        var trial = trialData || {};
        var data = gameState || window.gameData || {};
        return [
            trial.experimentType || data.currentExperiment || '',
            trial.trialIndex == null ? data.currentTrial : trial.trialIndex,
            positionKey(trial.initPlayerGrid || data.player1),
            positionKey(trial.initAIGrid || data.player2),
            (data.currentGoals || []).map(positionKey).join('|')
        ].join(':');
    }

    function resetTrial(goals) {
        state.pIntent = normalizeWeights((goals || []).map(function() { return 1; }));
        state.lastObservedStep = -1;
    }

    function ensurePosterior(goals) {
        if (!state.pIntent || state.pIntent.length !== goals.length) {
            resetTrial(goals);
        }
    }

    function inferPositionAtStep(trajectory, fallbackPosition, step) {
        if (Array.isArray(trajectory) && trajectory.length > step && Array.isArray(trajectory[step])) {
            return trajectory[step];
        }
        return fallbackPosition;
    }

    function actionLikelihoodForGoal(gridMatrix, actorPos, partnerPos, action, goal) {
        var probabilities = actionPolicyForGoal(gridMatrix, actorPos, partnerPos, goal);
        var actionKey = positionKey(action);
        return probabilities[actionKey] || 0.001;
    }

    function updatePosteriorFromObservedActions(gridMatrix, currentPos, playerPos, goals, trialData) {
        if (!trialData || !Array.isArray(goals) || !goals.length) return;

        var playerActions = Array.isArray(trialData.player1Actions) ? trialData.player1Actions : [];
        var playerTrajectory = Array.isArray(trialData.player1Trajectory) ? trialData.player1Trajectory : [];
        var startStep = state.lastObservedStep + 1;

        for (var step = startStep; step < playerActions.length; step++) {
            var observedAction = playerActions[step];
            var observedPos = inferPositionAtStep(playerTrajectory, playerPos, step);
            var nextPosterior = state.pIntent.map(function(probability, goalIndex) {
                var likelihood = actionLikelihoodForGoal(gridMatrix, observedPos, currentPos, observedAction, goals[goalIndex]);
                return probability * likelihood;
            });
            state.pIntent = normalizeWeights(nextPosterior);
            state.lastObservedStep = step;
        }
    }

    function actionPolicyForGoal(gridMatrix, actorPos, partnerPos, goal) {
        var scores = ACTIONS.map(function(action) {
            var realAction = getValidAction(gridMatrix, actorPos, action);
            var nextPos = addAction(actorPos, realAction);
            var progress = manhattan(actorPos, goal) - manhattan(nextPos, goal);
            var jointDistance = manhattan(nextPos, goal) + manhattan(partnerPos, goal);
            var invalidPenalty = isStayAction(realAction) ? -2 : 0;
            return progress - 0.15 * jointDistance + invalidPenalty;
        });
        var probabilities = softmax(scores, config.beta);
        var map = {};
        ACTIONS.forEach(function(action, index) {
            map[positionKey(action)] = probabilities[index];
        });
        return map;
    }

    function goalWeights(gridMatrix, aiPos, playerPos, goals) {
        var utilities = goals.map(function(goal) {
            var jointDistance = manhattan(aiPos, goal) + manhattan(playerPos, goal);
            return -jointDistance;
        });
        var policyWeights = softmax(utilities, config.beta);
        var combined = goals.map(function(goal, index) {
            var posterior = Math.max(0.0001, state.pIntent[index] == null ? 1 / goals.length : state.pIntent[index]);
            return policyWeights[index] * Math.pow(posterior, config.lambda);
        });
        return normalizeWeights(combined);
    }

    function chooseJointRLAction(aiPos, playerPos, goal) {
        if (!window.RLAgent || !goal) return null;

        try {
            if (typeof window.RLAgent.getSoftmaxOptimalJointRLActionFast === 'function') {
                return window.RLAgent.getSoftmaxOptimalJointRLActionFast(aiPos, playerPos, [goal], config.beta);
            }
            if (typeof window.RLAgent.getSoftmaxOptimalJointRLAction === 'function') {
                return window.RLAgent.getSoftmaxOptimalJointRLAction(aiPos, playerPos, [goal], config.beta);
            }
            if (typeof window.RLAgent.getSoftmaxOptimalJointRL4ActionSpace === 'function') {
                return window.RLAgent.getSoftmaxOptimalJointRL4ActionSpace(aiPos, playerPos, [goal], config.beta);
            }
        } catch (error) {
            console.warn('Shared agency joint-RL base policy failed:', error);
        }

        return null;
    }

    function chooseProgressAction(gridMatrix, aiPos, goal) {
        var actions = getValidActions(gridMatrix, aiPos);
        var bestAction = actions[0] || [0, 0];
        var bestScore = -Infinity;
        actions.forEach(function(action) {
            var realAction = getValidAction(gridMatrix, aiPos, action);
            var nextPos = addAction(aiPos, realAction);
            var score = manhattan(aiPos, goal) - manhattan(nextPos, goal);
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        });
        return bestAction;
    }

    function posteriorAfterAIAction(gridMatrix, aiPos, playerPos, goals, action, currentPosterior) {
        var nextPosterior = currentPosterior.map(function(probability, goalIndex) {
            var likelihood = actionLikelihoodForGoal(gridMatrix, aiPos, playerPos, action, goals[goalIndex]);
            return probability * likelihood;
        });
        return normalizeWeights(nextPosterior);
    }

    function chooseLegibilityAction(gridMatrix, aiPos, playerPos, goals, targetGoalIndex) {
        var targetGoal = goals[targetGoalIndex];
        var actions = getValidActions(gridMatrix, aiPos);
        var currentDistance = manhattan(aiPos, targetGoal);
        var bestAction = null;
        var bestScore = -Infinity;

        actions.forEach(function(action) {
            var realAction = getValidAction(gridMatrix, aiPos, action);
            var nextPos = addAction(aiPos, realAction);
            var nextDistance = manhattan(nextPos, targetGoal);
            if (nextDistance > currentDistance) {
                return;
            }

            var revealedPosterior = posteriorAfterAIAction(gridMatrix, aiPos, playerPos, goals, action, state.pIntent);
            var progress = currentDistance - nextDistance;
            var score = revealedPosterior[targetGoalIndex] + 0.05 * progress;
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        });

        return bestAction;
    }

    function recordDecision(trialData, goalIndex, goals, weights, chosenAction, baseAction, legibilityAction) {
        if (!trialData) return;

        var targetGoal = goals[goalIndex] || null;
        var historyEntry = {
            step: (window.gameData && window.gameData.stepCount) || 0,
            goalIndex: goalIndex,
            goal: targetGoal ? copyPosition(targetGoal) : null,
            posterior: state.pIntent.slice(),
            weights: weights.slice(),
            action: Array.isArray(chosenAction) ? chosenAction.slice() : chosenAction,
            baseAction: Array.isArray(baseAction) ? baseAction.slice() : baseAction,
            legibilityAction: Array.isArray(legibilityAction) ? legibilityAction.slice() : legibilityAction
        };

        trialData.alwaysSignalAgentSampledJointGoal = targetGoal ? copyPosition(targetGoal) : null;
        trialData.alwaysSignalAgentSampledJointGoalIndex = goalIndex;
        trialData.alwaysSignalAgentSampledJointGoalPosterior = state.pIntent.slice();
        trialData.alwaysSignalAgentSampledJointGoalWeights = weights.slice();
        trialData.alwaysSignalAgentEveryStepResampling = config.everyStepResampling;
        trialData.alwaysSignalAgentJointPolicyKind = config.jointPolicyKind;
        trialData.alwaysSignalAgentUnshapedJointRL = config.useUnshapedJointRL;
        trialData.sharedAgencyModelVersion = 'local-fallback-2026-05-28';
        trialData.sharedAgencyModelLabel = config.label;
        trialData.sharedAgencyModelParameters = Object.assign({}, config);
        trialData.sharedAgencyChosenAction = Array.isArray(chosenAction) ? chosenAction.slice() : chosenAction;
        trialData.sharedAgencyBaseAction = Array.isArray(baseAction) ? baseAction.slice() : baseAction;
        trialData.sharedAgencyLegibilityAction = Array.isArray(legibilityAction) ? legibilityAction.slice() : legibilityAction;
        trialData.player2CurrentGoal = trialData.player2CurrentGoal || [];
        trialData.alwaysSignalAgentPlayer2SampledJointGoalHistory = trialData.alwaysSignalAgentPlayer2SampledJointGoalHistory || [];
        trialData.alwaysSignalAgentPlayer2SampledJointGoalHistory.push(historyEntry);
    }

    function getAIAction(gridMatrix, currentPos, goals, playerPos, gameState, trialData) {
        if (!Array.isArray(goals) || !goals.length) return [0, 0];

        var aiPos = copyPosition(currentPos);
        var humanPos = copyPosition(playerPos);
        if (!aiPos || !humanPos) {
            return window.RLAgent && typeof window.RLAgent.getAIAction === 'function'
                ? window.RLAgent.getAIAction(gridMatrix, currentPos, goals, playerPos)
                : [0, 0];
        }

        var trial = trialData || (window.gameData && window.gameData.currentTrialData) || {};
        var trialKey = getTrialKey(gameState || window.gameData, trial);
        if (state.trialKey !== trialKey) {
            state.trialKey = trialKey;
            resetTrial(goals);
        }

        ensurePosterior(goals);
        updatePosteriorFromObservedActions(gridMatrix, aiPos, humanPos, goals, trial);

        var weights = goalWeights(gridMatrix, aiPos, humanPos, goals);
        var sampledGoalIndex = sampleIndex(weights);
        if (sampledGoalIndex < 0) return [0, 0];

        var sampledGoal = goals[sampledGoalIndex];
        var baseAction = chooseJointRLAction(aiPos, humanPos, sampledGoal) || chooseProgressAction(gridMatrix, aiPos, sampledGoal);
        var legibilityAction = chooseLegibilityAction(gridMatrix, aiPos, humanPos, goals, sampledGoalIndex);
        var chosenAction = baseAction;

        if (config.score === 'costly_mixture' && legibilityAction && Math.random() < config.alpha) {
            chosenAction = legibilityAction;
        }

        if (!Array.isArray(chosenAction) || chosenAction.length !== 2) {
            chosenAction = chooseProgressAction(gridMatrix, aiPos, sampledGoal);
        }

        var realAction = getValidAction(gridMatrix, aiPos, chosenAction);
        if (isStayAction(realAction) && !samePosition(addAction(aiPos, chosenAction), aiPos)) {
            chosenAction = realAction;
        }

        recordDecision(trial, sampledGoalIndex, goals, weights, chosenAction, baseAction, legibilityAction);
        return chosenAction;
    }

    function reset() {
        state.trialKey = null;
        state.pIntent = [];
        state.lastObservedStep = -1;
    }

    function updateConfig(nextConfig) {
        if (nextConfig && typeof nextConfig === 'object') {
            Object.assign(config, nextConfig);
        }
    }

    window.SharedAgencyAgent = {
        getAIAction: getAIAction,
        reset: reset,
        getConfig: function() { return Object.assign({}, config); },
        updateConfig: updateConfig
    };
})();

return window.SharedAgencyAgent;
}
