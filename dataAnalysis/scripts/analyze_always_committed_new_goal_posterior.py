#!/usr/bin/env python3
"""Analyze AlwaysCommittedAgent joint-goal posterior when a new goal appears."""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from fit_always_committed_lambda import (
    action_probability,
    ensure_action_list,
    ensure_coord_list,
    normalize_posterior,
    resize_posterior_like_always_committed,
    to_int,
)


DEFAULT_RAW = Path(
    "dataAnalysis/model_model/always_committed_agent/outputs/"
    "always_committed_vs_always_committed_simulation/"
    "always_committed_vs_always_committed_2p3g_raw_trials_beta_3_lambda_0p04_sessions_0_to_29.json"
)
DEFAULT_OUTPUT_DIR = Path(
    "dataAnalysis/model_model/always_committed_agent/outputs/"
    "always_committed_new_goal_posterior"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-trials", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--condition-scope", choices=["all", "equal_to_both"], default="equal_to_both")
    parser.add_argument("--prefix", default=None)
    return parser.parse_args()


def mean_ci(values: pd.Series) -> tuple[float, float, float, int]:
    arr = values.dropna().to_numpy(dtype=float)
    if arr.size == 0:
        return np.nan, np.nan, np.nan, 0
    mean = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1)) if arr.size > 1 else 0.0
    se = sd / np.sqrt(arr.size)
    ci = 1.96 * se
    return mean, mean - ci, mean + ci, int(arr.size)


def posterior_before_new_goal(trial: pd.Series) -> tuple[np.ndarray | None, int | None]:
    initial_goals = ensure_coord_list(trial.get("initialGoalPositions"))
    new_goal_time = to_int(trial.get("newGoalPresentedTime"))
    if len(initial_goals) < 2 or new_goal_time is None:
        return None, None

    p1_actions = ensure_action_list(trial.get("player1Actions"))
    p2_actions = ensure_action_list(trial.get("player2Actions"))
    p1_traj = ensure_coord_list(trial.get("player1Trajectory"))
    p2_traj = ensure_coord_list(trial.get("player2Trajectory"))

    posterior = np.full(len(initial_goals), 1.0 / len(initial_goals), dtype=np.float64)
    max_observed_step = min(
        new_goal_time,
        max(len(p1_actions), len(p2_actions), len(p1_traj), len(p2_traj)),
    )

    # markNewGoalPresented() is called at the top of the next loop, before the
    # agents act with the new goal. Therefore actions [0, newGoalPresentedTime)
    # are exactly the evidence available at presentation.
    for step in range(max_observed_step):
        like = np.ones(len(initial_goals), dtype=np.float64)
        if step < len(p1_actions) and step < len(p1_traj) and step < len(p2_traj):
            like *= np.array(
                [
                    action_probability(p1_traj[step], p2_traj[step], p1_actions[step], goal)
                    for goal in initial_goals
                ],
                dtype=np.float64,
            )
        if step < len(p2_actions) and step < len(p2_traj) and step < len(p1_traj):
            like *= np.array(
                [
                    action_probability(p2_traj[step], p1_traj[step], p2_actions[step], goal)
                    for goal in initial_goals
                ],
                dtype=np.float64,
            )
        posterior = normalize_posterior(posterior * like)

    return posterior, max_observed_step


