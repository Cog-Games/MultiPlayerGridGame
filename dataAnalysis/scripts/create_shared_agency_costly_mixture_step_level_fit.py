#!/usr/bin/env python3
"""Step-level fit for shared-agency communicative action mixture rho."""

from __future__ import annotations

import html
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

import numpy as np
import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = PROJECT_ROOT / "dataAnalysis" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import create_no_latent_joint_rl_shared_agency_baseline_report as base  # noqa: E402
import create_shared_agency_costly_legibility_fit as costly  # noqa: E402
import create_shared_agency_step_level_model_comparison as step_report  # noqa: E402
from create_step_level_model_model_comparison import ACTIONS, EPS, StepObs, goal_weights, revealed_posterior  # noqa: E402
from fit_signal_alpha_beta3 import load_raw, resolved_raw_path  # noqa: E402


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_costly_mixture_step_level_fit"
ASSET_DIR = OUT_DIR / "assets"
SIM_DIR = OUT_DIR / "simulations"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "shared_agency_costly_mixture_step_level_fit"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_costly_mixture_step_level_fit"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_costly_mixture_step_level_fit.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_costly_mixture_step_level_fit.html"
SHARED_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_always_signal_vs_always_signal_2p3g.js"
TRIAL_BEST_CSV = OUT_DIR.parent / "shared_agency_costly_mixture_rho_sweep" / "shared_agency_costly_mixture_best_rho.csv"

FIXED_LAMBDA = 0.2
SESSIONS = 30
TRIALS = 12
SEED = 42
BETA = 3.0
CV_FOLDS = 5
COARSE_RHOS = [round(i * 0.05, 10) for i in range(21)]
WINDOWS = costly.WINDOWS

CAM_NAME = "Communicative Action Mixture (Legibility Over Alternatives)"
NO_SIGNAL_LABEL = "Shared agency no signaling"
STEP1_LABEL = "Communicative action mixture step-1 fit"
STEP13_LABEL = "Communicative action mixture step-1-3 fit"
HUMAN_LABEL = base.HUMAN_LABEL
GROUP_ORDER = [NO_SIGNAL_LABEL, STEP1_LABEL, STEP13_LABEL, HUMAN_LABEL]
PALETTE = {
    NO_SIGNAL_LABEL: "#59a14f",
    STEP1_LABEL: "#e15759",
    STEP13_LABEL: "#b07aa1",
    HUMAN_LABEL: "#f28e2b",
}
PLOT_LABELS = {
    NO_SIGNAL_LABEL: "Shared agency\n(no signaling)",
    STEP1_LABEL: "Communicative\nAction Mixture\n(step-1 fit)",
    STEP13_LABEL: "Communicative\nAction Mixture\n(step 1-3 fit)",
}


def configure_base_plots() -> None:
    base.BTOM_GROUP_ORDER = GROUP_ORDER
    base.BTOM_PALETTE = PALETTE
    base.PLOT_LABELS = PLOT_LABELS


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def fmt(value: float) -> str:
    return f"{value:g}".replace("-", "neg").replace(".", "p")


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


def log_odds_score(obs: StepObs, goal_idx: int, action_idx: int) -> float:
    post = revealed_posterior(obs.posterior, obs.action_probs_by_goal, action_idx)
    target = max(EPS, min(1.0 - EPS, float(post[goal_idx])))
    other = max(EPS, float(np.sum(post) - target))
    return float(math.log(target) - math.log(other))


def communicative_policy(obs: StepObs, goal_idx: int) -> np.ndarray:
    base_probs = np.maximum(EPS, obs.action_probs_by_goal[goal_idx, :])
    base_probs = base_probs / max(EPS, float(np.sum(base_probs)))
    unnormalized = np.zeros(len(ACTIONS), dtype=np.float64)
    for action_idx in range(len(ACTIONS)):
        unnormalized[action_idx] = base_probs[action_idx] * math.exp(
            max(-700.0, min(700.0, log_odds_score(obs, goal_idx, action_idx)))
        )
    total = float(np.sum(unnormalized))
    if not math.isfinite(total) or total <= 0:
        return base_probs
    probs = np.maximum(EPS, unnormalized / total)
    return probs / max(EPS, float(np.sum(probs)))


