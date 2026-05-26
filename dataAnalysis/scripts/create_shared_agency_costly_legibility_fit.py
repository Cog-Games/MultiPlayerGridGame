#!/usr/bin/env python3
"""Fit a one-parameter costly legibility utility signaling policy."""

from __future__ import annotations

import html
import json
import math
import os
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

import create_shared_agency_step_level_model_comparison as step_report  # noqa: E402
from create_step_level_model_model_comparison import (  # noqa: E402
    ACTIONS,
    EPS,
    StepObs,
    goal_weights,
    manhattan,
    revealed_posterior,
    transition,
)


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_costly_legibility_fit"
ASSET_DIR = OUT_DIR / "assets"
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_costly_legibility_fit"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_costly_legibility_fit.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_costly_legibility_fit.html"

FIXED_LAMBDA = 0.2
CV_FOLDS = 5
COARSE_ETAS = [0.0, 0.05, 0.1, 0.2, 0.4, 0.8, 1.2, 1.6, 2.0, 3.0, 5.0, 8.0, 12.0, 16.0, 24.0, 32.0]
ETA_UPPER = 32.0
WINDOWS = {
    "step0": {"label": "New-goal presentation step", "start": 0, "end": 0},
    "step1": {"label": "Step 1 after new goal", "start": 1, "end": 1},
    "step1_3": {"label": "Steps 1-3 after new goal", "start": 1, "end": 3},
}


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def new_goal_time_map(rows: Sequence[Dict[str, Any]]) -> Dict[tuple[str, int], int]:
    out: Dict[tuple[str, int], int] = {}
    for row in rows:
        if not row.get("newGoalPresented"):
            continue
        try:
            out[(str(row.get("roomId")), int(row.get("trialIndex") or 0))] = int(row.get("newGoalPresentedTime"))
        except Exception:
            continue
    return out


def window_observations(rows: Sequence[Dict[str, Any]], start: int, end: int) -> List[StepObs]:
    observations = step_report.build_observations(rows, "always_signal_rsa")
    time_map = new_goal_time_map(rows)
    filtered: List[StepObs] = []
    for obs in observations:
        new_time = time_map.get((obs.room_id, obs.trial_index))
        if new_time is None:
            continue
        relative_step = int(obs.step) - int(new_time)
        if start <= relative_step <= end:
            filtered.append(obs)
    return filtered


def posterior_lift_score(obs: StepObs, goal_idx: int, action_idx: int) -> float:
    post = revealed_posterior(obs.posterior, obs.action_probs_by_goal, action_idx)
    return float(math.log(max(EPS, float(post[goal_idx]))) - math.log(max(EPS, float(obs.posterior[goal_idx]))))


def costly_legibility_goal_policy(obs: StepObs, goal_idx: int, eta: float) -> np.ndarray:
    base = np.maximum(EPS, obs.action_probs_by_goal[goal_idx, :])
    base = base / max(EPS, float(np.sum(base)))
    unnormalized = np.zeros(len(ACTIONS), dtype=np.float64)
    for action_idx in range(len(ACTIONS)):
        lift = posterior_lift_score(obs, goal_idx, action_idx)
        unnormalized[action_idx] = base[action_idx] * math.exp(max(-700.0, min(700.0, float(eta) * lift)))
    total = float(np.sum(unnormalized))
    if not math.isfinite(total) or total <= 0:
        return base
    probs = np.maximum(EPS, unnormalized / total)
    return probs / max(EPS, float(np.sum(probs)))


def costly_legibility_likelihood(obs: StepObs, eta: float, lambda_value: float = FIXED_LAMBDA) -> float:
    weights = goal_weights(obs, lambda_value)
    per_goal = np.zeros(len(weights), dtype=np.float64)
    for goal_idx in range(len(weights)):
        per_goal[goal_idx] = costly_legibility_goal_policy(obs, goal_idx, eta)[obs.observed_idx]
    return max(EPS, float(np.sum(weights * per_goal)))


def nll(observations: Sequence[StepObs], fn) -> float:
    return -float(sum(math.log(max(EPS, fn(obs))) for obs in observations))


