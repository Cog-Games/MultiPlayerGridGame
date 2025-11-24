import numpy as np
import collections as co
import functools as ft
import itertools as it
import operator as op
import matplotlib.pyplot as plt
import os
import pickle
import sys
import time
import pandas as pd
import seaborn as sns

import sys
sys.path.append(os.path.join(os.path.join(os.path.dirname(__file__), '..')))
from reward import *
from viz import *


class GridWorld():
    def __init__(self, name='', nx=None, ny=None):
        self.name = name
        self.nx = nx
        self.ny = ny
        self.coordinates = tuple(it.product(range(self.nx), range(self.ny)))
        self.terminals = []
        self.obstacles = []
        self.features = co.OrderedDict()

    def add_terminals(self, terminals=[]):
        for t in terminals:
            self.terminals.append(t)

    def add_obstacles(self, obstacles=[]):
        for o in obstacles:
            self.obstacles.append(o)

    def add_feature_map(self, name, state_values, default=0):
        self.features[name] = {s: default for s in self.coordinates}
        self.features[name].update(state_values)

    def is_state_valid(self, state):
        if state[0] not in range(self.nx):
            return False
        if state[1] not in range(self.ny):
            return False
        if state in self.obstacles:
            return False
        return True

    def reward(self, s, a, s_n, W={}):
        if not W:
            return sum(map(lambda f: self.features[f][s_n], self.features))
        return sum(map(lambda f: self.features[f][s_n] * W[f], W.keys()))

    def draw(self, ax=None, ax_images={}, features=[], colors={},
             masked_values={}, default_masked=0, show=True):

        new_features = [f for f in features if f not in ax_images.keys()]
        old_features = [f for f in features if f in ax_images.keys()]
        ax, new_ax_images = self.draw_features_first_time(ax, new_features,
                                                          colors, masked_values, default_masked=0)
        old_ax_images = self.update_features_images(ax_images, old_features,
                                                    masked_values,
                                                    default_masked=0)
        ax_images.update(old_ax_images)
        ax_images.update(new_ax_images)

        return ax, ax_images


def T_dict(S=(), A=(), tran_func=None):
    return {s: {a: tran_func(s, a) for a in A} for s in S}


def R_dict(S=(), A=(), T={}, reward_func=None):
    return {s: {a: {s_n: reward_func(s, a, s_n) for s_n in T[s][a]} for a in A} for s in S}


def transition(state, action):
    nextState = tuple(np.array(state) + np.array(action))
    return nextState


class StochasticTransition:
    def __init__(self, noise, noiseActionSpace, terminals, isStateValid):
        self.noise = noise
        self.noiseActionSpace = noiseActionSpace
        self.terminals = terminals
        self.isStateValid = isStateValid

    def __call__(self, state, action):
        if state in self.terminals:
            return {state: 1}

        nextState = transition(state, action)
        if not self.isStateValid(nextState):
            return {state: 1}

        possibleNextStates = (transition(state, noiseAction) for noiseAction in self.noiseActionSpace)
        validNextStates = list(filter(self.isStateValid, possibleNextStates))

        noiseProbAverged = self.noise / (len(validNextStates) - 1) if len(validNextStates) > 1 else 1
        nextStateProb = {s: noiseProbAverged for s in validNextStates}
        nextStateProb.update({nextState: 1.0 - self.noise})

        return nextStateProb


def grid_transition(s, a, is_valid=None, terminals=()):
    if s in terminals:
        return {s: 1}
    s_n = tuple(map(sum, zip(s, a)))
    if is_valid(s_n):
        return {s_n: 1}
    return {s: 1}


def grid_transition_stochastic(s=(), a=(), noiseSpace=[], is_valid=None, terminals=(), mode=0.9):
    if s in terminals:
        return {s: 1}

    def apply_action(s, noise):
        return (s[0] + noise[0], s[1] + noise[1])

    s_n = (s[0] + a[0], s[1] + a[1])
    if not is_valid(s_n):
        return {s: 1}

    sn_iter = (apply_action(s, noise) for noise in noiseSpace)
    states = list(filter(is_valid, sn_iter))

    p_n = (1.0 - mode) / len(states)

    next_state_prob = {s: p_n for s in states}
    next_state_prob.update({s_n: mode})

    return next_state_prob


