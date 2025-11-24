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
sys.setrecursionlimit(2**30)
import pandas as pd
import seaborn as sns

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
    next_state_prob.update({s_n: 1-noise})

    return next_state_prob


# def grid_transition_noise(s=(), a=(), A=(), is_valid=None, terminals=(), noise=0.1):
#     if s in terminals:
#         return {s: 1}

#     def apply_action(s, a):
#         return (s[0] + a[0], s[1] + a[1])

#     s_n = apply_action(s, a)
#     noise_action = [i for i in A if i != a]

#     sn_iter = (apply_action(s, a) for a in noise_action)
#     noise_next_states = list(filter(is_valid, sn_iter))
#     p_n = noise / (len(A) - 1)
#     num_invalid_action = len(noise_action) - len(noise_next_states)

#     if is_valid(s_n):
#         next_state_prob = {s: p_n for s in noise_next_states}
#         next_state_prob[s_n] = 1 - noise
#         next_state_prob[s] = num_invalid_action * p_n
#         return next_state_prob

#     else:
#         next_state_prob = {s: p_n for s in noise_next_states}
#         next_state_prob[s] = 1 - noise + num_invalid_action * p_n
#         return next_state_prob


def grid_transition_noise_midpoint(s=(), a=(), A=(), midpoint=(), is_valid=None, terminals=(), noise=0.1):
    if s in terminals:
        return {s: 1}

    def apply_action(s, a):
        return (s[0] + a[0], s[1] + a[1])

    midpoint_state = (apply_action(midpoint, a) for a in A)

    s_n = apply_action(a)
    noise_action = [i for i in A if i != a]

    sn_iter = (apply_action(s, a) for a in noise_action)
    noise_next_states = filter(is_valid, sn_iter)
    p_n = noise / (len(A) - 1)
    num_invalid_action = len(noise_action) - len(noise_next_states)

    # is s in midpoint_state:

    if is_valid(s_n):
        next_state_prob = {s: p_n for s in noise_next_states}
        next_state_prob[s_n] = 1 - noise
        next_state_prob[s] = num_invalid_action * p_n
        return next_state_prob

    else:
        next_state_prob = {s: p_n for s in noise_next_states}
        next_state_prob[s] = 1 - noise + num_invalid_action * p_n
        return next_state_prob


def grid_obstacle_vanish_transition(s, a, is_valid=None, terminals=(), vanish_rate=0.1):
    s_n = tuple(map(sum, zip(s[:2], a)))

    if s[2:] == (0, 0):
        if is_valid(s_n):
            return {(s_n + (0, 0)): 1}
        return {s: 1}

    # s_n[2:] = (np.argmax(np.random.multinomial(1,[vanish_rate,1-vanish_rate])), np.argmax(np.random.multinomial(1,[vanish_rate,1-vanish_rate])))

    if is_valid(s_n):
        if s[2:] == (1, 1):

            prob = {(s_n + (0, 0)): vanish_rate * vanish_rate,
                    (s_n + (1, 1)): (1 - vanish_rate) * (1 - vanish_rate),
                    (s_n + (0, 1)): vanish_rate * (1 - vanish_rate),
                    (s_n + (1, 0)): (1 - vanish_rate) * vanish_rate}

            return prob

        if s[2:] == (1, 0):
            prob = {(s_n + (0, 0)): vanish_rate,
                    (s_n + (1, 0)): 1 - vanish_rate}

            return prob

        if s[2:] == (0, 1):
            prob = {(s_n + (0, 0)): vanish_rate,
                    (s_n + (0, 1)): 1 - vanish_rate}

            return prob

    else:
        if s[2:] == (1, 1):

            prob = {(s[:2] + (0, 0)): vanish_rate * vanish_rate,
                    (s[:2] + (1, 1)): (1 - vanish_rate) * (1 - vanish_rate),
                    (s[:2] + (0, 1)): vanish_rate * (1 - vanish_rate),
                    (s[:2] + (1, 0)): (1 - vanish_rate) * vanish_rate}

            return prob

        if s[2:] == (1, 0):
            prob = {(s[:2] + (0, 0)): vanish_rate,
                    (s[:2] + (1, 0)): 1 - vanish_rate}

            return prob

        if s[2:] == (0, 1):
            prob = {(s[:2] + (0, 0)): vanish_rate,
                    (s[:2] + (0, 1)): 1 - vanish_rate}

            return prob