def costly_mixture_goal_policy(obs: StepObs, goal_idx: int, rho: float) -> np.ndarray:
    rho = max(0.0, min(1.0, float(rho)))
    base_probs = np.maximum(EPS, obs.action_probs_by_goal[goal_idx, :])
    base_probs = base_probs / max(EPS, float(np.sum(base_probs)))
    comm_probs = communicative_policy(obs, goal_idx)
    probs = (1.0 - rho) * base_probs + rho * comm_probs
    probs = np.maximum(EPS, probs)
    return probs / max(EPS, float(np.sum(probs)))


def costly_mixture_likelihood(obs: StepObs, rho: float, lambda_value: float = FIXED_LAMBDA) -> float:
    weights = goal_weights(obs, lambda_value)
    per_goal = np.zeros(len(weights), dtype=np.float64)
    for goal_idx in range(len(weights)):
        per_goal[goal_idx] = costly_mixture_goal_policy(obs, goal_idx, rho)[obs.observed_idx]
    return max(EPS, float(np.sum(weights * per_goal)))


def nll(observations: Sequence[StepObs], fn) -> float:
    return -float(sum(math.log(max(EPS, fn(obs))) for obs in observations))


def costly_mixture_nll(observations: Sequence[StepObs], rho: float) -> float:
    return nll(observations, lambda obs: costly_mixture_likelihood(obs, rho))


def trial_best_rho() -> float:
    if TRIAL_BEST_CSV.exists():
        try:
            return float(pd.read_csv(TRIAL_BEST_CSV).iloc[0]["rho"])
        except Exception:
            return 0.5
    return 0.5


def expected_policy_metrics(observations: Sequence[StepObs], rho: float) -> Dict[str, float]:
    if not observations:
        return {
            "expected_signal_move": np.nan,
            "expected_btom_legibility": np.nan,
            "expected_mean_log_odds": np.nan,
        }
    signal_values = []
    btom_values = []
    log_odds_values = []
    for obs in observations:
        weights = goal_weights(obs, FIXED_LAMBDA)
        signal_matrix = costly.signaling_indicator_matrix(obs)
        expected_signal = 0.0
        expected_btom = 0.0
        expected_log_odds = 0.0
        for goal_idx in range(len(weights)):
            probs = costly_mixture_goal_policy(obs, goal_idx, rho)
            expected_signal += float(weights[goal_idx]) * float(np.sum(probs * signal_matrix[goal_idx, :]))
            for action_idx in range(len(ACTIONS)):
                post = revealed_posterior(obs.posterior, obs.action_probs_by_goal, action_idx)
                expected_btom += float(weights[goal_idx]) * float(probs[action_idx]) * float(post[goal_idx])
                expected_log_odds += float(weights[goal_idx]) * float(probs[action_idx]) * log_odds_score(obs, goal_idx, action_idx)
        signal_values.append(expected_signal)
        btom_values.append(expected_btom)
        log_odds_values.append(expected_log_odds)
    return {
        "expected_signal_move": float(np.mean(signal_values)),
        "expected_btom_legibility": float(np.mean(btom_values)),
        "expected_mean_log_odds": float(np.mean(log_odds_values)),
    }


def fit_rho(observations: Sequence[StepObs]) -> tuple[pd.DataFrame, Dict[str, Any]]:
    rows = [
        {
            "rho": float(rho),
            "lambda": FIXED_LAMBDA,
            "negative_log_likelihood": costly_mixture_nll(observations, float(rho)),
            **expected_policy_metrics(observations, float(rho)),
            "fit_stage": "coarse",
        }
        for rho in COARSE_RHOS
    ]
    coarse_df = pd.DataFrame(rows)
    best_coarse = coarse_df.loc[coarse_df["negative_log_likelihood"].idxmin()].to_dict()
    refine_rhos = step_report.refinement_values(float(best_coarse["rho"]), COARSE_RHOS, 0.0, 1.0)
    seen = {round(float(row["rho"]), 10) for row in rows}
    for rho in refine_rhos:
        key = round(float(rho), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "rho": float(rho),
                "lambda": FIXED_LAMBDA,
                "negative_log_likelihood": costly_mixture_nll(observations, float(rho)),
                **expected_policy_metrics(observations, float(rho)),
                "fit_stage": "refine",
            }
        )
    df = pd.DataFrame(rows).sort_values("rho").reset_index(drop=True)
    return df, df.loc[df["negative_log_likelihood"].idxmin()].to_dict()


