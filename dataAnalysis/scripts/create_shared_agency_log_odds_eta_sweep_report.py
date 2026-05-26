#!/usr/bin/env python3
"""Full model-model sweep for shared-agency log-odds signaling eta."""

from __future__ import annotations

import html
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

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
from fit_always_signal_rsa_lambda_alpha import (  # noqa: E402
    human_targets,
    metric_binomial_nll,
    simulated_rates,
    weighted_metric_rate,
)
from fit_signal_alpha_beta3 import add_measures, comparison_rows, load_raw, long_player_rows  # noqa: E402


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_log_odds_eta_sweep"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "shared_agency_log_odds_eta_sweep"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_log_odds_eta_sweep"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_log_odds_eta_sweep.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_log_odds_eta_sweep.html"

SESSIONS = 30
TRIALS = 12
SEED = 42
BETA = 3.0
FIXED_LAMBDA = 0.2
ETA_SWEEP_VALUES = [0.0, 0.005, 0.01, 0.0125, 0.02, 0.025, 0.03, 0.04, 0.05, 0.075, 0.1]

NO_SIGNAL_LABEL = "Shared agency no signaling"
LOG_ODDS_LABEL = "Shared agency log-odds signaling"
HUMAN_LABEL = base.HUMAN_LABEL
GROUP_ORDER = [NO_SIGNAL_LABEL, LOG_ODDS_LABEL, HUMAN_LABEL]
PALETTE = {
    NO_SIGNAL_LABEL: "#59a14f",
    LOG_ODDS_LABEL: "#e15759",
    HUMAN_LABEL: "#f28e2b",
}
PLOT_LABELS = {
    NO_SIGNAL_LABEL: "Shared agency\n(no signaling)",
    LOG_ODDS_LABEL: "Shared agency\n(log-odds\nsignaling)",
}


def configure_base_plots() -> None:
    base.BTOM_GROUP_ORDER = GROUP_ORDER
    base.BTOM_PALETTE = PALETTE
    base.PLOT_LABELS = PLOT_LABELS


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def fmt_path_number(value: float) -> str:
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