def grid_transition_noise(s=(), a=(), A=(), is_valid=None, terminals=(), noise=0.1):
    if s in terminals:
        return {s: 1}

    def apply_action(s, a):
        return (s[0] + a[0], s[1] + a[1])

    s_n = apply_action(s, a)
    if not is_valid(s_n):
        return {s: 1}

    noise_action = [i for i in A if i != a]
    sn_iter = (apply_action(s, noise) for noise in noise_action)
    states = list(filter(is_valid, sn_iter))

    p_n = noise / len(states)
    next_state_prob = {s: p_n for s in states}
    next_state_prob.update({s_n: 1 - noise})

    return next_state_prob


def grid_reward(s, a, sn, env=None, const=-1, terminals=None):
    if sn in terminals:
        return const + sum(map(lambda f: env.features[f][sn], env.features))
    else:
        return const + sum(map(lambda f: env.features[f][s], env.features))


def dict_to_array(V):
    states, values = zip(*((s, v) for (s, v) in V.items()))
    row_index, col_index = zip(*states)
    num_row = max(row_index) + 1
    num_col = max(col_index) + 1
    I = np.empty((num_row, num_col))
    I[row_index, col_index] = values
    return I


def V_dict_to_array(V, S):
    V_lst = [V.get(s) for s in S]
    V_arr = np.asarray(V_lst)
    return V_arr


def T_dict_to_array(T):
    T_lst = [[[T[s][a].get(s_n, 0) for s_n in S] for a in A] for s in S]
    T_arr = np.asarray(T_lst)
    return T_arr


def R_dict_to_array(R):
    R_lst = [[[R[s][a].get(s_n, 0) for s_n in S] for a in A] for s in S]
    R_arr = np.asarray(R_lst, dtype=float)
    return R_arr


def V_to_Q(V, T=None, R=None, gamma=None):
    V_aug = V[np.newaxis, np.newaxis, :]
    return np.sum(T * (R + gamma * V_aug), axis=2)


def Q_from_V(s, a, T=None, R=None, V=None, gamma=None):
    return sum([p * (R[s][a] + gamma * V[s_n])
                for (s_n, p) in T[s][a].iteritems()])


def softmax_epislon_policy(Q, temperature=10, epsilon=0.1):
    na = Q.shape[-1]
    q_exp = np.exp(Q / temperature)
    norm = np.sum(q_exp, axis=1)
    prob = (q_exp / norm[:, np.newaxis]) * (1 - epsilon) + epsilon / na
    return prob


def pickle_dump_single_result(dirc="", prefix="result", name="", data=None):
    full_name = "_".join((prefix, name)) + ".pkl"
    path = os.path.join(dirc, full_name)
    pickle.dump(data, open(path, "wb"))
    print ("saving %s at %s" % (name, path))


def calculateSoftmaxProbability(acionValues, beta):
    exponents = np.multiply(beta, acionValues)
    exponents = np.array([min(700, exponent) for exponent in exponents])
    newProbabilityList = list(np.divide(np.exp(exponents), np.sum(np.exp(exponents))))
    return newProbabilityList


class SoftmaxRLPolicy:
    def __init__(self, Q_dict, softmaxBeta):
        self.Q_dict = Q_dict
        self.softmaxBeta = softmaxBeta

    def __call__(self, playerGrid):
        actionDict = self.Q_dict[playerGrid]
        actions = list(actionDict.keys())
        actionValues = list(actionDict.values())
        softmaxProbabilityList = calculateSoftmaxProbability(actionValues, self.softmaxBeta)
        softMaxActionDict = {action: prob for action, prob in zip(actions, softmaxProbabilityList)}
        return softMaxActionDict


class SoftmaxGoalPolicy:
    def __init__(self, Q_dict, softmaxBeta):
        self.Q_dict = Q_dict
        self.softmaxBeta = softmaxBeta

    def __call__(self, playerGrid, target):
        actionDict = self.Q_dict[(playerGrid, target)]
        actions = list(actionDict.keys())
        actionValues = list(actionDict.values())
        softmaxProbabilityList = calculateSoftmaxProbability(actionValues, self.softmaxBeta)
        # softMaxActionDict = dict(zip(actionDict.keys(), softmaxProbabilityList))
        softMaxActionDict = {action: prob for action, prob in zip(actions, softmaxProbabilityList)}
        return softMaxActionDict


