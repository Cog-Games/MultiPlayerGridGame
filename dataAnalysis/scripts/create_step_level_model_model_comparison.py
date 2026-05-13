#!/usr/bin/env python3
"""Create a model-model comparison report using step-level fitted parameters.

This report is separate from model_model_comparison.html, whose primary rows
use trial-level metric fits for several models.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PROJECT_ROOT = Path(__file__).resolve().parents[2]
HUMAN_RAW = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "human" / "equal_to_both_agent_human_comparison" / "human_human_pure_unique_2p3g_raw_trials.json"
OUT_DIR = PROJECT_ROOT / "dataAnalysis" / "model_model" / "step_level_fit_comparison"
ASSET_DIR = OUT_DIR / "assets"
SIM_DIR = OUT_DIR / "simulations"
HTML_PATH = PROJECT_ROOT / "dataAnalysis" / "model_model" / "model_model_comparison_step_level_fit.html"

ACTIONS: List[Tuple[int, int]] = [(0, -1), (0, 1), (-1, 0), (1, 0)]
ACTION_TO_INDEX = {a: i for i, a in enumerate(ACTIONS)}
GRID_SIZE = 15
GAMMA = 0.9
GOAL_REWARD = 30.0
STEP_COST = -1.0
SOFTMAX_BETA = 3.0
GOAL_WEIGHT_BETA = 3.0
PROXIMITY_REWARD_WEIGHT = 0.01
EPS = 1e-12

MODEL_ORDER = [
    "sampleJointGoal_afterNewGoal",
    "sampleJointGoalAndSignal_afterNewGoal",
    "sampleJointGoal_fromStart",
    "TwoStageSignalAgent_sigmoidThreshold",
]
MODEL_COLORS = {
    "sampleJointGoal_afterNewGoal": "#4e79a7",
    "sampleJointGoalAndSignal_afterNewGoal": "#59a14f",
    "sampleJointGoal_fromStart": "#f28e2b",
    "TwoStageSignalAgent_sigmoidThreshold": "#e15759",
    "Human-Human": "#777777",
}
SHORT_LABELS = {
    "sampleJointGoal_afterNewGoal": "sampleAfterNew",
    "sampleJointGoalAndSignal_afterNewGoal": "sample+signal",
    "sampleJointGoal_fromStart": "sampleFromStart",
    "TwoStageSignalAgent_sigmoidThreshold": "sigmoidThreshold",
    "Human-Human": "Human",
}


@dataclass
class StepObs:
    model_scope: str
    room_id: str
    trial_index: int
    distance_condition: str
    step: int
    player: int
    self_pos: Tuple[int, int]
    other_pos: Tuple[int, int]
    goals: List[Tuple[int, int]]
    posterior: np.ndarray
    eu: np.ndarray
    action_probs_by_goal: np.ndarray
    action_probs_all: np.ndarray
    legible_indicator: np.ndarray
    observed_idx: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reuse-simulations", action="store_true")
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--trials", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-lambda", type=float, default=50.0)
    return parser.parse_args()


def parse_point(value: Any) -> Optional[Tuple[int, int]]:
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return int(value[0]), int(value[1])
    try:
        parsed = json.loads(str(value))
    except Exception:
        return None
    if isinstance(parsed, (list, tuple)) and len(parsed) == 2:
        return int(parsed[0]), int(parsed[1])
    return None


def parse_points(value: Any) -> List[Tuple[int, int]]:
    if value is None:
        return []
    if isinstance(value, float) and np.isnan(value):
        return []
    raw = value
    if not isinstance(raw, list):
        try:
            raw = json.loads(str(value))
        except Exception:
            return []
    out = []
    for point in raw:
        parsed = parse_point(point)
        if parsed is not None:
            out.append(parsed)
    return out


def parse_actions(value: Any) -> List[Tuple[int, int]]:
    return parse_points(value)


def safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None
    try:
        return int(value)
    except Exception:
        return None


def manhattan(a: Tuple[int, int], b: Tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def transition(pos: Tuple[int, int], action: Tuple[int, int]) -> Tuple[int, int]:
    return (
        max(0, min(GRID_SIZE - 1, pos[0] + action[0])),
        max(0, min(GRID_SIZE - 1, pos[1] + action[1])),
    )


_ACTION_PROB_CACHE: Dict[Tuple[Tuple[int, int], Tuple[int, int], Tuple[Tuple[int, int], ...]], np.ndarray] = {}


def action_probabilities(
    self_pos: Tuple[int, int],
    other_pos: Tuple[int, int],
    goals: Sequence[Tuple[int, int]],
) -> np.ndarray:
    """Approximate the branch joint-RL marginal action probabilities.

    This matches the lightweight likelihood used by the existing committed and
    always-committed step-level fitters, generalized to a current goal set.
    """
    goal_tuple = tuple(tuple(g) for g in goals)
    key = (tuple(self_pos), tuple(other_pos), goal_tuple)
    cached = _ACTION_PROB_CACHE.get(key)
    if cached is not None:
        return cached

    goal_set = set(goal_tuple)
    q_values: List[float] = []
    for self_action in ACTIONS:
        self_next = self_pos if self_pos in goal_set else transition(self_pos, self_action)
        for other_action in ACTIONS:
            other_next = other_pos if other_pos in goal_set else transition(other_pos, other_action)
            done = self_next == other_next and self_next in goal_set
            if done:
                reward = GOAL_REWARD
                future_value = 0.0
            else:
                joint_distance = min(
                    manhattan(self_next, goal) + manhattan(other_next, goal)
                    for goal in goal_tuple
                )
                reward = STEP_COST - PROXIMITY_REWARD_WEIGHT * joint_distance
                future_value = GAMMA * (GOAL_REWARD + STEP_COST * joint_distance)
            q_values.append(reward + future_value)

    q = np.asarray(q_values, dtype=np.float64)
    prefs = np.exp(np.clip(SOFTMAX_BETA * (q - np.max(q)), -700, 700))
    joint_probs = prefs / max(EPS, np.sum(prefs))
    own_probs = np.asarray(
        [
            np.sum(joint_probs[i * len(ACTIONS) : (i + 1) * len(ACTIONS)])
            for i in range(len(ACTIONS))
        ],
        dtype=np.float64,
    )
    own_probs = np.maximum(EPS, own_probs)
    own_probs /= np.sum(own_probs)
    _ACTION_PROB_CACHE[key] = own_probs
    return own_probs


def normalize(posterior: np.ndarray) -> np.ndarray:
    total = float(np.sum(posterior))
    if not math.isfinite(total) or total <= 0:
        return np.full(len(posterior), 1.0 / max(1, len(posterior)), dtype=np.float64)
    return posterior / total


def resize_committed(posterior: np.ndarray, goal_count: int) -> np.ndarray:
    if posterior.size == 0:
        return np.full(goal_count, 1.0 / goal_count, dtype=np.float64)
    if posterior.size == goal_count:
        return posterior
    out = np.zeros(goal_count, dtype=np.float64)
    overlap = min(goal_count, posterior.size)
    out[:overlap] = posterior[:overlap]
    if goal_count > posterior.size:
        out[posterior.size:goal_count] = 1.0 / goal_count
    return normalize(out)


def resize_always(posterior: np.ndarray, goal_count: int) -> np.ndarray:
    if posterior.size == 0:
        return np.full(goal_count, 1.0 / goal_count, dtype=np.float64)
    if posterior.size == goal_count:
        return posterior
    out = np.zeros(goal_count, dtype=np.float64)
    overlap = min(goal_count, posterior.size)
    old = posterior[:overlap]
    old_total = float(np.sum(old))
    added = max(0, goal_count - posterior.size)
    new_goal_mass = added / goal_count if added > 0 else 0.0
    old_mass = max(0.0, 1.0 - new_goal_mass)
    if overlap > 0:
        out[:overlap] = old / old_total * old_mass if old_total > 0 else old_mass / overlap
    if added > 0:
        out[posterior.size:goal_count] = 1.0 / goal_count
    return normalize(out)


def goals_for_step(row: Dict[str, Any], step: int) -> List[Tuple[int, int]]:
    initial = parse_points(row.get("initialGoalPositions"))
    if len(initial) < 2:
        target1 = parse_point(row.get("target1"))
        target2 = parse_point(row.get("target2"))
        initial = [g for g in [target1, target2] if g is not None]
    goals = list(initial[:2])
    new_goal = parse_point(row.get("newGoalPosition"))
    new_time = safe_int(row.get("newGoalPresentedTime"))
    if row.get("newGoalPresented") and new_goal is not None and new_time is not None and step >= new_time:
        goals.append(new_goal)
    return goals


def compute_eu(self_pos: Tuple[int, int], other_pos: Tuple[int, int], goals: Sequence[Tuple[int, int]]) -> np.ndarray:
    return np.asarray([-(manhattan(self_pos, g) + manhattan(other_pos, g)) for g in goals], dtype=np.float64)


def revealed_posterior(posterior: np.ndarray, by_goal_probs: np.ndarray, action_idx: int) -> np.ndarray:
    numer = posterior * by_goal_probs[:, action_idx]
    total = float(np.sum(numer))
    if not math.isfinite(total) or total <= 0:
        return np.full(len(posterior), 1.0 / max(1, len(posterior)), dtype=np.float64)
    return numer / total


def legible_indicator_for_obs(
    self_pos: Tuple[int, int],
    goals: Sequence[Tuple[int, int]],
    posterior: np.ndarray,
    by_goal_probs: np.ndarray,
    observed_idx: int,
) -> np.ndarray:
    out = np.zeros(len(goals), dtype=np.float64)
    for g_idx, goal in enumerate(goals):
        current_dist = manhattan(self_pos, goal)
        best_action_idx = None
        best_prob = -1.0
        for a_idx, action in enumerate(ACTIONS):
            next_pos = transition(self_pos, action)
            if manhattan(next_pos, goal) >= current_dist:
                continue
            post = revealed_posterior(posterior, by_goal_probs, a_idx)
            target_prob = float(post[g_idx])
            if target_prob > best_prob:
                best_prob = target_prob
                best_action_idx = a_idx
        if best_action_idx is None:
            out[g_idx] = by_goal_probs[g_idx, observed_idx]
        else:
            out[g_idx] = 1.0 if observed_idx == best_action_idx else 0.0
    return out


def build_observations(rows: Sequence[Dict[str, Any]], scope: str) -> List[StepObs]:
    observations: List[StepObs] = []
    use_committed_resize = scope in {"committed", "signal"}
    resize_fn = resize_committed if use_committed_resize else resize_always

    for row in rows:
        if row.get("experimentType") != "2P3G":
            continue
        p1_actions = parse_actions(row.get("player1Actions"))
        p2_actions = parse_actions(row.get("player2Actions"))
        p1_traj = parse_points(row.get("player1Trajectory"))
        p2_traj = parse_points(row.get("player2Trajectory"))
        max_steps = max(len(p1_actions), len(p2_actions), len(p1_traj), len(p2_traj))
        posterior = np.asarray([], dtype=np.float64)
        new_time = safe_int(row.get("newGoalPresentedTime"))
        shared = safe_int(row.get("firstDetectedSharedGoal"))
        is_post_new_scope = scope in {"committed", "signal"}

        for step in range(max_steps):
            goals = goals_for_step(row, step)
            if not goals:
                continue
            posterior = resize_fn(posterior, len(goals))

            can_score_scope = True
            if is_post_new_scope:
                can_score_scope = (
                    bool(row.get("newGoalPresented"))
                    and new_time is not None
                    and step >= new_time
                    and shared is not None
                )

            if can_score_scope:
                for player, actions, self_traj, other_traj in [
                    (1, p1_actions, p1_traj, p2_traj),
                    (2, p2_actions, p2_traj, p1_traj),
                ]:
                    if step >= len(actions) or step >= len(self_traj) or step >= len(other_traj):
                        continue
                    action = actions[step]
                    if action not in ACTION_TO_INDEX:
                        observed_idx = 0
                    else:
                        observed_idx = ACTION_TO_INDEX[action]
                    self_pos = self_traj[step]
                    other_pos = other_traj[step]
                    by_goal = np.vstack([
                        action_probabilities(self_pos, other_pos, [goal])
                        for goal in goals
                    ])
                    all_probs = action_probabilities(self_pos, other_pos, goals)
                    eu = compute_eu(self_pos, other_pos, goals)
                    leg = legible_indicator_for_obs(self_pos, goals, posterior, by_goal, observed_idx)
                    observations.append(
                        StepObs(
                            model_scope=scope,
                            room_id=str(row.get("roomId")),
                            trial_index=int(row.get("trialIndex") or 0),
                            distance_condition=str(row.get("distanceCondition") or ""),
                            step=step,
                            player=player,
                            self_pos=self_pos,
                            other_pos=other_pos,
                            goals=list(goals),
                            posterior=posterior.copy(),
                            eu=eu,
                            action_probs_by_goal=by_goal,
                            action_probs_all=all_probs,
                            legible_indicator=leg,
                            observed_idx=observed_idx,
                        )
                    )

            # Update posterior after scoring this step.
            if step < len(p1_actions) and step < len(p1_traj) and step < len(p2_traj):
                action = p1_actions[step]
                if action in ACTION_TO_INDEX:
                    idx = ACTION_TO_INDEX[action]
                    likes = np.asarray([
                        action_probabilities(p1_traj[step], p2_traj[step], [goal])[idx]
                        for goal in goals
                    ])
                    posterior *= likes
            if step < len(p2_actions) and step < len(p2_traj) and step < len(p1_traj):
                action = p2_actions[step]
                if action in ACTION_TO_INDEX:
                    idx = ACTION_TO_INDEX[action]
                    likes = np.asarray([
                        action_probabilities(p2_traj[step], p1_traj[step], [goal])[idx]
                        for goal in goals
                    ])
                    posterior *= likes
            posterior = normalize(posterior)

    return observations


def goal_weights(obs: StepObs, lambda_value: float) -> np.ndarray:
    scaled = GOAL_WEIGHT_BETA * obs.eu
    max_scaled = float(np.max(scaled[np.isfinite(scaled)])) if np.any(np.isfinite(scaled)) else 0.0
    eu_weight = np.exp(np.clip(scaled - max_scaled, -700, 700))
    posterior_weight = np.power(np.maximum(EPS, obs.posterior), lambda_value)
    weights = eu_weight * posterior_weight
    total = float(np.sum(weights))
    if not math.isfinite(total) or total <= 0:
        return np.full(len(weights), 1.0 / max(1, len(weights)), dtype=np.float64)
    return weights / total


def committed_likelihood(obs: StepObs, lambda_value: float) -> float:
    w = goal_weights(obs, lambda_value)
    return max(EPS, float(np.sum(w * obs.action_probs_by_goal[:, obs.observed_idx])))


def signal_likelihood(obs: StepObs, lambda_value: float, p_signal: float) -> float:
    w = goal_weights(obs, lambda_value)
    committed = obs.action_probs_by_goal[:, obs.observed_idx]
    per_goal = (1.0 - p_signal) * committed + p_signal * obs.legible_indicator
    return max(EPS, float(np.sum(w * per_goal)))


def two_stage_likelihood(obs: StepObs, lambda_value: float, p_signal: float, tau: float = 2.0 / 3.0, eta: float = 0.0) -> float:
    confidence = float(np.max(obs.posterior)) if obs.posterior.size else 0.0
    gate = 1.0 / (1.0 + math.exp(-10.0 * (confidence - tau)))
    early = float(obs.action_probs_all[obs.observed_idx])
    if eta != 0:
        # The current report fixes eta=0. This branch is retained for clarity.
        early = max(EPS, early)
    late = signal_likelihood(obs, lambda_value, p_signal)
    return max(EPS, (1.0 - gate) * early + gate * late)


def nll(observations: Sequence[StepObs], likelihood_fn) -> float:
    return -float(sum(math.log(max(EPS, likelihood_fn(obs))) for obs in observations))


def fit_scalar_lambda(observations: Sequence[StepObs], max_lambda: float) -> Dict[str, Any]:
    result = minimize_scalar(
        lambda value: nll(observations, lambda obs: committed_likelihood(obs, value)),
        bounds=(0.0, max_lambda),
        method="bounded",
        options={"xatol": 1e-4},
    )
    return {
        "lambda": float(result.x),
        "negative_log_likelihood": float(result.fun),
        "optimizer_success": bool(result.success),
    }


def fit_grid(
    observations: Sequence[StepObs],
    likelihood_kind: str,
    lambda_grid: Sequence[float],
    p_grid: Sequence[float],
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for lam in lambda_grid:
        for p in p_grid:
            if likelihood_kind == "signal":
                value = nll(observations, lambda obs, lam=lam, p=p: signal_likelihood(obs, lam, p))
            elif likelihood_kind == "two_stage":
                value = nll(observations, lambda obs, lam=lam, p=p: two_stage_likelihood(obs, lam, p))
            else:
                raise ValueError(likelihood_kind)
            rows.append({"lambda": float(lam), "p_signal": float(p), "negative_log_likelihood": value})
    df = pd.DataFrame(rows)
    best = df.loc[df["negative_log_likelihood"].idxmin()].to_dict()
    return df, best


def load_human_rows() -> List[Dict[str, Any]]:
    rows = json.loads(HUMAN_RAW.read_text(encoding="utf-8"))
    return [row for row in rows if row.get("experimentType") == "2P3G"]


def run_command(cmd: List[str], reuse_path: Optional[Path] = None) -> Dict[str, Any]:
    if reuse_path is not None and reuse_path.exists():
        return {"rawTrialsPath": str(reuse_path)}
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        result.check_returncode()
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(result.stdout) from exc


def fmt(value: float) -> str:
    return f"{value:g}".replace("-", "neg").replace(".", "p")


def expected_raw_path(model: str, params: Dict[str, Any], sessions: int, output_dir: Path) -> Path:
    if model == "committed":
        suffix = f"beta_3_lambda_{fmt(params['lambda'])}_sessions_0_to_{sessions - 1}"
        return output_dir / f"committed_vs_committed_2p3g_raw_trials_{suffix}.json"
    if model == "always":
        suffix = f"beta_3_lambda_{fmt(params['lambda'])}_sessions_0_to_{sessions - 1}"
        return output_dir / f"always_committed_vs_always_committed_2p3g_raw_trials_{suffix}.json"
    if model == "signal":
        suffix = f"beta_3_lambda_{fmt(params['lambda'])}_alpha_{fmt(params['p_signal'])}_sessions_0_to_{sessions - 1}"
        return output_dir / f"signal_vs_signal_2p3g_raw_trials_{suffix}.json"
    if model == "two_stage":
        raw_dir = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "two_stage_signal_agent" / "step_level_fit_comparison"
        suffix = (
            f"signal_mixture_beta_3_lambda_{fmt(params['lambda'])}_tau_{fmt(2/3)}_"
            f"alpha_{fmt(params['p_signal'])}_eta_0_sessions_0_to_{sessions - 1}"
        )
        return raw_dir / f"two_stage_signal_vs_two_stage_signal_2p3g_raw_trials_{suffix}.json"
    raise ValueError(model)


def run_simulations(params: Dict[str, Dict[str, Any]], sessions: int, trials: int, seed: int, reuse: bool) -> Dict[str, Path]:
    SIM_DIR.mkdir(parents=True, exist_ok=True)
    raw_paths: Dict[str, Path] = {}

    committed_dir = SIM_DIR / "committed_agent"
    raw = expected_raw_path("committed", params["sampleJointGoal_afterNewGoal"], sessions, committed_dir)
    result = run_command(
        [
            "node", "dataAnalysis/scripts/simulate_committed_vs_committed_2p3g.js",
            "--sessions", str(sessions), "--trials", str(trials), "--seed", str(seed),
            "--lambda", str(params["sampleJointGoal_afterNewGoal"]["lambda"]),
            "--beta", "3", "--output-dir", str(committed_dir),
        ],
        raw if reuse else None,
    )
    raw_paths["sampleJointGoal_afterNewGoal"] = Path(result.get("rawTrialsPath", raw))

    signal_dir = SIM_DIR / "signal_agent"
    raw = expected_raw_path("signal", params["sampleJointGoalAndSignal_afterNewGoal"], sessions, signal_dir)
    result = run_command(
        [
            "node", "dataAnalysis/scripts/simulate_signal_vs_signal_2p3g.js",
            "--sessions", str(sessions), "--trials", str(trials), "--seed", str(seed),
            "--lambda", str(params["sampleJointGoalAndSignal_afterNewGoal"]["lambda"]),
            "--alpha", str(params["sampleJointGoalAndSignal_afterNewGoal"]["p_signal"]),
            "--beta", "3", "--score", "mixture", "--output-dir", str(signal_dir),
        ],
        raw if reuse else None,
    )
    raw_paths["sampleJointGoalAndSignal_afterNewGoal"] = Path(result.get("rawTrialsPath", raw))

    always_dir = SIM_DIR / "always_committed_agent"
    raw = expected_raw_path("always", params["sampleJointGoal_fromStart"], sessions, always_dir)
    result = run_command(
        [
            "node", "dataAnalysis/scripts/simulate_always_committed_vs_always_committed_2p3g.js",
            "--sessions", str(sessions), "--trials", str(trials), "--seed", str(seed),
            "--lambda", str(params["sampleJointGoal_fromStart"]["lambda"]),
            "--beta", "3", "--output-dir", str(always_dir),
        ],
        raw if reuse else None,
    )
    raw_paths["sampleJointGoal_fromStart"] = Path(result.get("rawTrialsPath", raw))

    two_stage_dir = SIM_DIR / "two_stage_signal_agent"
    raw = expected_raw_path("two_stage", params["TwoStageSignalAgent_sigmoidThreshold"], sessions, two_stage_dir)
    result = run_command(
        [
            "node", "dataAnalysis/scripts/simulate_two_stage_signal_vs_two_stage_signal_2p3g.js",
            "--sessions", str(sessions), "--trials", str(trials), "--seed", str(seed),
            "--lambda", str(params["TwoStageSignalAgent_sigmoidThreshold"]["lambda"]),
            "--tau", str(2.0 / 3.0), "--alpha", str(params["TwoStageSignalAgent_sigmoidThreshold"]["p_signal"]),
            "--eta", "0", "--beta", "3", "--signal-mode", "mixture",
            "--output-dir", str(two_stage_dir),
            "--raw-output-dir", str(PROJECT_ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "two_stage_signal_agent" / "step_level_fit_comparison"),
        ],
        raw if reuse else None,
    )
    raw_paths["TwoStageSignalAgent_sigmoidThreshold"] = Path(result.get("rawTrialsPath", raw))
    return raw_paths


def import_metric_helpers():
    import sys

    script_dir = str(PROJECT_ROOT / "dataAnalysis" / "scripts")
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    from fit_signal_alpha_beta3 import add_measures, comparison_rows, load_raw, long_player_rows

    return add_measures, comparison_rows, load_raw, long_player_rows


def build_summary(raw_paths: Dict[str, Path]) -> pd.DataFrame:
    add_measures, comparison_rows, load_raw, long_player_rows = import_metric_helpers()
    rows = []
    for model in MODEL_ORDER:
        raw = load_raw(raw_paths[model])
        df = add_measures(long_player_rows(raw, model))
        for condition_scope, condition in [("Average all 2P3G", None), ("Equal-to-both", "equal_to_both")]:
            for item in comparison_rows(model, raw, df, condition):
                rows.append({**item, "scope": condition_scope})

    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, "Human-Human"))
    for condition_scope, condition in [("Average all 2P3G", None), ("Equal-to-both", "equal_to_both")]:
        for item in comparison_rows("Human-Human", human_raw, human_df, condition):
            rows.append({**item, "scope": condition_scope})
    long = pd.DataFrame(rows)
    pivot = (
        long.pivot_table(
            index=["group", "scope"],
            columns="metric",
            values=["mean_percent", "ci95_percent", "n"],
            aggfunc="first",
        )
        .reset_index()
    )
    pivot.columns = [
        "_".join([str(c) for c in col if c]).strip("_")
        if isinstance(col, tuple)
        else str(col)
        for col in pivot.columns
    ]
    return long, pivot


def plot_fit_grids(committed_grid: pd.DataFrame, signal_grid: pd.DataFrame, always_grid: pd.DataFrame, two_stage_grid: pd.DataFrame, params: Dict[str, Dict[str, Any]]) -> Dict[str, Path]:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    out: Dict[str, Path] = {}

    def plot_line(df: pd.DataFrame, best_lambda: float, title: str, path: Path) -> None:
        fig, ax = plt.subplots(figsize=(7.0, 4.5))
        ax.plot(df["lambda"], df["negative_log_likelihood"], color="#4e79a7", linewidth=2.3, marker="o", markersize=4)
        best_row = df.iloc[df["negative_log_likelihood"].idxmin()]
        ax.axvline(best_lambda, color="#d62728", linestyle="--", linewidth=1.5)
        ax.scatter([best_lambda], [best_row["negative_log_likelihood"]], color="#d62728", marker="*", s=180, zorder=5)
        ax.set_title(title, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel("Step-level negative log likelihood")
        ax.grid(axis="y", alpha=0.25)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
        fig.tight_layout()
        fig.savefig(path, dpi=200, bbox_inches="tight")
        plt.close(fig)

    committed_line = committed_grid.sort_values("lambda")
    path = ASSET_DIR / "step_level_sampleJointGoal_afterNewGoal_lambda_fit.png"
    plot_line(committed_line, params["sampleJointGoal_afterNewGoal"]["lambda"], "sampleJointGoal_afterNewGoal Step-Level Lambda Fit", path)
    out["sampleJointGoal_afterNewGoal"] = path

    always_line = always_grid.sort_values("lambda")
    path = ASSET_DIR / "step_level_sampleJointGoal_fromStart_lambda_fit.png"
    plot_line(always_line, params["sampleJointGoal_fromStart"]["lambda"], "sampleJointGoal_fromStart Step-Level Lambda Fit", path)
    out["sampleJointGoal_fromStart"] = path

    def plot_heatmap(df: pd.DataFrame, best: Dict[str, Any], title: str, path: Path) -> None:
        pivot = df.pivot(index="p_signal", columns="lambda", values="negative_log_likelihood").sort_index(ascending=True)
        fig, ax = plt.subplots(figsize=(9.5, 5.8))
        im = ax.imshow(pivot.values, origin="lower", aspect="auto", cmap="viridis")
        ax.set_xticks(np.arange(len(pivot.columns)))
        ax.set_xticklabels([f"{v:g}" for v in pivot.columns], rotation=45, ha="right", fontsize=8)
        ax.set_yticks(np.arange(len(pivot.index)))
        ax.set_yticklabels([f"{v:g}" for v in pivot.index], fontsize=8)
        x = list(pivot.columns).index(best["lambda"])
        y = list(pivot.index).index(best["p_signal"])
        ax.scatter([x], [y], marker="*", s=260, color="red", edgecolor="white", linewidth=0.9)
        ax.set_title(title, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel("mixture p")
        cbar = fig.colorbar(im, ax=ax)
        cbar.set_label("Step-level negative log likelihood")
        fig.tight_layout()
        fig.savefig(path, dpi=200, bbox_inches="tight")
        plt.close(fig)

    path = ASSET_DIR / "step_level_sampleJointGoalAndSignal_afterNewGoal_lambda_p_fit.png"
    plot_heatmap(signal_grid, params["sampleJointGoalAndSignal_afterNewGoal"], "sampleJointGoalAndSignal_afterNewGoal Step-Level Fit", path)
    out["sampleJointGoalAndSignal_afterNewGoal"] = path

    path = ASSET_DIR / "step_level_TwoStageSignalAgent_sigmoidThreshold_lambda_p_fit.png"
    plot_heatmap(two_stage_grid, params["TwoStageSignalAgent_sigmoidThreshold"], "TwoStageSignalAgent_sigmoidThreshold Step-Level Fit", path)
    out["TwoStageSignalAgent_sigmoidThreshold"] = path
    return out


def plot_summary(long_df: pd.DataFrame, path: Path) -> None:
    metrics = ["Success Rate (%)", "Coordination Efficiency (%)", "Commitment (%)", "Signaling Move (%)"]
    fig, axes = plt.subplots(2, 2, figsize=(15, 10))
    fig.suptitle("Step-Level Fitted Parameters: Model-Model and Human Comparison", fontsize=18, fontweight="bold", y=0.98)
    groups = MODEL_ORDER + ["Human-Human"]
    x = np.arange(len(groups))
    width = 0.36
    for ax, metric in zip(axes.ravel(), metrics):
        avg = long_df[(long_df["metric"] == metric) & (long_df["scope"] == "Average all 2P3G")].set_index("group").reindex(groups)
        eq = long_df[(long_df["metric"] == metric) & (long_df["scope"] == "Equal-to-both")].set_index("group").reindex(groups)
        colors = [MODEL_COLORS[g] for g in groups]
        ax.bar(x - width / 2, avg["mean_percent"], width=width, yerr=avg["ci95_percent"], color=colors, alpha=0.9, capsize=4, label="Average all 2P3G")
        ax.bar(x + width / 2, eq["mean_percent"], width=width, yerr=eq["ci95_percent"], color=colors, alpha=0.45, capsize=4, label="Equal-to-both")
        ax.set_title(metric, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(x)
        ax.set_xticklabels([SHORT_LABELS[g] for g in groups], rotation=12, ha="right")
        ax.grid(axis="y", color="#d6d6d6", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
        ax.legend(frameon=True, fontsize=8)
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def relative(path: Path) -> str:
    return os.path.relpath(path, HTML_PATH.parent)


def metric_value(pivot: pd.DataFrame, group: str, scope: str, metric: str) -> float:
    row = pivot[(pivot["group"] == group) & (pivot["scope"] == scope)]
    if row.empty:
        return float("nan")
    return float(row.iloc[0].get(f"mean_percent_{metric}", np.nan))


def write_html(params: Dict[str, Dict[str, Any]], fit_plots: Dict[str, Path], long_df: pd.DataFrame, pivot: pd.DataFrame, summary_plot: Path) -> None:
    rows_html = []
    for group in MODEL_ORDER + ["Human-Human"]:
        for scope in ["Average all 2P3G", "Equal-to-both"]:
            setting = "reference data, not fit" if group == "Human-Human" else params[group]["setting"]
            row_class = "human" if group == "Human-Human" else ""
            rows_html.append(
                "<tr class=\"{row_class}\"><td><strong>{group}</strong></td><td>{scope}</td><td>{setting}</td>"
                "<td class=\"num\">{success:.1f}</td><td class=\"num\">{eff:.1f}</td>"
                "<td class=\"num\">{commit:.1f}</td><td class=\"num\">{signal:.1f}</td></tr>".format(
                    row_class=row_class,
                    group=html.escape(group),
                    scope=html.escape(scope),
                    setting=html.escape(setting),
                    success=metric_value(pivot, group, scope, "Success Rate (%)"),
                    eff=metric_value(pivot, group, scope, "Coordination Efficiency (%)"),
                    commit=metric_value(pivot, group, scope, "Commitment (%)"),
                    signal=metric_value(pivot, group, scope, "Signaling Move (%)"),
                )
            )

    cards = []
    descriptions = {
        "sampleJointGoal_afterNewGoal": "Joint-RL before new-goal; after new-goal, infer posterior and resample a joint goal every step.",
        "sampleJointGoalAndSignal_afterNewGoal": "Same post-new-goal joint-goal sampler plus a Bernoulli mixture signaling policy.",
        "sampleJointGoal_fromStart": "Commitment model is active from trial start; new goals are added by posterior resizing.",
        "TwoStageSignalAgent_sigmoidThreshold": "Always monitors joint-goal posterior and mixes early joint-RL with late committed-signaling policy via a sigmoid gate.",
    }
    equations = {
        "sampleJointGoal_afterNewGoal": r"""
          <div class="eq">\[W_\lambda(g)\propto \exp(3\,EU_t(g))P_t(g)^\lambda\]</div>
          <div class="eq">\[\pi(a_t)=\sum_g W_\lambda(g)\pi_{\mathrm{joint}}(a_t\mid s_t,\{g\})\]</div>
        """,
        "sampleJointGoalAndSignal_afterNewGoal": r"""
          <div class="eq">\[\pi_{\mathrm{signal}}(a\mid g)=(1-p)\pi_{\mathrm{joint}}(a\mid s_t,\{g\})+p\,\delta_{a_{\mathrm{leg}}(g)}(a)\]</div>
          <div class="eq">\[\pi(a_t)=\sum_g W_\lambda(g)\pi_{\mathrm{signal}}(a_t\mid g)\]</div>
        """,
        "sampleJointGoal_fromStart": r"""
          <div class="eq">\[P_0(g)=1/|\mathcal G_0|,\quad P_t(g_{\mathrm{new}})=1/|\mathcal G_t|\]</div>
          <div class="eq">\[\pi(a_t)=\sum_g W_\lambda(g)\pi_{\mathrm{joint}}(a_t\mid s_t,\{g\})\]</div>
        """,
        "TwoStageSignalAgent_sigmoidThreshold": r"""
          <div class="eq">\[\rho_t=\sigma(10(\max_gP_t(g)-2/3))\]</div>
          <div class="eq">\[\pi(a_t)=(1-\rho_t)\pi_{\mathrm{joint}}(a_t\mid s_t,\mathcal G_t)+\rho_t\sum_g W_\lambda(g)\pi_{\mathrm{signal}}(a_t\mid g)\]</div>
        """,
    }
    for model in MODEL_ORDER:
        cards.append(
            f"""
    <section class="card" id="{model}">
      <h2>{html.escape(model)}</h2>
      <p>{html.escape(descriptions[model])}</p>
      <div class="meta"><span>{html.escape(params[model]['setting'])}</span><span>fit target: step-level human action likelihood</span></div>
      <h3>Core Math</h3>
      <div class="equations">{equations[model]}</div>
      <h3>Step-Level Fit Surface</h3>
      <a href="{relative(fit_plots[model])}"><img src="{relative(fit_plots[model])}" alt="{html.escape(model)} step-level fit plot"></a>
    </section>
            """
        )

    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Step-Level Fit Model-Model Comparison</title>
<script>
window.MathJax = {{ tex: {{ inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] }}, svg: {{ fontCache: 'global' }} }};
</script>
<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
<style>
:root {{ --ink:#17202a; --muted:#607080; --line:#d8dee9; --bg:#f7f9fc; --card:#fff; --accent:#2457a6; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg); line-height:1.45; }}
header {{ padding:42px 56px 24px; background:linear-gradient(135deg,#1a2638,#3a5f83); color:white; }}
header h1 {{ margin:0 0 10px; font-size:34px; letter-spacing:-.02em; }}
header p {{ margin:0 0 6px; max-width:1050px; color:#dce7f8; }}
main {{ max-width:1280px; margin:0 auto; padding:30px 26px 60px; }}
nav {{ display:flex; gap:10px; flex-wrap:wrap; margin-bottom:22px; }}
nav a, .links a {{ color:var(--accent); text-decoration:none; }}
nav a {{ padding:7px 10px; background:white; border:1px solid var(--line); border-radius:999px; }}
.summary,.card {{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; box-shadow:0 6px 20px rgba(20,35,60,.06); margin-bottom:24px; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; }}
th,td {{ padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }}
th {{ text-align:left; background:#f0f3f8; color:#34495e; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
tr.human td {{ background:#fff7df; }}
.grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }}
.card h2 {{ margin:0 0 6px; font-size:22px; }}
.card h3 {{ margin:16px 0 8px; font-size:15px; }}
.meta {{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }}
.meta span {{ background:#eef4ff; border:1px solid #cfe0ff; color:#1f4e8c; border-radius:999px; padding:5px 8px; font-size:12px; }}
.equations {{ display:grid; gap:8px; margin:10px 0; }}
.eq {{ border:1px solid #e1e7f0; border-radius:12px; background:#fbfdff; padding:10px 12px; overflow-x:auto; }}
img {{ width:100%; max-height:620px; object-fit:contain; border:1px solid var(--line); border-radius:10px; background:white; }}
code {{ font-family:"SFMono-Regular",Consolas,monospace; }}
footer {{ color:var(--muted); font-size:12px; margin-top:28px; }}
@media (max-width: 900px) {{ .grid {{ grid-template-columns:1fr; }} header {{ padding:30px 24px 20px; }} }}
</style>
</head>
<body>
<header>
  <h1>Model-Model Comparison: Step-Level Fitted Parameters</h1>
  <p>This is a separate report from <code>model_model_comparison.html</code>. Here, fitted parameters are selected by human step-level action likelihood rather than trial-level commitment/signaling/success metrics.</p>
  <p>Fixed constants: goal-selection beta = 3.0; joint-RL softmax beta = 3.0. Human-Human is a reference row and is not fit.</p>
</header>
<main>
<nav>
  <a href="#overview">Overview</a>
  <a href="#summary-plot">4 Measures</a>
  <a href="#btom-legibility">BToM Legibility</a>
  {''.join(f'<a href="#{m}">{m}</a>' for m in MODEL_ORDER)}
</nav>
<section class="summary" id="overview">
  <h2>Primary Result Table</h2>
  <p>Rows use simulations at the step-level fitted parameter values. Values are percentages.</p>
  <table>
    <thead><tr><th>Model</th><th>Scope</th><th>Step-Level Fit / Setting</th><th>Success</th><th>Efficiency</th><th>Commitment</th><th>Signaling</th></tr></thead>
    <tbody>
      {''.join(rows_html)}
    </tbody>
  </table>
</section>
<section class="summary" id="summary-plot">
  <h2>Four-Measure Summary</h2>
  <a href="{relative(summary_plot)}"><img src="{relative(summary_plot)}" alt="Step-level fitted model comparison four-measure plot"></a>
  <p class="links"><a href="{relative(OUT_DIR / 'step_level_fit_parameters.csv')}">fit parameters CSV</a> <a href="{relative(OUT_DIR / 'step_level_fit_comparison_long.csv')}">long metrics CSV</a> <a href="{relative(OUT_DIR / 'step_level_fit_comparison_summary.csv')}">summary CSV</a></p>
</section>
<section class="summary" id="btom-legibility">
  <h2>BToM Legibility After New-Goal Presentation</h2>
  <p>BToM legibility is computed from the step-level fitted model simulations using the listener posterior from <code>BToM_legibility_comparison.ipynb</code>: posterior over the original shared goal versus the new goal, scored as \(P(\mathrm{{final\ reached\ goal}})\). Step 0 is the new-goal presentation moment.</p>
  <div class="grid">
    <section class="card">
      <h3>Posterior Over First 5 Steps</h3>
      <a href="{relative(ASSET_DIR / 'btom_model_model_first5_trajectory.png')}"><img src="{relative(ASSET_DIR / 'btom_model_model_first5_trajectory.png')}" alt="Step-level fit BToM legibility posterior over first five steps after new-goal presentation"></a>
    </section>
    <section class="card">
      <h3>Mean Posterior Across First 5 Steps</h3>
      <a href="{relative(ASSET_DIR / 'btom_model_model_first5_mean_posterior.png')}"><img src="{relative(ASSET_DIR / 'btom_model_model_first5_mean_posterior.png')}" alt="Step-level fit mean BToM posterior across first five steps after new-goal presentation"></a>
    </section>
  </div>
  <p class="links"><a href="{relative(ASSET_DIR / 'btom_model_model_first5_summary.csv')}">summary CSV</a> <a href="{relative(ASSET_DIR / 'btom_model_model_first5_step_per_participant.csv')}">step-level participant CSV</a> <a href="{relative(ASSET_DIR / 'btom_model_model_first5_mean_per_participant.csv')}">mean posterior participant CSV</a></p>
</section>
<section class="grid">
  {''.join(cards)}
</section>
<footer>
Generated by <code>dataAnalysis/scripts/create_step_level_model_model_comparison.py</code>. Step-level NLL uses the same lightweight joint-goal likelihood approximation as the committed-agent fitters.
</footer>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    rows = load_human_rows()

    committed_obs = build_observations(rows, "committed")
    always_obs = build_observations(rows, "always")
    signal_obs = build_observations(rows, "signal")
    two_stage_obs = build_observations(rows, "two_stage")

    committed_fit = fit_scalar_lambda(committed_obs, args.max_lambda)
    always_fit = fit_scalar_lambda(always_obs, args.max_lambda)

    # Profile curves for scalar models.
    lambda_profile = sorted(set([0, 0.05, 0.1, 0.125, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 50, round(committed_fit["lambda"], 6), round(always_fit["lambda"], 6)]))
    committed_grid = pd.DataFrame([
        {"lambda": lam, "negative_log_likelihood": nll(committed_obs, lambda obs, lam=lam: committed_likelihood(obs, lam))}
        for lam in lambda_profile
    ])
    always_grid = pd.DataFrame([
        {"lambda": lam, "negative_log_likelihood": nll(always_obs, lambda obs, lam=lam: committed_likelihood(obs, lam))}
        for lam in lambda_profile
    ])

    lambda_grid = sorted(set([
        0, 0.05, 0.1, 0.125, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5,
        7.5, 10, 15, 20, 30, 40, args.max_lambda,
        round(committed_fit["lambda"], 6),
        round(always_fit["lambda"], 6),
    ]))
    p_grid = [round(i * 0.05, 10) for i in range(21)]
    signal_grid, signal_fit = fit_grid(signal_obs, "signal", lambda_grid, p_grid)
    two_stage_grid, two_stage_fit = fit_grid(two_stage_obs, "two_stage", lambda_grid, p_grid)

    params = {
        "sampleJointGoal_afterNewGoal": {
            "lambda": committed_fit["lambda"],
            "negative_log_likelihood": committed_fit["negative_log_likelihood"],
            "step_observations": len(committed_obs),
            "setting": f"beta=3.0, lambda={committed_fit['lambda']:.3g} from post-new-goal step-level action likelihood",
        },
        "sampleJointGoalAndSignal_afterNewGoal": {
            "lambda": float(signal_fit["lambda"]),
            "p_signal": float(signal_fit["p_signal"]),
            "negative_log_likelihood": float(signal_fit["negative_log_likelihood"]),
            "step_observations": len(signal_obs),
            "setting": f"beta=3.0, lambda={signal_fit['lambda']:.3g}, mixture p={signal_fit['p_signal']:.3g} from post-new-goal step-level action likelihood",
        },
        "sampleJointGoal_fromStart": {
            "lambda": always_fit["lambda"],
            "negative_log_likelihood": always_fit["negative_log_likelihood"],
            "step_observations": len(always_obs),
            "setting": f"beta=3.0, lambda={always_fit['lambda']:.3g} from all-step action likelihood",
        },
        "TwoStageSignalAgent_sigmoidThreshold": {
            "lambda": float(two_stage_fit["lambda"]),
            "p_signal": float(two_stage_fit["p_signal"]),
            "negative_log_likelihood": float(two_stage_fit["negative_log_likelihood"]),
            "step_observations": len(two_stage_obs),
            "setting": f"beta=3.0, tau=2/3, eta=0, lambda={two_stage_fit['lambda']:.3g}, mixture p={two_stage_fit['p_signal']:.3g} from all-step action likelihood",
        },
    }
    for model in ["sampleJointGoalAndSignal_afterNewGoal", "TwoStageSignalAgent_sigmoidThreshold"]:
        if math.isclose(float(params[model]["lambda"]), float(args.max_lambda), rel_tol=0.0, abs_tol=1e-9):
            params[model]["setting"] += f" (bounded grid cap: lambda <= {args.max_lambda:g})"

    pd.DataFrame([
        {"model": model, **values}
        for model, values in params.items()
    ]).to_csv(OUT_DIR / "step_level_fit_parameters.csv", index=False)
    committed_grid.to_csv(OUT_DIR / "sampleJointGoal_afterNewGoal_step_level_lambda_profile.csv", index=False)
    signal_grid.to_csv(OUT_DIR / "sampleJointGoalAndSignal_afterNewGoal_step_level_lambda_p_grid.csv", index=False)
    always_grid.to_csv(OUT_DIR / "sampleJointGoal_fromStart_step_level_lambda_profile.csv", index=False)
    two_stage_grid.to_csv(OUT_DIR / "TwoStageSignalAgent_sigmoidThreshold_step_level_lambda_p_grid.csv", index=False)

    fit_plots = plot_fit_grids(committed_grid, signal_grid, always_grid, two_stage_grid, params)
    raw_paths = run_simulations(params, args.sessions, args.trials, args.seed, args.reuse_simulations)
    long_df, pivot = build_summary(raw_paths)
    long_df.to_csv(OUT_DIR / "step_level_fit_comparison_long.csv", index=False)
    pivot.to_csv(OUT_DIR / "step_level_fit_comparison_summary.csv", index=False)
    summary_plot = ASSET_DIR / "step_level_fit_model_model_4measure_summary.png"
    plot_summary(long_df, summary_plot)
    write_html(params, fit_plots, long_df, pivot, summary_plot)

    summary = {
        "html": str(HTML_PATH),
        "parameters": params,
        "raw_paths": {k: str(v) for k, v in raw_paths.items()},
        "human_raw_trials": len(rows),
        "step_observations": {
            "post_new_goal": len(committed_obs),
            "all_steps": len(always_obs),
        },
    }
    (OUT_DIR / "step_level_fit_report_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
