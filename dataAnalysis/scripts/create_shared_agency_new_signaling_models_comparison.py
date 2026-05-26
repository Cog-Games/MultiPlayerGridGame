#!/usr/bin/env python3
"""Compare new one-parameter shared-agency signaling variants."""

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
from fit_always_signal_rsa_lambda_alpha import human_targets, metric_binomial_nll, simulated_rates  # noqa: E402
from fit_signal_alpha_beta3 import add_measures, comparison_rows, load_raw, long_player_rows, resolved_raw_path  # noqa: E402


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_new_signaling_models_comparison"
ASSET_DIR = OUT_DIR / "assets"
SIM_DIR = OUT_DIR / "simulations"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "shared_agency_new_signaling_models_comparison"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_new_signaling_models_comparison"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_new_signaling_models_comparison.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_new_signaling_models_comparison.html"
SIM_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_always_signal_vs_always_signal_2p3g.js"

SESSIONS = 30
TRIALS = 12
SEED = 42
BETA = 3.0
FIXED_LAMBDA = 0.2
SWEEP_VALUES = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0]

NO_SIGNAL_LABEL = "Shared agency no signaling"
OPPORTUNITY_LABEL = "Opportunity-gated communicative action mixture"
CONTRAST_LABEL = "Goal-contrast signaling"
ONE_STEP_LABEL = "One-step deliberate signal"
HUMAN_LABEL = base.HUMAN_LABEL

GROUP_ORDER = [NO_SIGNAL_LABEL, OPPORTUNITY_LABEL, CONTRAST_LABEL, ONE_STEP_LABEL, HUMAN_LABEL]
PALETTE = {
    NO_SIGNAL_LABEL: "#59a14f",
    OPPORTUNITY_LABEL: "#4f79a8",
    CONTRAST_LABEL: "#b07aa1",
    ONE_STEP_LABEL: "#e15759",
    HUMAN_LABEL: "#f28e2b",
}
PLOT_LABELS = {
    NO_SIGNAL_LABEL: "Shared agency\n(no signaling)",
    OPPORTUNITY_LABEL: "Opportunity-gated\ncommunicative\naction mixture",
    CONTRAST_LABEL: "Goal-contrast\nsignaling",
    ONE_STEP_LABEL: "One-step\ndeliberate signal",
    HUMAN_LABEL: "Human-Human",
}
VARIANTS = [
    {
        "key": "opportunity_gated_costly_mixture",
        "label": OPPORTUNITY_LABEL,
        "score": "opportunity_costly_mixture",
        "parameter": "rho_max",
    },
    {
        "key": "goal_contrast",
        "label": CONTRAST_LABEL,
        "score": "goal_contrast",
        "parameter": "rho",
    },
    {
        "key": "one_step_deliberate",
        "label": ONE_STEP_LABEL,
        "score": "one_step_deliberate",
        "parameter": "rho",
    },
]
METRIC_ORDER = [
    "Success Rate (%)",
    "Coordination Efficiency (%)",
    "Commitment (%)",
    "Signaling Move (%)",
    "BToM Step 1 (%)",
    "BToM Step 1-3 (%)",
]


def configure_base_plots() -> None:
    base.BTOM_GROUP_ORDER = GROUP_ORDER
    base.BTOM_PALETTE = PALETTE
    base.PLOT_LABELS = PLOT_LABELS


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def fmt(value: float) -> str:
    return f"{value:g}".replace("-", "neg").replace(".", "p")


def raw_path_for(score: str, alpha: float, raw_dir: Path) -> Path:
    score_suffix = "" if score == "logposterior" else f"_score_{score}"
    suffix = (
        f"beta_{fmt(BETA)}_lambda_{fmt(FIXED_LAMBDA)}_alpha_{fmt(alpha)}"
        f"{score_suffix}_sessions_0_to_{SESSIONS - 1}"
    )
    return raw_dir / f"always_signal_vs_always_signal_2p3g_raw_trials_{suffix}.json"


def raw_exists(path: Path) -> Path | None:
    try:
        return resolved_raw_path(path)
    except FileNotFoundError:
        return None