def logodds_simulation_paths(eta: float) -> Dict[str, Path]:
    suffix = (
        f"beta_{fmt_path_number(BETA)}_lambda_{fmt_path_number(FIXED_LAMBDA)}_"
        f"alpha_{fmt_path_number(eta)}_score_logodds_sessions_0_to_{SESSIONS - 1}"
    )
    output_dir = OUT_DIR / "simulations" / "log_odds_eta_sweep"
    raw_dir = RAW_DIR / "log_odds_eta_sweep"
    return {
        "output_dir": output_dir,
        "raw_dir": raw_dir,
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


def run_logodds_simulation(eta: float) -> Dict[str, Any]:
    paths = logodds_simulation_paths(eta)
    paths["output_dir"].mkdir(parents=True, exist_ok=True)
    paths["raw_dir"].mkdir(parents=True, exist_ok=True)
    cmd = [
        "node",
        str(base.SHARED_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--lambda",
        str(FIXED_LAMBDA),
        "--alpha",
        str(eta),
        "--beta",
        str(BETA),
        "--score",
        "logodds",
        "--horizon",
        "1",
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir",
        str(paths["output_dir"]),
        "--raw-output-dir",
        str(paths["raw_dir"]),
    ]
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


def metric_row_for_raw(eta: float, raw_trials: List[Dict[str, Any]], sim_df: pd.DataFrame, label: str) -> Dict[str, float]:
    row: Dict[str, float] = {"lambda": FIXED_LAMBDA, "eta": eta}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows(label, raw_trials, sim_df, condition)
        metric_values = {item["metric"]: item for item in rows}
        row[f"{prefix}_success_percent"] = metric_values["Success Rate (%)"]["mean_percent"]
        row[f"{prefix}_efficiency_percent"] = metric_values["Coordination Efficiency (%)"]["mean_percent"]
        row[f"{prefix}_commitment_percent"] = metric_values["Commitment (%)"]["mean_percent"]
        row[f"{prefix}_signaling_percent"] = metric_values["Signaling Move (%)"]["mean_percent"]
    return row


def evaluate_eta(eta: float, target: pd.DataFrame) -> Dict[str, Any]:
    result = run_logodds_simulation(eta)
    raw_trials = load_raw(Path(result["rawTrialsPath"]))
    sim_df = add_measures(long_player_rows(raw_trials, LOG_ODDS_LABEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    row: Dict[str, Any] = {
        "lambda": FIXED_LAMBDA,
        "eta": float(eta),
        "fit_stage": "sweep",
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
    row.update(metric_row_for_raw(float(eta), raw_trials, sim_df, LOG_ODDS_LABEL))
    btom_rates = base.btom_step1_rates_for_raw(raw_trials, LOG_ODDS_LABEL)
    row["average_btom_step1_percent"] = btom_rates["average"] * 100 if np.isfinite(btom_rates["average"]) else np.nan
    row["equal_btom_step1_percent"] = btom_rates["equal_to_both"] * 100 if np.isfinite(btom_rates["equal_to_both"]) else np.nan
    return row


def run_eta_sweep() -> tuple[pd.DataFrame, Dict[str, Any]]:
    human_raw = load_raw(base.HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    target = human_targets(human_df)
    rows = [evaluate_eta(float(eta), target) for eta in ETA_SWEEP_VALUES]
    sweep_df = pd.DataFrame(rows).sort_values("eta").reset_index(drop=True)
    best_row = sweep_df.loc[sweep_df["binomial_nll"].idxmin()].to_dict()
    return sweep_df, best_row


def build_report_tables(best_row: Dict[str, Any]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    configure_base_plots()
    models = [
        {
            "key": "shared_agency_no_signaling_lambda02",
            "label": NO_SIGNAL_LABEL,
            "raw_trials": str(run_logodds_simulation(0.0)["rawTrialsPath"]),
            "lambda": FIXED_LAMBDA,
            "eta": 0.0,
        },
        {
            "key": "shared_agency_log_odds_best_eta",
            "label": LOG_ODDS_LABEL,
            "raw_trials": best_row["raw_trials"],
            "lambda": FIXED_LAMBDA,
            "eta": float(best_row["eta"]),
            "fit_objective": "commitment_plus_signaling_nll",
        },
    ]
    raw_sources_df = pd.DataFrame(
        [
            {
                "key": model["key"],
                "label": model["label"],
                "raw_trials": model["raw_trials"],
                "lambda": model.get("lambda"),
                "eta": model.get("eta"),
                "fit_objective": model.get("fit_objective", "reference"),
            }
            for model in models
        ]
    )
    btom_df = base.build_btom_table(models)
    btom_step_long, btom_step_participant, btom_mean_participant = base.build_btom_step_tables(btom_df, max_step=5)
    metric_df = base.build_metric_table(models)
    btom_metric_df = pd.DataFrame(
        base.btom_step1_metric_rows(btom_step_participant, None, "average")
        + base.btom_step1_metric_rows(btom_step_participant, "equal_to_both", "equal_to_both")
    )
    metric_df = pd.concat([metric_df, btom_metric_df], ignore_index=True)
    summary_df = base.wide_summary(metric_df)
    return models, raw_sources_df, metric_df, summary_df, btom_df, btom_step_participant


def plot_eta_sweep(sweep_df: pd.DataFrame, best_row: Dict[str, Any], path: Path) -> None:
    df = sweep_df.sort_values("eta")
    best_eta = float(best_row["eta"])
    fig, axes = plt.subplots(3, 2, figsize=(15.8, 14.8))
    flat_axes = axes.ravel()
    fig.suptitle(
        f"Shared Agency Log-Odds Eta Sweep (lambda = {FIXED_LAMBDA:g})",
        fontsize=17,
        fontweight="bold",
        y=0.99,
    )
    nll_ax = flat_axes[0]
    nll_ax.plot(df["eta"], df["binomial_nll"], marker="o", linewidth=2.4, color="#111827", label="Commitment + signaling NLL")
    nll_ax.plot(df["eta"], df["commitment_nll"], marker="o", linewidth=1.8, color="#4f79a8", label="Commitment NLL")
    nll_ax.plot(df["eta"], df["signaling_nll"], marker="o", linewidth=1.8, color="#e15759", label="Signaling NLL")
    nll_ax.axvline(best_eta, color="#111827", linestyle=":", linewidth=1.5, label=f"Best eta = {best_eta:g}")
    nll_ax.set_title("Fit Objective", fontsize=13, fontweight="bold")
    nll_ax.set_xlabel("eta")
    nll_ax.set_ylabel("NLL")
    nll_ax.grid(axis="y", color="#d8dde3")
    nll_ax.grid(axis="x", visible=False)
    nll_ax.legend(frameon=True, fontsize=8)

    panels = [
        ("Success Rate (%)", "average_success_percent", "equal_success_percent"),
        ("Coordination Efficiency (%)", "average_efficiency_percent", "equal_efficiency_percent"),
        ("Commitment (%)", "average_commitment_percent", "equal_commitment_percent"),
        ("Signaling Move (%)", "average_signaling_percent", "equal_signaling_percent"),
        ("BToM Step 1 (%)", "average_btom_step1_percent", "equal_btom_step1_percent"),
    ]
    for ax, (title, avg_col, equal_col) in zip(flat_axes[1:], panels):
        ax.plot(df["eta"], df[avg_col], marker="o", linewidth=2.2, color="#4f79a8", label="All distance")
        ax.plot(df["eta"], df[equal_col], marker="o", linewidth=2.2, linestyle="--", color="#59a14f", label="Equal-to-both")
        ax.axvline(best_eta, color="#111827", linestyle=":", linewidth=1.5)
        if title == "Commitment (%)":
            ax.axhline(50, ls="--", lw=1.1, color="#6b7280", alpha=0.6)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xlabel("eta")
        ax.set_ylabel("(%)")
        ax.set_ylim(0, 105)
        ax.grid(axis="y", color="#d8dde3")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    flat_axes[1].legend(frameon=True, fontsize=8)
    for ax in flat_axes:
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout(rect=[0, 0, 1, 0.965])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def html_table(df: pd.DataFrame, columns: List[str]) -> str:
    header = "".join(f"<th>{html.escape(col)}</th>" for col in columns)
    rows = []
    for record in df[columns].to_dict(orient="records"):
        cells = []
        for col in columns:
            value = record[col]
            if isinstance(value, float):
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
            {"cell_type": "markdown", "metadata": {}, "source": ["# Shared-Agency Log-Odds Eta Sweep\n"]},
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from pathlib import Path\n",
                    "import pandas as pd\n",
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "sweep = pd.read_csv(OUT / 'shared_agency_log_odds_eta_sweep.csv')\n",
                    "best = pd.read_csv(OUT / 'shared_agency_log_odds_best_eta.csv')\n",
                    "summary = pd.read_csv(OUT / 'shared_agency_log_odds_summary.csv')\n",
                    "raw_sources = pd.read_csv(OUT / 'shared_agency_log_odds_raw_sources.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Best eta\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["best.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Sweep\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["sweep.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Posterior predictive summary\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["summary.round(3)\n"]},
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


def write_html(best_df: pd.DataFrame, sweep_df: pd.DataFrame, summary_df: pd.DataFrame, raw_sources_df: pd.DataFrame, outputs: Dict[str, Path]) -> None:
    sweep_cols = [
        "eta",
        "commitment_nll",
        "signaling_nll",
        "binomial_nll",
        "average_commitment_percent",
        "average_signaling_percent",
        "average_btom_step1_percent",
        "equal_commitment_percent",
        "equal_signaling_percent",
        "equal_btom_step1_percent",
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
    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency Log-Odds Eta Sweep</title>
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
  <h1>Shared-Agency Log-Odds Eta Sweep</h1>
  <p class="note">Full model-model simulation for Model 2. Fixed lambda={FIXED_LAMBDA:g}; eta controls log-odds legibility action utility. Best eta is selected by trial/player-level commitment + signalingMove binomial NLL against Human-Human distance-condition targets.</p>
  <div class="links">
    <a href="{rel(outputs['sweep_csv'])}">eta sweep CSV</a>
    <a href="{rel(outputs['best_csv'])}">best eta CSV</a>
    <a href="{rel(outputs['summary_csv'])}">summary CSV</a>
    <a href="{rel(outputs['metric_long_csv'])}">metric long CSV</a>
    <a href="{rel(outputs['raw_sources_csv'])}">raw sources CSV</a>
    <a href="{rel(outputs['notebook'])}">notebook</a>
    <a href="shared_agency_log_odds_legibility_fit.html">step-level log-odds likelihood report</a>
    <a href="shared_agency_costly_mixture_rho_sweep.html">communicative action mixture rho sweep</a>
    <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">trial-level baseline report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Best Eta</h2>
    {html_table(best_df, sweep_cols)}
  </section>
  <section class="panel">
    <h2>Eta Sweep</h2>
    <a href="{rel(outputs['sweep_plot'])}"><img src="{rel(outputs['sweep_plot'])}" alt="log-odds eta sweep"></a>
    {html_table(sweep_df, sweep_cols)}
  </section>
  <section class="panel">
    <h2>All Distance 6-Panel</h2>
    <a href="{rel(outputs['average_plot'])}"><img src="{rel(outputs['average_plot'])}" alt="all distance 6 panel"></a>
  </section>
  <section class="panel">
    <h2>Equal-to-Both 6-Panel</h2>
    <a href="{rel(outputs['equal_plot'])}"><img src="{rel(outputs['equal_plot'])}" alt="equal to both 6 panel"></a>
  </section>
  <section class="panel">
    <h2>BToM Trajectory</h2>
    <a href="{rel(outputs['btom_trajectory_plot'])}"><img src="{rel(outputs['btom_trajectory_plot'])}" alt="BToM trajectory"></a>
  </section>
  <section class="panel">
    <h2>Summary</h2>
    {html_table(summary_df, summary_cols)}
  </section>
  <section class="panel">
    <h2>Raw Sources</h2>
    {html_table(raw_sources_df, list(raw_sources_df.columns))}
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    configure_base_plots()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)

    sweep_df, best_row = run_eta_sweep()
    best_df = pd.DataFrame([best_row])
    _models, raw_sources_df, metric_df, summary_df, btom_df, btom_step_participant = build_report_tables(best_row)
    average_df = metric_df[metric_df["condition_scope"] == "average"].copy()
    equal_df = metric_df[metric_df["condition_scope"] == "equal_to_both"].copy()

    outputs = {
        "sweep_csv": OUT_DIR / "shared_agency_log_odds_eta_sweep.csv",
        "best_csv": OUT_DIR / "shared_agency_log_odds_best_eta.csv",
        "summary_csv": OUT_DIR / "shared_agency_log_odds_summary.csv",
        "metric_long_csv": OUT_DIR / "shared_agency_log_odds_metric_long.csv",
        "raw_sources_csv": OUT_DIR / "shared_agency_log_odds_raw_sources.csv",
        "summary_json": OUT_DIR / "shared_agency_log_odds_eta_sweep_summary.json",
        "sweep_plot": OUT_DIR / "shared_agency_log_odds_eta_sweep.png",
        "average_plot": OUT_DIR / "shared_agency_log_odds_average_6panel.png",
        "equal_plot": OUT_DIR / "shared_agency_log_odds_equal_to_both_6panel.png",
        "btom_trajectory_plot": OUT_DIR / "shared_agency_log_odds_btom_first5_trajectory.png",
        "btom_trajectory_csv": OUT_DIR / "shared_agency_log_odds_btom_player_trajectories.csv",
        "btom_step_csv": OUT_DIR / "shared_agency_log_odds_btom_first5_step_per_participant.csv",
        "notebook": NOTEBOOK_PATH,
        "html": HTML_PATH,
    }
    sweep_df.to_csv(outputs["sweep_csv"], index=False)
    best_df.to_csv(outputs["best_csv"], index=False)
    summary_df.to_csv(outputs["summary_csv"], index=False)
    metric_df.to_csv(outputs["metric_long_csv"], index=False)
    raw_sources_df.to_csv(outputs["raw_sources_csv"], index=False)
    btom_csv = btom_df.copy()
    btom_csv["posteriors"] = btom_csv["posteriors"].apply(json.dumps)
    btom_csv.to_csv(outputs["btom_trajectory_csv"], index=False)
    btom_step_participant.to_csv(outputs["btom_step_csv"], index=False)

    plot_eta_sweep(sweep_df, best_row, outputs["sweep_plot"])
    base.plot_comparison(average_df, outputs["average_plot"], "Log-Odds Signaling: All Distance Conditions", btom_step_participant)
    base.plot_comparison(equal_df, outputs["equal_plot"], "Log-Odds Signaling: Equal-to-Both", btom_step_participant, "equal_to_both")
    base.plot_btom_trajectory(btom_step_participant, outputs["btom_trajectory_plot"], max_step=5)
    write_notebook()
    write_html(best_df, sweep_df, summary_df, raw_sources_df, outputs)

    summary = {
        "html": str(HTML_PATH),
        "fixed_lambda": FIXED_LAMBDA,
        "eta_sweep_values": ETA_SWEEP_VALUES,
        "fit_objective": "trial/player-level commitment + signalingMove binomial NLL by distance condition",
        "best": json_ready(best_row),
        "evaluated_settings": int(sweep_df.shape[0]),
        "outputs": {key: str(value) for key, value in outputs.items()},
    }
    outputs["summary_json"].write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
