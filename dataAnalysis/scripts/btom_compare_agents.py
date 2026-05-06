"""
BToM (Bayesian Theory of Mind) trajectory legibility for 2P3G new-goal trials.

Adapted from the BToM block in
collabAIdata/analysis_adults_unified_claude.ipynb (cells 27-32).

Computes the posterior P(reached goal | sub-trajectory after new-goal onset)
for each player using a softmax goal-conditioned policy obtained by value
iteration. The posterior is the goal-inference legibility measure.

Compares four populations on this measure:
    * commit-commit  (CommittedAgent vs CommittedAgent simulation)
    * signal-signal  (SignalAgent mixture, p=0.375, vs itself)
    * joint-RL       (joint-RL planner vs itself)
    * human-human    (real human-human dyads, 2P3G new-goal trials)

Outputs CSVs and PNGs into dataAnalysis/btom_legibility/.
"""
from __future__ import annotations

import functools as ft
import itertools as it
import json
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy.interpolate import interp1d


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]   # dataAnalysis/
OUT_DIR = ROOT / "btom_legibility"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DATA_PATHS = {
    "commit-commit": ROOT
    / "committed_vs_committed_simulation"
    / "committed_vs_committed_2p3g_raw_trials_sessions_0_to_14.json",
    "signal-signal": ROOT
    / "signal_agent_mixture_p_fit_beta3"
    / "simulations"
    / "signal_vs_signal_2p3g_raw_trials_beta_3_lambda_0p125_alpha_0p375_sessions_0_to_29.json",
    "joint-RL":     ROOT
    / "joint_rl_vs_joint_rl_simulation"
    / "joint_rl_vs_joint_rl_2p3g_raw_trials_sessions_0_to_29.json",
    "human-human":  ROOT
    / "equal_to_both_agent_human_comparison"
    / "human_human_pure_unique_2p3g_raw_trials.json",
}

GROUP_ORDER = ["commit-commit", "signal-signal", "joint-RL", "human-human"]
GROUP_PALETTE = {
    "commit-commit": "#1f77b4",
    "signal-signal": "#2ca02c",
    "joint-RL":      "#7f7f7f",
    "human-human":   "#d62728",
}


# ---------------------------------------------------------------------------
# Grid-world MDP + value iteration (lifted from the unified notebook)
# ---------------------------------------------------------------------------

ACTION_SPACE = [(0, -1), (0, 1), (-1, 0), (1, 0)]
NOISE_SPACE  = [(0, -1), (0, 1), (-1, 0), (1, 0),
                (1, 1), (1, -1), (-1, -1), (-1, 1)]


class _GridWorld:
    def __init__(self, nx, ny, obstacles=()):
        self.nx, self.ny = nx, ny
        self.obstacles = set(map(tuple, obstacles))

    def is_valid(self, state):
        x, y = state
        return (0 <= x < self.nx and 0 <= y < self.ny
                and state not in self.obstacles)


def _stochastic_transition(state, action, *, terminals, is_valid, noise):
    if state in terminals:
        return {state: 1.0}
    ns = (state[0] + action[0], state[1] + action[1])
    if not is_valid(ns):
        return {state: 1.0}
    candidates = [s for s in ((state[0] + a[0], state[1] + a[1])
                              for a in NOISE_SPACE) if is_valid(s)]
    if len(candidates) <= 1:
        return {ns: 1.0}
    p_noise = noise / (len(candidates) - 1)
    probs = {s: p_noise for s in candidates}
    probs[ns] = 1.0 - noise
    return probs


def _value_iteration(S, A, T, R, gamma, terminals, eps=1e-3, max_iter=200):
    S_nonterm = [s for s in S if s not in terminals]
    V = {s: 0.1 for s in S}
    for s in terminals:
        V[s] = 0.0
    for _ in range(max_iter):
        delta = 0.0
        for s in S_nonterm:
            old = V[s]
            V[s] = max(
                sum(p * (R[s][a][sn] + gamma * V[sn])
                    for sn, p in T[s][a].items())
                for a in A
            )
            delta = max(delta, abs(V[s] - old))
        if delta < eps:
            break
    return V