def grid_reward(s, a, sn, env=None, const=-1, terminals=None):
    if sn in terminals:
        return const + sum(map(lambda f: env.features[f][sn], env.features))
    else:
        return  const + sum(map(lambda f: env.features[f][s], env.features))


def grid_obstacle_vanish_reward(s, a, env=None, const=-1, is_terminal=None, terminals=()):
    if s[:2] == terminals[0] and s[2] == 1:
        return const + sum(map(lambda f: env.features[f][s[:2]], env.features))
    if s[:2] == terminals[1] and s[3] == 1:
        return const + sum(map(lambda f: env.features[f][s[:2]], env.features))
    else:
        return const


class ValueIteration():
    def __init__(self, gamma, epsilon=0.001, max_iter=100,terminals=()):
        self.gamma = gamma
        self.epsilon = epsilon
        self.max_iter = max_iter
        self.terminals = terminals

    def __call__(self, S, A, T, R):
        gamma, epsilon, max_iter = self.gamma, self.epsilon, self.max_iter
        S_iter = tuple(filter(lambda s:s not in self.terminals, S))
        V_init={s: 1 for s in S_iter}
        Vterminals = {s:0 for s in self.terminals}
        V_init.update(Vterminals)
        delta = 0
        for i in range(max_iter):
            V = V_init.copy()
            for s in S_iter:
                V_init[s] = max([sum([p * (R[s][a][s_n] + gamma * V[s_n]) for (s_n, p) in T[s][a].items()]) for a in A])
            delta = np.array([abs(V[s] - V_init[s]) for s in S_iter])
            if np.all(delta < epsilon * (1 - gamma) / gamma):
                break
        return V


def dict_to_array(V):
    states, values = zip(*((s, v) for (s, v) in V.items()))
    row_index, col_index = zip(*states)
    num_row = max(row_index) + 1
    num_col = max(col_index) + 1
    I = np.empty((num_row, num_col))
    I[row_index, col_index] = values
    return I


def V_dict_to_array(V):
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


