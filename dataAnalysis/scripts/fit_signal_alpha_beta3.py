#!/usr/bin/env python3
"""Fit SignalAgent alpha against trial/player-level human signaling."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HUMAN_RAW = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "human" / "equal_to_both_agent_human_comparison" / "human_human_pure_unique_2p3g_raw_trials.json"
JOINT_RAW = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "joint_rl" / "joint_rl_vs_joint_rl_simulation" / "joint_rl_vs_joint_rl_2p3g_raw_trials_sessions_0_to_29.json"
SIM_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_signal_vs_signal_2p3g.js"
EPS = 1e-9
DEFAULT_ALPHA_GRID = [round(i * 0.25, 10) for i in range(41)]
DEFAULT_OUTPUT_DIRS = {
    "margin": PROJECT_ROOT / "dataAnalysis" / "model_model" / "signal_agent" / "outputs" / "signal_agent_margin_alpha_fit_beta3",
    "logposterior": PROJECT_ROOT / "dataAnalysis" / "model_model" / "signal_agent" / "outputs" / "signal_agent_logpost_alpha_fit_beta3",
    "mixture": PROJECT_ROOT / "dataAnalysis" / "model_model" / "signal_agent" / "outputs" / "signal_agent_mixture_p_fit_beta3",
}
SCORE_LABELS = {
    "margin": "max-margin: P(g*|a) - max P(g!=g*|a)",
    "logposterior": "info-theoretic: log P(g*|a)  (RSA)",
    "mixture": "Bernoulli mixture: p · a_leg + (1-p) · CommittedAgent",
}
# For mixture mode the swept parameter is p in [0, 1]; for others it is alpha in [0, 10].
DEFAULT_MIXTURE_GRID = [round(i * 0.025, 10) for i in range(41)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--score",
        choices=["margin", "logposterior", "mixture"],
        default="logposterior",
        help="SignalAgent score form. 'mixture' interprets the swept parameter as p in [0, 1].",
    )
    parser.add_argument(
        "--horizon",
        type=int,
        default=1,
        help="Trajectory-level legibility horizon. H=1 = single-step (default); H>1 enables multi-step rollout.",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--trials", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--lambda-value", type=float, default=0.125)
    parser.add_argument("--beta", type=float, default=3.0)
    parser.add_argument("--alphas", type=str, default=None, help="Comma-separated alpha values. Default: 0..10 step 0.25.")
    parser.add_argument("--reuse-existing", action="store_true", help="Reuse matching simulation files when present.")
    parser.add_argument("--skip-notebook", action="store_true")
    args = parser.parse_args()
    if args.output_dir is None:
        base = DEFAULT_OUTPUT_DIRS[args.score]
        if args.horizon > 1:
            args.output_dir = base.with_name(f"{base.name}_H{args.horizon}")
        else:
            args.output_dir = base
    return args


def alpha_grid(text: Optional[str], score: str = "logposterior") -> List[float]:
    if not text:
        return DEFAULT_MIXTURE_GRID if score == "mixture" else DEFAULT_ALPHA_GRID
    out = []
    for item in text.split(","):
        item = item.strip()
        if item:
            out.append(float(item))
    return out


def fmt(value: float) -> str:
    return f"{value:g}".replace("-", "neg").replace(".", "p")


def raw_path_for(output_dir: Path, beta: float, lambda_value: float, alpha: float, sessions: int, offset: int = 0) -> Path:
    suffix = (
        f"beta_{fmt(beta)}_lambda_{fmt(lambda_value)}_alpha_{fmt(alpha)}_"
        f"sessions_{offset}_to_{offset + sessions - 1}"
    )
    return output_dir / "simulations" / f"signal_vs_signal_2p3g_raw_trials_{suffix}.json"


def run_simulation(args: argparse.Namespace, alpha: float) -> Path:
    raw_path = raw_path_for(args.output_dir, args.beta, args.lambda_value, alpha, args.sessions)
    if args.reuse_existing and raw_path.exists():
        return raw_path
    cmd = [
        "node",
        str(SIM_SCRIPT),
        "--sessions", str(args.sessions),
        "--trials", str(args.trials),
        "--seed", str(args.seed),
        "--alpha", str(alpha),
        "--lambda", str(args.lambda_value),
        "--beta", str(args.beta),
        "--score", str(args.score),
        "--horizon", str(args.horizon),
        "--output-dir", str(args.output_dir / "simulations"),
    ]
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        result.check_returncode()
    if not raw_path.exists():
        raise FileNotFoundError(raw_path)
    return raw_path


def parse_trajectory(value: Any) -> List[List[int]]:
    if value is None:
        return []
    if isinstance(value, float) and np.isnan(value):
        return []
    if isinstance(value, list):
        raw = value
    else:
        try:
            raw = json.loads(str(value))
        except Exception:
            return []
    return [list(p) for p in raw if isinstance(p, (list, tuple)) and len(p) == 2]


def parse_point(value: Any) -> Optional[List[int]]:
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return [int(value[0]), int(value[1])]
    try:
        point = json.loads(str(value))
    except Exception:
        return None
    if isinstance(point, (list, tuple)) and len(point) == 2:
        return [int(point[0]), int(point[1])]
    return None


def manhattan(p: List[int], q: List[int]) -> int:
    return abs(int(p[0]) - int(q[0])) + abs(int(p[1]) - int(q[1]))


def remove_duplicates(traj: List[List[int]]) -> List[List[int]]:
    if len(traj) <= 1:
        return traj
    cleaned = [traj[0]]
    for point in traj[1:]:
        if point != cleaned[-1]:
            cleaned.append(point)
    return cleaned


def safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None
    try:
        return int(value)
    except Exception:
        return None


def long_player_rows(raw_trials: Iterable[Dict[str, Any]], group: str) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for row in raw_trials:
        for player_index in (0, 1):
            participant_key = "participantId_player1" if player_index == 0 else "participantId_player2"
            fallback_id = f"{group}_row_{len(rows)}_p{player_index + 1}"
            rows.append({
                **row,
                "group": group,
                "participantId": row.get(participant_key) or row.get("participantId") or fallback_id,
                "humanPlayerIndex": player_index,
            })
    return pd.DataFrame(rows)


def compute_commitment(row: pd.Series) -> float:
    player_index = int(row.get("humanPlayerIndex", 0))
    first_goal = row.get("player1FirstDetectedGoal") if player_index == 0 else row.get("player2FirstDetectedGoal")
    final_goal = row.get("player1FinalReachedGoal") if player_index == 0 else row.get("player2FinalReachedGoal")
    first_i = safe_int(first_goal)
    final_i = safe_int(final_goal)
    if first_i is None or final_i is None:
        return np.nan
    return 1.0 if first_i == final_i else 0.0


def compute_efficiency(row: pd.Series) -> float:
    player_index = int(row.get("humanPlayerIndex", 0))
    traj_col = "player1Trajectory" if player_index == 0 else "player2Trajectory"
    traj = remove_duplicates(parse_trajectory(row.get(traj_col)))
    if not traj:
        return np.nan
    idx = safe_int(row.get("newGoalPresentedTime"))
    if idx is None:
        return np.nan
    idx = max(0, min(idx, len(traj) - 1))
    actual_steps = (len(traj) - 1) - idx
    if actual_steps <= 0:
        return np.nan
    candidates = [parse_point(row.get("target1")), parse_point(row.get("target2")), parse_point(row.get("newGoalPosition"))]
    candidates = [goal for goal in candidates if goal is not None]
    if not candidates:
        return np.nan
    optimal_steps = min(manhattan(traj[idx], goal) for goal in candidates)
    efficiency = (1 - (actual_steps - optimal_steps) / actual_steps) * 100
    return max(0.0, min(100.0, efficiency))


def compute_signaling(row: pd.Series) -> float:
    if not bool(row.get("newGoalPresented", False)):
        return np.nan

    player_index = int(row.get("humanPlayerIndex", 0))
    traj_col = "player1Trajectory" if player_index == 0 else "player2Trajectory"
    traj = remove_duplicates(parse_trajectory(row.get(traj_col)))
    if not traj:
        return np.nan

    new_goal_time = safe_int(row.get("newGoalPresentedTime"))
    if new_goal_time is None or new_goal_time < 0 or new_goal_time >= len(traj) - 1:
        return np.nan

    pos_before = traj[new_goal_time]
    pos_after = traj[new_goal_time + 1]
    target1_pos = parse_point(row.get("target1"))
    target2_pos = parse_point(row.get("target2"))
    new_goal_pos = parse_point(row.get("newGoalPosition"))
    if new_goal_pos is None or target1_pos is None or target2_pos is None:
        return np.nan

    final_goal_col = "player1FinalReachedGoal" if player_index == 0 else "player2FinalReachedGoal"
    final_goal_idx = safe_int(row.get(final_goal_col))
    shared_goal_idx = safe_int(row.get("firstDetectedSharedGoal"))
    if final_goal_idx is None or shared_goal_idx is None:
        return np.nan

    if shared_goal_idx not in (0, 1):
        return np.nan

    shared_goal_pos = target1_pos if shared_goal_idx == 0 else target2_pos
    other_old_pos = target2_pos if shared_goal_idx == 0 else target1_pos
    if final_goal_idx == 2:
        reached_goal_pos = new_goal_pos
        other_goal_pos = shared_goal_pos
    elif final_goal_idx == shared_goal_idx:
        reached_goal_pos = shared_goal_pos
        other_goal_pos = new_goal_pos
    elif final_goal_idx in (0, 1) and final_goal_idx != shared_goal_idx:
        reached_goal_pos = other_old_pos
        other_goal_pos = new_goal_pos
    else:
        return np.nan

    moved_closer_to_reached = manhattan(pos_after, reached_goal_pos) < manhattan(pos_before, reached_goal_pos)
    moved_closer_to_other = manhattan(pos_after, other_goal_pos) < manhattan(pos_before, other_goal_pos)
    return 1.0 if moved_closer_to_reached and not moved_closer_to_other else 0.0


def add_measures(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if out.empty:
        return out
    out["commitment"] = out.apply(compute_commitment, axis=1)
    out["efficiencyPercent"] = out.apply(compute_efficiency, axis=1)
    out["signalingMove"] = out.apply(compute_signaling, axis=1)
    return out


def load_raw(path: Path) -> List[Dict[str, Any]]:
    return json.loads(path.read_text())


def human_signal_targets(human_df: pd.DataFrame) -> pd.DataFrame:
    valid = human_df.dropna(subset=["signalingMove", "distanceCondition"]).copy()
    grouped = valid.groupby("distanceCondition")["signalingMove"].agg(["count", "sum", "mean"]).reset_index()
    grouped = grouped.rename(columns={"count": "human_n", "sum": "human_signaling", "mean": "human_rate"})
    grouped["human_n"] = grouped["human_n"].astype(int)
    grouped["human_signaling"] = grouped["human_signaling"].astype(int)
    order = ["closer_to_player1", "equal_to_both", "closer_to_player2"]
    return grouped[grouped["distanceCondition"].isin(order)].set_index("distanceCondition").loc[order].reset_index()


def simulated_signal_rates(sim_df: pd.DataFrame) -> Dict[str, float]:
    valid = sim_df.dropna(subset=["signalingMove", "distanceCondition"]).copy()
    return valid.groupby("distanceCondition")["signalingMove"].mean().to_dict()


def binomial_nll(target: pd.DataFrame, sim_rates: Dict[str, float]) -> float:
    total = 0.0
    for row in target.to_dict(orient="records"):
        condition = row["distanceCondition"]
        p = min(1 - EPS, max(EPS, float(sim_rates.get(condition, EPS))))
        k = float(row["human_signaling"])
        n = float(row["human_n"])
        total -= k * math.log(p) + (n - k) * math.log(1 - p)
    return total


def sse_condition_rates(target: pd.DataFrame, sim_rates: Dict[str, float]) -> float:
    return float(sum(
        (float(sim_rates.get(row["distanceCondition"], 0.0)) - float(row["human_rate"])) ** 2
        for row in target.to_dict(orient="records")
    ))


def mean_ci(values: np.ndarray) -> Dict[str, float]:
    clean = np.asarray([v for v in values if np.isfinite(v)], dtype=float)
    if clean.size == 0:
        return {"mean": np.nan, "ci95": np.nan, "n": 0}
    mean = float(np.mean(clean))
    if clean.size <= 1:
        return {"mean": mean, "ci95": 0.0, "n": int(clean.size)}
    return {"mean": mean, "ci95": float(1.96 * np.std(clean, ddof=1) / np.sqrt(clean.size)), "n": int(clean.size)}


def participant_metric(df: pd.DataFrame, value_col: str, condition: Optional[str] = None, success_only: bool = False) -> Dict[str, float]:
    sub = df.copy()
    if condition:
        sub = sub[sub["distanceCondition"] == condition]
    if success_only:
        sub = sub[sub["collaborationSucceeded"] == True]
    sub = sub.dropna(subset=[value_col])
    if sub.empty:
        return {"mean": np.nan, "ci95": np.nan, "n": 0}
    grouped = sub.groupby(["participantId", "group"], as_index=False)[value_col].mean()
    return mean_ci(grouped[value_col].to_numpy(dtype=float))


def trial_success_metric(raw_trials: List[Dict[str, Any]], condition: Optional[str] = None) -> Dict[str, float]:
    values = []
    for row in raw_trials:
        if condition and row.get("distanceCondition") != condition:
            continue
        values.append(1.0 if row.get("collaborationSucceeded") else 0.0)
    return mean_ci(np.asarray(values, dtype=float))


def alpha_measure_row(alpha: float, raw_trials: List[Dict[str, Any]], sim_df: pd.DataFrame) -> Dict[str, float]:
    row = {"alpha": alpha}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        success = trial_success_metric(raw_trials, condition)
        efficiency = participant_metric(sim_df[sim_df["newGoalPresented"] == True], "efficiencyPercent", condition, success_only=True)
        commitment = participant_metric(sim_df[sim_df["newGoalPresented"] == True], "commitment", condition)
        signaling = participant_metric(sim_df[sim_df["newGoalPresented"] == True], "signalingMove", condition)
        row[f"{prefix}_success_percent"] = success["mean"] * 100
        row[f"{prefix}_efficiency_percent"] = efficiency["mean"]
        row[f"{prefix}_efficiency_ci_low"] = efficiency["mean"] - efficiency["ci95"]
        row[f"{prefix}_efficiency_ci_high"] = efficiency["mean"] + efficiency["ci95"]
        row[f"{prefix}_commitment_percent"] = commitment["mean"] * 100
        row[f"{prefix}_signaling_percent"] = signaling["mean"] * 100
        row[f"{prefix}_signaling_ci_low"] = (signaling["mean"] - signaling["ci95"]) * 100
        row[f"{prefix}_signaling_ci_high"] = (signaling["mean"] + signaling["ci95"]) * 100
    return row


def comparison_rows(group: str, raw_trials: List[Dict[str, Any]], df: pd.DataFrame, condition: Optional[str]) -> List[Dict[str, Any]]:
    metrics = [
        ("Success Rate (%)", trial_success_metric(raw_trials, condition), 100.0),
        ("Coordination Efficiency (%)", participant_metric(df[df["newGoalPresented"] == True], "efficiencyPercent", condition, success_only=True), 1.0),
        ("Commitment (%)", participant_metric(df[df["newGoalPresented"] == True], "commitment", condition), 100.0),
        ("Signaling Move (%)", participant_metric(df[df["newGoalPresented"] == True], "signalingMove", condition), 100.0),
    ]
    return [
        {
            "group": group,
            "metric": name,
            "mean_percent": vals["mean"] * scale,
            "ci95_percent": vals["ci95"] * scale,
            "n": vals["n"],
        }
        for name, vals, scale in metrics
    ]


def _param_name(score: str) -> str:
    return "p" if score == "mixture" else "alpha"


def plot_fit(fit_df: pd.DataFrame, target: pd.DataFrame, path: Path, score: str) -> None:
    human_avg = np.average(target["human_rate"], weights=target["human_n"])
    human_equal = float(target[target["distanceCondition"] == "equal_to_both"]["human_rate"].iloc[0])
    best_alpha = float(fit_df.loc[fit_df["binomial_nll"].idxmin(), "alpha"])
    fig, ax = plt.subplots(figsize=(8, 5.5))
    ax.plot(fit_df["alpha"], fit_df["sim_human_weighted_average"] * 100, marker="o", linewidth=2.2, markersize=4, color="#4f79a8", label="Average")
    ax.plot(fit_df["alpha"], fit_df["sim_equal_to_both"] * 100, marker="o", linewidth=2.2, markersize=4, color="#59a14f", label="Equal-to-both")
    ax.axhline(human_avg * 100, color="#4f79a8", linestyle="--", alpha=0.65, label="Human average")
    ax.axhline(human_equal * 100, color="#59a14f", linestyle="--", alpha=0.65, label="Human equal-to-both")
    ax.axvline(best_alpha, color="black", linestyle=":", alpha=0.8, label=f"Best {_param_name(score)} = {best_alpha:g}")
    ax.set_title(f"SignalAgent Signaling Fit ({SCORE_LABELS[score]}), beta = 3.0, lambda = 0.125", fontsize=12, fontweight="bold")
    ax.set_xlabel(_param_name(score))
    ax.set_ylabel("Signaling move (%)")
    ax.set_ylim(0, 105)
    ax.legend(frameon=True)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_four_measures(df: pd.DataFrame, path: Path, score: str) -> None:
    fig, axes = plt.subplots(2, 2, figsize=(13, 10), sharex=True)
    fig.suptitle(
        f"SignalAgent ({SCORE_LABELS[score]})  beta = 3.0, lambda = 0.125: Average vs Equal-to-Both",
        fontsize=15, fontweight="bold", y=0.98,
    )
    panels = [
        ("Success Rate (%)", "average_success_percent", "equal_success_percent"),
        ("Coordination Efficiency (%)", "average_efficiency_percent", "equal_efficiency_percent"),
        ("Commitment (%)", "average_commitment_percent", "equal_commitment_percent"),
        ("Signaling Move (%)", "average_signaling_percent", "equal_signaling_percent"),
    ]
    for ax, (title, avg_col, eq_col) in zip(axes.ravel(), panels):
        ax.plot(df["alpha"], df[avg_col], marker="o", linewidth=2.2, markersize=4, color="#4f79a8", label="Average")
        ax.plot(df["alpha"], df[eq_col], marker="o", linewidth=2.2, markersize=4, color="#59a14f", label="Equal-to-both")
        ax.set_title(title, fontsize=14, fontweight="bold")
        ax.set_xlabel(_param_name(score))
        ax.set_ylabel("(%)")
        ax.set_ylim(0, 105)
        ax.grid(axis="y", color="#cfcfcf", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
        ax.legend(frameon=True)
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_comparison(df: pd.DataFrame, path: Path, title: str) -> None:
    metric_order = ["Success Rate (%)", "Coordination Efficiency (%)", "Commitment (%)", "Signaling Move (%)"]
    group_order = list(dict.fromkeys(df["group"].tolist()))
    colors = ["#4f79a8", "#f28e2b", "#59a14f"]
    fig, axes = plt.subplots(2, 2, figsize=(13, 10))
    fig.suptitle(title, fontsize=20, fontweight="bold", y=0.98)
    for ax, metric in zip(axes.ravel(), metric_order):
        sub = df[df["metric"] == metric].set_index("group").loc[group_order].reset_index()
        x = np.arange(len(group_order))
        ax.bar(x, sub["mean_percent"], yerr=sub["ci95_percent"], color=colors[:len(group_order)], alpha=0.88, capsize=5, edgecolor="white")
        ax.set_title(metric, fontsize=14, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(x)
        ax.set_xticklabels(group_order, fontsize=9)
        ax.grid(axis="y", color="#cfcfcf", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def write_notebook(output_dir: Path, best_alpha: float) -> Path:
    nb_path = output_dir / "signal_beta3_alpha_fit_and_equal_to_both_comparison.ipynb"
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# SignalAgent Beta=3 Alpha Fit and Equal-to-Both Comparison\n",
                "\n",
                f"Fitted setting: beta = 3.0, lambda = 0.125, alpha = {best_alpha:g}.\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "from pathlib import Path\n",
                "import pandas as pd\n",
                f"OUT = Path(r'{output_dir}')\n",
                "fit_df = pd.read_csv(OUT / 'signal_alpha_fit_beta3_average_equal.csv')\n",
                "four_df = pd.read_csv(OUT / 'signal_alpha_beta3_average_equal_4measures.csv')\n",
                "equal_df = pd.read_csv(OUT / 'equal_to_both_signal_joint_rl_human_4panel_summary.csv')\n",
                "all_df = pd.read_csv(OUT / 'all_distance_signal_joint_rl_human_4panel_summary.csv')\n",
            ],
        },
        {"cell_type": "markdown", "metadata": {}, "source": ["## Alpha Fit\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["fit_df.round(4)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## Four Measures Across Alpha\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["four_df.round(3)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## Equal-to-Both Comparison\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["equal_df.round(3)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## All Distance Conditions Comparison\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["all_df.round(3)\n"]},
    ]
    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    nb_path.write_text(json.dumps(nb, indent=2))
    return nb_path


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "simulations").mkdir(parents=True, exist_ok=True)

    alphas = alpha_grid(args.alphas, args.score)
    human_df = add_measures(long_player_rows(load_raw(HUMAN_RAW), "Human-Human"))
    target = human_signal_targets(human_df)
    target_path = args.output_dir / "human_trial_level_signaling_target.csv"
    target.to_csv(target_path, index=False)

    grid_rows = []
    measure_rows = []
    alpha_raw_paths: Dict[float, Path] = {}
    for alpha in alphas:
        raw_path = run_simulation(args, alpha)
        alpha_raw_paths[alpha] = raw_path
        raw_trials = load_raw(raw_path)
        sim_df = add_measures(long_player_rows(raw_trials, "SignalAgent"))
        rates = simulated_signal_rates(sim_df)
        weighted_average = float(np.average(
            [rates.get(condition, 0.0) for condition in target["distanceCondition"]],
            weights=target["human_n"],
        ))
        equal_rate = float(rates.get("equal_to_both", np.nan))
        grid_row = {
            "alpha": alpha,
            "sim_human_weighted_average": weighted_average,
            "sim_equal_to_both": equal_rate,
            "binomial_nll": binomial_nll(target, rates),
            "sse_condition_rates": sse_condition_rates(target, rates),
        }
        for condition in target["distanceCondition"]:
            grid_row[f"sim_{condition}"] = rates.get(condition, np.nan)
            grid_row[f"human_{condition}"] = float(target[target["distanceCondition"] == condition]["human_rate"].iloc[0])
        grid_rows.append(grid_row)
        measure_rows.append(alpha_measure_row(alpha, raw_trials, sim_df))

    grid_df = pd.DataFrame(grid_rows).sort_values("alpha")
    measures_df = pd.DataFrame(measure_rows).sort_values("alpha")
    best = grid_df.loc[grid_df["binomial_nll"].idxmin()].to_dict()
    best_alpha = float(best["alpha"])

    grid_path = args.output_dir / "signal_alpha_fit_beta3_grid.csv"
    fit_path = args.output_dir / "signal_alpha_fit_beta3_average_equal.csv"
    measures_path = args.output_dir / "signal_alpha_beta3_average_equal_4measures.csv"
    grid_df.to_csv(grid_path, index=False)
    grid_df[["alpha", "sim_human_weighted_average", "sim_equal_to_both", "binomial_nll", "sse_condition_rates"]].to_csv(fit_path, index=False)
    measures_df.to_csv(measures_path, index=False)

    best_raw = load_raw(alpha_raw_paths[best_alpha])
    best_signal_label = f"SignalAgent\n(beta=3, lambda=0.125, {_param_name(args.score)}={best_alpha:g})"
    best_signal_df = add_measures(long_player_rows(best_raw, best_signal_label))
    joint_df = add_measures(long_player_rows(load_raw(JOINT_RAW), "Joint-RL"))

    equal_rows = []
    all_rows = []
    for label, raw_trials, df in [
        (best_signal_label, best_raw, best_signal_df),
        ("Joint-RL", load_raw(JOINT_RAW), joint_df),
        ("Human-Human", load_raw(HUMAN_RAW), human_df),
    ]:
        equal_rows.extend(comparison_rows(label, raw_trials, df, "equal_to_both"))
        all_rows.extend(comparison_rows(label, raw_trials, df, None))

    equal_df = pd.DataFrame(equal_rows)
    all_df = pd.DataFrame(all_rows)
    equal_csv = args.output_dir / "equal_to_both_signal_joint_rl_human_4panel_summary.csv"
    all_csv = args.output_dir / "all_distance_signal_joint_rl_human_4panel_summary.csv"
    equal_df.to_csv(equal_csv, index=False)
    all_df.to_csv(all_csv, index=False)

    plot_fit(grid_df, target, args.output_dir / "signal_alpha_fit_beta3_average_equal.png", args.score)
    plot_four_measures(measures_df, args.output_dir / "signal_alpha_beta3_average_equal_4measures.png", args.score)
    plot_comparison(equal_df, args.output_dir / "equal_to_both_signal_beta3_best_joint_rl_human_4panel.png", f"Equal-to-Both Only: SignalAgent ({args.score}) and Human Comparison")
    plot_comparison(all_df, args.output_dir / "all_distance_signal_beta3_best_joint_rl_human_4panel.png", f"All Distance Conditions: SignalAgent ({args.score}) and Human Comparison")
    notebook_path = None if args.skip_notebook else write_notebook(args.output_dir, best_alpha)

    summary = {
        "fit_target": "trial/player-level signalingMove by distance condition",
        "score": args.score,
        "score_definition": SCORE_LABELS[args.score],
        "horizon": args.horizon,
        "beta_fixed": args.beta,
        "lambda_fixed": args.lambda_value,
        "alpha_grid": alphas,
        "human_target_csv": str(target_path),
        "best_by_binomial_nll": best,
        "best_raw_trials": str(alpha_raw_paths[best_alpha]),
        "outputs": {
            "grid_csv": str(grid_path),
            "average_equal_csv": str(fit_path),
            "four_measure_csv": str(measures_path),
            "equal_to_both_comparison_csv": str(equal_csv),
            "all_distance_comparison_csv": str(all_csv),
            "notebook": str(notebook_path) if notebook_path else None,
        },
    }
    summary_path = args.output_dir / "signal_alpha_fit_beta3_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))
    print(json.dumps({"summaryPath": str(summary_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