def solve_goal_policy(goal, grid_size=15, noise=0.067, gamma=0.9,
                      goal_reward=30, obstacles=()):
    env = _GridWorld(grid_size, grid_size, obstacles)
    goal = tuple(int(v) for v in goal)
    terminals = {goal}

    S = [s for s in it.product(range(grid_size), range(grid_size))
         if s not in env.obstacles]
    A = ACTION_SPACE

    tf = ft.partial(_stochastic_transition,
                    terminals=terminals, is_valid=env.is_valid, noise=noise)
    T = {s: {a: tf(s, a) for a in A} for s in S}

    step_cost = -1.0 / (grid_size * 2)
    R = {}
    for s in S:
        R[s] = {}
        for a in A:
            R[s][a] = {}
            for sn in T[s][a]:
                R[s][a][sn] = step_cost + (goal_reward if sn in terminals else 0.0)

    V = _value_iteration(S, A, T, R, gamma, terminals)
    for s in terminals:
        V[s] = goal_reward

    Q = {}
    for s in S:
        Q[s] = {}
        for a in A:
            Q[s][a] = sum(p * (R[s][a][sn] + gamma * V[sn])
                          for sn, p in T[s][a].items())
    return Q


def softmax_action_probs(Q_state, beta=2.5):
    if not Q_state:
        return {}
    actions = list(Q_state.keys())
    vals = np.array([Q_state[a] for a in actions])
    vals = vals - vals.max()
    exp_vals = np.exp(beta * vals)
    probs = exp_vals / exp_vals.sum()
    return dict(zip(actions, probs))


def infer_goal_posteriors(traj_states, actions, Q_A, Q_B, beta=2.5):
    """Posterior over (goal A, goal B) at each time step."""
    prior = [0.5, 0.5]
    posteriors = [list(prior)]
    for pos, act in zip(traj_states, actions):
        pos = tuple(int(v) for v in pos)
        act = tuple(int(v) for v in act)
        pA = softmax_action_probs(Q_A.get(pos, {}), beta)
        pB = softmax_action_probs(Q_B.get(pos, {}), beta)
        lA = pA.get(act, 1e-10)
        lB = pB.get(act, 1e-10)
        un = [prior[0] * lA, prior[1] * lB]
        Z = sum(un)
        prior = [u / Z for u in un] if Z > 0 else [0.5, 0.5]
        posteriors.append(list(prior))
    return posteriors


# ---------------------------------------------------------------------------
# BToM per-trial logic
# ---------------------------------------------------------------------------

_q_cache: dict = {}


def get_Q(goal_tuple):
    g = tuple(int(v) for v in goal_tuple)
    if g not in _q_cache:
        _q_cache[g] = solve_goal_policy(g)
    return _q_cache[g]


def _actions_from_traj(traj):
    return [
        (int(traj[i + 1][0]) - int(traj[i][0]),
         int(traj[i + 1][1]) - int(traj[i][1]))
        for i in range(len(traj) - 1)
    ]


def _btom_for_player(row, player_index):
    """Compute posterior trajectory for one player; returns list[float] or None.

    player_index: 0 or 1
    """
    target1 = row.get("target1")
    target2 = row.get("target2")
    new_goal_pos = row.get("newGoalPosition")
    if target1 is None or target2 is None or new_goal_pos is None:
        return None
    try:
        shared_idx = int(row.get("firstDetectedSharedGoal"))
    except (TypeError, ValueError):
        return None
    if shared_idx not in (0, 1):
        return None
    goalA = target1 if shared_idx == 0 else target2  # original shared goal
    goalB = new_goal_pos                              # new goal

    final_col = "player1FinalReachedGoal" if player_index == 0 else "player2FinalReachedGoal"
    try:
        final_idx = int(row.get(final_col))
    except (TypeError, ValueError):
        return None
    if final_idx == shared_idx:
        reached_idx = 0       # reached original shared goal
    elif final_idx == 2:
        reached_idx = 1       # reached new goal
    else:
        return None           # reached the OTHER original goal -> skip

    traj_col = f"player{player_index + 1}Trajectory"
    traj = row.get(traj_col)
    if not traj or len(traj) < 2:
        return None

    try:
        ngt = int(row.get("newGoalPresentedTime"))
    except (TypeError, ValueError):
        return None
    if ngt < 0 or ngt >= len(traj) - 1:
        return None

    sub_traj = traj[ngt:]
    sub_acts = _actions_from_traj(sub_traj)
    if len(sub_acts) < 1:
        return None

    Q_A = get_Q(tuple(goalA))
    Q_B = get_Q(tuple(goalB))
    posts = infer_goal_posteriors(sub_traj[:-1], sub_acts, Q_A, Q_B, beta=2.5)
    return [p[reached_idx] for p in posts]


