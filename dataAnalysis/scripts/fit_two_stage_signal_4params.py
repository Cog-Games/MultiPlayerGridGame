#!/usr/bin/env python3
"""Fit TwoStageSignalAgent 4 parameters against human-human trial-level metrics."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from itertools import product
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HUMAN_RAW = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "human" / "equal_to_both_agent_human_comparison" / "human_human_pure_unique_2p3g_raw_trials.json"
SIM_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_two_stage_signal_vs_two_stage_signal_2p3g.js"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "dataAnalysis" / "model_model" / "two_stage_signal_agent" / "outputs" / "two_stage_signal_4param_fit"
DEFAULT_RAW_DIR = PROJECT_ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "two_stage_signal_agent"
EPS = 1e-9

DEFAULT_LAMBDAS = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1.0]
DEFAULT_TAUS = [0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90]
DEFAULT_ALPHAS = [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0]
DEFAULT_ETAS = [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0]


def parse_float_grid(text: Optional[str], default: List[float]) -> List[float]:
    if not text:
        return default
    out = []
    for item in text.split(","):
        item = item.strip()
        if item:
            out.append(float(item))
    return sorted(set(round(v, 10) for v in out))


def parse_condition_list(text: Optional[str]) -> Optional[List[str]]:
    if not text:
        return None
    out = []
    for item in text.split(","):
        item = item.strip()
        if item:
            out.append(item)
    return out or None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--raw-output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--trials", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--beta", type=float, default=3.0)
    parser.add_argument("--gate-sharpness", type=float, default=10.0)
    parser.add_argument("--signal-mode", choices=["logposterior", "mixture"], default="logposterior")
    parser.add_argument("--commitment-weight", type=float, default=1.0)
    parser.add_argument("--signaling-weight", type=float, default=1.0)
    parser.add_argument("--success-weight", type=float, default=1.0)
    parser.add_argument(
        "--success-conditions",
        type=str,
        default=None,
        help="Comma-separated distanceCondition values for trial-level success targets. Defaults to all conditions in human raw trials.",
    )
    parser.add_argument("--lambdas", type=str, default=None)
    parser.add_argument("--taus", type=str, default=None)
    parser.add_argument("--alphas", type=str, default=None)
    parser.add_argument("--etas", type=str, default=None)
    parser.add_argument("--reuse-existing", action="store_true")
    parser.add_argument("--skip-refine", action="store_true")
    parser.add_argument(
        "--max-grid",
        type=int,
        default=None,
        help="Optional debug cap on number of parameter settings to evaluate.",
    )
    return parser.parse_args()


def fmt(value: float) -> str:
    return f"{value:.15g}".replace("-", "neg").replace(".", "p")


def raw_path_for(raw_dir: Path, beta: float, lambda_value: float, tau: float, alpha: float, eta: float, sessions: int, signal_mode: str, offset: int = 0) -> Path:
    suffix = (
        f"signal_{signal_mode}_beta_{fmt(beta)}_lambda_{fmt(lambda_value)}_tau_{fmt(tau)}_"
        f"alpha_{fmt(alpha)}_eta_{fmt(eta)}_sessions_{offset}_to_{offset + sessions - 1}"
    )
    return raw_dir / f"two_stage_signal_vs_two_stage_signal_2p3g_raw_trials_{suffix}.json"


def run_simulation(args: argparse.Namespace, params: Dict[str, float]) -> Path:
    raw_path = raw_path_for(
        args.raw_output_dir,
        args.beta,
        params["lambda"],
        params["tau"],
        params["alpha"],
        params["eta"],
        args.sessions,
        args.signal_mode,
    )
    if args.reuse_existing and raw_path.exists():
        return raw_path

    cmd = [
        "node",
        str(SIM_SCRIPT),
        "--sessions", str(args.sessions),
        "--trials", str(args.trials),
        "--seed", str(args.seed),
        "--lambda", str(params["lambda"]),
        "--tau", str(params["tau"]),
        "--alpha", str(params["alpha"]),
        "--eta", str(params["eta"]),
        "--beta", str(args.beta),
        "--gate-sharpness", str(args.gate_sharpness),
        "--signal-mode", str(args.signal_mode),
        "--output-dir", str(args.output_dir / "simulations"),
        "--raw-output-dir", str(args.raw_output_dir),
    ]
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        raise RuntimeError(f"Simulation failed for {params}")
    if not raw_path.exists():
        raise FileNotFoundError(f"Expected raw output missing: {raw_path}")
    return raw_path


def human_targets(human_df: pd.DataFrame) -> pd.DataFrame:
    valid = human_df.dropna(subset=["distanceCondition"]).copy()
    rows = []
    order = ["closer_to_player1", "equal_to_both", "closer_to_player2"]
    for condition in order:
        sub = valid[valid["distanceCondition"] == condition]
        for metric in ["commitment", "signalingMove"]:
            metric_sub = sub.dropna(subset=[metric])
            rows.append({
                "distanceCondition": condition,
                "metric": metric,
                "human_n": int(metric_sub.shape[0]),
                "human_k": int(metric_sub[metric].sum()) if not metric_sub.empty else 0,
                "human_rate": float(metric_sub[metric].mean()) if not metric_sub.empty else np.nan,
            })
    return pd.DataFrame(rows)


def ordered_conditions(conditions: Iterable[Any]) -> List[str]:
    preferred = ["closer_to_player1", "equal_to_both", "closer_to_player2", "no_new_goal"]
    found = [str(c) for c in conditions if c is not None and not pd.isna(c)]
    unique = set(found)
    ordered = [c for c in preferred if c in unique]
    ordered.extend(sorted(unique.difference(ordered)))
    return ordered


def human_success_targets(raw_trials: List[Dict[str, Any]], conditions: Optional[List[str]] = None) -> pd.DataFrame:
    rows = []
    selected = conditions or ordered_conditions(r.get("distanceCondition") for r in raw_trials)
    for condition in selected:
        trials = [r for r in raw_trials if str(r.get("distanceCondition")) == condition]
        if not trials:
            continue
        successes = sum(1 for r in trials if bool(r.get("collaborationSucceeded")))
        rows.append({
            "distanceCondition": condition,
            "metric": "success",
            "human_n": int(len(trials)),
            "human_k": int(successes),
            "human_rate": float(successes / len(trials)),
        })
    return pd.DataFrame(rows)


def simulated_rates(sim_df: pd.DataFrame) -> Dict[Tuple[str, str], float]:
    rates: Dict[Tuple[str, str], float] = {}
    valid = sim_df.dropna(subset=["distanceCondition"]).copy()
    for condition, sub in valid.groupby("distanceCondition"):
        for metric in ["commitment", "signalingMove"]:
            metric_sub = sub.dropna(subset=[metric])
            rates[(str(condition), metric)] = float(metric_sub[metric].mean()) if not metric_sub.empty else EPS
    return rates


def simulated_success_rates(raw_trials: List[Dict[str, Any]], conditions: Iterable[str]) -> Dict[str, float]:
    rates: Dict[str, float] = {}
    for condition in conditions:
        trials = [r for r in raw_trials if str(r.get("distanceCondition")) == condition]
        if not trials:
            rates[str(condition)] = EPS
            continue
        rates[str(condition)] = sum(1 for r in trials if bool(r.get("collaborationSucceeded"))) / len(trials)
    return rates


def metric_binomial_nll(target: pd.DataFrame, sim_rates: Dict[Tuple[str, str], float]) -> Tuple[float, float]:
    commitment_nll = 0.0
    signaling_nll = 0.0
    for row in target.to_dict(orient="records"):
        metric = row["metric"]
        p = min(1 - EPS, max(EPS, float(sim_rates.get((row["distanceCondition"], metric), EPS))))
        k = float(row["human_k"])
        n = float(row["human_n"])
        value = -(k * math.log(p) + (n - k) * math.log(1 - p))
        if metric == "commitment":
            commitment_nll += value
        elif metric == "signalingMove":
            signaling_nll += value
    return commitment_nll, signaling_nll


def success_binomial_nll(target: pd.DataFrame, success_rates: Dict[str, float]) -> float:
    success_nll = 0.0
    for row in target.to_dict(orient="records"):
        condition = str(row["distanceCondition"])
        p = min(1 - EPS, max(EPS, float(success_rates.get(condition, EPS))))
        k = float(row["human_k"])
        n = float(row["human_n"])
        success_nll += -(k * math.log(p) + (n - k) * math.log(1 - p))
    return success_nll


def measure_row(params: Dict[str, float], raw_trials: List[Dict[str, Any]], sim_df: pd.DataFrame) -> Dict[str, float]:
    row: Dict[str, float] = dict(params)
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows("TwoStageSignalAgent", raw_trials, sim_df, condition)
        metric_values = {item["metric"]: item for item in rows}
        row[f"{prefix}_success_percent"] = metric_values["Success Rate (%)"]["mean_percent"]
        row[f"{prefix}_efficiency_percent"] = metric_values["Coordination Efficiency (%)"]["mean_percent"]
        row[f"{prefix}_commitment_percent"] = metric_values["Commitment (%)"]["mean_percent"]
        row[f"{prefix}_signaling_percent"] = metric_values["Signaling Move (%)"]["mean_percent"]
    return row


def refine_grid(best: Dict[str, float]) -> List[Dict[str, float]]:
    lambdas = [best["lambda"] + delta for delta in [-0.05, -0.025, 0, 0.025, 0.05]]
    taus = [best["tau"] + delta for delta in [-0.05, -0.025, 0, 0.025, 0.05]]
    alphas = [best["alpha"] + delta for delta in [-0.25, -0.125, 0, 0.125, 0.25]]
    etas = [best["eta"] + delta for delta in [-0.25, -0.125, 0, 0.125, 0.25]]
    out = []
    for lmbda, tau, alpha, eta in product(lambdas, taus, alphas, etas):
        if lmbda < 0 or tau <= 0 or tau >= 1 or alpha < 0 or eta < 0:
            continue
        out.append({
            "lambda": round(lmbda, 6),
            "tau": round(tau, 6),
            "alpha": round(alpha, 6),
            "eta": round(eta, 6),
        })
    return out


def plot_best_measures(best_row: Dict[str, float], path: Path) -> None:
    alpha_label = "p" if best_row.get("signal_mode") == "mixture" else "alpha"
    labels = ["Average all 2P3G", "Equal-to-both"]
    panels = [
        ("Success Rate (%)", "success_percent"),
        ("Coordination Efficiency (%)", "efficiency_percent"),
        ("Commitment (%)", "commitment_percent"),
        ("Signaling Move (%)", "signaling_percent"),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(12, 9))
    fig.suptitle(
        f"TwoStageSignalAgent best fit: lambda={best_row['lambda']:g}, tau={best_row['tau']:g}, {alpha_label}={best_row['alpha']:g}, eta={best_row['eta']:g}",
        fontsize=15,
        fontweight="bold",
        y=0.98,
    )
    for ax, (title, suffix) in zip(axes.ravel(), panels):
        values = [best_row[f"average_{suffix}"], best_row[f"equal_{suffix}"]]
        ax.bar(np.arange(2), values, color=["#4f79a8", "#59a14f"], alpha=0.88, edgecolor="white")
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xticks(np.arange(2))
        ax.set_xticklabels(labels, fontsize=9)
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.grid(axis="y", color="#cfcfcf", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_two_param_heatmaps(grid_df: pd.DataFrame, path: Path, scope: str, title: str, row_param: str, col_param: str, row_label: Optional[str] = None, col_label: Optional[str] = None) -> None:
    panels = [
        ("Success Rate (%)", f"{scope}_success_percent"),
        ("Coordination Efficiency (%)", f"{scope}_efficiency_percent"),
        ("Commitment (%)", f"{scope}_commitment_percent"),
        ("Signaling Move (%)", f"{scope}_signaling_percent"),
    ]
    row_values = sorted(grid_df[row_param].dropna().unique())
    col_values = sorted(grid_df[col_param].dropna().unique())
    fig, axes = plt.subplots(2, 2, figsize=(13, 10))
    fig.suptitle(title, fontsize=16, fontweight="bold", y=0.98)

    for ax, (panel_title, col) in zip(axes.ravel(), panels):
        pivot = grid_df.pivot_table(index=row_param, columns=col_param, values=col, aggfunc="mean")
        pivot = pivot.reindex(index=row_values, columns=col_values)
        image = ax.imshow(pivot.to_numpy(dtype=float), aspect="auto", origin="lower", cmap="viridis", vmin=0, vmax=100)
        ax.set_title(panel_title, fontsize=13, fontweight="bold")
        ax.set_xlabel(col_label or col_param)
        ax.set_ylabel(row_label or row_param)
        ax.set_xticks(np.arange(len(col_values)))
        ax.set_xticklabels([f"{v:g}" for v in col_values], rotation=45, ha="right")
        ax.set_yticks(np.arange(len(row_values)))
        ax.set_yticklabels([f"{v:g}" for v in row_values])
        fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04, label="%")

        for y in range(len(row_values)):
            for x in range(len(col_values)):
                value = pivot.iloc[y, x]
                if np.isfinite(value):
                    ax.text(x, y, f"{value:.0f}", ha="center", va="center", fontsize=7, color="white" if value < 55 else "black")

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_lambda_tau_heatmaps(grid_df: pd.DataFrame, path: Path, scope: str, title: str) -> None:
    plot_two_param_heatmaps(grid_df, path, scope, title, "lambda", "tau")


def plot_lambda_alpha_heatmaps(grid_df: pd.DataFrame, path: Path, scope: str, title: str, signal_mode: str) -> None:
    alpha_label = "mixture p" if signal_mode == "mixture" else "alpha"
    plot_two_param_heatmaps(grid_df, path, scope, title, "lambda", "alpha", col_label=alpha_label)


def maybe_plot_lambda_tau_grid(grid_df: pd.DataFrame, output_dir: Path) -> Dict[str, str]:
    if grid_df["lambda"].nunique() < 2 or grid_df["tau"].nunique() < 2:
        return {}
    fixed_alpha = grid_df["alpha"].nunique() == 1
    fixed_eta = grid_df["eta"].nunique() == 1
    suffix = ""
    if fixed_alpha and fixed_eta:
        suffix = f" alpha={grid_df['alpha'].iloc[0]:g}, eta={grid_df['eta'].iloc[0]:g}"

    average_path = output_dir / "two_stage_signal_lambda_tau_average_4measure_heatmaps.png"
    equal_path = output_dir / "two_stage_signal_lambda_tau_equal_to_both_4measure_heatmaps.png"
    plot_lambda_tau_heatmaps(
        grid_df,
        average_path,
        "average",
        f"TwoStageSignalAgent Lambda-Tau Fit: Average All 2P3G{suffix}",
    )
    plot_lambda_tau_heatmaps(
        grid_df,
        equal_path,
        "equal",
        f"TwoStageSignalAgent Lambda-Tau Fit: Equal-to-Both Only{suffix}",
    )
    return {
        "lambda_tau_average_heatmap_png": str(average_path),
        "lambda_tau_equal_to_both_heatmap_png": str(equal_path),
    }


def maybe_plot_lambda_alpha_grid(grid_df: pd.DataFrame, output_dir: Path, signal_mode: str) -> Dict[str, str]:
    if grid_df["lambda"].nunique() < 2 or grid_df["alpha"].nunique() < 2:
        return {}
    fixed_tau = grid_df["tau"].nunique() == 1
    fixed_eta = grid_df["eta"].nunique() == 1
    suffix = ""
    if fixed_tau and fixed_eta:
        suffix = f" tau={grid_df['tau'].iloc[0]:g}, eta={grid_df['eta'].iloc[0]:g}"

    suffix_name = "lambda_p" if signal_mode == "mixture" else "lambda_alpha"
    title_param = "Lambda-P" if signal_mode == "mixture" else "Lambda-Alpha"
    average_path = output_dir / f"two_stage_signal_{suffix_name}_average_4measure_heatmaps.png"
    equal_path = output_dir / f"two_stage_signal_{suffix_name}_equal_to_both_4measure_heatmaps.png"
    plot_lambda_alpha_heatmaps(
        grid_df,
        average_path,
        "average",
        f"TwoStageSignalAgent {title_param} Fit: Average All 2P3G{suffix}",
        signal_mode,
    )
    plot_lambda_alpha_heatmaps(
        grid_df,
        equal_path,
        "equal",
        f"TwoStageSignalAgent {title_param} Fit: Equal-to-Both Only{suffix}",
        signal_mode,
    )
    return {
        "lambda_alpha_average_heatmap_png": str(average_path),
        "lambda_alpha_equal_to_both_heatmap_png": str(equal_path),
    }


def evaluate_params(
    args: argparse.Namespace,
    params: Dict[str, float],
    target: pd.DataFrame,
    success_target: pd.DataFrame,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], pd.DataFrame]:
    raw_path = run_simulation(args, params)
    raw_trials = load_raw(raw_path)
    sim_df = add_measures(long_player_rows(raw_trials, "TwoStageSignalAgent"))
    rates = simulated_rates(sim_df)
    success_conditions = [str(c) for c in success_target["distanceCondition"].tolist()]
    success_rates = simulated_success_rates(raw_trials, success_conditions)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    success_nll = success_binomial_nll(success_target, success_rates)
    total_nll = (
        args.commitment_weight * commitment_nll +
        args.signaling_weight * signaling_nll +
        args.success_weight * success_nll
    )
    row: Dict[str, Any] = {
        **params,
        "signal_mode": args.signal_mode,
        "total_nll": total_nll,
        "commitment_nll": commitment_nll,
        "signaling_nll": signaling_nll,
        "success_nll": success_nll,
        "commitment_weight": args.commitment_weight,
        "signaling_weight": args.signaling_weight,
        "success_weight": args.success_weight,
        "raw_path": str(raw_path),
    }
    for condition in ["closer_to_player1", "equal_to_both", "closer_to_player2"]:
        row[f"{condition}_commitment_rate"] = rates.get((condition, "commitment"), np.nan)
        row[f"{condition}_signaling_rate"] = rates.get((condition, "signalingMove"), np.nan)
    for condition in success_conditions:
        row[f"{condition}_success_rate"] = success_rates.get(condition, np.nan)
    row.update(measure_row(params, raw_trials, sim_df))
    return row, raw_trials, sim_df


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.raw_output_dir.mkdir(parents=True, exist_ok=True)

    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, "Human-Human"))
    target = human_targets(human_df)
    target_path = args.output_dir / "human_trial_level_commitment_signaling_targets.csv"
    target.to_csv(target_path, index=False)
    success_conditions = parse_condition_list(args.success_conditions)
    success_target = human_success_targets(human_raw, success_conditions)
    success_target_path = args.output_dir / "human_trial_level_success_targets.csv"
    success_target.to_csv(success_target_path, index=False)

    base_params = [
        {"lambda": lmbda, "tau": tau, "alpha": alpha, "eta": eta}
        for lmbda, tau, alpha, eta in product(
            parse_float_grid(args.lambdas, DEFAULT_LAMBDAS),
            parse_float_grid(args.taus, DEFAULT_TAUS),
            parse_float_grid(args.alphas, DEFAULT_ALPHAS),
            parse_float_grid(args.etas, DEFAULT_ETAS),
        )
    ]
    if args.max_grid is not None:
        base_params = base_params[:args.max_grid]

    rows: List[Dict[str, Any]] = []
    best_row: Optional[Dict[str, Any]] = None
    best_raw: Optional[List[Dict[str, Any]]] = None
    best_df: Optional[pd.DataFrame] = None
    seen = set()

    def evaluate_many(param_list: Iterable[Dict[str, float]], phase: str) -> None:
        nonlocal best_row, best_raw, best_df
        for idx, params in enumerate(param_list, start=1):
            key = (params["lambda"], params["tau"], params["alpha"], params["eta"])
            if key in seen:
                continue
            seen.add(key)
            print(f"[{phase}] {idx}: lambda={params['lambda']} tau={params['tau']} alpha={params['alpha']} eta={params['eta']}", flush=True)
            row, raw_trials, sim_df = evaluate_params(args, params, target, success_target)
            row["phase"] = phase
            rows.append(row)
            if best_row is None or float(row["total_nll"]) < float(best_row["total_nll"]):
                best_row = row
                best_raw = raw_trials
                best_df = sim_df

    evaluate_many(base_params, "grid")
    if best_row is None:
        raise RuntimeError("No parameter settings evaluated.")
    if not args.skip_refine:
        evaluate_many(refine_grid(best_row), "refine")

    grid_df = pd.DataFrame(rows).sort_values("total_nll")
    grid_path = args.output_dir / "two_stage_signal_4param_grid.csv"
    grid_df.to_csv(grid_path, index=False)
    two_param_plot_outputs = {
        **maybe_plot_lambda_tau_grid(grid_df, args.output_dir),
        **maybe_plot_lambda_alpha_grid(grid_df, args.output_dir, args.signal_mode),
    }

    best_row = grid_df.iloc[0].to_dict()
    best_raw_path = Path(str(best_row["raw_path"]))
    best_raw = load_raw(best_raw_path)
    best_df = add_measures(long_player_rows(best_raw, "TwoStageSignalAgent"))
    best_metrics = pd.DataFrame([measure_row(best_row, best_raw, best_df)])
    best_metrics_path = args.output_dir / "two_stage_signal_4param_best_metrics.csv"
    best_metrics.to_csv(best_metrics_path, index=False)

    plot_best_measures(best_metrics.iloc[0].to_dict(), args.output_dir / "two_stage_signal_best_average_equal_4panel.png")

    human_comparison_df = add_measures(long_player_rows(human_raw, "Human-Human"))
    for condition, suffix, title in [
        (None, "average", "All 2P3G Distance Conditions: TwoStageSignalAgent and Human-Human"),
        ("equal_to_both", "equal_to_both", "Equal-to-Both Only: TwoStageSignalAgent and Human-Human"),
    ]:
        signal_param_label = "p" if args.signal_mode == "mixture" else "alpha"
        comparison = pd.DataFrame(
            comparison_rows(
                f"TwoStageSignalAgent\n(lambda={best_row['lambda']:g}, tau={best_row['tau']:g}, {signal_param_label}={best_row['alpha']:g}, eta={best_row['eta']:g})",
                best_raw,
                best_df,
                condition,
            )
            + comparison_rows("Human-Human", human_raw, human_comparison_df, condition)
        )
        comparison_csv = args.output_dir / f"two_stage_signal_best_vs_human_4panel_{suffix}.csv"
        comparison_png = args.output_dir / f"two_stage_signal_best_vs_human_4panel_{suffix}.png"
        comparison.to_csv(comparison_csv, index=False)
        plot_comparison(comparison, comparison_png, title)

    summary = {
        "model": "TwoStageSignalAgent",
        "signal_mode": args.signal_mode,
        "alpha_interpretation": "mixture probability p(signal)" if args.signal_mode == "mixture" else "logposterior signaling strength",
        "fit_target": "trial-level success plus player-level commitment and signaling by distance condition",
        "human_raw": str(HUMAN_RAW),
        "human_targets_csv": str(target_path),
        "human_success_targets_csv": str(success_target_path),
        "success_conditions": success_target["distanceCondition"].tolist(),
        "sessions": args.sessions,
        "trials_per_session": args.trials,
        "beta": args.beta,
        "gate_sharpness": args.gate_sharpness,
        "commitment_weight": args.commitment_weight,
        "signaling_weight": args.signaling_weight,
        "success_weight": args.success_weight,
        "best_by_total_nll": best_row,
        "outputs": {
            "grid_csv": str(grid_path),
            "best_metrics_csv": str(best_metrics_path),
            "best_average_equal_4panel_png": str(args.output_dir / "two_stage_signal_best_average_equal_4panel.png"),
            "best_vs_human_average_png": str(args.output_dir / "two_stage_signal_best_vs_human_4panel_average.png"),
            "best_vs_human_equal_to_both_png": str(args.output_dir / "two_stage_signal_best_vs_human_4panel_equal_to_both.png"),
            **two_param_plot_outputs,
        },
    }
    summary_path = args.output_dir / "two_stage_signal_4param_fit_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))
    print(json.dumps({"summaryPath": str(summary_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
