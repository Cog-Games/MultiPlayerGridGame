#!/usr/bin/env python3
"""Compare IndividualRL, JointRL, and the no-commitment/no-signaling shared-agency baseline."""

from __future__ import annotations

import html
import json
import os
import subprocess
from itertools import product
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from fit_signal_alpha_beta3 import (  # noqa: E402
    HUMAN_RAW,
    add_measures,
    comparison_rows,
    load_raw,
    long_player_rows,
)
from fit_always_signal_rsa_lambda_alpha import (  # noqa: E402
    COARSE_LAMBDAS,
    human_targets,
    metric_binomial_nll,
    refinement_values,
    simulated_rates,
    weighted_metric_rate,
)
from btom_model_model_comparison import btom_for_player  # noqa: E402


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "joint_rl" / "outputs" / "no_latent_joint_rl_shared_agency_baseline"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "no_latent_joint_rl_shared_agency_baseline"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "no_latent_joint_rl_shared_agency_baseline"
NOTEBOOK_PATH = NOTEBOOK_DIR / "no_latent_joint_rl_shared_agency_baseline_comparison.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_joint_lambda_alpha_baseline_comparison.html"

JOINT_RL_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_joint_rl_vs_joint_rl_2p3g.js"
SHARED_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_always_signal_vs_always_signal_2p3g.js"

SESSIONS = 30
TRIALS = 12
SEED = 42
BETA = 3.0

NO_LATENT_LABEL = "Joint RL"
INDIVIDUAL_LABEL = "Individual RL"
SHARED_BASELINE_LABEL = "Shared agency no commitment no signaling"
SHARED_COMMITMENT_LABEL = "Shared agency commitment no signaling"
CAM_NAME = "Communicative Action Mixture (Legibility Over Alternatives)"
SHARED_FULL_LABEL = f"Shared agency commitment signaling ({CAM_NAME})"
SHARED_RSA_LEGACY_LABEL = "Shared agency commitment signaling (legacy RSA)"
HUMAN_LABEL = "Human-Human"
BTOM_GROUP_ORDER = [INDIVIDUAL_LABEL, NO_LATENT_LABEL, SHARED_BASELINE_LABEL, SHARED_COMMITMENT_LABEL, SHARED_FULL_LABEL, HUMAN_LABEL]
BTOM_PALETTE = {
    NO_LATENT_LABEL: "#4f79a8",
    INDIVIDUAL_LABEL: "#b07aa1",
    SHARED_BASELINE_LABEL: "#59a14f",
    SHARED_COMMITMENT_LABEL: "#9c755f",
    SHARED_FULL_LABEL: "#e15759",
    HUMAN_LABEL: "#f28e2b",
}
PLOT_LABELS = {
    SHARED_BASELINE_LABEL: "Shared agency\n(no commitment,\nno signaling)",
    SHARED_COMMITMENT_LABEL: "Shared agency\n(commitment,\nno signaling)",
    SHARED_FULL_LABEL: "Shared agency\n(commitment,\nsignaling,\ncommunicative\naction mixture)",
}
FIXED_COMMITMENT_LAMBDA = 0.1
ALPHA_SWEEP_VALUES = [round(value * 0.1, 10) for value in range(11)]
JOINT_LAMBDAS = COARSE_LAMBDAS
JOINT_ALPHAS = ALPHA_SWEEP_VALUES
COSTLY_MIXTURE_DIR = MODEL_ROOT / "shared_agency_costly_mixture_rho_sweep"
COSTLY_MIXTURE_BEST_CSV = COSTLY_MIXTURE_DIR / "shared_agency_costly_mixture_best_rho.csv"
COSTLY_MIXTURE_SWEEP_CSV = COSTLY_MIXTURE_DIR / "shared_agency_costly_mixture_rho_sweep.csv"
COSTLY_MIXTURE_SWEEP_PLOT = COSTLY_MIXTURE_DIR / "shared_agency_costly_mixture_rho_sweep.png"
COSTLY_MIXTURE_HTML = MODEL_ROOT / "shared_agency_costly_mixture_rho_sweep.html"


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def plot_label(group: str) -> str:
    return PLOT_LABELS.get(group, group)