if __name__ == '__main__':
    gridSize = 15
    numSheeps = 2
    sheep_state = tuple(it.product(range(gridSize), range(gridSize)))
    sheep_states_all = list(it.combinations(sheep_state, numSheeps))
    Q_merge = {}

    startTime = time.time()
    t = 0
    for sheep_states in sheep_states_all:
        t += 1
        # sheep_states = ((6, 2), (6, 6))
        sheep_states = ((7, 3), (3, 7))

        # sheep_states = ((4, 2), (2, 4))
        print(sheep_states)
        print("progress: {0}/{1} ".format(t, len(sheep_states_all)))

        env = GridWorld("test", nx=gridSize, ny=gridSize)
        goalReward = 100
        terminalValue = {s: goalReward for s in sheep_states}
        env.add_feature_map("goal", terminalValue, default=0)
        env.add_terminals(list(sheep_states))

        S = tuple(it.product(range(env.nx), range(env.ny)))

        A = ((1, 0), (0, 1), (-1, 0), (0, -1))
        noiseSpace = [(0, -2), (0, 2), (-2, 0), (2, 0), (1, 1), (1, -1), (-1, -1), (-1, 1)]

        noise = 0
        mode = 1 - noise
        transition_function = ft.partial(grid_transition_stochastic, noiseSpace=noiseSpace, terminals=sheep_states, is_valid=env.is_state_valid, mode=mode)

        # transition_function = ft.partial(grid_transition_noise, A=A, terminals=sheep_states, is_valid=env.is_state_valid, noise=noise)

        T = {s: {a: transition_function(s, a) for a in A} for s in S}
        T_arr = np.asarray([[[T[s][a].get(s_n, 0) for s_n in S]
                             for a in A] for s in S])

        """set the reward func"""
        upper = np.array([env.nx, env.ny])
        lower = np.array([-1, -1])

        barrier_func = ft.partial(signod_barrier, c=0, m=50, s=1)
        barrier_punish = ft.partial(
            barrier_punish, barrier_func=barrier_func, upper=upper, lower=lower)
        # to_wolf_punish = ft.partial(distance_punish, goal=wolf_state, unit=1)
        to_sheep_reward = ft.partial(
            distance_mean_reward, goal=sheep_states, unit=1)

        grid_reward = ft.partial(
            grid_reward, env=env, const=-1, terminals=sheep_states)

        func_lst = [grid_reward]
        reward_func = ft.partial(sum_rewards, func_lst=func_lst)

        reward_func = grid_reward
        # R = {s: {a: reward_func(s, a) for a in A} for s in S}
        # R_arr = np.asarray([[[R[s][a] for s_n in S] for a in A]
                            # for s in S], dtype=float)

        R = {s: {a: {sn: reward_func(s, a, sn) for sn in S} for a in A} for s in S}
        R_arr = np.asarray([[[R[s][a].get(s_n, 0) for s_n in S]
                             for a in A] for s in S])

        gamma = 0.9
        value_iteration = ValueIteration(gamma, epsilon=0.0001, max_iter=100,terminals=sheep_states)
        V = value_iteration(S, A, T, R)
        V.update(terminalValue)
        # print(V)

        V_arr = V_dict_to_array(V)
        Q = V_to_Q(V=V_arr, T=T_arr, R=R_arr, gamma=gamma)
        Q_dict = {s: {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}
        # print (Q_dict)

        Q_dict_output = {(s, sheep_states): {a: Q[si, ai] for (ai, a) in enumerate(A)} for (si, s) in enumerate(S)}
        # print (Q_dict_output)

        normlizedQ_dict = {}
        for wolf_state in S:
            normlizedQ_dict[wolf_state] = {action: np.divide(Q_dict[wolf_state][action], np.sum(list(Q_dict[wolf_state].values()))) for action in A}

# # viz V
        # def calMaxDiff(Qlist):
        #     diff = sorted(Qlist)[-1] - sorted(Qlist)[-2]
        #     return diff
        # QValueDiff = {s: calMaxDiff(Q_dict[s].values()) for s in Q_dict.keys()}
        # normlizedQValueDiff = {s: calMaxDiff(normlizedQ_dict[s].values()) for s in normlizedQ_dict.keys()}
        # actionProbMax = {s: max(normlizedQ_dict[s].values()) for s in Q_dict.keys()}

        # mapValue = 'QValueDiff'
        # heatMapValue = eval(mapValue)
        # y = dict_to_array(heatMapValue)
        # y = y.reshape((gridSize, gridSize))
        # df = pd.DataFrame(y, columns=[x for x in range(gridSize)])
        # sns.heatmap(df, annot=True, fmt='.3f')
        # plt.title('{} for goal at {} noise={} goalReward={}'.format(mapValue, sheep_states, noise, goalReward))
        # plt.show()
        # break


# viz Q
        fig, ax = plt.subplots(1, 1, tight_layout=True)
        fig.set_size_inches(env.nx * 3, env.ny * 3, forward=True)
        draw_policy_4d_softmax(ax, normlizedQ_dict, V=V, S=S, A=A)
        plt.show()
        break

        # prefix = "result" + str(sheep_states) + 'noise' + str(noise)
        # name = "wolf_".join((prefix, "policy.png"))
        # module_path = os.path.dirname(os.path.abspath(__file__))
        # # figure_path = os.path.join(module_path, "figures")
        # path = os.path.join(module_path, name)
        # print ("saving policy figure at %s" % path)
        # plt.savefig(path, dpi=300)

        Q_merge.update(Q_dict_output)
        # print (Q_dict[(3, 3)])

# # save value
    # print (len(Q_merge))
    # dirName = os.path.dirname(os.path.abspath(__file__))
    # prefix = 'noise' + str(noise) + 'commitArea' + 'Gird' + str(env.nx)
    # pickle_dump_single_result(
    #     dirc=dirName, prefix=prefix, name="policy", data=Q_merge)

    # endTime = time.time()
    # print("Time taken {} seconds".format((endTime - startTime)))
