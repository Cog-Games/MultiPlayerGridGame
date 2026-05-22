#!/usr/bin/env python3
"""Fit AlwaysSignalAgent lambda x RSA-alpha against trial/player-level human data."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from itertools import product
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from fit_signal_alpha_beta3 import (  # noqa: E402
    add_measures,
    comparison_rows,
    load_raw,
    long_player_rows,
    plot_comparison,
    resolved_raw_path,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HUMAN_RAW = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "human" / "equal_to_both_agent_human_comparison" / "human_human_pure_unique_2p3g_raw_trials.json"
SIM_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_always_signal_vs_always_signal_2p3g.js"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "dataAnalysis" / "model_model" / "signal_agent" / "outputs" / "signal_agent_from_start_rsa_lambda_alpha_fit"
DEFAULT_RAW_DIR = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "signal_agent" / "from_start_rsa_unshaped_jointrl_lambda_alpha_fit"

COARSE_LAMBDAS = [0.0, 0.05, 0.1, 0.15, 0.3, 0.5, 1.0]
COARSE_ALPHAS = [0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0]
CONDITIONS = ["closer_to_player1", "equal_to_both", "closer_to_player2"]
FIT_METRICS = ["commitment", "signalingMove"]
EPS = 1e-9
MODEL = "sampleJointGoalAndRSASignal_fromStart"


def parse_float_grid(text: Optional[str], default: List[float]) -> List[float]:
    if not text:
        return default
    values = []
    for item in text.split(","):
        item = item.strip()
        if item:
            values.append(float(item))
    return sorted(set(round(v, 10) for v in values))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--raw-output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--trials", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--beta", type=float, default=3.0)
    parser.add_argument("--score", choices=["logposterior"], default="logposterior")
    parser.add_argument("--horizon", type=int, default=1)
    parser.add_argument("--lambdas", type=str, default=None)
    parser.add_argument("--alphas", type=str, default=None)
    parser.add_argument("--reuse-existing", action="store_true")
    parser.add_argument("--skip-refine", action="store_true")
    parser.add_argument("--skip-notebook", action="store_true")
    parser.add_argument("--no-compress-raw", action="store_true")
    parser.add_argument("--max-grid", type=int, default=None, help="Optional debug cap on evaluated settings.")
    return parser.parse_args()


def fmt(value: float) -> str:
    return f"{value:.15g}".replace("-", "neg").replace(".", "p")


def raw_path_for(raw_dir: Path, beta: float, lambda_value: float, alpha: float, sessions: int, offset: int = 0) -> Path:
    suffix = (
        f"beta_{fmt(beta)}_lambda_{fmt(lambda_value)}_alpha_{fmt(alpha)}_"
        f"sessions_{offset}_to_{offset + sessions - 1}"
    )
    return raw_dir / f"always_signal_vs_always_signal_2p3g_raw_trials_{suffix}.json"


def existing_raw_path(raw_path: Path) -> Optional[Path]:
    try:
        return resolved_raw_path(raw_path)
    except FileNotFoundError:
        return None


def run_simulation(args: argparse.Namespace, lambda_value: float, alpha: float) -> Path:
    raw_path = raw_path_for(args.raw_output_dir, args.beta, lambda_value, alpha, args.sessions)
    if args.reuse_existing:
        existing = existing_raw_path(raw_path)
        if existing is not None:
            return existing

    cmd = [
        "node",
        str(SIM_SCRIPT),
        "--sessions", str(args.sessions),
        "--trials", str(args.trials),
        "--seed", str(args.seed),
        "--lambda", str(lambda_value),
        "--alpha", str(alpha),
        "--beta", str(args.beta),
        "--score", args.score,
        "--horizon", str(args.horizon),
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir", str(args.output_dir / "simulations"),
        "--raw-output-dir", str(args.raw_output_dir),
    ]
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        raise RuntimeError(f"Simulation failed for lambda={lambda_value:g}, alpha={alpha:g}")
    if not raw_path.exists():
        raise FileNotFoundError(f"Expected raw output missing: {raw_path}")
    return raw_path


def compress_raw(raw_path: Path, enabled: bool = True) -> Path:
    if not enabled or raw_path.suffix == ".zst":
        return raw_path
    zst_path = Path(f"{raw_path}.zst")
    if zst_path.exists() and not raw_path.exists():
        return zst_path
    if not raw_path.exists():
        return resolved_raw_path(raw_path)
    subprocess.run(["zstd", "-q", "-f", "--rm", str(raw_path)], cwd=PROJECT_ROOT, check=True)
    return zst_path


def human_targets(human_df: pd.DataFrame) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    valid = human_df.dropna(subset=["distanceCondition"]).copy()
    for condition in CONDITIONS:
        sub = valid[valid["distanceCondition"] == condition]
        for metric in FIT_METRICS:
            metric_sub = sub.dropna(subset=[metric])
            rows.append({
                "distanceCondition": condition,
                "metric": metric,
                "human_n": int(metric_sub.shape[0]),
                "human_k": int(metric_sub[metric].sum()) if not metric_sub.empty else 0,
                "human_rate": float(metric_sub[metric].mean()) if not metric_sub.empty else np.nan,
            })
    return pd.DataFrame(rows)


def simulated_rates(sim_df: pd.DataFrame) -> Dict[Tuple[str, str], float]:
    rates: Dict[Tuple[str, str], float] = {}
    valid = sim_df.dropna(subset=["distanceCondition"]).copy()
    for condition, sub in valid.groupby("distanceCondition"):
        for metric in FIT_METRICS:
            metric_sub = sub.dropna(subset=[metric])
            rates[(str(condition), metric)] = float(metric_sub[metric].mean()) if not metric_sub.empty else EPS
    return rates


def metric_binomial_nll(target: pd.DataFrame, sim_rates: Dict[Tuple[str, str], float]) -> Tuple[float, float]:
    commitment_nll = 0.0
    signaling_nll = 0.0
    for row in target.to_dict(orient="records"):
        metric = str(row["metric"])
        p = min(1 - EPS, max(EPS, float(sim_rates.get((str(row["distanceCondition"]), metric), EPS))))
        k = float(row["human_k"])
        n = float(row["human_n"])
        value = -(k * math.log(p) + (n - k) * math.log(1 - p))
        if metric == "commitment":
            commitment_nll += value
        elif metric == "signalingMove":
            signaling_nll += value
    return commitment_nll, signaling_nll


def weighted_metric_rate(target: pd.DataFrame, rates: Dict[Tuple[str, str], float], metric: str) -> float:
    sub = target[target["metric"] == metric]
    return float(np.average(
        [rates.get((str(row.distanceCondition), metric), 0.0) for row in sub.itertuples(index=False)],
        weights=sub["human_n"],
    ))


def measure_row(lambda_value: float, alpha: float, raw_trials: List[Dict[str, Any]], sim_df: pd.DataFrame) -> Dict[str, float]:
    row: Dict[str, float] = {"lambda": lambda_value, "alpha": alpha}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows(MODEL, raw_trials, sim_df, condition)
        metric_values = {item["metric"]: item for item in rows}
        row[f"{prefix}_success_percent"] = metric_values["Success Rate (%)"]["mean_percent"]
        row[f"{prefix}_efficiency_percent"] = metric_values["Coordination Efficiency (%)"]["mean_percent"]
        row[f"{prefix}_commitment_percent"] = metric_values["Commitment (%)"]["mean_percent"]
        row[f"{prefix}_signaling_percent"] = metric_values["Signaling Move (%)"]["mean_percent"]
    return row


def refinement_values(best: float, coarse: List[float], lower: float, upper: float) -> List[float]:
    values = sorted(set(float(v) for v in coarse))
    idx = min(range(len(values)), key=lambda i: abs(values[i] - best))
    lo = values[idx - 1] if idx > 0 else lower
    hi = values[idx + 1] if idx < len(values) - 1 else upper
    refined = np.linspace(lo, hi, 5)
    return sorted(set(round(float(v), 10) for v in refined if lower <= float(v) <= upper))


def setting_key(lambda_value: float, alpha: float) -> Tuple[float, float]:
    return round(lambda_value, 10), round(alpha, 10)


def plot_lambda_alpha_heatmaps(grid_df: pd.DataFrame, best_row: Dict[str, Any], path: Path, scope: str, title: str) -> None:
    panels = [
        ("Success Rate (%)", f"{scope}_success_percent"),
        ("Coordination Efficiency (%)", f"{scope}_efficiency_percent"),
        ("Commitment (%)", f"{scope}_commitment_percent"),
        ("Signaling Move (%)", f"{scope}_signaling_percent"),
    ]
    alpha_values = sorted(grid_df["alpha"].dropna().unique())
    lambda_values = sorted(grid_df["lambda"].dropna().unique())
    fig, axes = plt.subplots(2, 2, figsize=(13, 10))
    fig.suptitle(title, fontsize=16, fontweight="bold", y=0.98)

    best_x = lambda_values.index(float(best_row["lambda"])) if float(best_row["lambda"]) in lambda_values else None
    best_y = alpha_values.index(float(best_row["alpha"])) if float(best_row["alpha"]) in alpha_values else None

    for ax, (panel_title, col) in zip(axes.ravel(), panels):
        pivot = grid_df.pivot_table(index="alpha", columns="lambda", values=col, aggfunc="mean")
        pivot = pivot.reindex(index=alpha_values, columns=lambda_values)
        image = ax.imshow(pivot.to_numpy(dtype=float), aspect="auto", origin="lower", cmap="viridis", vmin=0, vmax=100)
        ax.set_title(panel_title, fontsize=13, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel("RSA alpha")
        ax.set_xticks(np.arange(len(lambda_values)))
        ax.set_xticklabels([f"{v:g}" for v in lambda_values], rotation=45, ha="right")
        ax.set_yticks(np.arange(len(alpha_values)))
        ax.set_yticklabels([f"{v:g}" for v in alpha_values])
        fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04, label="%")
        if best_x is not None and best_y is not None:
            ax.scatter([best_x], [best_y], marker="*", s=170, color="white", edgecolor="black", linewidth=1.1, zorder=5)
        for y in range(len(alpha_values)):
            for x in range(len(lambda_values)):
                value = pivot.iloc[y, x]
                if np.isfinite(value):
                    ax.text(x, y, f"{value:.0f}", ha="center", va="center", fontsize=7, color="white" if value < 55 else "black")

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def write_notebook(output_dir: Path, best_row: Dict[str, Any]) -> Path:
    nb_dir = PROJECT_ROOT / "dataAnalysis" / "model_model" / "signal_agent" / "notebooks" / "signal_agent_from_start_rsa_lambda_alpha_fit"
    nb_dir.mkdir(parents=True, exist_ok=True)
    nb_path = nb_dir / "AlwaysSignalAgent_from_start_rsa_lambda_alpha_results.ipynb"
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# sampleJointGoalAndRSASignal_fromStart (shared-agency model) Lambda x Alpha Fit\n",
                "\n",
                "Always-on posterior timing with unshaped JointRL goal values and RSA/log-posterior SignalAgent action policy.\n",
                f"Best setting: lambda = {float(best_row['lambda']):g}, alpha = {float(best_row['alpha']):g}.\n",
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
                "grid = pd.read_csv(OUT / 'always_signal_rsa_lambda_alpha_grid.csv')\n",
                "best_metrics = pd.read_csv(OUT / 'always_signal_rsa_lambda_alpha_best_metrics.csv')\n",
                "all_summary = pd.read_csv(OUT / 'all_distance_always_signal_rsa_human_4panel_summary.csv')\n",
                "equal_summary = pd.read_csv(OUT / 'equal_to_both_always_signal_rsa_human_4panel_summary.csv')\n",
            ],
        },
        {"cell_type": "markdown", "metadata": {}, "source": ["## Fit Grid\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["grid.sort_values('binomial_nll').head(10).round(4)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## Best Metrics\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["best_metrics.round(3)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## Model-Human Summaries\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["all_summary.round(3), equal_summary.round(3)\n"]},
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
    nb_path.write_text(json.dumps(nb, indent=2), encoding="utf-8")
    return nb_path


def evaluate_setting(args: argparse.Namespace, lambda_value: float, alpha: float, target: pd.DataFrame) -> Tuple[Dict[str, Any], Dict[str, float]]:
    raw_path = run_simulation(args, lambda_value, alpha)
    raw_trials = load_raw(raw_path)
    sim_df = add_measures(long_player_rows(raw_trials, MODEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    compressed_raw_path = compress_raw(raw_path, enabled=not args.no_compress_raw)

    row: Dict[str, Any] = {
        "lambda": lambda_value,
        "alpha": alpha,
        "commitment_nll": commitment_nll,
        "signaling_nll": signaling_nll,
        "binomial_nll": commitment_nll + signaling_nll,
        "sim_commitment_human_weighted_average": weighted_metric_rate(target, rates, "commitment"),
        "sim_signaling_human_weighted_average": weighted_metric_rate(target, rates, "signalingMove"),
        "sim_commitment_equal_to_both": rates.get(("equal_to_both", "commitment"), np.nan),
        "sim_signaling_equal_to_both": rates.get(("equal_to_both", "signalingMove"), np.nan),
        "raw_trials": str(compressed_raw_path),
    }
    for condition in CONDITIONS:
        row[f"sim_{condition}_commitment"] = rates.get((condition, "commitment"), np.nan)
        row[f"sim_{condition}_signalingMove"] = rates.get((condition, "signalingMove"), np.nan)
        for metric in FIT_METRICS:
            human_match = target[(target["distanceCondition"] == condition) & (target["metric"] == metric)]
            if not human_match.empty:
                row[f"human_{condition}_{metric}"] = float(human_match["human_rate"].iloc[0])
    row.update(measure_row(lambda_value, alpha, raw_trials, sim_df))
    return row, {"raw_trials": str(compressed_raw_path)}


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "simulations").mkdir(parents=True, exist_ok=True)
    args.raw_output_dir.mkdir(parents=True, exist_ok=True)

    lambdas = parse_float_grid(args.lambdas, COARSE_LAMBDAS)
    alphas = parse_float_grid(args.alphas, COARSE_ALPHAS)
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, "Human-Human"))
    target = human_targets(human_df)
    target_path = args.output_dir / "human_trial_level_commitment_signaling_target.csv"
    target.to_csv(target_path, index=False)

    grid_rows: List[Dict[str, Any]] = []
    seen: set[Tuple[float, float]] = set()

    coarse_settings = [(float(l), float(a)) for l, a in product(lambdas, alphas)]
    if args.max_grid is not None:
        coarse_settings = coarse_settings[: args.max_grid]

    for lambda_value, alpha in coarse_settings:
        key = setting_key(lambda_value, alpha)
        if key in seen:
            continue
        seen.add(key)
        row, _ = evaluate_setting(args, lambda_value, alpha, target)
        row["fit_stage"] = "coarse"
        grid_rows.append(row)

    if not grid_rows:
        raise RuntimeError("No settings were evaluated.")

    coarse_df = pd.DataFrame(grid_rows)
    best_coarse = coarse_df.loc[coarse_df["binomial_nll"].idxmin()].to_dict()

    if not args.skip_refine and args.max_grid is None:
        refine_lambdas = refinement_values(float(best_coarse["lambda"]), lambdas, 0.0, max(max(lambdas), 1.0))
        refine_alphas = refinement_values(float(best_coarse["alpha"]), alphas, 0.0, max(max(alphas), 8.0))
        for lambda_value, alpha in product(refine_lambdas, refine_alphas):
            key = setting_key(lambda_value, alpha)
            if key in seen:
                continue
            seen.add(key)
            row, _ = evaluate_setting(args, float(lambda_value), float(alpha), target)
            row["fit_stage"] = "refine"
            grid_rows.append(row)

    grid_df = pd.DataFrame(grid_rows).sort_values(["lambda", "alpha"]).reset_index(drop=True)
    best_row = grid_df.loc[grid_df["binomial_nll"].idxmin()].to_dict()
    best_raw_path = Path(str(best_row["raw_trials"]))
    best_raw = load_raw(best_raw_path)
    best_df = add_measures(long_player_rows(best_raw, MODEL))

    model_label = (
        f"{MODEL}\n"
        f"(lambda={float(best_row['lambda']):g}, alpha={float(best_row['alpha']):g})"
    )
    model_df = add_measures(long_player_rows(best_raw, model_label))
    equal_rows: List[Dict[str, Any]] = []
    all_rows: List[Dict[str, Any]] = []
    for label, raw_trials, df in [
        (model_label, best_raw, model_df),
        ("Human-Human", human_raw, human_df),
    ]:
        equal_rows.extend(comparison_rows(label, raw_trials, df, "equal_to_both"))
        all_rows.extend(comparison_rows(label, raw_trials, df, None))

    equal_df = pd.DataFrame(equal_rows)
    all_df = pd.DataFrame(all_rows)

    grid_path = args.output_dir / "always_signal_rsa_lambda_alpha_grid.csv"
    best_metrics_path = args.output_dir / "always_signal_rsa_lambda_alpha_best_metrics.csv"
    equal_csv = args.output_dir / "equal_to_both_always_signal_rsa_human_4panel_summary.csv"
    all_csv = args.output_dir / "all_distance_always_signal_rsa_human_4panel_summary.csv"
    grid_df.to_csv(grid_path, index=False)
    pd.DataFrame([best_row]).to_csv(best_metrics_path, index=False)
    equal_df.to_csv(equal_csv, index=False)
    all_df.to_csv(all_csv, index=False)

    average_heatmap = args.output_dir / "always_signal_rsa_lambda_alpha_average_4measure_heatmaps.png"
    equal_heatmap = args.output_dir / "always_signal_rsa_lambda_alpha_equal_to_both_4measure_heatmaps.png"
    plot_lambda_alpha_heatmaps(
        grid_df,
        best_row,
        average_heatmap,
        "average",
        f"{MODEL}: lambda x alpha sweep, average all 2P3G",
    )
    plot_lambda_alpha_heatmaps(
        grid_df,
        best_row,
        equal_heatmap,
        "equal",
        f"{MODEL}: lambda x alpha sweep, equal-to-both",
    )
    plot_comparison(
        equal_df,
        args.output_dir / "equal_to_both_always_signal_rsa_human_4panel.png",
        f"Equal-to-Both Only: {MODEL} and Human-Human",
    )
    plot_comparison(
        all_df,
        args.output_dir / "all_distance_always_signal_rsa_human_4panel.png",
        f"All Distance Conditions: {MODEL} and Human-Human",
    )
    notebook_path = None if args.skip_notebook else write_notebook(args.output_dir, best_row)

    summary = {
        "model": MODEL,
        "implementation": "AlwaysSignalAgent",
        "joint_value_model": "unshaped JointRL",
        "reward_parameters": {
            "goalReward": 30,
            "stepCost": -1,
            "gamma": 0.9,
            "softmaxBeta": 3.0,
            "proximityRewardWeight": 0.0,
        },
        "score": args.score,
        "horizon": int(args.horizon),
        "fit_target": "trial/player-level commitment + signalingMove binomial NLL by distance condition",
        "optimized_metrics": FIT_METRICS,
        "reported_not_optimized": ["success", "efficiency"],
        "coarse_lambdas": lambdas,
        "coarse_alphas": alphas,
        "evaluated_settings": int(grid_df.shape[0]),
        "max_expected_settings": int(len(lambdas) * len(alphas) + 25),
        "best_by_binomial_nll": best_row,
        "best_raw_trials": str(best_raw_path),
        "human_target_csv": str(target_path),
        "outputs": {
            "grid_csv": str(grid_path),
            "best_metrics_csv": str(best_metrics_path),
            "average_heatmap": str(average_heatmap),
            "equal_to_both_heatmap": str(equal_heatmap),
            "equal_to_both_comparison_csv": str(equal_csv),
            "all_distance_comparison_csv": str(all_csv),
            "notebook": str(notebook_path) if notebook_path else None,
        },
    }
    summary_path = args.output_dir / "always_signal_rsa_lambda_alpha_fit_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"summaryPath": str(summary_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