def costly_legibility_nll(observations: Sequence[StepObs], eta: float) -> float:
    return nll(observations, lambda obs: costly_legibility_likelihood(obs, eta))


def no_signal_nll(observations: Sequence[StepObs]) -> float:
    return nll(observations, lambda obs: step_report.rsa_signal_likelihood(obs, FIXED_LAMBDA, 0.0))


def constant_rsa_nll(observations: Sequence[StepObs]) -> float:
    return nll(observations, lambda obs: step_report.rsa_signal_likelihood(obs, FIXED_LAMBDA, 1.0))


def trial_best_nll(observations: Sequence[StepObs]) -> float:
    return nll(observations, lambda obs: step_report.rsa_signal_likelihood(obs, 0.15, 0.5))


def signaling_indicator_matrix(obs: StepObs) -> np.ndarray:
    out = np.zeros((len(obs.goals), len(ACTIONS)), dtype=np.float64)
    for goal_idx, goal in enumerate(obs.goals):
        current_dist = manhattan(obs.self_pos, goal)
        best_action_idx = None
        best_prob = -1.0
        for action_idx, action in enumerate(ACTIONS):
            next_pos = transition(obs.self_pos, action)
            if manhattan(next_pos, goal) >= current_dist:
                continue
            post = revealed_posterior(obs.posterior, obs.action_probs_by_goal, action_idx)
            target_prob = float(post[goal_idx])
            if target_prob > best_prob:
                best_prob = target_prob
                best_action_idx = action_idx
        if best_action_idx is not None:
            out[goal_idx, best_action_idx] = 1.0
    return out


def expected_policy_metrics(observations: Sequence[StepObs], eta: float) -> Dict[str, float]:
    if not observations:
        return {
            "expected_signal_move": np.nan,
            "expected_btom_legibility": np.nan,
            "expected_mean_posterior_lift": np.nan,
        }
    signal_values = []
    btom_values = []
    lift_values = []
    for obs in observations:
        weights = goal_weights(obs, FIXED_LAMBDA)
        signal_matrix = signaling_indicator_matrix(obs)
        expected_signal = 0.0
        expected_btom = 0.0
        expected_lift = 0.0
        for goal_idx in range(len(weights)):
            probs = costly_legibility_goal_policy(obs, goal_idx, eta)
            expected_signal += float(weights[goal_idx]) * float(np.sum(probs * signal_matrix[goal_idx, :]))
            for action_idx in range(len(ACTIONS)):
                post = revealed_posterior(obs.posterior, obs.action_probs_by_goal, action_idx)
                expected_btom += float(weights[goal_idx]) * float(probs[action_idx]) * float(post[goal_idx])
                expected_lift += float(weights[goal_idx]) * float(probs[action_idx]) * posterior_lift_score(obs, goal_idx, action_idx)
        signal_values.append(expected_signal)
        btom_values.append(expected_btom)
        lift_values.append(expected_lift)
    return {
        "expected_signal_move": float(np.mean(signal_values)),
        "expected_btom_legibility": float(np.mean(btom_values)),
        "expected_mean_posterior_lift": float(np.mean(lift_values)),
    }


def fit_eta(observations: Sequence[StepObs]) -> tuple[pd.DataFrame, Dict[str, Any]]:
    rows = [
        {
            "eta": float(eta),
            "lambda": FIXED_LAMBDA,
            "negative_log_likelihood": costly_legibility_nll(observations, float(eta)),
            **expected_policy_metrics(observations, float(eta)),
            "fit_stage": "coarse",
        }
        for eta in COARSE_ETAS
    ]
    coarse_df = pd.DataFrame(rows)
    best_coarse = coarse_df.loc[coarse_df["negative_log_likelihood"].idxmin()].to_dict()
    refine_etas = step_report.refinement_values(float(best_coarse["eta"]), COARSE_ETAS, 0.0, ETA_UPPER)
    seen = {round(float(row["eta"]), 10) for row in rows}
    for eta in refine_etas:
        key = round(float(eta), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "eta": float(eta),
                "lambda": FIXED_LAMBDA,
                "negative_log_likelihood": costly_legibility_nll(observations, float(eta)),
                **expected_policy_metrics(observations, float(eta)),
                "fit_stage": "refine",
            }
        )
    df = pd.DataFrame(rows).sort_values("eta").reset_index(drop=True)
    return df, df.loc[df["negative_log_likelihood"].idxmin()].to_dict()