def extract_player_rows(raw_df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, trial in raw_df.iterrows():
        if not bool(trial.get("newGoalPresented")):
            continue
        shared_goal = trial.get("firstDetectedSharedGoal")
        if not isinstance(shared_goal, (int, np.integer)):
            continue
        shared_goal = int(shared_goal)
        posterior_two, evidence_steps = posterior_before_new_goal(trial)
        if posterior_two is None or shared_goal >= len(posterior_two):
            continue

        posterior_three = resize_posterior_like_always_committed(posterior_two, len(posterior_two) + 1)
        two_goal_shared = float(posterior_two[shared_goal])
        three_goal_shared = float(posterior_three[shared_goal])
        old_alternative_idx = 1 - shared_goal if len(posterior_two) == 2 else None
        three_goal_old_alternative = (
            float(posterior_three[old_alternative_idx])
            if old_alternative_idx is not None and old_alternative_idx < len(posterior_three)
            else np.nan
        )
        three_goal_new = float(posterior_three[-1])
        denominator = three_goal_shared + three_goal_new
        three_goal_shared_scaled = three_goal_shared / denominator if denominator > 0 else np.nan

        rows.append({
            "sessionIndex": trial.get("sessionIndex"),
            "trialIndex": trial.get("trialIndex"),
            "mapId": trial.get("mapId"),
            "distanceCondition": trial.get("distanceCondition"),
            "firstDetectedSharedGoal": shared_goal,
            "newGoalPresentedTime": trial.get("newGoalPresentedTime"),
            "posteriorEvidenceSteps": evidence_steps,
            "two_goal_shared_posterior": two_goal_shared,
            "three_goal_shared_raw_posterior": three_goal_shared,
            "three_goal_old_alternative_raw_posterior": three_goal_old_alternative,
            "three_goal_new_raw_posterior": three_goal_new,
            "three_goal_shared_scaled_posterior": three_goal_shared_scaled,
        })
    return pd.DataFrame(rows)


def build_summary(detail_df: pd.DataFrame, scope: str) -> pd.DataFrame:
    df = detail_df.copy()
    if scope == "equal_to_both":
        df = df[df["distanceCondition"] == "equal_to_both"]

    measures = [
        ("2-goal posterior P(old shared)", "two_goal_shared_posterior"),
        ("3-goal scaled P(old shared | old shared or new)", "three_goal_shared_scaled_posterior"),
        ("3-goal raw P(old shared)", "three_goal_shared_raw_posterior"),
        ("3-goal raw P(old alternative)", "three_goal_old_alternative_raw_posterior"),
        ("3-goal raw P(new)", "three_goal_new_raw_posterior"),
    ]
    rows = []
    for label, col in measures:
        mean, low, high, n = mean_ci(df[col])
        rows.append({
            "condition_scope": scope,
            "measure": label,
            "mean": mean,
            "ci95_lower": low,
            "ci95_upper": high,
            "n_trials": n,
        })
    return pd.DataFrame(rows)


def plot_two_bar(summary_df: pd.DataFrame, output_path: Path, scope: str) -> None:
    plot_df = summary_df.iloc[:2].copy()
    labels = ["2-goal\nbefore new", "3-goal scaled\nold vs new"]
    y = plot_df["mean"].to_numpy(dtype=float)
    low = plot_df["ci95_lower"].to_numpy(dtype=float)
    high = plot_df["ci95_upper"].to_numpy(dtype=float)
    yerr = np.vstack([y - low, high - y])

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    bars = ax.bar(
        np.arange(len(y)),
        y * 100,
        yerr=yerr * 100,
        color=["#4f79a8", "#f28e2b"],
        alpha=0.88,
        capsize=5,
        width=0.58,
    )
    ax.axhline(50, color="#333333", linestyle="--", linewidth=1.5, alpha=0.75)
    ax.set_title(
        f"Joint-Goal Posterior at New-Goal Onset ({scope.replace('_', ' ')})",
        fontsize=14,
        fontweight="bold",
    )
    ax.set_ylabel("Mean posterior for old shared goal (%)")
    ax.set_ylim(0, 105)
    ax.set_xticks(np.arange(len(labels)))
    ax.set_xticklabels(labels)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for bar, value in zip(bars, y * 100):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            max(2, value * 0.08),
            f"{value:.1f}",
            ha="center",
            va="bottom",
            color="white",
            fontsize=11,
            fontweight="bold",
        )
    fig.tight_layout()
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_three_goal_distribution(summary_df: pd.DataFrame, output_path: Path, scope: str) -> None:
    label_to_short = {
        "3-goal raw P(old shared)": "Old shared",
        "3-goal raw P(old alternative)": "Old alternative",
        "3-goal raw P(new)": "New goal",
    }
    plot_df = summary_df[summary_df["measure"].isin(label_to_short)].copy()
    plot_df["short_label"] = plot_df["measure"].map(label_to_short)
    order = ["Old shared", "Old alternative", "New goal"]
    plot_df = plot_df.set_index("short_label").loc[order].reset_index()

    y = plot_df["mean"].to_numpy(dtype=float)
    low = plot_df["ci95_lower"].to_numpy(dtype=float)
    high = plot_df["ci95_upper"].to_numpy(dtype=float)
    yerr = np.vstack([y - low, high - y])

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(7.8, 5.2))
    bars = ax.bar(
        np.arange(len(order)),
        y * 100,
        yerr=yerr * 100,
        color=["#4f79a8", "#bab0ac", "#f28e2b"],
        alpha=0.88,
        capsize=5,
        width=0.62,
    )
    ax.set_title(
        f"3-Goal Posterior Distribution at New-Goal Onset ({scope.replace('_', ' ')})",
        fontsize=14,
        fontweight="bold",
    )
    ax.set_ylabel("Mean posterior (%)")
    ax.set_ylim(0, 105)
    ax.set_xticks(np.arange(len(order)))
    ax.set_xticklabels(order)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for bar, value in zip(bars, y * 100):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            max(2, value * 0.08),
            f"{value:.1f}",
            ha="center",
            va="bottom",
            color="white",
            fontsize=11,
            fontweight="bold",
        )
    fig.tight_layout()
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or f"always_committed_new_goal_posterior_{args.condition_scope}"

    raw_df = pd.read_json(args.raw_trials)
    detail_df = extract_player_rows(raw_df)
    summary_df = build_summary(detail_df, args.condition_scope)

    detail_path = args.output_dir / f"{prefix}_detail.csv"
    summary_path = args.output_dir / f"{prefix}_summary.csv"
    png_path = args.output_dir / f"{prefix}_two_bar.png"
    dist_png_path = args.output_dir / f"{prefix}_three_goal_distribution.png"

    detail_df.to_csv(detail_path, index=False)
    summary_df.to_csv(summary_path, index=False)
    plot_two_bar(summary_df, png_path, args.condition_scope)
    plot_three_goal_distribution(summary_df, dist_png_path, args.condition_scope)

    print(summary_df.round(4).to_string(index=False))
    print(f"detail_csv={detail_path}")
    print(f"summary_csv={summary_path}")
    print(f"png={png_path}")
    print(f"three_goal_png={dist_png_path}")


if __name__ == "__main__":
    main()
