#!/usr/bin/env python3
"""Fit AlwaysCommittedAgent lambda directly to trial-level commitment.

This is a descriptive fit over simulated model-model commitment rates, not an
action-level likelihood fit. It finds the lambda whose simulated trial-level
commitment best matches Human-Human commitment.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


DEFAULT_SWEEP_CSV = Path(
    "dataAnalysis/analyses/outputs/model_model/always_committed_agent/"
    "always_committed_vs_always_committed_simulation/"
    "always_committed_lambda_sweep_average_equal_summary.csv"
)
DEFAULT_HUMAN_COMPARISON_DIR = Path(
    "dataAnalysis/analyses/outputs/comparisons/equal_to_both_agent_human_comparison"
)
DEFAULT_OUTPUT_DIR = Path(
    "dataAnalysis/analyses/outputs/model_model/always_committed_agent/"
    "always_committed_trial_commitment_fit"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sweep-csv", type=Path, default=DEFAULT_SWEEP_CSV)
    parser.add_argument("--human-comparison-dir", type=Path, default=DEFAULT_HUMAN_COMPARISON_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--fit-scope",
        choices=["average", "equal_to_both", "both"],
        default="average",
        help="Commitment target used to choose lambda.",
    )
    parser.add_argument("--grid-size", type=int, default=10001)
    return parser.parse_args()


def load_human_commitments(human_comparison_dir: Path) -> dict[str, dict[str, float]]:
    files = {
        "average": human_comparison_dir / "all_distance_committed_joint_rl_human_4panel_summary.csv",
        "equal_to_both": human_comparison_dir / "equal_to_both_committed_joint_rl_human_4panel_summary.csv",
    }
    targets: dict[str, dict[str, float]] = {}
    for scope, path in files.items():
        df = pd.read_csv(path)
        row = df[(df["group"] == "Human-Human") & (df["metric"] == "Commitment (%)")].iloc[0]
        targets[scope] = {
            "commitment_percent": float(row["mean_percent"]),
            "ci95_percent": float(row["ci95_percent"]),
            "n": int(row["n"]),
        }
    return targets


def interpolate_curve(sweep_df: pd.DataFrame, grid_size: int) -> pd.DataFrame:
    pivot = sweep_df.pivot(index="lambda", columns="condition_scope", values="commitment_percent")
    pivot = pivot.sort_index()
    lambda_min = float(pivot.index.min())
    lambda_max = float(pivot.index.max())
    grid = np.linspace(lambda_min, lambda_max, grid_size)
    out = pd.DataFrame({"lambda": grid})
    for scope in ["average", "equal_to_both"]:
        out[f"{scope}_commitment_percent"] = np.interp(
            grid,
            pivot.index.to_numpy(dtype=float),
            pivot[scope].to_numpy(dtype=float),
        )
    return out


def score_fit(curve_df: pd.DataFrame, human_targets: dict[str, dict[str, float]], fit_scope: str) -> pd.DataFrame:
    out = curve_df.copy()
    avg_error = out["average_commitment_percent"] - human_targets["average"]["commitment_percent"]
    equal_error = out["equal_to_both_commitment_percent"] - human_targets["equal_to_both"]["commitment_percent"]
    if fit_scope == "average":
        out["loss"] = avg_error.pow(2)
    elif fit_scope == "equal_to_both":
        out["loss"] = equal_error.pow(2)
    else:
        avg_n = human_targets["average"]["n"]
        equal_n = human_targets["equal_to_both"]["n"]
        out["loss"] = avg_n * avg_error.pow(2) + equal_n * equal_error.pow(2)
    return out


def plot_fit(
    sweep_df: pd.DataFrame,
    curve_df: pd.DataFrame,
    human_targets: dict[str, dict[str, float]],
    fitted_lambda: float,
    output_path: Path,
    fit_scope: str,
) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(9, 5.5))
    colors = {
        "average": "#4f79a8",
        "equal_to_both": "#f28e2b",
    }
    labels = {
        "average": "Average all 2P3G",
        "equal_to_both": "Equal-to-Both only",
    }

    for scope in ["average", "equal_to_both"]:
        sub = sweep_df[sweep_df["condition_scope"] == scope].sort_values("lambda")
        ax.plot(
            curve_df["lambda"],
            curve_df[f"{scope}_commitment_percent"],
            color=colors[scope],
            linewidth=2,
            alpha=0.6,
        )
        ax.scatter(
            sub["lambda"],
            sub["commitment_percent"],
            color=colors[scope],
            s=36,
            label=f"Model: {labels[scope]}",
        )
        target = human_targets[scope]["commitment_percent"]
        ax.axhline(
            target,
            color=colors[scope],
            linestyle="--",
            linewidth=1.8,
            alpha=0.8,
            label=f"Human: {labels[scope]} ({target:.1f}%)",
        )

    ax.axvline(
        fitted_lambda,
        color="#333333",
        linestyle="-",
        linewidth=2,
        label=f"fit lambda={fitted_lambda:.5f}",
    )
    ax.set_title(f"AlwaysCommitted Trial-Level Commitment Fit ({fit_scope})", fontsize=15, fontweight="bold")
    ax.set_xlabel("lambda")
    ax.set_ylabel("Commitment (%)")
    ax.set_ylim(0, 105)
    ax.set_xlim(float(sweep_df["lambda"].min()) - 0.02, float(sweep_df["lambda"].max()) + 0.02)
    ax.grid(axis="y", color="#d0d0d0")
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    ax.legend(loc="lower right", frameon=True, fontsize=9)
    fig.tight_layout()
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    sweep_df = pd.read_csv(args.sweep_csv)
    human_targets = load_human_commitments(args.human_comparison_dir)
    curve_df = interpolate_curve(sweep_df, args.grid_size)
    scored_df = score_fit(curve_df, human_targets, args.fit_scope)
    best = scored_df.loc[scored_df["loss"].idxmin()]
    fitted_lambda = float(best["lambda"])

    fit_curve_path = args.output_dir / f"always_committed_trial_commitment_fit_{args.fit_scope}_curve.csv"
    summary_path = args.output_dir / f"always_committed_trial_commitment_fit_{args.fit_scope}_summary.json"
    plot_path = args.output_dir / f"always_committed_trial_commitment_fit_{args.fit_scope}_curve.png"

    scored_df.to_csv(fit_curve_path, index=False)
    plot_fit(sweep_df, scored_df, human_targets, fitted_lambda, plot_path, args.fit_scope)

    summary = {
        "model": "AlwaysCommittedAgent",
        "fit_target": "trial_level_commitment",
        "fit_scope": args.fit_scope,
        "source_sweep_csv": str(args.sweep_csv),
        "fitted_lambda": fitted_lambda,
        "loss": float(best["loss"]),
        "model_average_commitment_percent": float(best["average_commitment_percent"]),
        "human_average_commitment_percent": human_targets["average"]["commitment_percent"],
        "human_average_commitment_n": human_targets["average"]["n"],
        "model_equal_to_both_commitment_percent": float(best["equal_to_both_commitment_percent"]),
        "human_equal_to_both_commitment_percent": human_targets["equal_to_both"]["commitment_percent"],
        "human_equal_to_both_commitment_n": human_targets["equal_to_both"]["n"],
        "method": "linear interpolation over simulated lambda sweep; minimize squared commitment error",
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    print(f"curve_csv={fit_curve_path}")
    print(f"curve_png={plot_path}")
    print(f"summary_json={summary_path}")


if __name__ == "__main__":
    main()