def fold_id_map(observations: Sequence[StepObs]) -> Dict[str, int]:
    groups = sorted({obs.room_id or f"trial_{obs.trial_index}" for obs in observations})
    return {group: idx % CV_FOLDS for idx, group in enumerate(groups)}


def cv_for_window(observations: Sequence[StepObs]) -> pd.DataFrame:
    group_to_fold = fold_id_map(observations)
    rows = []
    for fold in range(CV_FOLDS):
        train = [obs for obs in observations if group_to_fold.get(obs.room_id or f"trial_{obs.trial_index}") != fold]
        test = [obs for obs in observations if group_to_fold.get(obs.room_id or f"trial_{obs.trial_index}") == fold]
        _grid, best = fit_eta(train)
        eta = float(best["eta"])
        candidates = [
            ("no signaling, lambda=.2", 0.0, no_signal_nll(train), no_signal_nll(test), 0),
            ("costly legibility utility", eta, costly_legibility_nll(train, eta), costly_legibility_nll(test, eta), 1),
            ("constant RSA alpha=1", 1.0, constant_rsa_nll(train), constant_rsa_nll(test), 0),
            ("trial-level best lambda=.15 alpha=.5", 0.5, trial_best_nll(train), trial_best_nll(test), 0),
        ]
        for model, eta_value, train_nll, test_nll, n_params in candidates:
            rows.append(
                {
                    "fold": fold,
                    "model": model,
                    "eta": eta_value,
                    "lambda": 0.15 if model == "trial-level best lambda=.15 alpha=.5" else FIXED_LAMBDA,
                    "n_params": n_params,
                    "train_negative_log_likelihood": train_nll,
                    "test_negative_log_likelihood": test_nll,
                    "train_actions": len(train),
                    "test_actions": len(test),
                }
            )
    return pd.DataFrame(rows)


def summarize_models(observations: Sequence[StepObs], best: Dict[str, Any], cv_df: pd.DataFrame) -> pd.DataFrame:
    eta = float(best["eta"])
    candidates = [
        ("no signaling, lambda=.2", 0.0, no_signal_nll(observations), 0),
        ("costly legibility utility", eta, float(best["negative_log_likelihood"]), 1),
        ("constant RSA alpha=1", 1.0, constant_rsa_nll(observations), 0),
        ("trial-level best lambda=.15 alpha=.5", 0.5, trial_best_nll(observations), 0),
    ]
    rows = []
    for model, eta_value, insample, n_params in candidates:
        heldout = float(cv_df[cv_df["model"] == model]["test_negative_log_likelihood"].sum())
        rows.append(
            {
                "model": model,
                "eta": eta_value,
                "lambda": 0.15 if model == "trial-level best lambda=.15 alpha=.5" else FIXED_LAMBDA,
                "n_params": n_params,
                "actions": len(observations),
                "in_sample_nll": insample,
                "heldout_nll": heldout,
                "heldout_nll_per_action": heldout / max(1, len(observations)),
                **expected_policy_metrics(observations, eta_value),
                "aic": 2 * n_params + 2 * insample,
                "bic": math.log(max(1, len(observations))) * n_params + 2 * insample,
            }
        )
    out = pd.DataFrame(rows)
    best_heldout = float(out["heldout_nll"].min())
    out["delta_heldout_nll"] = out["heldout_nll"] - best_heldout
    return out.sort_values("heldout_nll").reset_index(drop=True)