class ValueIteration():
    def __init__(self, gamma, epsilon=0.001, max_iter=100, terminals=[], obstacles=[]):
        self.gamma = gamma
        self.epsilon = epsilon
        self.max_iter = max_iter
        self.terminals = terminals
        self.obstacles = obstacles

    def __call__(self, S, A, T, R):
        gamma, epsilon, max_iter = self.gamma, self.epsilon, self.max_iter
        excludedState = (set(self.terminals))
        S_iter = tuple(filter(lambda s: s not in self.terminals, S))

        V_init = {s: 0.1 for s in S_iter}
        Vterminals = {s: 0 for s in self.terminals}
        V_init.update(Vterminals)

        delta = 0
        for i in range(max_iter):
            V = V_init.copy()
            for s in S_iter:
                V_init[s] = max([sum([p * (R[s][a][s_n] + gamma * V[s_n]) for (s_n, p) in T[s][a].items()]) for a in A])
            delta = np.array([abs(V[s] - V_init[s]) for s in S_iter])
            # if np.all(delta < epsilon * (1 - gamma) / gamma):
            if np.all(delta < self.epsilon):
                # print(i)
                break
        V = {state: round(value, 4) for state, value in V.items()}
        return V


class RunVI:
    def __init__(self, gridSize, actionSpace, noiseSpace, noise, gamma, goalReward):
        self.gridSize = gridSize
        self.actionSpace = actionSpace
        self.noiseSpace = noiseSpace
        self.noise = noise
        self.gamma = gamma
        self.goalReward = goalReward

    def __call__(self, goalStates, obstacles):
        gridSize, A, noiseSpace, noise, gamma, goalReward = self.gridSize, self.actionSpace, self.noiseSpace, self.noise, self.gamma, self.goalReward

        env = GridWorld("test", nx=gridSize, ny=gridSize)

        obstacles = list(obstacles)  # list of tuples
        if isinstance(goalStates, tuple):
            goalStates = [goalStates]
        else:
            goalStates = list(goalStates)

        terminalValue = {s: goalReward for s in goalStates}

        env.add_feature_map("goal", terminalValue, default=0)
        env.add_terminals(goalStates)
        env.add_obstacles(obstacles)

        S = tuple(it.product(range(env.nx), range(env.ny)))

        excludedStates = set(obstacles)
        S = tuple(filter(lambda s: s not in excludedStates, S))

        transition_function = StochasticTransition(noise, noiseSpace, goalStates, env.is_state_valid)

        T = {s: {a: transition_function(s, a) for a in A} for s in S}
        T_arr = np.asarray([[[T[s][a].get(s_n, 0) for s_n in S]
                             for a in A] for s in S])

        stepCost = - self.goalReward / (self.gridSize * 2)
        reward_func = ft.partial(
            grid_reward, env=env, const=stepCost, terminals=goalStates)

        R = {s: {a: {sn: reward_func(s, a, sn) for sn in S} for a in A} for s in S}
        R_arr = np.asarray([[[R[s][a].get(s_n, 0) for s_n in S]
                             for a in A] for s in S])

        valueIteration = ValueIteration(gamma, epsilon=0.001, max_iter=100, terminals=goalStates, obstacles=obstacles)
        V = valueIteration(S, A, T, R)
        V.update(terminalValue)

        V_arr = V_dict_to_array(V, S)
        Q = V_to_Q(V=V_arr, T=T_arr, R=R_arr, gamma=gamma)

        Q_dict = {s: {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}
###

        visualMap = 0
        if visualMap:
            # mapValue = 'V'
            # heatMapValue = eval(mapValue)
            # y = dict_to_array(heatMapValue)
            # # y = np.round(y)  # round value
            # y = y.reshape((gridSize, gridSize))
            # df = pd.DataFrame(y, columns=[x for x in range(gridSize)])
            # sns.heatmap(df, annot=True, fmt='.3f')

            getPolicy = SoftmaxRLPolicy(Q_dict, softmaxBeta=3)
            policy = {state: getPolicy(state) for state in S}
            fig, ax = plt.subplots(1, 1, tight_layout=True)
            draw_policy_4d_softmax(ax, policy, V=V, S=S, A=A)
            plt.show()

        goalStatesTuple = tuple(goalStates) if len(goalStates) > 1 else goalStates[0]
        Q_dictGoal = {(s, goalStatesTuple): {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}

        return S, A, T, R, gamma, V, Q_dictGoal, Q_dict


class GetGoalPolices:
    def __init__(self, runVI, softmaxBeta):
        self.softmaxBeta = softmaxBeta
        self.runVI = runVI

    def __call__(self, targetA, targetB, obstacles):
        _, _, transitionTableA, rewardA, _, V_goalA, Q_dictA, _ = self.runVI(targetA, obstacles)
        _, _, transitionTableB, rewardB, _, V_goalB, Q_dictB, _ = self.runVI(targetB, obstacles)
        goalQDicts = [Q_dictA, Q_dictB]

        getPolicyA = SoftmaxGoalPolicy(Q_dictA, self.softmaxBeta)
        getPolicyB = SoftmaxGoalPolicy(Q_dictB, self.softmaxBeta)
        policyA = {state: getPolicyA(state, targetA) for state in transitionTableA.keys()}
        policyB = {state: getPolicyB(state, targetB) for state in transitionTableB.keys()}

        return policyA, policyB


class GetIntentionPolices:
    def __init__(self, runVI, softmaxBeta, hideRatio, showRatio):
        self.softmaxBeta = softmaxBeta
        self.hideRatio = hideRatio
        self.showRatio = showRatio
        self.runVI = runVI

    def __call__(self, targetA, targetB, obstacles):
        S, A, transitionRL, rewardRL, gamma, V_RL, _, RLDict = self.runVI([targetA, targetB], obstacles)
        _, _, transitionTableA, rewardA, _, V_goalA, Q_dictA, _ = self.runVI(targetA, obstacles)
        _, _, transitionTableB, rewardB, _, V_goalB, Q_dictB, _ = self.runVI(targetB, obstacles)
        goalQDicts = [Q_dictA, Q_dictB]

        getPolicyA = SoftmaxGoalPolicy(Q_dictA, self.softmaxBeta)
        getPolicyB = SoftmaxGoalPolicy(Q_dictB, self.softmaxBeta)
        policyA = {state: getPolicyA(state, targetA) for state in transitionTableA.keys()}
        policyB = {state: getPolicyB(state, targetB) for state in transitionTableB.keys()}
        goalPoliciesDict = {'a': policyA, 'b': policyB}

        runValueIterationA = ValueIteration(gamma, epsilon=0.001, max_iter=100, terminals=[targetA], obstacles=obstacles)
        runValueIterationB = ValueIteration(gamma, epsilon=0.001, max_iter=100, terminals=[targetB], obstacles=obstacles)

# 1
        getLikelihoodRewardFunctionA = GetLikelihoodRewardFunction(transitionTableA, goalPoliciesDict, self.showRatio)
        getLikelihoodRewardFunctionB = GetLikelihoodRewardFunction(transitionTableB, goalPoliciesDict, self.showRatio)

        infoRewardA = getLikelihoodRewardFunctionA('a', rewardA)
        infoRewardB = getLikelihoodRewardFunctionB('b', rewardB)

        V_A = runValueIterationA(S, A, transitionTableA, infoRewardA)
        V_B = runValueIterationB(S, A, transitionTableB, infoRewardB)
        V_A.update({targetA: goalReward})
        V_B.update({targetB: goalReward})

        def mergeRewards(reward1, reward2):
            mergedReward = {state: {action: {nextState: reward1[state][action].get(nextState, 0) + reward2[state][action].get(nextState, 0)
                                             for nextState in reward2[state][action].keys()}
                                    for action in reward2[state].keys()}
                            for state in reward2.keys()}
            return mergedReward

# hide policy
        getGoalPolicies = GetGoalPolices(runVI, softmaxBeta)
        goalPolicies = getGoalPolicies(targetA, targetB, obstacles)

        def calPosterior(state, action):
            priorList = [0.5, 0.5]
            likelihoodList = [goalPolicy[state].get(action) for goalPolicy in goalPolicies]
            posteriorUnnormalized = [prior * likelihood for prior, likelihood in zip(priorList, likelihoodList)]
            evidence = sum(posteriorUnnormalized)
            posteriors = [posterior / evidence for posterior in posteriorUnnormalized]
            return posteriors

        from scipy.stats import entropy

        def calEntropyReward(state, action, nextState):
            posteriors = calPosterior(state, action)
            entropyReward = entropy(posteriors)
            return entropyReward

        entropyRewardDict = {s: {a: {sn: self.hideRatio * calEntropyReward(s, a, sn) for sn in S} for a in A} for s in S}
        hideReward = mergeRewards(rewardRL, entropyRewardDict)

        runValueIterationHide = ValueIteration(gamma, epsilon=0.001, max_iter=100, terminals=[targetA, targetB], obstacles=obstacles)

        V_Hide = runValueIterationHide(S, A, transitionRL, hideReward)

        for V, R, T in zip([V_Hide], [hideReward], [transitionRL]):

            V_arr = V_dict_to_array(V, S)
            T_arr = np.asarray([[[T[s][a].get(s_n, 0) for s_n in S]
                                 for a in A] for s in S])
            R_arr = np.asarray([[[R[s][a].get(s_n, 0) for s_n in S]
                                 for a in A] for s in S])

            Q = V_to_Q(V=V_arr, T=T_arr, R=R_arr, gamma=gamma)
            HideIntentionQDict = {s: {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}

        visualPolicyMap = 0
        if visualPolicyMap:
            getPolicy = SoftmaxRLPolicy(HideIntentionQDict, self.softmaxBeta)
            policy = {state: getPolicy(state) for state in S}
            fig, ax = plt.subplots(1, 1, tight_layout=True)
            draw_policy_4d_softmax(ax, policy, V=V_Hide, S=S, A=A)
            plt.show()

        visualValueMap = 0
        if visualValueMap:
            mapValue = 'V_A'
            heatMapValue = eval(mapValue)
            y = dict_to_array(heatMapValue)
            # y = np.round(y)  # round value
            y = y.reshape((gridSize, gridSize))
            df = pd.DataFrame(y, columns=[x for x in range(gridSize)])
            sns.heatmap(df, annot=True, fmt='.2f')
            plt.title('{} '.format(mapValue))
            plt.show()

        showIntentionQDicts = []
        for V, R, T, goal in zip([V_A, V_B], [infoRewardA, infoRewardB], [transitionTableA, transitionTableB], [targetA, targetB]):
            V_arr = V_dict_to_array(V, S)
            T_arr = np.asarray([[[T[s][a].get(s_n, 0) for s_n in S]
                                 for a in A] for s in S])
            R_arr = np.asarray([[[R[s][a].get(s_n, 0) for s_n in S]
                                 for a in A] for s in S])

            Q = V_to_Q(V=V_arr, T=T_arr, R=R_arr, gamma=gamma)
            Q_dict = {(s, goal): {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}
            showIntentionQDicts.append(Q_dict)

        visualPolicyMap = 1
        if visualPolicyMap:
            QDictPlotting = showIntentionQDicts[0] # or Q_dictA
            getShowPolicy = SoftmaxGoalPolicy(QDictPlotting, self.softmaxBeta)
            policyShow = {state: getShowPolicy(state, targetA) for state in S}

            QDictPlotting = HideIntentionQDict
            getHidePolicy = SoftmaxRLPolicy(QDictPlotting, self.softmaxBeta)
            policyHide = {state: getHidePolicy(state) for state in S}

            fig, ax = plt.subplots(1, 1, tight_layout=True)
            # draw_policy_4d_softmax(ax, policyShow, V=V_A, S=S, A=A)
            draw_policy_4d_softmax(ax, policyHide, V=V_Hide, S=S, A=A)

            plt.show()

        return [RLDict, goalQDicts, showIntentionQDicts, HideIntentionQDict]


if __name__ == '__main__':
    gridSize = 5 # 11
    noise = 0  # 0.067
    gamma = 0.9
    goalReward = 30
    actionSpace = [(0, -1), (0, 1), (-1, 0), (1, 0)]
    noiseActionSpace = [(0, -1), (0, 1), (-1, 0), (1, 0), (1, 1), (1, -1), (-1, -1), (-1, 1)]

    runVI = RunVI(gridSize, actionSpace, noiseActionSpace, noise, gamma, goalReward)

    softmaxBeta = 3
    hideRatio = 2
    showRatio = 1
    runModel = GetIntentionPolices(runVI, softmaxBeta, hideRatio, showRatio)

    # goalStates = [(5, 9), (9, 5)]
    # obstaclesMap2 = [(1, 1), (1, 3), (3, 1)]
    # obstaclesMap6 = [(3, 3), (4, 0), (3, 1), (3, 5), (5, 3), (1, 3), (0, 4)]
    # obstacles = obstaclesMap6

# Ulysses map
    goalStates = [(0, 2), (2, 2)]
    obstacles = [(1, 1), (1, 2), (1, 3), (2, 3), (3, 1),(3, 2),(3, 3)]

# T maze map
    # goalStates = [(7, 10),(2, 1)]
    # obstacles = [(4,0),(4,1),(4,2),(4,3),(4,4),(4,6),(4,7),(4,8),(4,9),(4,10),
    #             (6,1),(6,2),(6,3),(6,4),(6,5),(6,6),(6,7),(6,8),(6,9),
    #                 (7,1),(7,9)]

# stright line map
    # goalStates = [(1, 9),(9, 9)]
    # obstacles = [(4,0),(4,1),(4,3),(4,4),(4,6),(4,8),
    #             (6,0),(6,1),(6,3),(6,4),(6,6),(6,8)]

    # obstacles = []
    target1, target2 = goalStates
    # target1 = target2
    policies = runModel(target1, target2, obstacles)