def json_ready(record: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in record.items():
        if isinstance(value, np.integer):
            out[key] = int(value)
        elif isinstance(value, np.floating):
            out[key] = float(value)
        elif isinstance(value, Path):
            out[key] = str(value)
        else:
            out[key] = value
    return out


def fmt_path_number(value: float) -> str:
    return f"{value:g}".replace("-", "neg").replace(".", "p")


def shared_simulation_paths(lambda_value: float, alpha: float, output_dir: Path, raw_dir: Path) -> Dict[str, Path]:
    suffix = (
        f"beta_{fmt_path_number(BETA)}_lambda_{fmt_path_number(lambda_value)}_"
        f"alpha_{fmt_path_number(alpha)}_sessions_0_to_{SESSIONS - 1}"
    )
    return {
        "summaryPath": output_dir / f"always_signal_vs_always_signal_2p3g_summary_{suffix}.json",
        "trialsPath": output_dir / f"always_signal_vs_always_signal_2p3g_trials_{suffix}.json",
        "rawTrialsPath": raw_dir / f"always_signal_vs_always_signal_2p3g_raw_trials_{suffix}.json",
    }


def run_json_command(cmd: List[str]) -> Dict[str, Any]:
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    return json.loads(result.stdout)


def compress_raw(raw_path: Path) -> Path:
    zst_path = Path(f"{raw_path}.zst")
    subprocess.run(["zstd", "-q", "-f", "--rm", str(raw_path)], cwd=PROJECT_ROOT, check=True)
    return zst_path


def run_shared_agency_simulation(lambda_value: float, alpha: float, output_dir: Path, raw_dir: Path) -> Dict[str, Any]:
    cmd = [
        "node",
        str(SHARED_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--lambda",
        str(lambda_value),
        "--alpha",
        str(alpha),
        "--beta",
        str(BETA),
        "--score",
        "logposterior",
        "--horizon",
        "1",
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    paths = shared_simulation_paths(lambda_value, alpha, output_dir, raw_dir)
    raw_json = paths["rawTrialsPath"]
    raw_zst = Path(f"{raw_json}.zst")
    if paths["summaryPath"].exists() and paths["trialsPath"].exists():
        if raw_zst.exists():
            return {
                "summaryPath": str(paths["summaryPath"]),
                "trialsPath": str(paths["trialsPath"]),
                "rawTrialsPath": str(raw_zst),
                "command": " ".join(cmd),
            }
        if raw_json.exists():
            return {
                "summaryPath": str(paths["summaryPath"]),
                "trialsPath": str(paths["trialsPath"]),
                "rawTrialsPath": str(compress_raw(raw_json)),
                "command": " ".join(cmd),
            }

    result = run_json_command(cmd)
    result["rawTrialsPath"] = str(compress_raw(Path(result["rawTrialsPath"])))
    result["command"] = " ".join(cmd)
    return result


def run_no_latent_joint_rl() -> Dict[str, Any]:
    output_dir = OUT_DIR / "simulations" / "no_latent_joint_rl"
    raw_dir = RAW_DIR / "no_latent_joint_rl"
    cmd = [
        "node",
        str(JOINT_RL_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--unshaped-joint-rl",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    result = run_json_command(cmd)
    result["rawTrialsPath"] = str(compress_raw(Path(result["rawTrialsPath"])))
    result["command"] = " ".join(cmd)
    return result


def run_individual_rl_legacy() -> Dict[str, Any]:
    output_dir = OUT_DIR / "simulations" / "individual_rl_legacy"
    raw_dir = RAW_DIR / "individual_rl_legacy"
    cmd = [
        "node",
        str(JOINT_RL_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--individual-rl",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    result = run_json_command(cmd)
    result["rawTrialsPath"] = str(compress_raw(Path(result["rawTrialsPath"])))
    result["command"] = " ".join(cmd)
    return result


def run_shared_agency_baseline() -> Dict[str, Any]:
    output_dir = OUT_DIR / "simulations" / "shared_agency_lambda0_alpha0"
    raw_dir = RAW_DIR / "shared_agency_lambda0_alpha0"
    return run_shared_agency_simulation(0.0, 0.0, output_dir, raw_dir)


def shared_measure_row(
    lambda_value: float,
    signal_value: float,
    raw_trials: List[Dict[str, Any]],
    sim_df: pd.DataFrame,
    label: str,
    signal_col: str = "alpha",
) -> Dict[str, float]:
    row: Dict[str, float] = {"lambda": lambda_value, signal_col: signal_value}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows(label, raw_trials, sim_df, condition)
        metric_values = {item["metric"]: item for item in rows}
        row[f"{prefix}_success_percent"] = metric_values["Success Rate (%)"]["mean_percent"]
        row[f"{prefix}_efficiency_percent"] = metric_values["Coordination Efficiency (%)"]["mean_percent"]
        row[f"{prefix}_commitment_percent"] = metric_values["Commitment (%)"]["mean_percent"]
        row[f"{prefix}_signaling_percent"] = metric_values["Signaling Move (%)"]["mean_percent"]
    return row


def evaluate_commitment_lambda(lambda_value: float, target: pd.DataFrame, fit_stage: str) -> Dict[str, Any]:
    output_dir = OUT_DIR / "simulations" / "shared_agency_commitment_no_signaling_lambda_sweep"
    raw_dir = RAW_DIR / "shared_agency_commitment_no_signaling_lambda_sweep"
    result = run_shared_agency_simulation(lambda_value, 0.0, output_dir, raw_dir)
    raw_trials = load_raw(Path(result["rawTrialsPath"]))
    sim_df = add_measures(long_player_rows(raw_trials, SHARED_COMMITMENT_LABEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    row: Dict[str, Any] = {
        "lambda": float(lambda_value),
        "alpha": 0.0,
        "fit_stage": fit_stage,
        "commitment_nll": float(commitment_nll),
        "signaling_nll": float(signaling_nll),
        "binomial_nll": float(commitment_nll + signaling_nll),
        "sim_commitment_human_weighted_average": weighted_metric_rate(target, rates, "commitment"),
        "sim_signaling_human_weighted_average": weighted_metric_rate(target, rates, "signalingMove"),
        "sim_commitment_equal_to_both": rates.get(("equal_to_both", "commitment"), np.nan),
        "sim_signaling_equal_to_both": rates.get(("equal_to_both", "signalingMove"), np.nan),
        "raw_trials": result["rawTrialsPath"],
        "summary_path": result["summaryPath"],
        "trials_path": result["trialsPath"],
        "command": result["command"],
    }
    row.update(shared_measure_row(float(lambda_value), 0.0, raw_trials, sim_df, SHARED_COMMITMENT_LABEL))
    btom_rates = btom_step1_rates_for_raw(raw_trials, SHARED_COMMITMENT_LABEL)
    row["average_btom_step1_percent"] = btom_rates["average"] * 100 if np.isfinite(btom_rates["average"]) else np.nan
    row["equal_btom_step1_percent"] = btom_rates["equal_to_both"] * 100 if np.isfinite(btom_rates["equal_to_both"]) else np.nan
    return row


def evaluate_signaling_alpha(alpha: float, target: pd.DataFrame, fit_stage: str) -> Dict[str, Any]:
    output_dir = OUT_DIR / "simulations" / "shared_agency_commitment_signaling_alpha_sweep"
    raw_dir = RAW_DIR / "shared_agency_commitment_signaling_alpha_sweep"
    result = run_shared_agency_simulation(FIXED_COMMITMENT_LAMBDA, alpha, output_dir, raw_dir)
    raw_trials = load_raw(Path(result["rawTrialsPath"]))
    sim_df = add_measures(long_player_rows(raw_trials, SHARED_RSA_LEGACY_LABEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    row: Dict[str, Any] = {
        "lambda": float(FIXED_COMMITMENT_LAMBDA),
        "alpha": float(alpha),
        "fit_stage": fit_stage,
        "commitment_nll": float(commitment_nll),
        "signaling_nll": float(signaling_nll),
        "binomial_nll": float(commitment_nll + signaling_nll),
        "sim_commitment_human_weighted_average": weighted_metric_rate(target, rates, "commitment"),
        "sim_signaling_human_weighted_average": weighted_metric_rate(target, rates, "signalingMove"),
        "sim_commitment_equal_to_both": rates.get(("equal_to_both", "commitment"), np.nan),
        "sim_signaling_equal_to_both": rates.get(("equal_to_both", "signalingMove"), np.nan),
        "raw_trials": result["rawTrialsPath"],
        "summary_path": result["summaryPath"],
        "trials_path": result["trialsPath"],
        "command": result["command"],
    }
    row.update(shared_measure_row(FIXED_COMMITMENT_LAMBDA, float(alpha), raw_trials, sim_df, SHARED_RSA_LEGACY_LABEL))
    btom_rates = btom_step1_rates_for_raw(raw_trials, SHARED_RSA_LEGACY_LABEL)
    row["average_btom_step1_percent"] = btom_rates["average"] * 100 if np.isfinite(btom_rates["average"]) else np.nan
    row["equal_btom_step1_percent"] = btom_rates["equal_to_both"] * 100 if np.isfinite(btom_rates["equal_to_both"]) else np.nan
    return row


def evaluate_joint_lambda_alpha(lambda_value: float, alpha: float, target: pd.DataFrame, fit_stage: str) -> Dict[str, Any]:
    if abs(float(alpha)) < 1e-12:
        output_dir = OUT_DIR / "simulations" / "shared_agency_commitment_no_signaling_lambda_sweep"
        raw_dir = RAW_DIR / "shared_agency_commitment_no_signaling_lambda_sweep"
    elif abs(float(lambda_value) - FIXED_COMMITMENT_LAMBDA) < 1e-12:
        output_dir = OUT_DIR / "simulations" / "shared_agency_commitment_signaling_alpha_sweep"
        raw_dir = RAW_DIR / "shared_agency_commitment_signaling_alpha_sweep"
    else:
        output_dir = OUT_DIR / "simulations" / "shared_agency_commitment_signaling_joint_lambda_alpha_sweep"
        raw_dir = RAW_DIR / "shared_agency_commitment_signaling_joint_lambda_alpha_sweep"
    result = run_shared_agency_simulation(lambda_value, alpha, output_dir, raw_dir)
    raw_trials = load_raw(Path(result["rawTrialsPath"]))
    sim_df = add_measures(long_player_rows(raw_trials, SHARED_RSA_LEGACY_LABEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    row: Dict[str, Any] = {
        "lambda": float(lambda_value),
        "alpha": float(alpha),
        "fit_stage": fit_stage,
        "commitment_nll": float(commitment_nll),
        "signaling_nll": float(signaling_nll),
        "binomial_nll": float(commitment_nll + signaling_nll),
        "sim_commitment_human_weighted_average": weighted_metric_rate(target, rates, "commitment"),
        "sim_signaling_human_weighted_average": weighted_metric_rate(target, rates, "signalingMove"),
        "sim_commitment_equal_to_both": rates.get(("equal_to_both", "commitment"), np.nan),
        "sim_signaling_equal_to_both": rates.get(("equal_to_both", "signalingMove"), np.nan),
        "raw_trials": result["rawTrialsPath"],
        "summary_path": result["summaryPath"],
        "trials_path": result["trialsPath"],
        "command": result["command"],
    }
    row.update(shared_measure_row(float(lambda_value), float(alpha), raw_trials, sim_df, SHARED_RSA_LEGACY_LABEL))
    btom_rates = btom_step1_rates_for_raw(raw_trials, SHARED_RSA_LEGACY_LABEL)
    row["average_btom_step1_percent"] = btom_rates["average"] * 100 if np.isfinite(btom_rates["average"]) else np.nan
    row["equal_btom_step1_percent"] = btom_rates["equal_to_both"] * 100 if np.isfinite(btom_rates["equal_to_both"]) else np.nan
    return row


def load_costly_mixture_full_model() -> Dict[str, Any]:
    best = pd.read_csv(COSTLY_MIXTURE_BEST_CSV).iloc[0].to_dict()
    raw_trials = load_raw(Path(best["raw_trials"]))
    sim_df = add_measures(long_player_rows(raw_trials, SHARED_FULL_LABEL))
    row: Dict[str, Any] = dict(best)
    row["lambda"] = float(best["lambda"])
    row["rho"] = float(best["rho"])
    row["fit_stage"] = "costly_mixture_trial_best"
    row["fit_objective"] = "costly_mixture_commitment_plus_signaling_nll"
    row.update(
        shared_measure_row(
            float(best["lambda"]),
            float(best["rho"]),
            raw_trials,
            sim_df,
            SHARED_FULL_LABEL,
            signal_col="rho",
        )
    )
    btom_rates = btom_step1_rates_for_raw(raw_trials, SHARED_FULL_LABEL)
    row["average_btom_step1_percent"] = btom_rates["average"] * 100 if np.isfinite(btom_rates["average"]) else np.nan
    row["equal_btom_step1_percent"] = btom_rates["equal_to_both"] * 100 if np.isfinite(btom_rates["equal_to_both"]) else np.nan
    return row


def run_commitment_lambda_sweep() -> tuple[pd.DataFrame, Dict[str, Any]]:
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    target = human_targets(human_df)
    rows: List[Dict[str, Any]] = []
    seen: set[float] = set()
    for lambda_value in COARSE_LAMBDAS:
        key = round(float(lambda_value), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(evaluate_commitment_lambda(float(lambda_value), target, "coarse"))

    coarse_df = pd.DataFrame(rows)
    best_coarse = coarse_df.loc[coarse_df["commitment_nll"].idxmin()].to_dict()
    refine_lambdas = refinement_values(float(best_coarse["lambda"]), COARSE_LAMBDAS, 0.0, max(max(COARSE_LAMBDAS), 1.0))
    for lambda_value in refine_lambdas:
        key = round(float(lambda_value), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(evaluate_commitment_lambda(float(lambda_value), target, "refine"))

    sweep_df = pd.DataFrame(rows).sort_values(["lambda", "fit_stage"]).reset_index(drop=True)
    best_row = sweep_df.loc[sweep_df["commitment_nll"].idxmin()].to_dict()
    return sweep_df, best_row


def run_signaling_alpha_sweep() -> tuple[pd.DataFrame, Dict[str, Any]]:
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    target = human_targets(human_df)
    rows: List[Dict[str, Any]] = []
    seen: set[float] = set()
    for alpha in ALPHA_SWEEP_VALUES:
        key = round(float(alpha), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(evaluate_signaling_alpha(float(alpha), target, "coarse"))

    sweep_df = pd.DataFrame(rows).sort_values(["alpha", "fit_stage"]).reset_index(drop=True)
    best_row = sweep_df.loc[sweep_df["binomial_nll"].idxmin()].to_dict()
    return sweep_df, best_row


def run_joint_lambda_alpha_sweep() -> tuple[pd.DataFrame, Dict[str, Any]]:
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    target = human_targets(human_df)
    rows: List[Dict[str, Any]] = []
    seen: set[tuple[float, float]] = set()
    for lambda_value, alpha in product(JOINT_LAMBDAS, JOINT_ALPHAS):
        key = (round(float(lambda_value), 10), round(float(alpha), 10))
        if key in seen:
            continue
        seen.add(key)
        rows.append(evaluate_joint_lambda_alpha(float(lambda_value), float(alpha), target, "joint_grid"))

    sweep_df = pd.DataFrame(rows).sort_values(["lambda", "alpha"]).reset_index(drop=True)
    best_row = sweep_df.loc[sweep_df["binomial_nll"].idxmin()].to_dict()
    return sweep_df, best_row


def build_metric_table(models: List[Dict[str, Any]]) -> pd.DataFrame:
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    rows: List[Dict[str, Any]] = []
    for scope, condition in [("average", None), ("equal_to_both", "equal_to_both")]:
        for model in models:
            raw_trials = load_raw(Path(model["raw_trials"]))
            df = add_measures(long_player_rows(raw_trials, model["label"]))
            for item in comparison_rows(model["label"], raw_trials, df, condition):
                item["condition_scope"] = scope
                rows.append(item)
        for item in comparison_rows(HUMAN_LABEL, human_raw, human_df, condition):
            item["condition_scope"] = scope
            rows.append(item)
    return pd.DataFrame(rows)


def wide_summary(metric_df: pd.DataFrame) -> pd.DataFrame:
    out = (
        metric_df.pivot_table(
            index=["condition_scope", "group"],
            columns="metric",
            values="mean_percent",
            aggfunc="first",
        )
        .reset_index()
        .rename_axis(None, axis=1)
    )
    out["condition_scope"] = pd.Categorical(out["condition_scope"], categories=["average", "equal_to_both"], ordered=True)
    out["group"] = pd.Categorical(out["group"], categories=BTOM_GROUP_ORDER, ordered=True)
    return out.sort_values(["condition_scope", "group"]).astype({"condition_scope": str, "group": str}).reset_index(drop=True)


def plot_comparison(
    df: pd.DataFrame,
    path: Path,
    title: str,
    btom_step_participant: pd.DataFrame,
    condition: str | None = None,
) -> None:
    metric_order = [
        "Success Rate (%)",
        "Coordination Efficiency (%)",
        "Commitment (%)",
        "Signaling Move (%)",
    ]
    group_order = BTOM_GROUP_ORDER
    colors = [BTOM_PALETTE[group] for group in group_order]
    fig, axes = plt.subplots(3, 2, figsize=(17.2, 16.8))
    flat_axes = axes.ravel()
    fig.suptitle(title, fontsize=18, fontweight="bold", y=0.992)
    for ax, metric in zip(flat_axes[:4], metric_order):
        sub = df[df["metric"] == metric].set_index("group").reindex(group_order).reset_index()
        x = np.arange(len(group_order))
        ax.bar(
            x,
            sub["mean_percent"],
            yerr=sub["ci95_percent"],
            color=colors,
            alpha=0.9,
            capsize=4,
            edgecolor="white",
        )
        ax.set_title(metric, fontsize=13, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(x)
        ax.set_xticklabels([plot_label(group) for group in group_order], rotation=0, ha="center", fontsize=8)
        ax.tick_params(axis="x", pad=8)
        if metric == "Commitment (%)":
            ax.axhline(50, ls="--", lw=1.2, color="#6b7280", alpha=0.65)
        ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)

    plot_btom_trajectory_panel(flat_axes[4], btom_step_participant, condition)

    ax = flat_axes[5]
    metric = "BToM Step 1 (%)"
    sub = df[df["metric"] == metric].set_index("group").reindex(group_order).reset_index()
    x = np.arange(len(group_order))
    ax.bar(
        x,
        sub["mean_percent"],
        yerr=sub["ci95_percent"],
        color=colors,
        alpha=0.9,
        capsize=4,
        edgecolor="white",
    )
    ax.set_title(metric, fontsize=13, fontweight="bold")
    ax.set_ylim(0, 105)
    ax.set_ylabel("(%)")
    ax.set_xticks(x)
    ax.set_xticklabels([plot_label(group) for group in group_order], rotation=0, ha="center", fontsize=8)
    ax.tick_params(axis="x", pad=8)
    ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)

    fig.tight_layout(rect=[0, 0, 1, 0.975])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_commitment_lambda_sweep(sweep_df: pd.DataFrame, best_row: Dict[str, Any], path: Path) -> None:
    df = sweep_df.sort_values("lambda").copy()
    best_lambda = float(best_row["lambda"])
    panels = [
        ("Success Rate (%)", "average_success_percent", "equal_success_percent"),
        ("Coordination Efficiency (%)", "average_efficiency_percent", "equal_efficiency_percent"),
        ("Commitment (%)", "average_commitment_percent", "equal_commitment_percent"),
        ("Signaling Move (%)", "average_signaling_percent", "equal_signaling_percent"),
        ("BToM Step 1 (%)", "average_btom_step1_percent", "equal_btom_step1_percent"),
    ]
    fig, axes = plt.subplots(3, 2, figsize=(15.6, 14.6))
    fig.suptitle("Shared Agency Commitment-Only Lambda Sweep (alpha = 0)", fontsize=17, fontweight="bold", y=0.99)
    flat_axes = axes.ravel()
    for ax, (title, avg_col, equal_col) in zip(flat_axes[:5], panels):
        ax.plot(df["lambda"], df[avg_col], marker="o", linewidth=2.2, color="#4f79a8", label="All distance")
        ax.plot(df["lambda"], df[equal_col], marker="o", linewidth=2.2, linestyle="--", color="#59a14f", label="Equal-to-both")
        ax.axvline(best_lambda, color="#111827", linestyle=":", linewidth=1.5, label=f"Best lambda = {best_lambda:g}")
        if title == "Commitment (%)":
            ax.axhline(50, ls="--", lw=1.1, color="#6b7280", alpha=0.6)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel("(%)")
        ax.set_ylim(0, 105)
        ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    flat_axes[0].legend(frameon=True, fontsize=9)
    flat_axes[5].axis("off")
    fig.tight_layout(rect=[0, 0, 1, 0.965])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_signaling_alpha_sweep(sweep_df: pd.DataFrame, best_row: Dict[str, Any], path: Path) -> None:
    df = sweep_df.sort_values("alpha").copy()
    best_alpha = float(best_row["alpha"])
    panels = [
        ("Success Rate (%)", "average_success_percent", "equal_success_percent"),
        ("Coordination Efficiency (%)", "average_efficiency_percent", "equal_efficiency_percent"),
        ("Commitment (%)", "average_commitment_percent", "equal_commitment_percent"),
        ("Signaling Move (%)", "average_signaling_percent", "equal_signaling_percent"),
        ("BToM Step 1 (%)", "average_btom_step1_percent", "equal_btom_step1_percent"),
    ]
    fig, axes = plt.subplots(3, 2, figsize=(15.6, 14.6))
    fig.suptitle(
        f"Shared Agency Commitment + Signaling Alpha Sweep (lambda = {FIXED_COMMITMENT_LAMBDA:g})",
        fontsize=17,
        fontweight="bold",
        y=0.99,
    )
    flat_axes = axes.ravel()
    for ax, (title, avg_col, equal_col) in zip(flat_axes[:5], panels):
        ax.plot(df["alpha"], df[avg_col], marker="o", linewidth=2.2, color="#4f79a8", label="All distance")
        ax.plot(df["alpha"], df[equal_col], marker="o", linewidth=2.2, linestyle="--", color="#59a14f", label="Equal-to-both")
        ax.axvline(best_alpha, color="#111827", linestyle=":", linewidth=1.5, label=f"Best alpha = {best_alpha:g}")
        if title == "Commitment (%)":
            ax.axhline(50, ls="--", lw=1.1, color="#6b7280", alpha=0.6)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xlabel("alpha")
        ax.set_ylabel("(%)")
        ax.set_ylim(0, 105)
        ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    flat_axes[0].legend(frameon=True, fontsize=9)
    flat_axes[5].axis("off")
    fig.tight_layout(rect=[0, 0, 1, 0.965])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_joint_lambda_alpha_heatmap(sweep_df: pd.DataFrame, best_row: Dict[str, Any], path: Path) -> None:
    df = sweep_df.copy()
    lambda_values = sorted(df["lambda"].dropna().unique())
    alpha_values = sorted(df["alpha"].dropna().unique())
    best_lambda = float(best_row["lambda"])
    best_alpha = float(best_row["alpha"])
    best_x = min(range(len(lambda_values)), key=lambda idx: abs(float(lambda_values[idx]) - best_lambda))
    best_y = min(range(len(alpha_values)), key=lambda idx: abs(float(alpha_values[idx]) - best_alpha))
    panels = [
        ("Commitment NLL", "commitment_nll", "magma_r", None),
        ("Signaling NLL", "signaling_nll", "magma_r", None),
        ("Commitment + Signaling NLL", "binomial_nll", "magma_r", None),
        ("BToM Step 1 (%)", "average_btom_step1_percent", "viridis", (0, 100)),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(14.4, 10.8))
    fig.suptitle("Shared Agency Joint Lambda x Alpha Search", fontsize=17, fontweight="bold", y=0.99)
    for ax, (title, col, cmap, value_range) in zip(axes.ravel(), panels):
        pivot = df.pivot_table(index="alpha", columns="lambda", values=col, aggfunc="mean")
        pivot = pivot.reindex(index=alpha_values, columns=lambda_values)
        kwargs = {}
        if value_range is not None:
            kwargs["vmin"], kwargs["vmax"] = value_range
        image = ax.imshow(pivot.to_numpy(dtype=float), origin="lower", aspect="auto", cmap=cmap, **kwargs)
        ax.scatter([best_x], [best_y], marker="*", s=190, color="white", edgecolor="black", linewidth=1.1, zorder=5)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel("alpha")
        ax.set_xticks(np.arange(len(lambda_values)))
        ax.set_xticklabels([f"{value:g}" for value in lambda_values], rotation=45, ha="right")
        ax.set_yticks(np.arange(len(alpha_values)))
        ax.set_yticklabels([f"{value:g}" for value in alpha_values])
        fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
        for y in range(len(alpha_values)):
            for x in range(len(lambda_values)):
                value = pivot.iloc[y, x]
                if np.isfinite(value):
                    text = f"{value:.0f}" if "NLL" in title else f"{value:.0f}%"
                    ax.text(x, y, text, ha="center", va="center", fontsize=6.5, color="white")
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def participant_id(trial: Dict[str, Any], group: str, player_index: int) -> str:
    field = f"participantId_player{player_index + 1}"
    if trial.get(field) is not None:
        return str(trial[field])
    if player_index == 0 and trial.get("participantId") is not None:
        return str(trial["participantId"])
    return f"{group}_session_{trial.get('sessionIndex', 'na')}_trial_{trial.get('trialIndex', 'na')}_p{player_index + 1}"


def build_btom_table(models: List[Dict[str, Any]]) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    datasets = [(model["label"], load_raw(Path(model["raw_trials"]))) for model in models]
    datasets.append((HUMAN_LABEL, load_raw(HUMAN_RAW)))
    for group, raw_trials in datasets:
        for trial in raw_trials:
            if not trial.get("newGoalPresented"):
                continue
            for player_index in (0, 1):
                posteriors = btom_for_player(trial, player_index)
                if posteriors is None:
                    continue
                rows.append(
                    {
                        "group": group,
                        "participantId": participant_id(trial, group, player_index),
                        "sessionIndex": trial.get("sessionIndex"),
                        "trialIndex": trial.get("trialIndex"),
                        "playerIndex": player_index + 1,
                        "distanceCondition": trial.get("distanceCondition"),
                        "nSteps": len(posteriors),
                        "posteriors": posteriors,
                    }
                )
    return pd.DataFrame(rows)


def build_btom_step_tables(btom_df: pd.DataFrame, max_step: int = 5) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    rows: List[Dict[str, Any]] = []
    for _, row in btom_df.iterrows():
        for step, posterior in enumerate(row["posteriors"][: max_step + 1]):
            rows.append(
                {
                    "group": row["group"],
                    "participantId": row["participantId"],
                    "sessionIndex": row["sessionIndex"],
                    "trialIndex": row["trialIndex"],
                    "playerIndex": row["playerIndex"],
                    "distanceCondition": row["distanceCondition"],
                    "stepFromNewGoal": step,
                    "posterior": posterior,
                }
            )
    step_long = pd.DataFrame(rows)
    step_participant = (
        step_long.groupby(["participantId", "group", "distanceCondition", "stepFromNewGoal"], observed=False)["posterior"]
        .mean()
        .reset_index()
    )
    mean_participant = (
        step_participant.groupby(["participantId", "group"], observed=False)["posterior"]
        .mean()
        .reset_index()
    )
    return step_long, step_participant, mean_participant


def mean_ci(values: np.ndarray) -> Dict[str, float]:
    clean = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if clean.size == 0:
        return {"mean": np.nan, "ci95": np.nan, "n": 0}
    mean = float(np.mean(clean))
    if clean.size <= 1:
        return {"mean": mean, "ci95": 0.0, "n": int(clean.size)}
    return {"mean": mean, "ci95": float(1.96 * np.std(clean, ddof=1) / np.sqrt(clean.size)), "n": int(clean.size)}


def btom_step1_rates_for_raw(raw_trials: List[Dict[str, Any]], group: str) -> Dict[str, float]:
    rows: List[Dict[str, Any]] = []
    for trial in raw_trials:
        if not trial.get("newGoalPresented"):
            continue
        for player_index in (0, 1):
            posteriors = btom_for_player(trial, player_index)
            if posteriors is None or len(posteriors) <= 1:
                continue
            rows.append(
                {
                    "participantId": participant_id(trial, group, player_index),
                    "distanceCondition": trial.get("distanceCondition"),
                    "posterior": float(posteriors[1]),
                }
            )
    if not rows:
        return {"average": np.nan, "equal_to_both": np.nan}
    df = pd.DataFrame(rows)
    grouped = df.groupby(["participantId"], observed=False)["posterior"].mean()
    average = float(grouped.mean()) if not grouped.empty else np.nan
    equal_df = df[df["distanceCondition"] == "equal_to_both"]
    equal_grouped = equal_df.groupby(["participantId"], observed=False)["posterior"].mean()
    equal = float(equal_grouped.mean()) if not equal_grouped.empty else np.nan
    return {"average": average, "equal_to_both": equal}


def btom_step1_metric_rows(step_participant: pd.DataFrame, condition: str | None, condition_scope: str) -> List[Dict[str, Any]]:
    sub = step_participant[step_participant["stepFromNewGoal"] == 1].copy()
    if condition:
        sub = sub[sub["distanceCondition"] == condition]
    rows: List[Dict[str, Any]] = []
    for group in BTOM_GROUP_ORDER:
        values = (
            sub[sub["group"] == group]
            .groupby(["participantId", "group"], observed=False)["posterior"]
            .mean()
            .to_numpy(dtype=float)
        )
        stats = mean_ci(values)
        rows.append(
            {
                "group": group,
                "metric": "BToM Step 1 (%)",
                "mean_percent": stats["mean"] * 100,
                "ci95_percent": stats["ci95"] * 100,
                "n": stats["n"],
                "condition_scope": condition_scope,
            }
        )
    return rows


def summarize_btom_step1(step_participant: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for scope, condition in [("average", None), ("equal_to_both", "equal_to_both")]:
        sub = step_participant[step_participant["stepFromNewGoal"] == 1].copy()
        if condition:
            sub = sub[sub["distanceCondition"] == condition]
        for group in BTOM_GROUP_ORDER:
            values = (
                sub[sub["group"] == group]
                .groupby(["participantId", "group"], observed=False)["posterior"]
                .mean()
                .to_numpy(dtype=float)
            )
            stats = mean_ci(values)
            rows.append(
                {
                    "condition_scope": scope,
                    "group": group,
                    "stepFromNewGoal": 1,
                    "mean": stats["mean"],
                    "ci95": stats["ci95"],
                    "count": stats["n"],
                }
            )
    return pd.DataFrame(rows)


def add_chance_line(ax) -> None:
    ax.axhline(0.5, ls="--", lw=1.2, color="#6b7280", alpha=0.55)


def plot_btom_trajectory_panel(ax, step_participant: pd.DataFrame, condition: str | None = None) -> None:
    sub_all = step_participant.copy()
    if condition:
        sub_all = sub_all[sub_all["distanceCondition"] == condition]
    for group in BTOM_GROUP_ORDER:
        sub = sub_all[sub_all["group"] == group]
        if sub.empty:
            continue
        grouped = sub.groupby("stepFromNewGoal")["posterior"]
        x = sorted(grouped.groups.keys())
        means = [float(grouped.mean().loc[step]) * 100 for step in x]
        sems = [float(grouped.sem().fillna(0).loc[step]) * 100 for step in x]
        cis = [1.96 * value for value in sems]
        ax.plot(x, means, marker="o", linewidth=2.2, color=BTOM_PALETTE[group], label=plot_label(group))
        ax.fill_between(x, np.asarray(means) - np.asarray(cis), np.asarray(means) + np.asarray(cis), color=BTOM_PALETTE[group], alpha=0.16)
    ax.axhline(50, ls="--", lw=1.2, color="#6b7280", alpha=0.55)
    ax.set_title("BToM Trajectory (%)", fontsize=13, fontweight="bold")
    ax.set_xlabel("Steps from new-goal presentation")
    ax.set_ylabel("(%)")
    ax.set_xlim(-0.1, 5.1)
    ax.set_ylim(40, 102)
    ax.set_xticks(range(6))
    ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
    ax.grid(axis="x", visible=False)
    ax.legend(frameon=True, fontsize=8, loc="lower right")
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)


def plot_btom_trajectory(step_participant: pd.DataFrame, path: Path, max_step: int = 5) -> None:
    fig, ax = plt.subplots(figsize=(11.5, 7))
    for group in BTOM_GROUP_ORDER:
        sub = step_participant[step_participant["group"] == group]
        if sub.empty:
            continue
        grouped = sub.groupby("stepFromNewGoal")["posterior"]
        x = sorted(grouped.groups.keys())
        means = [float(grouped.mean().loc[step]) for step in x]
        sems = [float(grouped.sem().fillna(0).loc[step]) for step in x]
        cis = [1.96 * value for value in sems]
        ax.plot(x, means, marker="o", linewidth=2.4, color=BTOM_PALETTE[group], label=plot_label(group))
        ax.fill_between(x, np.asarray(means) - np.asarray(cis), np.asarray(means) + np.asarray(cis), color=BTOM_PALETTE[group], alpha=0.16)
    add_chance_line(ax)
    ax.set_title("BToM Legibility Over First 5 Steps After New Goal", fontsize=15, fontweight="bold")
    ax.set_xlabel("Steps from new-goal presentation")
    ax.set_ylabel("BToM posterior P(final reached goal)")
    ax.set_xlim(-0.1, max_step + 0.1)
    ax.set_ylim(0.4, 1.02)
    ax.set_xticks(range(max_step + 1))
    ax.legend(frameon=True, fontsize=10)
    ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_btom_mean(mean_participant: pd.DataFrame, path: Path) -> None:
    rows = []
    for group in BTOM_GROUP_ORDER:
        vals = mean_participant[mean_participant["group"] == group]["posterior"].to_numpy(dtype=float)
        vals = vals[np.isfinite(vals)]
        mean = float(np.mean(vals)) if vals.size else np.nan
        ci = float(1.96 * np.std(vals, ddof=1) / np.sqrt(vals.size)) if vals.size > 1 else 0.0
        rows.append({"group": group, "mean": mean, "ci": ci, "n": int(vals.size)})
    summary = pd.DataFrame(rows)
    fig, ax = plt.subplots(figsize=(11, 6.5))
    x = np.arange(summary.shape[0])
    ax.bar(
        x,
        summary["mean"],
        yerr=summary["ci"],
        color=[BTOM_PALETTE[group] for group in summary["group"]],
        alpha=0.9,
        capsize=4,
        edgecolor="white",
    )
    add_chance_line(ax)
    ax.set_title("Mean BToM Posterior Across First 5 Steps", fontsize=15, fontweight="bold")
    ax.set_ylabel("Mean BToM posterior P(final reached goal)")
    ax.set_ylim(0.4, 1.0)
    ax.set_xticks(x)
    ax.set_xticklabels([plot_label(group) for group in summary["group"]], rotation=0, ha="center", fontsize=9)
    ax.tick_params(axis="x", pad=8)
    for idx, value in enumerate(summary["mean"]):
        if np.isfinite(value):
            ax.text(idx, value + 0.018, f"{value:.3f}", ha="center", va="bottom", fontsize=9)
    ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_btom_step1(step_participant: pd.DataFrame, path: Path) -> pd.DataFrame:
    step1 = step_participant[step_participant["stepFromNewGoal"] == 1].copy()
    rows = []
    for group in BTOM_GROUP_ORDER:
        vals = step1[step1["group"] == group]["posterior"].to_numpy(dtype=float)
        vals = vals[np.isfinite(vals)]
        mean = float(np.mean(vals)) if vals.size else np.nan
        ci = float(1.96 * np.std(vals, ddof=1) / np.sqrt(vals.size)) if vals.size > 1 else 0.0
        rows.append({"group": group, "stepFromNewGoal": 1, "mean": mean, "ci95": ci, "count": int(vals.size)})
    summary = pd.DataFrame(rows)

    fig, ax = plt.subplots(figsize=(11, 6.5))
    x = np.arange(summary.shape[0])
    ax.bar(
        x,
        summary["mean"],
        yerr=summary["ci95"],
        color=[BTOM_PALETTE[group] for group in summary["group"]],
        alpha=0.9,
        capsize=4,
        edgecolor="white",
    )
    add_chance_line(ax)
    ax.set_title("BToM Posterior at Step 1 After New Goal", fontsize=15, fontweight="bold")
    ax.set_ylabel("BToM posterior P(final reached goal)")
    ax.set_ylim(0.4, 1.0)
    ax.set_xticks(x)
    ax.set_xticklabels([plot_label(group) for group in summary["group"]], rotation=0, ha="center", fontsize=9)
    ax.tick_params(axis="x", pad=8)
    for idx, value in enumerate(summary["mean"]):
        if np.isfinite(value):
            ax.text(idx, value + 0.018, f"{value:.3f}", ha="center", va="bottom", fontsize=9)
    ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)
    return summary


def html_table(df: pd.DataFrame, columns: List[str]) -> str:
    header = "".join(f"<th>{html.escape(col)}</th>" for col in columns)
    rows = []
    for record in df[columns].to_dict(orient="records"):
        cells = []
        for col in columns:
            value = record[col]
            if isinstance(value, float):
                text = f"{value:.2f}"
                cls = "num"
            else:
                text = str(value)
                cls = ""
            cells.append(f"<td class=\"{cls}\">{html.escape(text)}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(rows)}</tbody></table>"


def write_html(
    summary_df: pd.DataFrame,
    raw_sources_df: pd.DataFrame,
    lambda_sweep_best_df: pd.DataFrame,
    alpha_sweep_best_df: pd.DataFrame,
    joint_sweep_best_df: pd.DataFrame,
    costly_mixture_best_df: pd.DataFrame,
    outputs: Dict[str, Path],
) -> None:
    summary_columns = [
        "condition_scope",
        "group",
        "Success Rate (%)",
        "Coordination Efficiency (%)",
        "Commitment (%)",
        "Signaling Move (%)",
        "BToM Step 1 (%)",
    ]
    raw_columns = ["label", "raw_trials", "summary_path", "trials_path"]
    sweep_columns = [
        "lambda",
        "commitment_nll",
        "signaling_nll",
        "binomial_nll",
        "average_commitment_percent",
        "average_signaling_percent",
        "equal_commitment_percent",
        "equal_signaling_percent",
    ]
    costly_columns = [
        "lambda",
        "rho",
        "commitment_nll",
        "signaling_nll",
        "binomial_nll",
        "average_commitment_percent",
        "average_signaling_percent",
        "equal_commitment_percent",
        "equal_signaling_percent",
    ]
    HTML_PATH.write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shared-Agency {CAM_NAME} Baseline Comparison</title>
  <style>
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fb; }}
    header {{ padding: 36px 48px 24px; background: #ffffff; border-bottom: 1px solid #d9e2ec; }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 28px 24px 56px; }}
    h1 {{ margin: 0 0 10px; font-size: 30px; }}
    h2 {{ margin: 34px 0 14px; font-size: 21px; }}
    p {{ line-height: 1.55; }}
    .note {{ color: #52606d; max-width: 980px; }}
    .links a {{ display: inline-block; margin: 0 12px 10px 0; color: #2458a6; text-decoration: none; }}
    .panel {{ background: #ffffff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 18px; margin: 18px 0; }}
    img {{ width: 100%; height: auto; display: block; border: 1px solid #d9e2ec; border-radius: 6px; background: white; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 13px; background: white; }}
    th, td {{ border: 1px solid #d9e2ec; padding: 8px 10px; text-align: left; vertical-align: top; }}
    th {{ background: #eef3f8; }}
    td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
    code {{ background: #eef3f8; padding: 2px 5px; border-radius: 4px; }}
  </style>
</head>
<body>
<header>
  <h1>Shared-Agency {CAM_NAME} Baseline Comparison</h1>
  <p class="note">Compares Individual RL, Joint RL, and <code>sampleJointGoalAndRSASignal_fromStart</code> baselines with Human-Human. The full shared-agency row uses {CAM_NAME} with lambda = 0.2 and rho = 0.5.</p>
  <div class="links">
    <a href="{rel(outputs['metric_long_csv'])}">metric long CSV</a>
    <a href="{rel(outputs['summary_csv'])}">summary CSV</a>
    <a href="{rel(outputs['lambda_sweep_csv'])}">commitment lambda sweep CSV</a>
    <a href="{rel(outputs['costly_mixture_best_csv'])}">communicative action mixture best rho CSV</a>
    <a href="{rel(outputs['costly_mixture_sweep_csv'])}">communicative action mixture rho sweep CSV</a>
    <a href="{rel(outputs['alpha_sweep_csv'])}">legacy RSA alpha sweep CSV</a>
    <a href="{rel(outputs['joint_sweep_csv'])}">legacy RSA lambda x alpha CSV</a>
    <a href="{rel(outputs['raw_sources_csv'])}">raw sources CSV</a>
    <a href="{rel(outputs['notebook'])}">notebook</a>
    <a href="shared_agency_step_level_model_comparison.html">step-level model comparison</a>
    <a href="shared_agency_signal_window_model_comparison.html">signal-window fit report</a>
    <a href="shared_agency_uncertainty_gated_rho_fit.html">uncertainty-gated rho fit</a>
    <a href="shared_agency_information_gain_fit.html">information-gain fit</a>
    <a href="shared_agency_tiebreak_signal_fit.html">tie-break signaling fit</a>
    <a href="shared_agency_costly_legibility_fit.html">costly legibility fit</a>
    <a href="shared_agency_log_odds_legibility_fit.html">log-odds legibility fit</a>
    <a href="shared_agency_log_odds_eta_sweep.html">log-odds full eta sweep</a>
    <a href="shared_agency_costly_mixture_rho_sweep.html">communicative action mixture rho sweep</a>
    <a href="sampleJointGoalAndRSASignal_fromStart_ablation_comparison.html">shared-agency ablation report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Model Definitions</h2>
    <p><strong>Individual RL</strong>: no partner-position input; each player uses the existing IndividualRL policy over current goals with goal feature reward +30, step cost -1 per own action step, gamma 0.9, transition noise 0, softmax beta 3, and argmax action selection with random tie-breaking.</p>
    <p><strong>Joint RL</strong>: no inferred goal, no posterior, no lambda, no alpha; actions are sampled from the unshaped JointRL marginal policy over all current goals.</p>
    <p><strong>Shared agency no commitment no signaling</strong>: samples a latent goal from unshaped value weights, then acts through the same unshaped JointRL base policy for that sampled goal. With lambda=0 and rho=0, posterior and signaling mixture terms are disabled.</p>
    <p><strong>Shared agency commitment no signaling</strong>: fixes the signaling parameter at 0, sweeps lambda, and uses the best lambda selected by commitment-only binomial NLL.</p>
    <p><strong>Shared agency commitment signaling ({CAM_NAME})</strong>: fixes lambda=0.2 and uses the rho selected by commitment + signaling binomial NLL. The signaling policy mixes the base JointRL policy with a communicative policy that increases sampled-goal legibility over alternatives.</p>
  </section>

  <section class="panel">
    <h2>All Distance Conditions</h2>
    <a href="{rel(outputs['average_plot'])}"><img src="{rel(outputs['average_plot'])}" alt="All-distance comparison"></a>
  </section>

  <section class="panel">
    <h2>Equal-to-Both</h2>
    <a href="{rel(outputs['equal_plot'])}"><img src="{rel(outputs['equal_plot'])}" alt="Equal-to-both comparison"></a>
  </section>

  <section class="panel">
    <h2>Commitment-Only Lambda Sweep</h2>
    <p class="note">The commitment/no-signaling shared-agency row fixes alpha=0 and selects lambda by commitment-only binomial NLL. The sweep plot shows the five report metrics as lambda changes.</p>
    <a href="{rel(outputs['lambda_sweep_plot'])}"><img src="{rel(outputs['lambda_sweep_plot'])}" alt="Shared-agency commitment-only lambda sweep"></a>
    <h2>Best Lambda</h2>
    {html_table(lambda_sweep_best_df, sweep_columns)}
  </section>

  <section class="panel">
    <h2>Full Shared-Agency {CAM_NAME} Rho Sweep</h2>
    <p class="note">The full shared-agency row in the main comparison uses this {CAM_NAME} fit. Lambda is fixed at 0.2 and rho is selected by commitment NLL + signaling NLL across the human distance-condition targets.</p>
    <a href="{rel(outputs['costly_mixture_sweep_plot'])}"><img src="{rel(outputs['costly_mixture_sweep_plot'])}" alt="Shared-agency communicative action mixture rho sweep"></a>
    <h2>Best {CAM_NAME} Setting</h2>
    {html_table(costly_mixture_best_df, costly_columns)}
  </section>

  <section class="panel">
    <h2>Legacy RSA Diagnostics</h2>
    <p class="note">These alpha and lambda x alpha searches are retained for comparison only. They are no longer used as the full shared-agency row in this report.</p>
    <h2>Legacy RSA Alpha Sweep</h2>
    <a href="{rel(outputs['alpha_sweep_plot'])}"><img src="{rel(outputs['alpha_sweep_plot'])}" alt="Legacy shared-agency RSA alpha sweep"></a>
    <h2>Best Legacy RSA Alpha</h2>
    {html_table(alpha_sweep_best_df, sweep_columns)}
    <h2>Legacy RSA Joint Lambda x Alpha Search</h2>
    <a href="{rel(outputs['joint_sweep_heatmap'])}"><img src="{rel(outputs['joint_sweep_heatmap'])}" alt="Legacy shared-agency joint lambda alpha search heatmap"></a>
    <h2>Best Legacy RSA Joint Pair</h2>
    {html_table(joint_sweep_best_df, sweep_columns)}
  </section>

  <section class="panel">
    <h2>BToM Legibility</h2>
    <p class="note">BToM posterior is computed over the old shared goal versus the new goal from each post-new-goal trajectory, scored as the posterior probability of the player's final reached goal. Step 0 is the new-goal presentation moment.</p>
    <a href="{rel(outputs['btom_trajectory_plot'])}"><img src="{rel(outputs['btom_trajectory_plot'])}" alt="BToM posterior over first five steps after new-goal presentation"></a>
    <p class="links">
      <a href="{rel(outputs['btom_summary_csv'])}">BToM summary CSV</a>
      <a href="{rel(outputs['btom_step1_csv'])}">BToM step 1 CSV</a>
      <a href="{rel(outputs['btom_step_csv'])}">BToM step CSV</a>
      <a href="{rel(outputs['btom_mean_csv'])}">BToM mean CSV</a>
    </p>
  </section>

  <section class="panel">
    <h2>Summary Table</h2>
    {html_table(summary_df, summary_columns)}
  </section>

  <section class="panel">
    <h2>Raw Sources</h2>
    {html_table(raw_sources_df, raw_columns)}
  </section>
</main>
</body>
</html>
""",
        encoding="utf-8",
    )


def write_notebook() -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    nb = {
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    f"# Shared-Agency {CAM_NAME} Baseline Comparison\n",
                    "\n",
                    f"Compares Individual RL, Joint RL, shared agency no commitment/no signaling, shared agency commitment/no signaling, full shared agency with {CAM_NAME}, and Human-Human.\n",
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
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "summary = pd.read_csv(OUT / 'no_latent_joint_rl_shared_agency_summary.csv')\n",
                    "metrics = pd.read_csv(OUT / 'no_latent_joint_rl_shared_agency_metric_long.csv')\n",
                    "raw_sources = pd.read_csv(OUT / 'no_latent_joint_rl_shared_agency_raw_sources.csv')\n",
                    "lambda_sweep = pd.read_csv(OUT / 'shared_agency_commitment_no_signaling_lambda_sweep.csv')\n",
                    "lambda_sweep_best = pd.read_csv(OUT / 'shared_agency_commitment_no_signaling_best_lambda.csv')\n",
                    "alpha_sweep = pd.read_csv(OUT / 'shared_agency_commitment_signaling_alpha_sweep.csv')\n",
                    "alpha_sweep_best = pd.read_csv(OUT / 'shared_agency_commitment_signaling_best_alpha.csv')\n",
                    "joint_sweep = pd.read_csv(OUT / 'shared_agency_commitment_signaling_joint_lambda_alpha_sweep.csv')\n",
                    "joint_sweep_best = pd.read_csv(OUT / 'shared_agency_commitment_signaling_best_joint_lambda_alpha.csv')\n",
                    "costly_dir = OUT.parents[2] / 'shared_agency_costly_mixture_rho_sweep'\n",
                    "costly_sweep = pd.read_csv(costly_dir / 'shared_agency_costly_mixture_rho_sweep.csv')\n",
                    "costly_best = pd.read_csv(costly_dir / 'shared_agency_costly_mixture_best_rho.csv')\n",
                    "btom_summary = pd.read_csv(OUT / 'no_latent_joint_rl_shared_agency_btom_summary.csv')\n",
                    "btom_step1 = pd.read_csv(OUT / 'no_latent_joint_rl_shared_agency_btom_step1_summary.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Raw Sources\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["raw_sources\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Summary Metrics\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["summary.round(2)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Long Metric Table\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["metrics.round(2)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Commitment-Only Lambda Sweep\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["lambda_sweep.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Best Commitment-Only Lambda\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["lambda_sweep_best.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": [f"## Full Shared-Agency {CAM_NAME} Rho Sweep\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["costly_sweep.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": [f"## Best {CAM_NAME} Setting\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["costly_best.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Legacy RSA Alpha Sweep\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["alpha_sweep.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Best Legacy RSA Alpha\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["alpha_sweep_best.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Legacy RSA Joint Lambda x Alpha Search\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["joint_sweep.sort_values('binomial_nll').head(10).round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Best Legacy RSA Joint Lambda x Alpha Pair\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["joint_sweep_best.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## BToM First 5-Step Summary\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["btom_summary.round(4)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## BToM Step 1 Summary\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["btom_step1.round(4)\n"]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    no_latent = run_no_latent_joint_rl()
    individual = run_individual_rl_legacy()
    shared = run_shared_agency_baseline()
    lambda_sweep_df, lambda_sweep_best = run_commitment_lambda_sweep()
    lambda_sweep_best_df = pd.DataFrame([lambda_sweep_best])
    alpha_sweep_df, alpha_sweep_best = run_signaling_alpha_sweep()
    alpha_sweep_best_df = pd.DataFrame([alpha_sweep_best])
    joint_sweep_df, joint_sweep_best = run_joint_lambda_alpha_sweep()
    joint_sweep_best_df = pd.DataFrame([joint_sweep_best])
    costly_mixture_best = load_costly_mixture_full_model()
    costly_mixture_best_df = pd.DataFrame([costly_mixture_best])
    models = [
        {"key": "individual_rl_legacy", "label": INDIVIDUAL_LABEL, "raw_trials": individual["rawTrialsPath"]},
        {"key": "no_latent_joint_rl", "label": NO_LATENT_LABEL, "raw_trials": no_latent["rawTrialsPath"]},
        {"key": "shared_agency_lambda0_alpha0", "label": SHARED_BASELINE_LABEL, "raw_trials": shared["rawTrialsPath"]},
        {
            "key": "shared_agency_commitment_no_signaling",
            "label": SHARED_COMMITMENT_LABEL,
            "raw_trials": lambda_sweep_best["raw_trials"],
            "lambda": float(lambda_sweep_best["lambda"]),
            "alpha": 0.0,
            "fit_objective": "commitment_nll",
        },
        {
            "key": "shared_agency_costly_mixture",
            "label": SHARED_FULL_LABEL,
            "raw_trials": costly_mixture_best["raw_trials"],
            "lambda": float(costly_mixture_best["lambda"]),
            "rho": float(costly_mixture_best["rho"]),
            "fit_objective": "costly_mixture_commitment_plus_signaling_nll",
        },
    ]
    raw_sources_df = pd.DataFrame(
        [
            {
                "key": "individual_rl_legacy",
                "label": INDIVIDUAL_LABEL,
                "raw_trials": individual["rawTrialsPath"],
                "summary_path": individual["summaryPath"],
                "trials_path": individual["trialsPath"],
                "command": individual["command"],
            },
            {
                "key": "no_latent_joint_rl",
                "label": NO_LATENT_LABEL,
                "raw_trials": no_latent["rawTrialsPath"],
                "summary_path": no_latent["summaryPath"],
                "trials_path": no_latent["trialsPath"],
                "command": no_latent["command"],
            },
            {
                "key": "shared_agency_lambda0_alpha0",
                "label": SHARED_BASELINE_LABEL,
                "raw_trials": shared["rawTrialsPath"],
                "summary_path": shared["summaryPath"],
                "trials_path": shared["trialsPath"],
                "command": shared["command"],
            },
            {
                "key": "shared_agency_commitment_no_signaling",
                "label": SHARED_COMMITMENT_LABEL,
                "raw_trials": lambda_sweep_best["raw_trials"],
                "summary_path": lambda_sweep_best["summary_path"],
                "trials_path": lambda_sweep_best["trials_path"],
                "command": lambda_sweep_best["command"],
                "lambda": float(lambda_sweep_best["lambda"]),
                "alpha": 0.0,
                "fit_objective": "commitment_nll",
            },
            {
                "key": "shared_agency_costly_mixture",
                "label": SHARED_FULL_LABEL,
                "raw_trials": costly_mixture_best["raw_trials"],
                "summary_path": costly_mixture_best["summary_path"],
                "trials_path": costly_mixture_best["trials_path"],
                "command": costly_mixture_best["command"],
                "lambda": float(costly_mixture_best["lambda"]),
                "rho": float(costly_mixture_best["rho"]),
                "fit_objective": "costly_mixture_commitment_plus_signaling_nll",
            },
        ]
    )

    btom_df = build_btom_table(models)
    btom_step_long, btom_step_participant, btom_mean_participant = build_btom_step_tables(btom_df, max_step=5)
    btom_summary = (
        btom_mean_participant.groupby("group", observed=False)["posterior"]
        .agg(["mean", "std", "count"])
        .reset_index()
    )
    btom_step1_summary = summarize_btom_step1(btom_step_participant)

    metric_df = build_metric_table(models)
    btom_metric_df = pd.DataFrame(
        btom_step1_metric_rows(btom_step_participant, None, "average")
        + btom_step1_metric_rows(btom_step_participant, "equal_to_both", "equal_to_both")
    )
    metric_df = pd.concat([metric_df, btom_metric_df], ignore_index=True)
    summary_df = wide_summary(metric_df)
    average_df = metric_df[metric_df["condition_scope"] == "average"].copy()
    equal_df = metric_df[metric_df["condition_scope"] == "equal_to_both"].copy()

    outputs = {
        "summary_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_summary.csv",
        "metric_long_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_metric_long.csv",
        "raw_sources_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_raw_sources.csv",
        "summary_json": OUT_DIR / "no_latent_joint_rl_shared_agency_summary.json",
        "lambda_sweep_csv": OUT_DIR / "shared_agency_commitment_no_signaling_lambda_sweep.csv",
        "lambda_sweep_best_csv": OUT_DIR / "shared_agency_commitment_no_signaling_best_lambda.csv",
        "lambda_sweep_plot": OUT_DIR / "shared_agency_commitment_no_signaling_lambda_sweep.png",
        "alpha_sweep_csv": OUT_DIR / "shared_agency_commitment_signaling_alpha_sweep.csv",
        "alpha_sweep_best_csv": OUT_DIR / "shared_agency_commitment_signaling_best_alpha.csv",
        "alpha_sweep_plot": OUT_DIR / "shared_agency_commitment_signaling_alpha_sweep.png",
        "joint_sweep_csv": OUT_DIR / "shared_agency_commitment_signaling_joint_lambda_alpha_sweep.csv",
        "joint_sweep_best_csv": OUT_DIR / "shared_agency_commitment_signaling_best_joint_lambda_alpha.csv",
        "joint_sweep_heatmap": OUT_DIR / "shared_agency_commitment_signaling_joint_lambda_alpha_heatmap.png",
        "costly_mixture_best_csv": COSTLY_MIXTURE_BEST_CSV,
        "costly_mixture_sweep_csv": COSTLY_MIXTURE_SWEEP_CSV,
        "costly_mixture_sweep_plot": COSTLY_MIXTURE_SWEEP_PLOT,
        "costly_mixture_report": COSTLY_MIXTURE_HTML,
        "average_plot": OUT_DIR / "no_latent_joint_rl_shared_agency_average_6panel.png",
        "equal_plot": OUT_DIR / "no_latent_joint_rl_shared_agency_equal_to_both_6panel.png",
        "btom_trajectory_plot": OUT_DIR / "no_latent_joint_rl_shared_agency_btom_first5_trajectory.png",
        "btom_trajectory_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_btom_player_trajectories.csv",
        "btom_step_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_btom_first5_step_per_participant.csv",
        "btom_mean_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_btom_first5_mean_per_participant.csv",
        "btom_summary_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_btom_summary.csv",
        "btom_step1_csv": OUT_DIR / "no_latent_joint_rl_shared_agency_btom_step1_summary.csv",
        "notebook": NOTEBOOK_PATH,
        "html": HTML_PATH,
    }
    summary_df.to_csv(outputs["summary_csv"], index=False)
    metric_df.to_csv(outputs["metric_long_csv"], index=False)
    raw_sources_df.to_csv(outputs["raw_sources_csv"], index=False)
    lambda_sweep_df.to_csv(outputs["lambda_sweep_csv"], index=False)
    lambda_sweep_best_df.to_csv(outputs["lambda_sweep_best_csv"], index=False)
    alpha_sweep_df.to_csv(outputs["alpha_sweep_csv"], index=False)
    alpha_sweep_best_df.to_csv(outputs["alpha_sweep_best_csv"], index=False)
    joint_sweep_df.to_csv(outputs["joint_sweep_csv"], index=False)
    joint_sweep_best_df.to_csv(outputs["joint_sweep_best_csv"], index=False)
    btom_csv = btom_df.copy()
    btom_csv["posteriors"] = btom_csv["posteriors"].apply(json.dumps)
    btom_csv.to_csv(outputs["btom_trajectory_csv"], index=False)
    btom_step_participant.to_csv(outputs["btom_step_csv"], index=False)
    btom_mean_participant.to_csv(outputs["btom_mean_csv"], index=False)
    btom_summary.to_csv(outputs["btom_summary_csv"], index=False)
    btom_step1_summary.to_csv(outputs["btom_step1_csv"], index=False)
    plot_comparison(average_df, outputs["average_plot"], "All Distance Conditions", btom_step_participant)
    plot_comparison(equal_df, outputs["equal_plot"], "Equal-to-Both", btom_step_participant, "equal_to_both")
    plot_commitment_lambda_sweep(lambda_sweep_df, lambda_sweep_best, outputs["lambda_sweep_plot"])
    plot_signaling_alpha_sweep(alpha_sweep_df, alpha_sweep_best, outputs["alpha_sweep_plot"])
    plot_joint_lambda_alpha_heatmap(joint_sweep_df, joint_sweep_best, outputs["joint_sweep_heatmap"])
    plot_btom_trajectory(btom_step_participant, outputs["btom_trajectory_plot"], max_step=5)
    write_notebook()
    write_html(
        summary_df,
        raw_sources_df,
        lambda_sweep_best_df,
        alpha_sweep_best_df,
        joint_sweep_best_df,
        costly_mixture_best_df,
        outputs,
    )

    outputs["summary_json"].write_text(
        json.dumps(
            {
                "sessions": SESSIONS,
                "trials_per_session": TRIALS,
                "seed": SEED,
                "models": models,
                "commitment_lambda_sweep": {
                    "fit_objective": "commitment_nll",
                    "alpha": 0.0,
                    "coarse_lambdas": COARSE_LAMBDAS,
                    "evaluated_settings": int(lambda_sweep_df.shape[0]),
                    "best": json_ready(lambda_sweep_best),
                },
                "signaling_alpha_sweep": {
                    "fit_objective": "legacy_rsa_commitment_plus_signaling_nll",
                    "lambda": FIXED_COMMITMENT_LAMBDA,
                    "alpha_values": ALPHA_SWEEP_VALUES,
                    "evaluated_settings": int(alpha_sweep_df.shape[0]),
                    "best": json_ready(alpha_sweep_best),
                },
                "joint_lambda_alpha_sweep": {
                    "fit_objective": "legacy_rsa_joint_commitment_plus_signaling_nll",
                    "lambdas": JOINT_LAMBDAS,
                    "alphas": JOINT_ALPHAS,
                    "evaluated_settings": int(joint_sweep_df.shape[0]),
                    "best": json_ready(joint_sweep_best),
                },
                "costly_mixture_full_model": {
                    "fit_objective": "costly_mixture_commitment_plus_signaling_nll",
                    "best": json_ready(costly_mixture_best),
                    "sweep_csv": str(COSTLY_MIXTURE_SWEEP_CSV),
                    "report": str(COSTLY_MIXTURE_HTML),
                },
                "outputs": {key: str(value) for key, value in outputs.items()},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"html": str(HTML_PATH), "outputs": {key: str(value) for key, value in outputs.items()}}, indent=2))


if __name__ == "__main__":
    main()
