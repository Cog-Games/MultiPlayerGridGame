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
import random
from viz import *
from reward import *


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


class RunVIMDP:
    def __init__(self, gridSize, actionSpace, noiseSpace, noise, gamma, goalReward):
        self.gridSize = gridSize
        self.actionSpace = actionSpace
        self.noiseSpace = noiseSpace
        self.noise = noise
        self.gamma = gamma
        self.goalReward = goalReward

    def __call__(self, goalStates, obstacles_states):
        env = GridWorld("test", nx=self.gridSize, ny=self.gridSize)

        terminalValue = {s: goalReward for s, goalReward in zip([goalStates], [self.goalReward])}

        if isinstance(goalStates[0], int):
            terminalValue = {s: goalReward for s, goalReward in zip([goalStates], self.goalReward)}

        env.add_obstacles(list(obstacles_states))
        env.add_feature_map("goal", terminalValue, default=0)
        env.add_terminals([goalStates])

        S = tuple(it.product(range(env.nx), range(env.ny)))
        A = self.actionSpace

        mode = 1 - self.noise
        transition_function = ft.partial(grid_transition_stochastic, noiseSpace=self.noiseSpace, terminals=[goalStates], is_valid=env.is_state_valid, mode=mode)

        # transition_function = ft.partial(grid_transition_noise, A=A, terminals=goalStates, is_valid=env.is_state_valid, noise=self.noise)

        T = {s: {a: transition_function(s, a) for a in A} for s in S}
        T_arr = np.asarray([[[T[s][a].get(s_n, 0) for s_n in S]
                             for a in A] for s in S])

        stepCost = - self.goalReward[0] / (self.gridSize * 2)
        reward_func = ft.partial(grid_reward, env=env, const=stepCost, terminals=goalStates)

        R = {s: {a: {sn: reward_func(s, a, sn) for sn in S} for a in A} for s in S}
        R_arr = np.asarray([[[R[s][a].get(s_n, 0) for s_n in S]
                             for a in A] for s in S])

        valueIteration = ValueIteration(self.gamma, epsilon=0.001, max_iter=100, terminals=goalStates, obstacles=obstacles_states)
        V = valueIteration(S, A, T, R)
        V_arr = V_dict_to_array(V, S)
        # print(V)

        Q = V_to_Q(V=V_arr, T=T_arr, R=R_arr, gamma=self.gamma)
        Q_dict = {(s, goalStates): {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}

        VIZ = 0
        if VIZ:
            mapValue = 'V'
            heatMapValue = eval(mapValue)
            y = dict_to_array(heatMapValue)
            y = y.reshape((self.gridSize, self.gridSize))
            df = pd.DataFrame(y, columns=[x for x in range(self.gridSize)])
            sns.heatmap(df, annot=True, fmt='.3f')
            plt.title('{} for goal at {} noise={} goalReward={}'.format(mapValue, goalStates, self.noise, self.goalReward))
            plt.show()

        # print(Q_dict)
        return S, A, T, R, self.gamma, Q_dict


def calculateSoftmaxProbability(acionValues, beta):
    expont = np.multiply(beta, acionValues)
    newProbabilityList = list(np.divide(np.exp(expont), np.sum(np.exp(expont))))
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
        softMaxActionDict = {action: prob for action, prob in zip(actions, softmaxProbabilityList)}
        return softMaxActionDict


class GetLikelihoodRewardFunction:
    def __init__(self, transitionTable, goalPolicies, infoScale=5):
        self.transitionTable = transitionTable
        self.goalPolicies = goalPolicies
        self.infoScale = infoScale

    def __call__(self, trueGoal, originalReward):
        likelihoodRewardFunction = self.createLikelihoodReward(trueGoal)
        newReward = self.mergeRewards(originalReward, likelihoodRewardFunction)
        return(newReward)

    def createLikelihoodReward(self, trueGoal):
        rewardFunction = {state: {action: {nextState: self.getLikelihoodRatio(state, nextState, trueGoal) for nextState in self.transitionTable[state][action].keys()}
                                  for action in self.transitionTable[state].keys()}
                          for state in self.transitionTable.keys()}
        return(rewardFunction)

    def mergeRewards(self, reward1, reward2):
        mergedReward = {state: {action: {nextState: reward1[state][action][nextState] + reward2[state][action][nextState]
                                         for nextState in reward2[state][action].keys()}
                                for action in reward2[state].keys()}
                        for state in reward2.keys()}
        return(mergedReward)

    def getLikelihoodRatio(self, state, nextState, goalTrue):
        goalLikelihood = self.getNextStateProbability(state, nextState, goalTrue)
        notGoalLikelihood = sum([self.getNextStateProbability(state, nextState, g)
                                 for g in self.goalPolicies.keys()])

        likelihoodRatio = self.infoScale * goalLikelihood / notGoalLikelihood
        return(likelihoodRatio)

    def getNextStateProbability(self, state, nextState, goal):
        possibleActionsToNextState = [action for action in self.transitionTable[state]
                                      if nextState in self.transitionTable[state][action]]
        probNextState = sum([self.transitionTable[state][action][nextState] * self.goalPolicies[goal][state][action]
                             for action in possibleActionsToNextState])
        return(probNextState)


class RunIntentionModel:
    def __init__(self, runVI, softmaxBeta, intentionInfoScale):
        self.softmaxBeta = softmaxBeta
        self.runVI = runVI
        self.intentionInfoScale = intentionInfoScale

    def __call__(self, targetA, targetB, obstacles_states):
        S, A, transitionTable, rewardA, gamma, Q_dictA = self.runVI(targetA, obstacles_states)
        S, A, transitionTable, rewardB, gamma, Q_dictB = self.runVI(targetB, obstacles_states)

        getPolicyA = SoftmaxGoalPolicy(Q_dictA, self.softmaxBeta)
        getPolicyB = SoftmaxGoalPolicy(Q_dictB, self.softmaxBeta)
        policyA = {state: getPolicyA(state, targetA) for state in transitionTable.keys()}
        policyB = {state: getPolicyB(state, targetB) for state in transitionTable.keys()}
        environmentPolicies = {'a': policyA, 'b': policyB}

        Q_dictList = []
        for intentionInfoScale in self.intentionInfoScale:
            getLikelihoodRewardFunction = GetLikelihoodRewardFunction(transitionTable, environmentPolicies, intentionInfoScale)

            infoRewardA = getLikelihoodRewardFunction('a', rewardA)
            infoRewardB = getLikelihoodRewardFunction('b', rewardB)

            runValueIterationA = ValueIteration(gamma, epsilon=0.001, max_iter=100, terminals=targetA)
            runValueIterationB = ValueIteration(gamma, epsilon=0.001, max_iter=100, terminals=targetB)

            V_A = runValueIterationA(S, A, transitionTable, infoRewardA)
            V_B = runValueIterationB(S, A, transitionTable, infoRewardB)
            for V, R in zip([V_A, V_B], [infoRewardA, infoRewardB]):
                V_arr = V_dict_to_array(V, S)
                T = transitionTable

                T_arr = np.asarray([[[T[s][a].get(s_n, 0) for s_n in S]
                                     for a in A] for s in S])
                R_arr = np.asarray([[[R[s][a].get(s_n, 0) for s_n in S]
                                     for a in A] for s in S])
                Q = V_to_Q(V=V_arr, T=T_arr, R=R_arr, gamma=gamma)
                Q_dict = {s: {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}
                Q_dictList.append(Q_dict)

        avoidCommitQDicts = {targetA: Q_dictList[0], targetB: Q_dictList[1]}
        commitQDicts = {targetA: Q_dictList[2], targetB: Q_dictList[3]}
        return [avoidCommitQDicts, commitQDicts]


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


class RunVI:
    def __init__(self, gridSize, actionSpace, noiseSpace, noise, gamma, goalReward,visualMap):
        self.gridSize = gridSize
        self.actionSpace = actionSpace
        self.noiseSpace = noiseSpace
        self.noise = noise
        self.gamma = gamma
        self.goalReward = goalReward
        self.visualMap = visualMap

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

        QDict = {s: {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}
###

        if self.visualMap:
            # mapValue = 'V'
            # heatMapValue = eval(mapValue)
            # y = dict_to_array(heatMapValue)
            # # y = np.round(y)  # round value
            # y = y.reshape((gridSize, gridSize))
            # df = pd.DataFrame(y, columns=[x for x in range(gridSize)])
            # sns.heatmap(df, annot=True, fmt='.3f')

            getPolicy = SoftmaxRLPolicy(QDict, softmaxBeta=3)
            policy = {state: getPolicy(state) for state in S}
            fig, ax = plt.subplots(1, 1, tight_layout=True)
            draw_policy_4d_softmax(ax, policy, V=V, S=S, A=A)
            plt.show()

        goalStatesTuple = tuple(goalStates) if len(goalStates) > 1 else goalStates[0]
        QDictGoal = {(s, goalStatesTuple): {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}

        return QDictGoal


if __name__ == '__main__':
    gridSize = 15
    noise = 0.067
    gamma = 0.9
    goalReward = 30
    actionSpace = [(0, -1), (0, 1), (-1, 0), (1, 0)]
    noiseActionSpace = [(0, -1), (0, 1), (-1, 0), (1, 0), (1, 1), (1, -1), (-1, -1), (-1, 1)]

    visualMap = 1
    runVI = RunVI(gridSize, actionSpace, noiseActionSpace, noise, gamma, goalReward, visualMap)

    goalStates = ((4, 9), (9, 4))
    # goalStates = ((6, 11),)

    obstaclesMap1 = [[]]

    obstaclesMap2 = [[(3, 3), (4, 1), (1, 4), (5, 3), (3, 5), (6, 3), (3, 6)],
                     [(3, 3), (5, 1), (1, 5), (5, 3), (3, 5), (6, 3), (3, 6)],
                     [(3, 3), (3, 1), (1, 3), (5, 3), (3, 5), (6, 3), (3, 6)]]

    obstaclesMap3 = [[(4, 4), (4, 1), (4, 2), (6, 4), (4, 6), (1, 4), (2, 4)],
                     [(4, 4), (5, 1), (4, 2), (6, 4), (4, 6), (1, 5), (2, 4)],
                     [(4, 4), (3, 1), (4, 2), (6, 4), (4, 6), (1, 3), (2, 4)]]

    speicalObstacleMap = [[(4, 1), (4, 2), (6, 3), (6, 4), (1, 4), (2, 4), (3, 6), (4, 6)],
                          [(5, 1), (4, 2), (6, 3), (6, 4), (1, 5), (2, 4), (3, 6), (4, 6)],
                          [(3, 1), (4, 2), (6, 3), (6, 4), (1, 3), (2, 4), (3, 6), (4, 6)]]

    # obstaclesMap1 = [[(1,3),(1,4),(1,5),(1,6),(1,7),(1,8),(3,1),(4,1)]]

    obstaclesMap1 = [[(1, 1), (1, 3), (1, 4), (4, 1), (3, 1), (1, gridSize - 1), (0, gridSize - 1), (0, gridSize - 2), (gridSize - 1, 1), (gridSize - 1, 0), (gridSize - 2, 0)]]
    obstaclesMap1 = [[(2, 2), (2, 4), (2, 5), (4, 2), (5, 2), (0, 3), (0, 4), (0, 5), (3, 0), (4, 0), (5, 0)]]
    obstacles_states = random.choice(obstaclesMap1)
    # obstacles_states = obstaclesMap3[2]
    # obstacles_states = tuple(map(lambda x: (x[0] + 1, x[1] + 1), obstacles_states))

    # goalStates = ((11, 3), (11, 11))
    # obstacles_states = ((2, 6), (2, 8), (3, 6), (3, 8), (5, 6), (5, 8), (6, 6), (6, 8), (7, 6), (7, 8), (8, 6), (8, 8))

    Q_dict = runVI(goalStates, obstacles_states)
    print(Q_dict[(4, 7), goalStates])