def run_json_command(cmd: List[str], expected_raw: Path) -> Dict[str, Any]:
    existing = raw_exists(expected_raw)
    if existing is not None:
        return {"rawTrialsPath": str(existing), "command": " ".join(cmd), "reused": True}
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        result.check_returncode()
    out = json.loads(result.stdout)
    out["command"] = " ".join(cmd)
    out["reused"] = False
    return out


def compress_raw(raw_path: Path) -> Path:
    if raw_path.suffix == ".zst":
        return raw_path
    subprocess.run(["zstd", "-q", "-f", "--rm", str(raw_path)], cwd=PROJECT_ROOT, check=True)
    return Path(f"{raw_path}.zst")


def run_simulation(score: str, alpha: float, subdir: str) -> Dict[str, Any]:
    output_dir = SIM_DIR / subdir
    raw_dir = RAW_DIR / subdir
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    expected_raw = raw_path_for(score, alpha, raw_dir)
    cmd = [
        "node",
        str(SIM_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--lambda",
        str(FIXED_LAMBDA),
        "--alpha",
        str(alpha),
        "--beta",
        str(BETA),
        "--score",
        score,
        "--horizon",
        "1",
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    result = run_json_command(cmd, expected_raw)
    result["rawTrialsPath"] = str(compress_raw(Path(result["rawTrialsPath"])))
    return result


def no_signal_result() -> Dict[str, Any]:
    return run_simulation("costly_mixture", 0.0, "no_signaling")


def btom_rates_for_raw(raw_trials: List[Dict[str, Any]], group: str, steps: Sequence[int]) -> Dict[str, float]:
    rows: List[Dict[str, Any]] = []
    for trial in raw_trials:
        if not trial.get("newGoalPresented"):
            continue
        for player_index in (0, 1):
            posteriors = base.btom_for_player(trial, player_index)
            if posteriors is None:
                continue
            values = [float(posteriors[step]) for step in steps if step < len(posteriors)]
            if not values:
                continue
            rows.append(
                {
                    "participantId": base.participant_id(trial, group, player_index),
                    "distanceCondition": trial.get("distanceCondition"),
                    "posterior": float(np.mean(values)),
                }
            )
    if not rows:
        return {"average": np.nan, "equal_to_both": np.nan}
    df = pd.DataFrame(rows)
    avg_values = df.groupby("participantId", observed=False)["posterior"].mean().to_numpy(dtype=float)
    equal = df[df["distanceCondition"] == "equal_to_both"]
    equal_values = equal.groupby("participantId", observed=False)["posterior"].mean().to_numpy(dtype=float)
    return {
        "average": float(np.mean(avg_values)) if avg_values.size else np.nan,
        "equal_to_both": float(np.mean(equal_values)) if equal_values.size else np.nan,
    }


def measure_row(raw_trials: List[Dict[str, Any]], label: str) -> Dict[str, float]:
    df = add_measures(long_player_rows(raw_trials, label))
    out: Dict[str, float] = {}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows(label, raw_trials, df, condition)
        values = {row["metric"]: row["mean_percent"] for row in rows}
        out[f"{prefix}_success_percent"] = values.get("Success Rate (%)", np.nan)
        out[f"{prefix}_efficiency_percent"] = values.get("Coordination Efficiency (%)", np.nan)
        out[f"{prefix}_commitment_percent"] = values.get("Commitment (%)", np.nan)
        out[f"{prefix}_signaling_percent"] = values.get("Signaling Move (%)", np.nan)
    step1 = btom_rates_for_raw(raw_trials, label, [1])
    step13 = btom_rates_for_raw(raw_trials, label, [1, 2, 3])
    out["average_btom_step1_percent"] = step1["average"] * 100
    out["equal_btom_step1_percent"] = step1["equal_to_both"] * 100
    out["average_btom_step1_3_percent"] = step13["average"] * 100
    out["equal_btom_step1_3_percent"] = step13["equal_to_both"] * 100
    return out


def evaluate_setting(variant: Dict[str, str], value: float, target: pd.DataFrame, no_signal_raw: Path) -> Dict[str, Any]:
    if math.isclose(float(value), 0.0, abs_tol=1e-12):
        result = {"rawTrialsPath": str(no_signal_raw), "command": "reused no-signaling baseline", "reused": True}
    else:
        result = run_simulation(variant["score"], float(value), f"{variant['key']}_sweep")
    raw_trials = load_raw(Path(result["rawTrialsPath"]))
    sim_df = add_measures(long_player_rows(raw_trials, variant["label"]))
    commitment_nll, signaling_nll = metric_binomial_nll(target, simulated_rates(sim_df))
    row: Dict[str, Any] = {
        "model_key": variant["key"],
        "model": variant["label"],
        "score": variant["score"],
        "parameter": variant["parameter"],
        "parameter_value": float(value),
        "lambda": FIXED_LAMBDA,
        "commitment_nll": commitment_nll,
        "signaling_nll": signaling_nll,
        "binomial_nll": commitment_nll + signaling_nll,
        "raw_trials": result["rawTrialsPath"],
        "command": result["command"],
        "reused": result.get("reused", False),
    }
    row.update(measure_row(raw_trials, variant["label"]))
    return row


def run_sweeps() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    no_signal = no_signal_result()
    no_signal_raw = Path(no_signal["rawTrialsPath"])
    human_raw = load_raw(base.HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    target = human_targets(human_df)
    rows = []
    for variant in VARIANTS:
        for value in SWEEP_VALUES:
            rows.append(evaluate_setting(variant, float(value), target, no_signal_raw))
    sweep_df = pd.DataFrame(rows).sort_values(["model_key", "parameter_value"]).reset_index(drop=True)
    best_rows = []
    for variant in VARIANTS:
        sub = sweep_df[sweep_df["model_key"] == variant["key"]]
        best_rows.append(sub.loc[sub["binomial_nll"].idxmin()].to_dict())
    best_df = pd.DataFrame(best_rows)
    raw_sources = [
        {
            "model": NO_SIGNAL_LABEL,
            "score": "costly_mixture",
            "parameter": "rho",
            "parameter_value": 0.0,
            "lambda": FIXED_LAMBDA,
            "raw_trials": str(no_signal_raw),
            "command": no_signal.get("command", ""),
        }
    ]
    for row in best_rows:
        raw_sources.append(
            {
                "model": row["model"],
                "score": row["score"],
                "parameter": row["parameter"],
                "parameter_value": row["parameter_value"],
                "lambda": row["lambda"],
                "raw_trials": row["raw_trials"],
                "command": row["command"],
            }
        )
    return sweep_df, best_df, pd.DataFrame(raw_sources)


def btom_metric_rows(step_participant: pd.DataFrame, steps: Sequence[int], metric: str, condition: str | None, condition_scope: str) -> List[Dict[str, Any]]:
    sub = step_participant[step_participant["stepFromNewGoal"].isin(list(steps))].copy()
    if condition:
        sub = sub[sub["distanceCondition"] == condition]
    rows: List[Dict[str, Any]] = []
    for group in GROUP_ORDER:
        values = (
            sub[sub["group"] == group]
            .groupby(["participantId", "group"], observed=False)["posterior"]
            .mean()
            .to_numpy(dtype=float)
        )
        stats = base.mean_ci(values)
        rows.append(
            {
                "group": group,
                "metric": metric,
                "mean_percent": stats["mean"] * 100,
                "ci95_percent": stats["ci95"] * 100,
                "n": stats["n"],
                "condition_scope": condition_scope,
            }
        )
    return rows


def build_behavior_outputs(raw_sources: pd.DataFrame) -> Dict[str, Any]:
    models = [
        {"key": "no_signaling", "label": NO_SIGNAL_LABEL, "raw_trials": raw_sources.iloc[0]["raw_trials"]},
        {"key": "opportunity", "label": OPPORTUNITY_LABEL, "raw_trials": raw_sources[raw_sources["model"] == OPPORTUNITY_LABEL].iloc[0]["raw_trials"]},
        {"key": "goal_contrast", "label": CONTRAST_LABEL, "raw_trials": raw_sources[raw_sources["model"] == CONTRAST_LABEL].iloc[0]["raw_trials"]},
        {"key": "one_step", "label": ONE_STEP_LABEL, "raw_trials": raw_sources[raw_sources["model"] == ONE_STEP_LABEL].iloc[0]["raw_trials"]},
    ]
    metric_df = base.build_metric_table(models)
    btom_df = base.build_btom_table(models)
    _step_long, step_participant, mean_participant = base.build_btom_step_tables(btom_df, max_step=5)
    btom_rows = (
        btom_metric_rows(step_participant, [1], "BToM Step 1 (%)", None, "average")
        + btom_metric_rows(step_participant, [1], "BToM Step 1 (%)", "equal_to_both", "equal_to_both")
        + btom_metric_rows(step_participant, [1, 2, 3], "BToM Step 1-3 (%)", None, "average")
        + btom_metric_rows(step_participant, [1, 2, 3], "BToM Step 1-3 (%)", "equal_to_both", "equal_to_both")
    )
    metric_df = pd.concat([metric_df, pd.DataFrame(btom_rows)], ignore_index=True)
    summary_df = wide_summary(metric_df)
    return {
        "models": models,
        "metric_df": metric_df,
        "summary_df": summary_df,
        "btom_df": btom_df,
        "step_participant": step_participant,
        "mean_participant": mean_participant,
    }


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
    out["group"] = pd.Categorical(out["group"], categories=GROUP_ORDER, ordered=True)
    return out.sort_values(["condition_scope", "group"]).astype({"condition_scope": str, "group": str}).reset_index(drop=True)


def plot_six_panel(metric_df: pd.DataFrame, path: Path, title: str, condition_scope: str) -> None:
    df = metric_df[metric_df["condition_scope"] == condition_scope].copy()
    fig, axes = plt.subplots(3, 2, figsize=(17.2, 16.8))
    fig.suptitle(title, fontsize=18, fontweight="bold", y=0.992)
    colors = [PALETTE[group] for group in GROUP_ORDER]
    for ax, metric in zip(axes.ravel(), METRIC_ORDER):
        sub = df[df["metric"] == metric].set_index("group").reindex(GROUP_ORDER).reset_index()
        x = np.arange(len(GROUP_ORDER))
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
        ax.set_xticklabels([PLOT_LABELS[group] for group in GROUP_ORDER], rotation=0, ha="center", fontsize=8)
        ax.tick_params(axis="x", pad=8)
        if metric in {"Commitment (%)", "BToM Step 1 (%)", "BToM Step 1-3 (%)"}:
            ax.axhline(50, ls="--", lw=1.2, color="#6b7280", alpha=0.65)
        ax.grid(axis="y", color="#d8dde3", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout(rect=[0, 0, 1, 0.965])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_btom_trajectory(step_participant: pd.DataFrame, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(11.8, 7.2))
    for group in GROUP_ORDER:
        sub = step_participant[step_participant["group"] == group]
        if sub.empty:
            continue
        grouped = sub.groupby("stepFromNewGoal", observed=False)["posterior"]
        x = sorted(grouped.groups.keys())
        means = [float(grouped.mean().loc[step]) * 100 for step in x]
        sems = [float(grouped.sem().fillna(0).loc[step]) * 100 for step in x]
        cis = [1.96 * value for value in sems]
        ax.plot(x, means, marker="o", linewidth=2.3, color=PALETTE[group], label=PLOT_LABELS[group].replace("\n", " "))
        ax.fill_between(x, np.asarray(means) - np.asarray(cis), np.asarray(means) + np.asarray(cis), color=PALETTE[group], alpha=0.14)
    ax.axhline(50, ls="--", lw=1.2, color="#6b7280", alpha=0.65)
    ax.set_title("BToM Trajectory After New Goal", fontsize=15, fontweight="bold")
    ax.set_xlabel("Steps from new-goal presentation")
    ax.set_ylabel("BToM posterior P(final reached goal) (%)")
    ax.set_xlim(-0.1, 5.1)
    ax.set_ylim(40, 102)
    ax.set_xticks(range(6))
    ax.grid(axis="y", color="#d8dde3")
    ax.grid(axis="x", visible=False)
    ax.legend(frameon=True, fontsize=9)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_sweep(sweep_df: pd.DataFrame, variant: Dict[str, str], path: Path) -> None:
    df = sweep_df[sweep_df["model_key"] == variant["key"]].sort_values("parameter_value")
    fig, axes = plt.subplots(3, 2, figsize=(14.5, 12.5))
    fig.suptitle(f"{variant['label']} sweep", fontsize=16, fontweight="bold", y=0.99)
    panels = [
        ("binomial_nll", "Commitment + signaling NLL"),
        ("average_commitment_percent", "Commitment, all distance"),
        ("average_signaling_percent", "Signaling move, all distance"),
        ("average_btom_step1_percent", "BToM Step 1, all distance"),
        ("average_btom_step1_3_percent", "BToM Step 1-3, all distance"),
        ("equal_signaling_percent", "Signaling move, equal-to-both"),
    ]
    best_x = float(df.loc[df["binomial_nll"].idxmin(), "parameter_value"])
    for ax, (col, label) in zip(axes.ravel(), panels):
        ax.plot(df["parameter_value"], df[col], marker="o", linewidth=2.2, color=PALETTE[variant["label"]])
        ax.axvline(best_x, color="#111827", linestyle="--", linewidth=1.1)
        ax.set_title(label, fontsize=12, fontweight="bold")
        ax.set_xlabel(variant["parameter"])
        ax.grid(axis="y", color="#d8dde3")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def html_table(df: pd.DataFrame, columns: Sequence[str]) -> str:
    header = "".join(f"<th>{html.escape(col)}</th>" for col in columns)
    body = []
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
        body.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def write_notebook() -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    nb = {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Shared-Agency New Signaling Models Comparison\n"]},
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from pathlib import Path\n",
                    "import pandas as pd\n",
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "summary = pd.read_csv(OUT / 'new_signaling_models_summary.csv')\n",
                    "best = pd.read_csv(OUT / 'new_signaling_models_best_parameters.csv')\n",
                    "sweep = pd.read_csv(OUT / 'new_signaling_models_sweep.csv')\n",
                    "raw_sources = pd.read_csv(OUT / 'new_signaling_models_raw_sources.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Summary metrics\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["summary.round(2)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Best parameters\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["best.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Sweep\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["sweep.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Raw sources\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["raw_sources\n"]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def write_html(best_df: pd.DataFrame, summary_df: pd.DataFrame, raw_sources: pd.DataFrame, outputs: Dict[str, Path]) -> None:
    best_cols = ["model", "score", "parameter", "parameter_value", "lambda", "commitment_nll", "signaling_nll", "binomial_nll"]
    summary_cols = ["condition_scope", "group", *METRIC_ORDER]
    raw_cols = ["model", "score", "parameter", "parameter_value", "raw_trials"]
    sweep_link_parts = []
    for variant in VARIANTS:
        plot_path = outputs[f"{variant['key']}_sweep_plot"]
        sweep_link_parts.append(
            f'<a href="{rel(plot_path)}"><img src="{rel(plot_path)}" alt="{html.escape(variant["label"])} sweep"></a>'
        )
    sweep_links = "\n".join(sweep_link_parts)
    text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency New Signaling Models Comparison</title>
<style>
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f8fb; color:#1f2933; }}
header {{ padding:34px 48px 24px; background:#fff; border-bottom:1px solid #d9e2ec; }}
main {{ max-width:1220px; margin:0 auto; padding:28px 24px 60px; }}
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
  <h1>Shared-Agency New Signaling Models Comparison</h1>
  <p class="note">Three one-parameter signaling variants are compared against no signaling and Human-Human. The shared-agency commitment parameter is fixed at lambda=0.2 for all model rows.</p>
  <div class="links">
    <a href="{rel(OUT_DIR / 'new_signaling_models_summary.csv')}">summary CSV</a>
    <a href="{rel(OUT_DIR / 'new_signaling_models_sweep.csv')}">sweep CSV</a>
    <a href="{rel(OUT_DIR / 'new_signaling_models_best_parameters.csv')}">best parameter CSV</a>
    <a href="{rel(OUT_DIR / 'new_signaling_models_raw_sources.csv')}">raw sources CSV</a>
    <a href="{rel(NOTEBOOK_PATH)}">notebook</a>
    <a href="shared_agency_signaling_models_overview.md">signaling models overview</a>
    <a href="shared_agency_step_level_model_comparison.html">step-level shared-agency report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Selected Parameters</h2>
    <p class="note">Each variant was selected by trial-level commitment + signaling binomial NLL against Human-Human, using the compact sweep values {SWEEP_VALUES}.</p>
    {html_table(best_df, best_cols)}
  </section>
  <section class="panel">
    <h2>All Distance Conditions</h2>
    <a href="{rel(outputs['average_plot'])}"><img src="{rel(outputs['average_plot'])}" alt="all distance six metric comparison"></a>
  </section>
  <section class="panel">
    <h2>Equal-to-Both</h2>
    <a href="{rel(outputs['equal_plot'])}"><img src="{rel(outputs['equal_plot'])}" alt="equal to both six metric comparison"></a>
  </section>
  <section class="panel">
    <h2>BToM Trajectory</h2>
    <a href="{rel(outputs['btom_trajectory_plot'])}"><img src="{rel(outputs['btom_trajectory_plot'])}" alt="BToM trajectory"></a>
  </section>
  <section class="panel">
    <h2>Sweep Diagnostics</h2>
    {sweep_links}
  </section>
  <section class="panel">
    <h2>Summary Table</h2>
    {html_table(summary_df, summary_cols)}
  </section>
  <section class="panel">
    <h2>Raw Sources</h2>
    {html_table(raw_sources, raw_cols)}
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(text, encoding="utf-8")


def main() -> None:
    configure_base_plots()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    SIM_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    sweep_df, best_df, raw_sources = run_sweeps()
    behavior = build_behavior_outputs(raw_sources)

    outputs = {
        "average_plot": ASSET_DIR / "new_signaling_models_average_6metric.png",
        "equal_plot": ASSET_DIR / "new_signaling_models_equal_to_both_6metric.png",
        "btom_trajectory_plot": ASSET_DIR / "new_signaling_models_btom_first5_trajectory.png",
    }
    for variant in VARIANTS:
        outputs[f"{variant['key']}_sweep_plot"] = ASSET_DIR / f"{variant['key']}_sweep.png"

    sweep_df.to_csv(OUT_DIR / "new_signaling_models_sweep.csv", index=False)
    best_df.to_csv(OUT_DIR / "new_signaling_models_best_parameters.csv", index=False)
    raw_sources.to_csv(OUT_DIR / "new_signaling_models_raw_sources.csv", index=False)
    behavior["metric_df"].to_csv(OUT_DIR / "new_signaling_models_metric_long.csv", index=False)
    behavior["summary_df"].to_csv(OUT_DIR / "new_signaling_models_summary.csv", index=False)
    btom_csv = behavior["btom_df"].copy()
    btom_csv["posteriors"] = btom_csv["posteriors"].apply(json.dumps)
    btom_csv.to_csv(OUT_DIR / "new_signaling_models_btom_player_trajectories.csv", index=False)
    behavior["step_participant"].to_csv(OUT_DIR / "new_signaling_models_btom_first5_step_per_participant.csv", index=False)
    behavior["mean_participant"].to_csv(OUT_DIR / "new_signaling_models_btom_first5_mean_per_participant.csv", index=False)

    plot_six_panel(behavior["metric_df"], outputs["average_plot"], "New Signaling Models: All Distance Conditions", "average")
    plot_six_panel(behavior["metric_df"], outputs["equal_plot"], "New Signaling Models: Equal-to-Both", "equal_to_both")
    plot_btom_trajectory(behavior["step_participant"], outputs["btom_trajectory_plot"])
    for variant in VARIANTS:
        plot_sweep(sweep_df, variant, outputs[f"{variant['key']}_sweep_plot"])

    write_notebook()
    write_html(best_df, behavior["summary_df"], raw_sources, outputs)

    summary = {
        "html": str(HTML_PATH),
        "fixed_lambda": FIXED_LAMBDA,
        "sweep_values": SWEEP_VALUES,
        "best_parameters": best_df.to_dict(orient="records"),
        "outputs": {key: str(value) for key, value in outputs.items()},
        "notebook": str(NOTEBOOK_PATH),
    }
    (OUT_DIR / "new_signaling_models_report_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
