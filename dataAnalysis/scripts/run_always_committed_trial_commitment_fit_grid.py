#!/usr/bin/env python3
"""Run a fine lambda grid and fit AlwaysCommittedAgent to trial-level commitment."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from fit_always_committed_lambda_trial_commitment import (
    DEFAULT_HUMAN_COMPARISON_DIR,
    DEFAULT_OUTPUT_DIR,
    load_human_commitments,
)
from run_always_committed_lambda_sweep import (
    DEFAULT_OUTPUT_DIR as DEFAULT_SIM_OUTPUT_DIR,
    ANALYZER_SCRIPT,
    SIM_SCRIPT,
    collect_metrics,
    format_number,
    simulation_paths,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--trials-per-session", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--beta", type=float, default=3.0)
    parser.add_argument("--lambda-start", type=float, default=0.0)
    parser.add_argument("--lambda-end", type=float, default=0.1)
    parser.add_argument("--lambda-step", type=float, default=0.01)
    parser.add_argument("--fit-scope", choices=["average", "equal_to_both", "both"], default="average")
    parser.add_argument("--sim-output-dir", type=Path, default=DEFAULT_SIM_OUTPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--human-comparison-dir", type=Path, default=DEFAULT_HUMAN_COMPARISON_DIR)
    parser.add_argument("--skip-existing", action="store_true")
    return parser.parse_args()


def lambda_values(start: float, end: float, step: float) -> list[float]:
    values = []
    current = start
    while current <= end + step / 2:
        values.append(round(current, 10))
        current += step
    return values


def run_command(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def fit_loss(row: pd.Series, targets: dict[str, dict[str, float]], fit_scope: str) -> float:
    average_error = float(row["average_commitment_percent"]) - targets["average"]["commitment_percent"]
    equal_error = float(row["equal_to_both_commitment_percent"]) - targets["equal_to_both"]["commitment_percent"]
    if fit_scope == "average":
        return average_error ** 2
    if fit_scope == "equal_to_both":
        return equal_error ** 2
    return (
        targets["average"]["n"] * average_error ** 2 +
        targets["equal_to_both"]["n"] * equal_error ** 2
    )


def plot_grid_fit(df: pd.DataFrame, targets: dict[str, dict[str, float]], fitted_lambda: float, fit_scope: str, path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(8.5, 5.2))
    ax.plot(df["lambda"], df["average_commitment_percent"], marker="o", linewidth=2.4, color="#4f79a8", label="Model average")
    ax.plot(df["lambda"], df["equal_to_both_commitment_percent"], marker="o", linewidth=2.4, color="#f28e2b", label="Model equal-to-both")
    ax.axhline(targets["average"]["commitment_percent"], color="#4f79a8", linestyle="--", linewidth=1.8, label="Human average")
    ax.axhline(targets["equal_to_both"]["commitment_percent"], color="#f28e2b", linestyle="--", linewidth=1.8, label="Human equal-to-both")
    ax.axvline(fitted_lambda, color="#333333", linewidth=2, label=f"fit lambda={fitted_lambda:.2f}")
    ax.set_title(f"Trial-Level Commitment Fit ({fit_scope})", fontsize=15, fontweight="bold")
    ax.set_xlabel("lambda")
    ax.set_ylabel("Commitment (%)")
    ax.set_ylim(0, 105)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    ax.legend(loc="lower right", frameon=True, fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    args = parse_args()
    args.sim_output_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    human_targets = load_human_commitments(args.human_comparison_dir)

    rows = []
    for lam in lambda_values(args.lambda_start, args.lambda_end, args.lambda_step):
        paths = simulation_paths(args.sim_output_dir, args.beta, lam, args.sessions)
        if not args.skip_existing or not (paths["summary"].exists() and paths["trials"].exists() and paths["raw"].exists()):
            run_command([
                "node",
                str(SIM_SCRIPT),
                "--sessions",
                str(args.sessions),
                "--trials-per-session",
                str(args.trials_per_session),
                "--seed",
                str(args.seed),
                "--beta",
                format_number(args.beta),
                "--lambda",
                format_number(lam),
                "--output-dir",
                str(args.sim_output_dir),
            ])
        if not args.skip_existing or not paths["metrics"].exists():
            run_command([
                "python3",
                str(ANALYZER_SCRIPT),
                "--input",
                str(paths["raw"]),
                "--output",
                str(paths["metrics"]),
            ])

        metric_rows = collect_metrics(args.sim_output_dir, args.beta, lam, args.sessions)
        wide = {"lambda": lam}
        for metric_row in metric_rows:
            prefix = metric_row["condition_scope"]
            wide[f"{prefix}_success_percent"] = metric_row["success_percent"]
            wide[f"{prefix}_efficiency_percent"] = metric_row["efficiency_percent"]
            wide[f"{prefix}_commitment_percent"] = metric_row["commitment_percent"]
            wide[f"{prefix}_signaling_percent"] = metric_row["signaling_percent"]
        wide["loss"] = fit_loss(pd.Series(wide), human_targets, args.fit_scope)
        rows.append(wide)

    df = pd.DataFrame(rows).sort_values("lambda")
    best = df.loc[df["loss"].idxmin()]
    prefix = f"always_committed_trial_commitment_fit_grid_{args.fit_scope}_{format_number(args.lambda_start)}_to_{format_number(args.lambda_end)}"
    grid_path = args.output_dir / f"{prefix}.csv"
    summary_path = args.output_dir / f"{prefix}_summary.json"
    plot_path = args.output_dir / f"{prefix}.png"
    df.to_csv(grid_path, index=False)
    plot_grid_fit(df, human_targets, float(best["lambda"]), args.fit_scope, plot_path)

    summary = {
        "model": "AlwaysCommittedAgent",
        "fit_target": "trial_level_commitment",
        "fit_scope": args.fit_scope,
        "method": "direct simulated grid search",
        "lambda_start": args.lambda_start,
        "lambda_end": args.lambda_end,
        "lambda_step": args.lambda_step,
        "fitted_lambda": float(best["lambda"]),
        "loss": float(best["loss"]),
        "model_average_commitment_percent": float(best["average_commitment_percent"]),
        "human_average_commitment_percent": human_targets["average"]["commitment_percent"],
        "model_equal_to_both_commitment_percent": float(best["equal_to_both_commitment_percent"]),
        "human_equal_to_both_commitment_percent": human_targets["equal_to_both"]["commitment_percent"],
        "grid_csv": str(grid_path),
        "grid_plot": str(plot_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"grid_csv={grid_path}")
    print(f"grid_png={plot_path}")
    print(f"summary_json={summary_path}")


if __name__ == "__main__":
    main()
