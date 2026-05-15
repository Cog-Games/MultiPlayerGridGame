#!/usr/bin/env python3
"""Generate standardized model-model report plots and notebooks.

Outputs:
- one sweep/heatmap plot per model with the best fit highlighted
- one model-vs-human 4-panel bar plot per model with 95% CI error bars
- lightweight notebooks pointing to the standardized assets
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = ROOT / "dataAnalysis" / "model_model"
ASSET_DIR = MODEL_ROOT / "report_assets"
ASSET_DIR.mkdir(parents=True, exist_ok=True)

PANELS = [
    ("Success Rate (%)", "success"),
    ("Coordination Efficiency (%)", "efficiency"),
    ("Commitment (%)", "commitment"),
    ("Signaling Move (%)", "signaling"),
]

COMPACT_LABELS = {
    "sampleJointGoal_afterNewGoal": "sampleAfterNew",
    "sampleJointGoalAndSignal_afterNewGoal": "sample+signal",
    "sampleJointGoal_fromStart": "sampleFromStart",
    "sampleJointGoalAndSignal_fromStart": "sample+signalStart",
    "sampleJointGoalAndRSASignal_fromStart": "sample+RSAStart\n(shared-agency)",
    "samplePosteriorOnlyGoalAndSignal_fromStart": "posteriorOnly+signal",
    "TwoStageSignalAgent_sigmoidThreshold": "sigmoidThreshold",
    "Human-Human": "Human",
}

COMPACT_COLORS = {
    "sampleJointGoal_afterNewGoal": "#4e79a7",
    "sampleJointGoalAndSignal_afterNewGoal": "#59a14f",
    "sampleJointGoal_fromStart": "#f28e2b",
    "sampleJointGoalAndSignal_fromStart": "#b07aa1",
    "sampleJointGoalAndRSASignal_fromStart": "#edc948",
    "samplePosteriorOnlyGoalAndSignal_fromStart": "#76b7b2",
    "TwoStageSignalAgent_sigmoidThreshold": "#e15759",
    "Human-Human": "#777777",
}

MODELS = {
    "sampleJointGoal_afterNewGoal": {
        "short": "sampleAfterNew",
        "impl": "CommittedAgent",
        "param_label": "lambda",
        "best_param": 0.125,
        "agent_label": "sampleJointGoal_afterNewGoal\n(lambda=0.125)",
        "raw": ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "committed_agent" / "committed_vs_committed_simulation" / "committed_vs_committed_2p3g_raw_trials_sessions_0_to_29.json",
        "sweep": MODEL_ROOT / "committed_agent" / "outputs" / "committed_agent_trial_commitment_fit_beta3" / "committed_beta3_lambda_0_to_0p5_average_equal_4measures.csv",
        "notebook": MODEL_ROOT / "committed_agent" / "notebooks" / "committed_agent_trial_commitment_fit_beta3" / "committed_beta3_lambda_fit_and_equal_to_both_comparison.ipynb",
    },
    "sampleJointGoalAndSignal_afterNewGoal": {
        "short": "sample+signal",
        "impl": "SignalAgent",
        "param_label": "p",
        "best_param": 0.375,
        "agent_label": "sampleJointGoalAndSignal_afterNewGoal\n(lambda=0.125, p=0.375)",
        "raw": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_mixture_p_fit_beta3" / "simulations" / "signal_vs_signal_2p3g_raw_trials_beta_3_lambda_0p125_alpha_0p375_sessions_0_to_29.json",
        "sweep": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_mixture_p_fit_beta3" / "signal_alpha_beta3_average_equal_4measures.csv",
        "notebook": MODEL_ROOT / "signal_agent" / "notebooks" / "signal_agent_mixture_p_fit_beta3" / "SignalAgent_mixture_results.ipynb",
    },
    "sampleJointGoal_fromStart": {
        "short": "sampleFromStart",
        "impl": "AlwaysCommittedAgent",
        "param_label": "lambda",
        "best_param": 0.15,
        "agent_label": "sampleJointGoal_fromStart\n(lambda=0.150)",
        "raw": MODEL_ROOT / "always_committed_agent" / "outputs" / "always_committed_vs_always_committed_simulation" / "always_committed_vs_always_committed_2p3g_raw_trials_beta_3_lambda_0p15_sessions_0_to_29.json",
        "sweep": MODEL_ROOT / "always_committed_agent" / "outputs" / "always_committed_vs_always_committed_simulation" / "always_committed_lambda_sweep_average_equal_summary.csv",
        "notebook": MODEL_ROOT / "always_committed_agent" / "notebooks" / "always_committed_equal_to_both_trial_commitment_fit" / "always_committed_equal_to_both_lambda_fit.ipynb",
    },
    "sampleJointGoalAndSignal_fromStart": {
        "short": "sample+signalStart",
        "impl": "AlwaysSignalAgent",
        "param_label": "lambda/p",
        "best_param": (0.0, 0.0),
        "agent_label": "sampleJointGoalAndSignal_fromStart\n(lambda=?, p=?)",
        "raw": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_lambda_p_fit" / "missing_until_fit.json",
        "sweep": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_lambda_p_fit" / "always_signal_lambda_p_grid.csv",
        "summary": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_lambda_p_fit" / "always_signal_lambda_p_fit_summary.json",
        "notebook": MODEL_ROOT / "signal_agent" / "notebooks" / "signal_agent_from_start_lambda_p_fit" / "AlwaysSignalAgent_from_start_lambda_p_results.ipynb",
    },
    "sampleJointGoalAndRSASignal_fromStart": {
        "short": "sample+RSAStart\n(shared-agency)",
        "impl": "AlwaysSignalAgent",
        "param_label": "lambda/alpha",
        "best_param": (0.0, 0.0),
        "agent_label": "sampleJointGoalAndRSASignal_fromStart (shared-agency model)\n(lambda=?, alpha=?)",
        "raw": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_rsa_lambda_alpha_fit" / "missing_until_fit.json",
        "sweep": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_rsa_lambda_alpha_fit" / "always_signal_rsa_lambda_alpha_grid.csv",
        "summary": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_rsa_lambda_alpha_fit" / "always_signal_rsa_lambda_alpha_fit_summary.json",
        "notebook": MODEL_ROOT / "signal_agent" / "notebooks" / "signal_agent_from_start_rsa_lambda_alpha_fit" / "AlwaysSignalAgent_from_start_rsa_lambda_alpha_results.ipynb",
    },
    "samplePosteriorOnlyGoalAndSignal_fromStart": {
        "short": "posteriorOnly+signal",
        "impl": "PosteriorOnlySignalAgent",
        "param_label": "lambda/p",
        "best_param": (0.0, 0.0),
        "agent_label": "samplePosteriorOnlyGoalAndSignal_fromStart\n(lambda=?, p=?)",
        "raw": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_posterior_only_lambda_p_fit" / "missing_until_fit.json",
        "sweep": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_posterior_only_lambda_p_fit" / "posterior_only_signal_lambda_p_grid.csv",
        "summary": MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_posterior_only_lambda_p_fit" / "posterior_only_signal_lambda_p_fit_summary.json",
        "notebook": MODEL_ROOT / "signal_agent" / "notebooks" / "signal_agent_posterior_only_lambda_p_fit" / "PosteriorOnlySignalAgent_from_start_lambda_p_results.ipynb",
    },
    "TwoStageSignalAgent_sigmoidThreshold": {
        "short": "sigmoidThreshold",
        "impl": "TwoStageSignalAgent",
        "param_label": "lambda/p",
        "best_param": (0.10, 0.00),
        "agent_label": "TwoStageSignalAgent_sigmoidThreshold\n(lambda=0.10, p=0.00)",
        "raw": ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations" / "two_stage_signal_agent" / "mixture_lambda_p_tau2over3_eta0" / "two_stage_signal_vs_two_stage_signal_2p3g_raw_trials_signal_mixture_beta_3_lambda_0p1_tau_0p6666667_alpha_0_eta_0_sessions_0_to_29.json",
        "sweep": MODEL_ROOT / "two_stage_signal_agent" / "outputs" / "two_stage_mixture_lambda_p_success_fit_tau2over3_eta0" / "two_stage_signal_4param_grid.csv",
        "notebook": MODEL_ROOT / "two_stage_signal_agent" / "notebooks" / "two_stage_mixture_lambda_p_success_fit_tau2over3_eta0" / "two_stage_signal_mixture_success_fit_results.ipynb",
    },
}

HUMAN_RAW = ROOT / "dataAnalysis" / "raw_data" / "human" / "equal_to_both_agent_human_comparison" / "human_human_pure_unique_2p3g_raw_trials.json"


def resolve_raw_path(path: Path) -> Path:
    path = Path(path)
    if path.exists():
        return path
    zst_path = Path(f"{path}.zst")
    if zst_path.exists():
        return zst_path
    raise FileNotFoundError(path)


def load_json(path: Path) -> Any:
    raw_path = resolve_raw_path(Path(path))
    if raw_path.suffix == ".zst":
        result = subprocess.run(
            ["zstd", "-dc", str(raw_path)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)
    return json.loads(raw_path.read_text(encoding="utf-8"))


def apply_dynamic_model_config() -> None:
    for model, cfg in MODELS.items():
        summary_path = cfg.get("summary")
        if not summary_path or not Path(summary_path).exists():
            continue
        summary = load_json(Path(summary_path))
        best = summary.get("best_by_binomial_nll", {})
        best_lambda = float(best.get("lambda", 0.0))
        second_key = "alpha" if cfg.get("param_label") == "lambda/alpha" else "p_signal"
        best_second = float(best.get(second_key, best.get("alpha", 0.0)))
        raw_path = Path(summary.get("best_raw_trials") or best.get("raw_trials") or cfg["raw"])
        cfg["best_param"] = (best_lambda, best_second)
        second_label = "alpha" if cfg.get("param_label") == "lambda/alpha" else "p"
        display_model = f"{model} (shared-agency model)" if model == "sampleJointGoalAndRSASignal_fromStart" else model
        cfg["agent_label"] = f"{display_model}\n(lambda={best_lambda:g}, {second_label}={best_second:g})"
        cfg["raw"] = raw_path if raw_path.is_absolute() else ROOT / raw_path


def parse_traj(value: Any) -> List[List[int]]:
    if isinstance(value, list):
        return [list(p) for p in value if isinstance(p, (list, tuple)) and len(p) == 2]
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return []
    try:
        parsed = json.loads(str(value))
    except Exception:
        return []
    return [list(p) for p in parsed if isinstance(p, (list, tuple)) and len(p) == 2]


def remove_duplicates(traj: List[List[int]]) -> List[List[int]]:
    out: List[List[int]] = []
    for point in traj:
        if not out or point != out[-1]:
            out.append(point)
    return out


def manhattan(a: Sequence[int], b: Sequence[int]) -> int:
    return abs(int(a[0]) - int(b[0])) + abs(int(a[1]) - int(b[1]))


def safe_int(value: Any) -> Optional[int]:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    try:
        return int(value)
    except Exception:
        return None


def mean_ci(values: Iterable[float]) -> Dict[str, float]:
    clean = np.asarray([float(v) for v in values if pd.notna(v)], dtype=float)
    if clean.size == 0:
        return {"mean": np.nan, "ci95": np.nan, "n": 0}
    ci = 0.0 if clean.size <= 1 else float(1.96 * np.std(clean, ddof=1) / np.sqrt(clean.size))
    return {"mean": float(np.mean(clean)), "ci95": ci, "n": int(clean.size)}


def efficiency(row: Dict[str, Any], player: int) -> float:
    traj = remove_duplicates(parse_traj(row.get(f"player{player}Trajectory")))
    if not traj:
        return np.nan
    idx = safe_int(row.get("newGoalPresentedTime"))
    if idx is None:
        return np.nan
    idx = max(0, min(idx, len(traj) - 1))
    actual_steps = len(traj) - 1 - idx
    if actual_steps <= 0:
        return np.nan
    goals = [row.get("target1"), row.get("target2"), row.get("newGoalPosition")]
    goals = [g for g in goals if isinstance(g, list) and len(g) == 2]
    if not goals:
        return np.nan
    optimal_steps = min(manhattan(traj[idx], g) for g in goals)
    return max(0.0, min(100.0, (1.0 - (actual_steps - optimal_steps) / actual_steps) * 100.0))


def commitment(row: Dict[str, Any], player: int) -> float:
    final_goal = safe_int(row.get(f"player{player}FinalReachedGoal"))
    shared_goal = safe_int(row.get("firstDetectedSharedGoal"))
    if final_goal is None or shared_goal is None:
        return np.nan
    return 1.0 if final_goal == shared_goal else 0.0


def signaling(row: Dict[str, Any], player: int) -> float:
    if not bool(row.get("newGoalPresented", False)):
        return np.nan
    traj = remove_duplicates(parse_traj(row.get(f"player{player}Trajectory")))
    t = safe_int(row.get("newGoalPresentedTime"))
    if t is None or t < 0 or t >= len(traj) - 1:
        return np.nan
    target1 = row.get("target1")
    target2 = row.get("target2")
    new_goal = row.get("newGoalPosition")
    if not all(isinstance(g, list) and len(g) == 2 for g in [target1, target2, new_goal]):
        return np.nan
    shared_idx = safe_int(row.get("firstDetectedSharedGoal"))
    final_idx = safe_int(row.get(f"player{player}FinalReachedGoal"))
    if shared_idx is None or final_idx is None or shared_idx not in (0, 1):
        return np.nan
    shared_goal = target1 if shared_idx == 0 else target2
    other_old = target2 if shared_idx == 0 else target1
    if final_idx == 2:
        reached = new_goal
        other = shared_goal
    elif final_idx == shared_idx:
        reached = shared_goal
        other = new_goal
    elif final_idx in (0, 1) and final_idx != shared_idx:
        reached = other_old
        other = new_goal
    else:
        return np.nan
    moved_closer_to_reached = manhattan(traj[t + 1], reached) < manhattan(traj[t], reached)
    moved_closer_to_other = manhattan(traj[t + 1], other) < manhattan(traj[t], other)
    return 1.0 if moved_closer_to_reached and not moved_closer_to_other else 0.0


def long_rows(raw: List[Dict[str, Any]]) -> pd.DataFrame:
    rows = []
    for row in raw:
        for player in (1, 2):
            rows.append({
                **row,
                "participantId": row.get(f"participantId_player{player}") or row.get("participantId") or f"row_{len(rows)}_p{player}",
                "humanPlayerIndex": player - 1,
                "efficiency": efficiency(row, player),
                "commitment": commitment(row, player),
                "signaling": signaling(row, player),
            })
    return pd.DataFrame(rows)


def metric_summary(raw_path: Path, agent_label: str, human: bool = False) -> pd.DataFrame:
    raw = load_json(raw_path)
    base = pd.DataFrame(raw)
    long = long_rows(raw)
    rows: List[Dict[str, Any]] = []
    for scope, condition, label in [
        ("average", None, "Average all 2P3G"),
        ("equal_to_both", "equal_to_both", "Equal-to-Both only"),
    ]:
        trial_sub = base if condition is None else base[base["distanceCondition"] == condition]
        long_sub = long if condition is None else long[long["distanceCondition"] == condition]

        if human:
            success_vals = trial_sub["collaborationSucceeded"].astype(float).to_numpy()
        else:
            success_vals = (
                trial_sub.groupby("sessionIndex")["collaborationSucceeded"].mean().to_numpy(dtype=float)
                if "sessionIndex" in trial_sub.columns
                else trial_sub["collaborationSucceeded"].astype(float).to_numpy()
            )
        success = mean_ci(success_vals)

        eff_sub = long_sub[(long_sub["newGoalPresented"] == True) & (long_sub["collaborationSucceeded"] == True)]
        if human:
            eff_vals = eff_sub["efficiency"].dropna().to_numpy(dtype=float)
        else:
            eff_vals = eff_sub.dropna(subset=["efficiency"]).groupby("participantId")["efficiency"].mean().to_numpy(dtype=float)
        eff = mean_ci(eff_vals)

        comm_sub = long_sub[long_sub["newGoalPresented"] == True].dropna(subset=["commitment"])
        if human:
            comm_vals = comm_sub["commitment"].to_numpy(dtype=float)
        else:
            # Match the existing AlwaysCommitted report: commitment CI is session-level.
            comm_vals = comm_sub.groupby("sessionIndex")["commitment"].mean().to_numpy(dtype=float)
        comm = mean_ci(comm_vals)

        sig_sub = long_sub[long_sub["newGoalPresented"] == True].dropna(subset=["signaling"])
        if human:
            sig_vals = sig_sub["signaling"].to_numpy(dtype=float)
        else:
            sig_vals = sig_sub.groupby("participantId")["signaling"].mean().to_numpy(dtype=float)
        sig = mean_ci(sig_vals)

        for metric_name, result, scale in [
            ("Success Rate (%)", success, 100.0),
            ("Coordination Efficiency (%)", eff, 1.0),
            ("Commitment (%)", comm, 100.0),
            ("Signaling Move (%)", sig, 100.0),
        ]:
            rows.append({
                "condition_scope": scope,
                "condition_label": label,
                "group": "Human-Human" if human else agent_label,
                "metric": metric_name,
                "mean_percent": result["mean"] * scale,
                "ci95_percent": result["ci95"] * scale,
                "n": result["n"],
            })
    return pd.DataFrame(rows)


def plot_side_by_side(df: pd.DataFrame, title: str, output_path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(14, 9.5))
    fig.suptitle(title, fontsize=18, fontweight="bold", y=0.98)
    condition_order = ["average", "equal_to_both"]
    condition_labels = ["Average\nAll 2P3G", "Equal-to-Both\nOnly"]
    agent_group = [g for g in df["group"].drop_duplicates() if g != "Human-Human"][0]
    group_order = [agent_group, "Human-Human"]
    colors = {agent_group: "#4f79a8", "Human-Human": "#59a14f"}
    x = np.arange(len(condition_order))
    width = 0.36

    for ax, (metric_name, _key) in zip(axes.ravel(), PANELS):
        metric_df = df[df["metric"] == metric_name].set_index(["condition_scope", "group"])
        for offset_idx, group in enumerate(group_order):
            means = [metric_df.loc[(scope, group), "mean_percent"] for scope in condition_order]
            errors = [metric_df.loc[(scope, group), "ci95_percent"] for scope in condition_order]
            positions = x + (offset_idx - 0.5) * width
            bars = ax.bar(
                positions,
                means,
                width=width,
                label=group,
                color=colors[group],
                alpha=0.88,
                yerr=errors,
                capsize=4,
                edgecolor="white",
                linewidth=0.8,
            )
            for bar, value in zip(bars, means):
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    max(2, value * 0.08),
                    f"{value:.1f}",
                    ha="center",
                    va="bottom",
                    color="white",
                    fontsize=10,
                    fontweight="bold",
                )
        ax.set_title(metric_name, fontsize=14, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(x)
        ax.set_xticklabels(condition_labels, fontsize=11)
        ax.grid(axis="y", color="#d0d0d0", linewidth=1.1)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    handles, labels = axes.ravel()[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, 0.935), ncol=2, frameon=False)
    fig.tight_layout(rect=[0, 0, 1, 0.90])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def read_sweep_wide(path: Path, param_col: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    if "condition_scope" not in df.columns:
        return df
    rows: Dict[float, Dict[str, float]] = {}
    for item in df.to_dict(orient="records"):
        value = float(item[param_col])
        rows.setdefault(value, {param_col: value})
        prefix = "average" if item["condition_scope"] == "average" else "equal"
        for metric, key in [("success", "success_percent"), ("efficiency", "efficiency_percent"), ("commitment", "commitment_percent"), ("signaling", "signaling_percent")]:
            rows[value][f"{prefix}_{metric}_percent"] = float(item[key])
    return pd.DataFrame(rows.values()).sort_values(param_col)


def plot_sweep_4measure(df: pd.DataFrame, param_col: str, best: float, title: str, output_path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(14, 9.5), sharex=True)
    fig.suptitle(title, fontsize=18, fontweight="bold", y=0.98)
    panels = [
        ("Success Rate (%)", "average_success_percent", "equal_success_percent"),
        ("Coordination Efficiency (%)", "average_efficiency_percent", "equal_efficiency_percent"),
        ("Commitment (%)", "average_commitment_percent", "equal_commitment_percent"),
        ("Signaling Move (%)", "average_signaling_percent", "equal_signaling_percent"),
    ]
    for ax, (metric_name, avg_col, eq_col) in zip(axes.ravel(), panels):
        ax.plot(df[param_col], df[avg_col], marker="o", linewidth=2.2, markersize=4, color="#4f79a8", label="Average all 2P3G")
        ax.plot(df[param_col], df[eq_col], marker="o", linewidth=2.2, markersize=4, color="#d9822b", label="Equal-to-both only")
        ax.axvline(best, color="#d62728", linestyle="--", linewidth=1.8)
        nearest = df.iloc[(df[param_col] - best).abs().argsort()[:1]].iloc[0]
        for col, color in [(avg_col, "#4f79a8"), (eq_col, "#d9822b")]:
            ax.scatter([nearest[param_col]], [nearest[col]], marker="*", s=190, color="#d62728", edgecolor="white", linewidth=0.7, zorder=5)
        ax.set_title(metric_name, fontsize=14, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("%")
        ax.set_xlabel(param_col)
        ax.grid(axis="y", color="#e0e0e0")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
        ax.legend(frameon=True, fontsize=9)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_lambda_p_heatmaps(df: pd.DataFrame, best_lambda: float, best_p: float, output_path: Path, title: str) -> None:
    metrics = [
        ("Success Rate (%)", "average_success_percent"),
        ("Coordination Efficiency (%)", "average_efficiency_percent"),
        ("Commitment (%)", "average_commitment_percent"),
        ("Signaling Move (%)", "average_signaling_percent"),
    ]
    p_col = "p_signal" if "p_signal" in df.columns else "alpha"
    y_label = "mixture p" if p_col == "p_signal" else "RSA alpha"
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle(title, fontsize=18, fontweight="bold", y=0.98)
    for ax, (title, col) in zip(axes.ravel(), metrics):
        pivot = df.pivot_table(index=p_col, columns="lambda", values=col, aggfunc="first").sort_index()
        im = ax.imshow(pivot.values, origin="lower", aspect="auto", cmap="viridis", vmin=0, vmax=100)
        ax.set_xticks(np.arange(len(pivot.columns)))
        ax.set_xticklabels([f"{v:g}" for v in pivot.columns], rotation=45, ha="right", fontsize=8)
        ax.set_yticks(np.arange(len(pivot.index)))
        ax.set_yticklabels([f"{v:g}" for v in pivot.index], fontsize=8)
        if len(pivot.columns) and len(pivot.index):
            x = min(range(len(pivot.columns)), key=lambda i: abs(float(pivot.columns[i]) - float(best_lambda)))
            y = min(range(len(pivot.index)), key=lambda i: abs(float(pivot.index[i]) - float(best_p)))
            ax.scatter([x], [y], marker="*", s=240, color="red", edgecolor="white", linewidth=0.8)
        ax.set_title(title, fontsize=14, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel(y_label)
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_compact_summary(df: pd.DataFrame, output_path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(17, 10.5), sharey=True)
    fig.suptitle("Compact Model-Model Visual Summary", fontsize=20, fontweight="bold", y=0.98)

    group_order = [
        "sampleJointGoal_afterNewGoal",
        "sampleJointGoalAndSignal_afterNewGoal",
        "sampleJointGoal_fromStart",
        "sampleJointGoalAndSignal_fromStart",
        "sampleJointGoalAndRSASignal_fromStart",
        "samplePosteriorOnlyGoalAndSignal_fromStart",
        "TwoStageSignalAgent_sigmoidThreshold",
        "Human-Human",
    ]
    scope_order = ["average", "equal_to_both"]
    scope_labels = {"average": "Average all 2P3G", "equal_to_both": "Equal-to-both only"}
    x = np.arange(len(group_order))
    width = 0.34

    for ax, (metric_name, _key) in zip(axes.ravel(), PANELS):
        metric_df = df[df["metric"] == metric_name].set_index(["model_key", "condition_scope"])
        for scope_idx, scope in enumerate(scope_order):
            positions = x + (scope_idx - 0.5) * width
            means = [metric_df.loc[(group, scope), "mean_percent"] for group in group_order]
            errors = [metric_df.loc[(group, scope), "ci95_percent"] for group in group_order]
            colors = [COMPACT_COLORS[group] for group in group_order]
            bars = ax.bar(
                positions,
                means,
                width=width,
                yerr=errors,
                capsize=4,
                label=scope_labels[scope],
                color=colors,
                alpha=0.92 if scope == "average" else 0.48,
                edgecolor="white",
                linewidth=0.8,
            )
            for bar, value in zip(bars, means):
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    max(2, value * 0.08),
                    f"{value:.0f}",
                    ha="center",
                    va="bottom",
                    color="white",
                    fontsize=8,
                    fontweight="bold",
                )
        ax.set_title(metric_name, fontsize=14, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(x)
        ax.set_xticklabels([COMPACT_LABELS[group] for group in group_order], rotation=18, ha="right")
        ax.grid(axis="y", color="#d0d0d0", linewidth=1.1)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)

    handles, labels = axes.ravel()[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, 0.935), ncol=2, frameon=False)
    fig.tight_layout(rect=[0, 0, 1, 0.90])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def write_notebook(model: str, cfg: Dict[str, Any], sweep_png: Path, bar_png: Path, summary_csv: Path) -> None:
    nb_path = cfg["notebook"]
    nb_path.parent.mkdir(parents=True, exist_ok=True)
    rel_sweep = os.path.relpath(sweep_png, nb_path.parent)
    rel_bar = os.path.relpath(bar_png, nb_path.parent)
    rel_csv = os.path.relpath(summary_csv, nb_path.parent)
    display_model = f"{model} (shared-agency model)" if model == "sampleJointGoalAndRSASignal_fromStart" else model
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                f"# {display_model} standardized model-model results\n",
                "\n",
                "This notebook mirrors the current `model_model_comparison.html` plotting logic.\n",
                "\n",
                "- Fit/sweep plot: average and equal-to-both model metrics with the best fit highlighted.\n",
                "- Result plot: model vs Human-Human side-by-side, shown for average all 2P3G and equal-to-both, with 95% CI error bars.\n",
                "- Commitment uses `finalReachedGoal == firstDetectedSharedGoal`.\n",
            ],
        },
        {"cell_type": "markdown", "metadata": {}, "source": [f"## Sweep / Fit Plot\n\n![sweep]({rel_sweep})\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": [f"## Model vs Human-Human\n\n![bar]({rel_bar})\n"]},
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "import pandas as pd\n",
                f"summary = pd.read_csv(r'{rel_csv}')\n",
                "summary.round(3)\n",
            ],
        },
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


def main() -> None:
    apply_dynamic_model_config()
    human_df = metric_summary(HUMAN_RAW, "Human-Human", human=True)
    manifest = []
    compact_parts = []
    for model, cfg in MODELS.items():
        model_df = metric_summary(cfg["raw"], cfg["agent_label"], human=False)
        combined = pd.concat([model_df, human_df], ignore_index=True)
        summary_csv = ASSET_DIR / f"{model}_standard_human_side_by_side_summary.csv"
        bar_png = ASSET_DIR / f"{model}_standard_human_side_by_side_bar_4panel.png"
        combined.to_csv(summary_csv, index=False)
        plot_side_by_side(combined, f"{model} vs Human-Human", bar_png)

        if cfg["param_label"] in {"lambda/p", "lambda/alpha"}:
            grid = pd.read_csv(cfg["sweep"])
            sweep_png = ASSET_DIR / f"{model}_standard_sweep_best.png"
            best_lambda, best_p = cfg["best_param"]
            sweep_title = f"{model}: lambda x {'alpha' if cfg['param_label'] == 'lambda/alpha' else 'p'} sweep"
            plot_lambda_p_heatmaps(grid, float(best_lambda), float(best_p), sweep_png, sweep_title)
        else:
            param_col = "alpha" if cfg["param_label"] == "p" else "lambda"
            sweep_df = read_sweep_wide(cfg["sweep"], param_col)
            sweep_png = ASSET_DIR / f"{model}_standard_sweep_best.png"
            x_label = "p" if cfg["param_label"] == "p" else "lambda"
            if param_col != x_label:
                sweep_df = sweep_df.rename(columns={param_col: x_label})
                param_col = x_label
            plot_sweep_4measure(sweep_df, param_col, float(cfg["best_param"]), f"{model}: {cfg['param_label']} sweep", sweep_png)

        write_notebook(model, cfg, sweep_png, bar_png, summary_csv)
        manifest.append({
            "model": model,
            "sweep_png": str(sweep_png.relative_to(ROOT)),
            "bar_png": str(bar_png.relative_to(ROOT)),
            "summary_csv": str(summary_csv.relative_to(ROOT)),
            "notebook": str(cfg["notebook"].relative_to(ROOT)),
        })

        compact_model_df = model_df.copy()
        compact_model_df["model_key"] = model
        compact_parts.append(compact_model_df)

    compact_human_df = human_df.copy()
    compact_human_df["model_key"] = "Human-Human"
    compact = pd.concat([*compact_parts, compact_human_df], ignore_index=True)
    compact_csv = ASSET_DIR / "model_model_compact_visual_summary_grouped_ci.csv"
    compact_png = ASSET_DIR / "model_model_compact_visual_summary_grouped.png"
    compact.to_csv(compact_csv, index=False)
    plot_compact_summary(compact, compact_png)

    manifest_path = ASSET_DIR / "standardized_model_model_report_manifest.csv"
    pd.DataFrame(manifest).to_csv(manifest_path, index=False)
    print(pd.DataFrame(manifest).to_string(index=False))


if __name__ == "__main__":
    main()