def fold_id_map(observations: Sequence[StepObs]) -> Dict[str, int]:
    groups = sorted({obs.room_id or f"trial_{obs.trial_index}" for obs in observations})
    return {group: idx % CV_FOLDS for idx, group in enumerate(groups)}


def cv_for_window(observations: Sequence[StepObs]) -> pd.DataFrame:
    group_to_fold = fold_id_map(observations)
    rows = []
    trial_rho = trial_best_rho()
    for fold in range(CV_FOLDS):
        train = [obs for obs in observations if group_to_fold.get(obs.room_id or f"trial_{obs.trial_index}") != fold]
        test = [obs for obs in observations if group_to_fold.get(obs.room_id or f"trial_{obs.trial_index}") == fold]
        _grid, best = fit_rho(train)
        rho = float(best["rho"])
        candidates = [
            ("no signaling, lambda=.2", 0.0, costly_mixture_nll(train, 0.0), costly_mixture_nll(test, 0.0), 0),
            ("communicative action mixture rho fit", rho, costly_mixture_nll(train, rho), costly_mixture_nll(test, rho), 1),
            (f"trial-level rho={trial_rho:g}", trial_rho, costly_mixture_nll(train, trial_rho), costly_mixture_nll(test, trial_rho), 0),
        ]
        for model, rho_value, train_nll, test_nll, n_params in candidates:
            rows.append(
                {
                    "fold": fold,
                    "model": model,
                    "rho": rho_value,
                    "lambda": FIXED_LAMBDA,
                    "n_params": n_params,
                    "train_negative_log_likelihood": train_nll,
                    "test_negative_log_likelihood": test_nll,
                    "train_actions": len(train),
                    "test_actions": len(test),
                }
            )
    return pd.DataFrame(rows)


def summarize_models(observations: Sequence[StepObs], best: Dict[str, Any], cv_df: pd.DataFrame) -> pd.DataFrame:
    rho = float(best["rho"])
    trial_rho = trial_best_rho()
    candidates = [
        ("no signaling, lambda=.2", 0.0, costly_mixture_nll(observations, 0.0), 0),
        ("communicative action mixture rho fit", rho, float(best["negative_log_likelihood"]), 1),
        (f"trial-level rho={trial_rho:g}", trial_rho, costly_mixture_nll(observations, trial_rho), 0),
    ]
    rows = []
    for model, rho_value, insample, n_params in candidates:
        heldout = float(cv_df[cv_df["model"] == model]["test_negative_log_likelihood"].sum())
        rows.append(
            {
                "model": model,
                "rho": rho_value,
                "lambda": FIXED_LAMBDA,
                "n_params": n_params,
                "actions": len(observations),
                "in_sample_nll": insample,
                "heldout_nll": heldout,
                "heldout_nll_per_action": heldout / max(1, len(observations)),
                **expected_policy_metrics(observations, rho_value),
                "aic": 2 * n_params + 2 * insample,
                "bic": math.log(max(1, len(observations))) * n_params + 2 * insample,
            }
        )
    out = pd.DataFrame(rows)
    best_heldout = float(out["heldout_nll"].min())
    out["delta_heldout_nll"] = out["heldout_nll"] - best_heldout
    return out.sort_values("heldout_nll").reset_index(drop=True)