def plot_eta_sweep(grid: pd.DataFrame, best: Dict[str, Any], path: Path, title: str) -> None:
    df = grid.sort_values("eta")
    fig, axes = plt.subplots(2, 2, figsize=(13.5, 8.4))
    axes = axes.ravel()
    series = [
        ("negative_log_likelihood", "Human Action NLL", "#4f79a8"),
        ("expected_signal_move", "Expected Signaling Move", "#59a14f"),
        ("expected_btom_legibility", "Expected BToM Legibility", "#e15759"),
        ("expected_mean_posterior_lift", "Expected Posterior Lift", "#b07aa1"),
    ]
    for ax, (col, label, color) in zip(axes, series):
        ax.plot(df["eta"], df[col], marker="o", linewidth=2.2, color=color)
        ax.axvline(float(best["eta"]), color="#111827", linestyle="--", linewidth=1.2)
        ax.set_title(label, fontweight="bold")
        ax.set_xlabel("eta")
        ax.grid(axis="y", color="#d8dde3")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.suptitle(title, fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_model_summary(summary: pd.DataFrame, path: Path, title: str) -> None:
    df = summary.copy()
    fig, axes = plt.subplots(1, 3, figsize=(14.5, 4.8))
    x = np.arange(df.shape[0])
    colors = ["#4f79a8" if model == "no signaling, lambda=.2" else "#59a14f" for model in df["model"]]
    panels = [
        ("heldout_nll_per_action", "Held-Out NLL / Action"),
        ("expected_signal_move", "Expected Signaling Move"),
        ("expected_btom_legibility", "Expected BToM Legibility"),
    ]
    for ax, (col, label) in zip(axes, panels):
        ax.bar(x, df[col], color=colors, edgecolor="white")
        ax.set_title(label, fontweight="bold")
        ax.set_xticks(x)
        ax.set_xticklabels(df["model"], rotation=12, ha="right")
        ax.grid(axis="y", color="#d8dde3")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.suptitle(title, fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


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


def write_notebook() -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    nb = {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Shared-Agency Costly Legibility Utility Fit\n"]},
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
                    "step0_grid = pd.read_csv(OUT / 'step0_eta_sweep.csv')\n",
                    "step1_grid = pd.read_csv(OUT / 'step1_eta_sweep.csv')\n",
                    "step13_grid = pd.read_csv(OUT / 'step1_3_eta_sweep.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## New-goal Presentation Step\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["step0.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Step 1\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["step1.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Steps 1-3\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["step13.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Eta Sweeps\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["step0_grid.round(3), step1_grid.round(3), step13_grid.round(3)\n"]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def write_html(results: Dict[str, Dict[str, Any]]) -> None:
    cols = [
        "model",
        "eta",
        "lambda",
        "n_params",
        "actions",
        "in_sample_nll",
        "heldout_nll",
        "heldout_nll_per_action",
        "delta_heldout_nll",
        "expected_signal_move",
        "expected_btom_legibility",
        "expected_mean_posterior_lift",
        "aic",
        "bic",
    ]
    html_sections = []
    for key, info in results.items():
        label = WINDOWS[key]["label"]
        html_sections.append(
            f"""
  <section class="panel">
    <h2>{html.escape(label)}</h2>
    <p class="note">Actions={info['actions']}. Fixed lambda={FIXED_LAMBDA:g}; only eta is fitted. Goal weights are unchanged for every eta.</p>
    <a href="{rel(info['eta_plot'])}"><img src="{rel(info['eta_plot'])}" alt="{html.escape(label)} eta sweep"></a>
    <a href="{rel(info['model_plot'])}"><img src="{rel(info['model_plot'])}" alt="{html.escape(label)} model summary"></a>
    {html_table(info['summary_df'], cols)}
  </section>
            """
        )
    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency Costly Legibility Utility Fit</title>
<style>
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f8fb; color:#1f2933; }}
header {{ padding:34px 48px 24px; background:#ffffff; border-bottom:1px solid #d9e2ec; }}
main {{ max-width:1120px; margin:0 auto; padding:28px 24px 60px; }}
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
  <h1>Shared-Agency Costly Legibility Utility Fit</h1>
  <p class="note">Model 1: fixed lambda=0.2, costly action signaling utility with one free eta. This allows legible actions even when they are not value-safe tie-breaks.</p>
  <div class="links">
    <a href="{rel(OUT_DIR / 'step0_model_summary.csv')}">presentation-step summary CSV</a>
    <a href="{rel(OUT_DIR / 'step1_model_summary.csv')}">step-1 summary CSV</a>
    <a href="{rel(OUT_DIR / 'step1_3_model_summary.csv')}">step 1-3 summary CSV</a>
    <a href="{rel(NOTEBOOK_PATH)}">notebook</a>
    <a href="shared_agency_log_odds_legibility_fit.html">log-odds legibility fit</a>
    <a href="shared_agency_log_odds_eta_sweep.html">log-odds full eta sweep</a>
    <a href="shared_agency_costly_mixture_rho_sweep.html">communicative action mixture rho sweep</a>
    <a href="shared_agency_tiebreak_signal_fit.html">tie-break signaling fit</a>
    <a href="shared_agency_information_gain_fit.html">information-gain fit</a>
    <a href="shared_agency_uncertainty_gated_rho_fit.html">uncertainty-gated rho fit</a>
    <a href="shared_agency_step1_model_comparison.html">step-1 alpha fit report</a>
    <a href="shared_agency_signal_window_model_comparison.html">step 1-3 alpha fit report</a>
    <a href="shared_agency_step_level_model_comparison.html">all-step step-level report</a>
    <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">trial-level baseline report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Model</h2>
    <p class="note">The base term is the existing unshaped JointRL goal-conditioned action policy. The signaling term is target posterior lift, so eta controls costly willingness to make the sampled goal more legible.</p>
    <p><code>pi_eta(a|s,g,P) proportional to pi_base(a|s,g) exp(eta [log P(g|a) - log P(g)])</code></p>
  </section>
  {''.join(html_sections)}
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def analyze_window(key: str, observations: Sequence[StepObs]) -> Dict[str, Any]:
    grid, best = fit_eta(observations)
    cv_df = cv_for_window(observations)
    summary_df = summarize_models(observations, best, cv_df)
    grid_path = OUT_DIR / f"{key}_eta_sweep.csv"
    cv_path = OUT_DIR / f"{key}_cv_folds.csv"
    summary_path = OUT_DIR / f"{key}_model_summary.csv"
    eta_plot = ASSET_DIR / f"{key}_eta_sweep.png"
    model_plot = ASSET_DIR / f"{key}_model_summary.png"
    grid.to_csv(grid_path, index=False)
    cv_df.to_csv(cv_path, index=False)
    summary_df.to_csv(summary_path, index=False)
    plot_eta_sweep(grid, best, eta_plot, f"{WINDOWS[key]['label']}: eta sweep")
    plot_model_summary(summary_df, model_plot, f"{WINDOWS[key]['label']}: model summary")
    return {
        "actions": len(observations),
        "grid_df": grid,
        "summary_df": summary_df,
        "best": best,
        "grid_path": grid_path,
        "cv_path": cv_path,
        "summary_path": summary_path,
        "eta_plot": eta_plot,
        "model_plot": model_plot,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    human_rows = step_report.load_human_rows()
    results: Dict[str, Dict[str, Any]] = {}
    for key, cfg in WINDOWS.items():
        observations = window_observations(human_rows, int(cfg["start"]), int(cfg["end"]))
        results[key] = analyze_window(key, observations)
    write_notebook()
    write_html(results)
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
                        "eta",
                        "negative_log_likelihood",
                        "expected_signal_move",
                        "expected_btom_legibility",
                        "expected_mean_posterior_lift",
                        "fit_stage",
                    }
                },
                "best_heldout_model": str(value["summary_df"].iloc[0]["model"]),
            }
            for key, value in results.items()
        },
        "outputs": {
            "notebook": str(NOTEBOOK_PATH),
            "step0_summary": str(OUT_DIR / "step0_model_summary.csv"),
            "step1_summary": str(OUT_DIR / "step1_model_summary.csv"),
            "step1_3_summary": str(OUT_DIR / "step1_3_model_summary.csv"),
        },
    }
    (OUT_DIR / "costly_legibility_fit_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