# ---------------------------------------------------------------------------
# Loading + per-group computation
# ---------------------------------------------------------------------------

def load_group(name, fp):
    with open(fp) as f:
        trials = json.load(f)
    rows = []
    for t in trials:
        if not t.get("newGoalPresented"):
            continue
        for player_index in (0, 1):
            posts = _btom_for_player(t, player_index)
            if posts is None:
                continue
            # Build per-participant id (each agent gets its own id in sims;
            # in human-human, currentPlayer is the human row already).
            pid_field = (f"participantId_player{player_index + 1}"
                         if f"participantId_player{player_index + 1}" in t
                         else None)
            if pid_field:
                pid = t.get(pid_field)
            elif "participantId" in t and player_index == 0:
                pid = t.get("participantId")    # human-human row -> player1
            else:
                pid = f"{name}_session_{t.get('sessionIndex','?')}_p{player_index + 1}"
            rows.append({
                "group": name,
                "participantId": str(pid),
                "trialIndex": t.get("trialIndex"),
                "playerIndex": player_index,
                "distanceCondition": t.get("distanceCondition"),
                "posteriors": posts,
                "n_steps": len(posts),
            })
    return pd.DataFrame(rows)


def main():
    sns.set_theme(style="whitegrid", context="talk")

    print("Computing BToM posteriors per group ...")
    group_dfs = []
    for name in GROUP_ORDER:
        fp = DATA_PATHS[name]
        if not fp.exists():
            print(f"  [skip] {name}: missing {fp}")
            continue
        df = load_group(name, fp)
        print(f"  {name}: {len(df)} player-trials  "
              f"(unique pid={df['participantId'].nunique()})")
        group_dfs.append(df)
    btom_df = pd.concat(group_dfs, ignore_index=True)
    print(f"Total BToM trajectories: {len(btom_df)}")
    print(f"Unique goals solved: {len(_q_cache)}")

    # ---- Trajectory-percent interpolation ----
    N_INTERP = 11
    x_pct = np.linspace(0, 1, N_INTERP)

    def interp(post_list):
        if len(post_list) < 2:
            return None
        return interp1d(np.linspace(0, 1, len(post_list)), post_list, kind="linear")(x_pct)

    btom_df["btom_interp"] = btom_df["posteriors"].apply(interp)
    btom_df_interp = btom_df.dropna(subset=["btom_interp"]).copy()

    rows = []
    for _, r in btom_df_interp.iterrows():
        for ti, val in enumerate(r["btom_interp"]):
            rows.append({
                "group":         r["group"],
                "participantId": r["participantId"],
                "time_pct":      x_pct[ti] * 100,
                "posterior":     val,
            })
    btom_long = pd.DataFrame(rows)

    btom_part = (btom_long
                 .groupby(["participantId", "group", "time_pct"], observed=False)["posterior"]
                 .mean().reset_index())

    # ---- Plot 1: posterior over % trajectory ----
    fig, ax = plt.subplots(figsize=(10, 6))
    sns.lineplot(data=btom_part, x="time_pct", y="posterior",
                 hue="group", hue_order=GROUP_ORDER, palette=GROUP_PALETTE,
                 errorbar=("ci", 95), ax=ax)
    ax.axhline(0.5, ls="--", color="grey", alpha=0.5, label="chance")
    ax.set(xlabel="Trajectory progress after new goal (%)",
           ylabel="Posterior P(reached goal)",
           title="BToM legibility over trajectory by partner type",
           ylim=(0.4, 1.05))
    ax.legend(title="Partner type", bbox_to_anchor=(1.02, 1), loc="upper left")
    sns.despine()
    plt.tight_layout()
    plt.savefig(OUT_DIR / "btom_posterior_over_trajectory.png", dpi=140)
    plt.close()

    # ---- Plot 2: posterior over first 5 steps ----
    MAX_STEP = 5
    rows = []
    for _, r in btom_df.iterrows():
        for step, val in enumerate(r["posteriors"][: MAX_STEP + 1]):
            rows.append({
                "group":         r["group"],
                "participantId": r["participantId"],
                "step":          step,
                "posterior":     val,
            })
    btom_step_long = pd.DataFrame(rows)
    btom_step_part = (btom_step_long
                      .groupby(["participantId", "group", "step"], observed=False)["posterior"]
                      .mean().reset_index())

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.lineplot(data=btom_step_part, x="step", y="posterior",
                 hue="group", hue_order=GROUP_ORDER, palette=GROUP_PALETTE,
                 errorbar=("ci", 95), marker="o", ax=ax)
    ax.axhline(0.5, ls="--", color="grey", alpha=0.5, label="chance")
    ax.set(xlabel="Steps after new goal appears",
           ylabel="Posterior P(reached goal)",
           title="BToM legibility over first 5 steps by partner type",
           xlim=(-0.1, MAX_STEP + 0.1), ylim=(0.4, 1.05))
    ax.set_xticks(range(MAX_STEP + 1))
    ax.legend(title="Partner type", bbox_to_anchor=(1.02, 1), loc="upper left")
    sns.despine()
    plt.tight_layout()
    plt.savefig(OUT_DIR / "btom_posterior_first5_steps.png", dpi=140)
    plt.close()

    # ---- Plot 3: bar chart, mean posterior across first 5 steps ----
    btom_step_mean = (btom_step_part
                      .groupby(["participantId", "group"], observed=False)["posterior"]
                      .mean().reset_index())

    fig, ax = plt.subplots(figsize=(8, 6))
    sns.barplot(data=btom_step_mean, x="group", y="posterior",
                order=GROUP_ORDER, hue="group", palette=GROUP_PALETTE,
                legend=False, errorbar=("ci", 95),
                err_kws={"color": "black", "linewidth": 1.5}, capsize=0.1,
                alpha=0.9, ax=ax)
    ax.axhline(0.5, ls="--", color="grey", alpha=0.5, label="chance")
    ax.set(xlabel="Partner type", ylabel="Mean posterior P(reached goal)",
           title="BToM legibility — first 5 steps", ylim=(0.4, 1.0))
    for c in ax.containers:
        ax.bar_label(c, fmt="%.3f")
    plt.xticks(rotation=20, ha="right")
    sns.despine()
    plt.tight_layout()
    plt.savefig(OUT_DIR / "btom_bar_first5_steps.png", dpi=140)
    plt.close()

    # ---- Plot 4: bar chart, mean posterior over full trajectory ----
    btom_traj_mean = (btom_part
                      .groupby(["participantId", "group"], observed=False)["posterior"]
                      .mean().reset_index())

    fig, ax = plt.subplots(figsize=(8, 6))
    sns.barplot(data=btom_traj_mean, x="group", y="posterior",
                order=GROUP_ORDER, hue="group", palette=GROUP_PALETTE,
                legend=False, errorbar=("ci", 95),
                err_kws={"color": "black", "linewidth": 1.5}, capsize=0.1,
                alpha=0.9, ax=ax)
    ax.axhline(0.5, ls="--", color="grey", alpha=0.5, label="chance")
    ax.set(xlabel="Partner type", ylabel="Mean posterior P(reached goal)",
           title="BToM legibility — full sub-trajectory", ylim=(0.4, 1.0))
    for c in ax.containers:
        ax.bar_label(c, fmt="%.3f")
    plt.xticks(rotation=20, ha="right")
    sns.despine()
    plt.tight_layout()
    plt.savefig(OUT_DIR / "btom_bar_full_trajectory.png", dpi=140)
    plt.close()

    # ---- Save CSVs ----
    btom_part.to_csv(OUT_DIR / "btom_posterior_pct_per_participant.csv", index=False)
    btom_step_part.to_csv(OUT_DIR / "btom_posterior_step_per_participant.csv", index=False)
    btom_step_mean.to_csv(OUT_DIR / "btom_first5_mean_per_participant.csv", index=False)
    btom_traj_mean.to_csv(OUT_DIR / "btom_traj_mean_per_participant.csv", index=False)

    summary_first5 = (btom_step_mean
                      .groupby("group", observed=False)["posterior"]
                      .agg(["mean", "std", "count"]).reset_index())
    summary_full = (btom_traj_mean
                    .groupby("group", observed=False)["posterior"]
                    .agg(["mean", "std", "count"]).reset_index())
    print("\nFirst-5-step mean posterior:")
    print(summary_first5.to_string(index=False))
    print("\nFull-sub-trajectory mean posterior:")
    print(summary_full.to_string(index=False))
    summary_first5.to_csv(OUT_DIR / "btom_summary_first5.csv", index=False)
    summary_full.to_csv(OUT_DIR / "btom_summary_full.csv", index=False)

    print(f"\nWrote outputs to {OUT_DIR}")


if __name__ == "__main__":
    main()