def plot_rho_sweep(grid: pd.DataFrame, best: Dict[str, Any], path: Path, title: str) -> None:
    df = grid.sort_values("rho")
    fig, axes = plt.subplots(2, 2, figsize=(13.5, 8.4))
    axes = axes.ravel()
    series = [
        ("negative_log_likelihood", "Human Action NLL", "#4f79a8"),
        ("expected_signal_move", "Expected Signaling Move", "#59a14f"),
        ("expected_btom_legibility", "Expected BToM Legibility", "#e15759"),
        ("expected_mean_log_odds", "Expected Goal Log-Odds", "#b07aa1"),
    ]
    for ax, (col, label, color) in zip(axes, series):
        ax.plot(df["rho"], df[col], marker="o", linewidth=2.2, color=color)
        ax.axvline(float(best["rho"]), color="#111827", linestyle="--", linewidth=1.2)
        ax.set_title(label, fontweight="bold")
        ax.set_xlabel("rho")
        ax.grid(axis="y", color="#d8dde3")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.suptitle(title, fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_model_summary(summary: pd.DataFrame, path: Path, title: str) -> None:
    costly.plot_model_summary(summary, path, title)


def html_table(df: pd.DataFrame, columns: Sequence[str]) -> str:
    header = "".join(f"<th>{html.escape(col)}</th>" for col in columns)
    rows = []
    for record in df[columns].to_dict(orient="records"):
        cells = []
        for col in columns:
            value = record[col]
            if isinstance(value, float) and math.isnan(value):
                text = ""
                cls = "num"
            elif isinstance(value, float):
                text = f"{value:.3f}" if "nll" in col.lower() else f"{value:.2f}"
                cls = "num"
            else:
                text = str(value)
                cls = ""
            cells.append(f"<td class=\"{cls}\">{html.escape(text)}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(rows)}</tbody></table>"


def expected_raw_path(rho: float, raw_dir: Path) -> Path:
    suffix = f"beta_{fmt(BETA)}_lambda_{fmt(FIXED_LAMBDA)}_alpha_{fmt(rho)}_score_costly_mixture_sessions_0_to_{SESSIONS - 1}"
    return raw_dir / f"always_signal_vs_always_signal_2p3g_raw_trials_{suffix}.json"


def raw_exists(path: Path) -> Path | None:
    try:
        return resolved_raw_path(path)
    except FileNotFoundError:
        return None


def compress_result_raw(result: Dict[str, Any]) -> Path:
    raw_path = Path(result["rawTrialsPath"])
    if raw_path.suffix == ".zst":
        return raw_path
    return base.compress_raw(raw_path)


def run_shared_simulation(rho: float, label: str, output_dir: Path, raw_dir: Path) -> Dict[str, Any]:
    expected = expected_raw_path(rho, raw_dir)
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
        str(FIXED_LAMBDA),
        "--alpha",
        str(rho),
        "--beta",
        str(BETA),
        "--score",
        "costly_mixture",
        "--horizon",
        "1",
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    existing = raw_exists(expected)
    if existing is not None:
        return {"label": label, "rho": rho, "rawTrialsPath": str(existing), "command": " ".join(cmd)}
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        result.check_returncode()
    out = json.loads(result.stdout)
    out["label"] = label
    out["rho"] = rho
    out["command"] = " ".join(cmd)
    out["rawTrialsPath"] = str(compress_result_raw(out))
    return out


def build_report_tables(raw_paths: Dict[str, Path]) -> Dict[str, Any]:
    models = [
        {"key": "shared_agency_no_signaling", "label": NO_SIGNAL_LABEL, "raw_trials": str(raw_paths[NO_SIGNAL_LABEL])},
        {"key": "costly_mixture_step1_fit", "label": STEP1_LABEL, "raw_trials": str(raw_paths[STEP1_LABEL])},
        {"key": "costly_mixture_step13_fit", "label": STEP13_LABEL, "raw_trials": str(raw_paths[STEP13_LABEL])},
    ]
    btom_df = base.build_btom_table(models)
    _btom_step_long, btom_step_participant, btom_mean_participant = base.build_btom_step_tables(btom_df, max_step=5)
    metric_df = base.build_metric_table(models)
    btom_metric_df = pd.DataFrame(
        base.btom_step1_metric_rows(btom_step_participant, None, "average")
        + base.btom_step1_metric_rows(btom_step_participant, "equal_to_both", "equal_to_both")
    )
    metric_df = pd.concat([metric_df, btom_metric_df], ignore_index=True)
    summary_df = base.wide_summary(metric_df)
    average_df = metric_df[metric_df["condition_scope"] == "average"].copy()
    equal_df = metric_df[metric_df["condition_scope"] == "equal_to_both"].copy()
    return {
        "metric_df": metric_df,
        "summary_df": summary_df,
        "average_df": average_df,
        "equal_df": equal_df,
        "btom_df": btom_df,
        "btom_step_participant": btom_step_participant,
        "btom_mean_participant": btom_mean_participant,
    }


def analyze_window(key: str, observations: Sequence[StepObs]) -> Dict[str, Any]:
    grid, best = fit_rho(observations)
    cv_df = cv_for_window(observations)
    summary_df = summarize_models(observations, best, cv_df)
    grid_path = OUT_DIR / f"{key}_rho_sweep.csv"
    cv_path = OUT_DIR / f"{key}_cv_folds.csv"
    summary_path = OUT_DIR / f"{key}_model_summary.csv"
    rho_plot = ASSET_DIR / f"{key}_rho_sweep.png"
    model_plot = ASSET_DIR / f"{key}_model_summary.png"
    grid.to_csv(grid_path, index=False)
    cv_df.to_csv(cv_path, index=False)
    summary_df.to_csv(summary_path, index=False)
    plot_rho_sweep(grid, best, rho_plot, f"{WINDOWS[key]['label']}: communicative action mixture rho sweep")
    plot_model_summary(summary_df, model_plot, f"{WINDOWS[key]['label']}: model summary")
    return {
        "actions": len(observations),
        "grid_df": grid,
        "summary_df": summary_df,
        "best": best,
        "grid_path": grid_path,
        "cv_path": cv_path,
        "summary_path": summary_path,
        "rho_plot": rho_plot,
        "model_plot": model_plot,
    }


def run_posterior_predictive(results: Dict[str, Dict[str, Any]]) -> tuple[Dict[str, Path], pd.DataFrame, Dict[str, Any]]:
    SIM_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_paths: Dict[str, Path] = {}
    raw_sources: List[Dict[str, Any]] = []
    settings = [
        (NO_SIGNAL_LABEL, 0.0, "no_signaling"),
        (STEP1_LABEL, float(results["step1"]["best"]["rho"]), "step1_fit"),
        (STEP13_LABEL, float(results["step1_3"]["best"]["rho"]), "step1_3_fit"),
    ]
    for label, rho, subdir in settings:
        result = run_shared_simulation(rho, label, SIM_DIR / subdir, RAW_DIR / subdir)
        raw_paths[label] = Path(result["rawTrialsPath"])
        raw_sources.append(result)
    tables = build_report_tables(raw_paths)
    outputs = {
        "metric_long_csv": OUT_DIR / "costly_mixture_step_level_metric_long.csv",
        "summary_csv": OUT_DIR / "costly_mixture_step_level_summary.csv",
        "raw_sources_csv": OUT_DIR / "costly_mixture_step_level_raw_sources.csv",
        "average_plot": ASSET_DIR / "costly_mixture_step_level_average_6panel.png",
        "equal_plot": ASSET_DIR / "costly_mixture_step_level_equal_to_both_6panel.png",
        "btom_trajectory_plot": ASSET_DIR / "costly_mixture_step_level_btom_first5_trajectory.png",
        "btom_step_csv": OUT_DIR / "costly_mixture_step_level_btom_first5_step_per_participant.csv",
        "btom_mean_csv": OUT_DIR / "costly_mixture_step_level_btom_first5_mean_per_participant.csv",
        "btom_trajectory_csv": OUT_DIR / "costly_mixture_step_level_btom_player_trajectories.csv",
    }
    tables["metric_df"].to_csv(outputs["metric_long_csv"], index=False)
    tables["summary_df"].to_csv(outputs["summary_csv"], index=False)
    pd.DataFrame(raw_sources).to_csv(outputs["raw_sources_csv"], index=False)
    btom_csv = tables["btom_df"].copy()
    btom_csv["posteriors"] = btom_csv["posteriors"].apply(json.dumps)
    btom_csv.to_csv(outputs["btom_trajectory_csv"], index=False)
    tables["btom_step_participant"].to_csv(outputs["btom_step_csv"], index=False)
    tables["btom_mean_participant"].to_csv(outputs["btom_mean_csv"], index=False)
    base.plot_comparison(tables["average_df"], outputs["average_plot"], f"{CAM_NAME} Step-Level Fit: All Distance Conditions", tables["btom_step_participant"])
    base.plot_comparison(tables["equal_df"], outputs["equal_plot"], f"{CAM_NAME} Step-Level Fit: Equal-to-Both", tables["btom_step_participant"], "equal_to_both")
    base.plot_btom_trajectory(tables["btom_step_participant"], outputs["btom_trajectory_plot"], max_step=5)
    return raw_paths, pd.DataFrame(raw_sources), {"tables": tables, "outputs": outputs}


def write_notebook() -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    nb = {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": [f"# Shared-Agency {CAM_NAME} Step-Level Fit\n"]},
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from pathlib import Path\n",
                    "import pandas as pd\n",
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "step0 = pd.read_csv(OUT / 'step0_model_summary.csv')\n",
                    "step1 = pd.read_csv(OUT / 'step1_model_summary.csv')\n",
                    "step13 = pd.read_csv(OUT / 'step1_3_model_summary.csv')\n",
                    "step0_grid = pd.read_csv(OUT / 'step0_rho_sweep.csv')\n",
                    "step1_grid = pd.read_csv(OUT / 'step1_rho_sweep.csv')\n",
                    "step13_grid = pd.read_csv(OUT / 'step1_3_rho_sweep.csv')\n",
                    "summary = pd.read_csv(OUT / 'costly_mixture_step_level_summary.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Step-Level NLL Summaries\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["step0.round(3), step1.round(3), step13.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Rho Sweeps\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["step0_grid.round(3), step1_grid.round(3), step13_grid.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Posterior Predictive Summary\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["summary.round(2)\n"]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def write_html(results: Dict[str, Dict[str, Any]], posterior: Dict[str, Any], raw_sources: pd.DataFrame) -> None:
    cols = [
        "model",
        "rho",
        "lambda",
        "n_params",
        "actions",
        "in_sample_nll",
        "heldout_nll",
        "heldout_nll_per_action",
        "delta_heldout_nll",
        "expected_signal_move",
        "expected_btom_legibility",
        "expected_mean_log_odds",
        "aic",
        "bic",
    ]
    summary_cols = [
        "condition_scope",
        "group",
        "Success Rate (%)",
        "Coordination Efficiency (%)",
        "Commitment (%)",
        "Signaling Move (%)",
        "BToM Step 1 (%)",
    ]
    html_sections = []
    for key, info in results.items():
        label = WINDOWS[key]["label"]
        html_sections.append(
            f"""
  <section class="panel">
    <h2>{html.escape(label)}</h2>
    <p class="note">Actions={info['actions']}. Fixed lambda={FIXED_LAMBDA:g}; only rho is fitted. Goal weights are unchanged for every rho.</p>
    <a href="{rel(info['rho_plot'])}"><img src="{rel(info['rho_plot'])}" alt="{html.escape(label)} rho sweep"></a>
    <a href="{rel(info['model_plot'])}"><img src="{rel(info['model_plot'])}" alt="{html.escape(label)} model summary"></a>
    {html_table(info['summary_df'], cols)}
  </section>
            """
        )
    outputs = posterior["outputs"]
    tables = posterior["tables"]
    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency {CAM_NAME} Step-Level Fit</title>
<style>
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f8fb; color:#1f2933; }}
header {{ padding:34px 48px 24px; background:#ffffff; border-bottom:1px solid #d9e2ec; }}
main {{ max-width:1180px; margin:0 auto; padding:28px 24px 60px; }}
h1 {{ margin:0 0 8px; font-size:31px; }}
h2 {{ margin:30px 0 12px; font-size:21px; }}
p {{ line-height:1.55; }}
.note {{ color:#52606d; max-width:980px; }}
.panel {{ background:#fff; border:1px solid #d9e2ec; border-radius:8px; padding:18px; margin:18px 0; }}
.links a {{ display:inline-block; margin:0 12px 10px 0; color:#2458a6; text-decoration:none; }}
img {{ width:100%; height:auto; display:block; border:1px solid #d9e2ec; border-radius:6px; background:white; margin:12px 0; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; background:white; }}
th,td {{ border:1px solid #d9e2ec; padding:8px 10px; text-align:left; vertical-align:top; }}
th {{ background:#eef3f8; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
code {{ background:#eef3f8; padding:2px 5px; border-radius:4px; }}
</style>
</head>
<body>
<header>
  <h1>Shared-Agency {CAM_NAME} Step-Level Fit</h1>
  <p class="note">Fixed lambda={FIXED_LAMBDA:g}. Rho mixes the unshaped JointRL base policy with a communicative policy that increases goal legibility over alternatives. The likelihood target is human action choice in immediate new-goal windows.</p>
  <div class="links">
    <a href="{rel(OUT_DIR / 'step0_model_summary.csv')}">presentation-step summary CSV</a>
    <a href="{rel(OUT_DIR / 'step1_model_summary.csv')}">step-1 summary CSV</a>
    <a href="{rel(OUT_DIR / 'step1_3_model_summary.csv')}">step 1-3 summary CSV</a>
    <a href="{rel(outputs['summary_csv'])}">posterior predictive summary CSV</a>
    <a href="{rel(outputs['raw_sources_csv'])}">raw sources CSV</a>
    <a href="{rel(NOTEBOOK_PATH)}">notebook</a>
    <a href="shared_agency_costly_mixture_rho_sweep.html">communicative action mixture trial-level sweep</a>
    <a href="shared_agency_log_odds_eta_sweep.html">log-odds full eta sweep</a>
    <a href="shared_agency_log_odds_legibility_fit.html">step-level log-odds likelihood report</a>
    <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">trial-level baseline report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Model</h2>
    <p><code>pi(a|g) = (1-rho) pi_base(a|s,g) + rho pi_comm(a|s,g)</code></p>
    <p><code>pi_comm(a|g) proportional to pi_base(a|s,g) exp(log P(g|a) - log sum_{{g' != g}} P(g'|a))</code></p>
  </section>
  {''.join(html_sections)}
  <section class="panel">
    <h2>Posterior Predictive: All Distance Conditions</h2>
    <a href="{rel(outputs['average_plot'])}"><img src="{rel(outputs['average_plot'])}" alt="all distance posterior predictive"></a>
  </section>
  <section class="panel">
    <h2>Posterior Predictive: Equal-to-Both</h2>
    <a href="{rel(outputs['equal_plot'])}"><img src="{rel(outputs['equal_plot'])}" alt="equal-to-both posterior predictive"></a>
  </section>
  <section class="panel">
    <h2>BToM Trajectory</h2>
    <a href="{rel(outputs['btom_trajectory_plot'])}"><img src="{rel(outputs['btom_trajectory_plot'])}" alt="BToM trajectory"></a>
  </section>
  <section class="panel">
    <h2>Posterior Predictive Summary</h2>
    {html_table(tables['summary_df'], summary_cols)}
  </section>
  <section class="panel">
    <h2>Raw Sources</h2>
    {html_table(raw_sources, list(raw_sources.columns))}
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    configure_base_plots()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    human_rows = step_report.load_human_rows()
    results: Dict[str, Dict[str, Any]] = {}
    for key, cfg in WINDOWS.items():
        observations = costly.window_observations(human_rows, int(cfg["start"]), int(cfg["end"]))
        results[key] = analyze_window(key, observations)

    _raw_paths, raw_sources, posterior = run_posterior_predictive(results)
    write_notebook()
    write_html(results, posterior, raw_sources)

    summary = {
        "html": str(HTML_PATH),
        "fixed_lambda": FIXED_LAMBDA,
        "windows": {
            key: {
                "actions": value["actions"],
                "best": {
                    k: v
                    for k, v in value["best"].items()
                    if k
                    in {
                        "rho",
                        "negative_log_likelihood",
                        "expected_signal_move",
                        "expected_btom_legibility",
                        "expected_mean_log_odds",
                        "fit_stage",
                    }
                },
                "best_heldout_model": str(value["summary_df"].iloc[0]["model"]),
            }
            for key, value in results.items()
        },
        "posterior_predictive_outputs": {key: str(path) for key, path in posterior["outputs"].items()},
        "notebook": str(NOTEBOOK_PATH),
    }
    (OUT_DIR / "costly_mixture_step_level_fit_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
