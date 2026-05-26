#!/usr/bin/env python3
"""Full model-model sweep for shared-agency communicative action mixture rho."""

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
from fit_always_signal_rsa_lambda_alpha import human_targets, metric_binomial_nll, simulated_rates, weighted_metric_rate  # noqa: E402
from fit_signal_alpha_beta3 import add_measures, comparison_rows, load_raw, long_player_rows  # noqa: E402


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_costly_mixture_rho_sweep"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "shared_agency_costly_mixture_rho_sweep"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_costly_mixture_rho_sweep"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_costly_mixture_rho_sweep.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_costly_mixture_rho_sweep.html"

SESSIONS = 30
TRIALS = 12
SEED = 42
BETA = 3.0
FIXED_LAMBDA = 0.2
RHO_SWEEP_VALUES = [0.0, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0]

CAM_NAME = "Communicative Action Mixture (Legibility Over Alternatives)"
NO_SIGNAL_LABEL = "Shared agency no signaling"
COSTLY_MIXTURE_LABEL = f"Shared agency {CAM_NAME}"
HUMAN_LABEL = base.HUMAN_LABEL
GROUP_ORDER = [NO_SIGNAL_LABEL, COSTLY_MIXTURE_LABEL, HUMAN_LABEL]
PALETTE = {
    NO_SIGNAL_LABEL: "#59a14f",
    COSTLY_MIXTURE_LABEL: "#e15759",
    HUMAN_LABEL: "#f28e2b",
}
PLOT_LABELS = {
    NO_SIGNAL_LABEL: "Shared agency\n(no signaling)",
    COSTLY_MIXTURE_LABEL: "Shared agency\nCommunicative\nAction Mixture\n(Legibility Over\nAlternatives)",
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


def simulation_paths(rho: float) -> Dict[str, Path]:
    suffix = (
        f"beta_{fmt_path_number(BETA)}_lambda_{fmt_path_number(FIXED_LAMBDA)}_"
        f"alpha_{fmt_path_number(rho)}_score_costly_mixture_sessions_0_to_{SESSIONS - 1}"
    )
    output_dir = OUT_DIR / "simulations" / "costly_mixture_rho_sweep"
    raw_dir = RAW_DIR / "costly_mixture_rho_sweep"
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


def run_costly_mixture_simulation(rho: float) -> Dict[str, Any]:
    paths = simulation_paths(rho)
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


def metric_row_for_raw(rho: float, raw_trials: List[Dict[str, Any]], sim_df: pd.DataFrame, label: str) -> Dict[str, float]:
    row: Dict[str, float] = {"lambda": FIXED_LAMBDA, "rho": rho}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows(label, raw_trials, sim_df, condition)
        metric_values = {item["metric"]: item for item in rows}
        row[f"{prefix}_success_percent"] = metric_values["Success Rate (%)"]["mean_percent"]
        row[f"{prefix}_efficiency_percent"] = metric_values["Coordination Efficiency (%)"]["mean_percent"]
        row[f"{prefix}_commitment_percent"] = metric_values["Commitment (%)"]["mean_percent"]
        row[f"{prefix}_signaling_percent"] = metric_values["Signaling Move (%)"]["mean_percent"]
    return row


def evaluate_rho(rho: float, target: pd.DataFrame) -> Dict[str, Any]:
    result = run_costly_mixture_simulation(rho)
    raw_trials = load_raw(Path(result["rawTrialsPath"]))
    sim_df = add_measures(long_player_rows(raw_trials, COSTLY_MIXTURE_LABEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    row: Dict[str, Any] = {
        "lambda": FIXED_LAMBDA,
        "rho": float(rho),
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
    row.update(metric_row_for_raw(float(rho), raw_trials, sim_df, COSTLY_MIXTURE_LABEL))
    btom_rates = base.btom_step1_rates_for_raw(raw_trials, COSTLY_MIXTURE_LABEL)
    row["average_btom_step1_percent"] = btom_rates["average"] * 100 if np.isfinite(btom_rates["average"]) else np.nan
    row["equal_btom_step1_percent"] = btom_rates["equal_to_both"] * 100 if np.isfinite(btom_rates["equal_to_both"]) else np.nan
    return row


def run_rho_sweep() -> tuple[pd.DataFrame, Dict[str, Any]]:
    human_raw = load_raw(base.HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    target = human_targets(human_df)
    rows = [evaluate_rho(float(rho), target) for rho in RHO_SWEEP_VALUES]
    sweep_df = pd.DataFrame(rows).sort_values("rho").reset_index(drop=True)
    best_row = sweep_df.loc[sweep_df["binomial_nll"].idxmin()].to_dict()
    return sweep_df, best_row


def build_report_tables(best_row: Dict[str, Any]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    configure_base_plots()
    models = [
        {
            "key": "shared_agency_no_signaling_lambda02",
            "label": NO_SIGNAL_LABEL,
            "raw_trials": str(run_costly_mixture_simulation(0.0)["rawTrialsPath"]),
            "lambda": FIXED_LAMBDA,
            "rho": 0.0,
        },
        {
            "key": "shared_agency_costly_mixture_best_rho",
            "label": COSTLY_MIXTURE_LABEL,
            "raw_trials": best_row["raw_trials"],
            "lambda": FIXED_LAMBDA,
            "rho": float(best_row["rho"]),
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
                "rho": model.get("rho"),
                "fit_objective": model.get("fit_objective", "reference"),
            }
            for model in models
        ]
    )
    btom_df = base.build_btom_table(models)
    _btom_step_long, btom_step_participant, _btom_mean_participant = base.build_btom_step_tables(btom_df, max_step=5)
    metric_df = base.build_metric_table(models)
    btom_metric_df = pd.DataFrame(
        base.btom_step1_metric_rows(btom_step_participant, None, "average")
        + base.btom_step1_metric_rows(btom_step_participant, "equal_to_both", "equal_to_both")
    )
    metric_df = pd.concat([metric_df, btom_metric_df], ignore_index=True)
    summary_df = base.wide_summary(metric_df)
    return raw_sources_df, metric_df, summary_df, btom_step_participant


def plot_rho_sweep(sweep_df: pd.DataFrame, best_row: Dict[str, Any], path: Path) -> None:
    df = sweep_df.sort_values("rho")
    best_rho = float(best_row["rho"])
    fig, axes = plt.subplots(3, 2, figsize=(15.8, 14.8))
    flat_axes = axes.ravel()
    fig.suptitle(
        f"Shared Agency {CAM_NAME} Rho Sweep (lambda = {FIXED_LAMBDA:g})",
        fontsize=17,
        fontweight="bold",
        y=0.99,
    )
    nll_ax = flat_axes[0]
    nll_ax.plot(df["rho"], df["binomial_nll"], marker="o", linewidth=2.4, color="#111827", label="Commitment + signaling NLL")
    nll_ax.plot(df["rho"], df["commitment_nll"], marker="o", linewidth=1.8, color="#4f79a8", label="Commitment NLL")
    nll_ax.plot(df["rho"], df["signaling_nll"], marker="o", linewidth=1.8, color="#e15759", label="Signaling NLL")
    nll_ax.axvline(best_rho, color="#111827", linestyle=":", linewidth=1.5, label=f"Best rho = {best_rho:g}")
    nll_ax.set_title("Fit Objective", fontsize=13, fontweight="bold")
    nll_ax.set_xlabel("rho")
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
        ax.plot(df["rho"], df[avg_col], marker="o", linewidth=2.2, color="#4f79a8", label="All distance")
        ax.plot(df["rho"], df[equal_col], marker="o", linewidth=2.2, linestyle="--", color="#59a14f", label="Equal-to-both")
        ax.axvline(best_rho, color="#111827", linestyle=":", linewidth=1.5)
        if title == "Commitment (%)":
            ax.axhline(50, ls="--", lw=1.1, color="#6b7280", alpha=0.6)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xlabel("rho")
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
            {"cell_type": "markdown", "metadata": {}, "source": [f"# Shared-Agency {CAM_NAME} Rho Sweep\n"]},
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from pathlib import Path\n",
                    "import pandas as pd\n",
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "sweep = pd.read_csv(OUT / 'shared_agency_costly_mixture_rho_sweep.csv')\n",
                    "best = pd.read_csv(OUT / 'shared_agency_costly_mixture_best_rho.csv')\n",
                    "summary = pd.read_csv(OUT / 'shared_agency_costly_mixture_summary.csv')\n",
                    "raw_sources = pd.read_csv(OUT / 'shared_agency_costly_mixture_raw_sources.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Best rho\n"]},
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
        "rho",
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
<title>Shared-Agency {CAM_NAME} Rho Sweep</title>
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
  <h1>Shared-Agency {CAM_NAME} Rho Sweep</h1>
  <p class="note">Full model-model simulation for {CAM_NAME}. Fixed lambda={FIXED_LAMBDA:g}; rho mixes the base policy with a communicative policy that increases goal legibility over alternatives. Best rho is selected by trial/player-level commitment + signalingMove binomial NLL.</p>
  <div class="links">
    <a href="{rel(outputs['sweep_csv'])}">rho sweep CSV</a>
    <a href="{rel(outputs['best_csv'])}">best rho CSV</a>
    <a href="{rel(outputs['summary_csv'])}">summary CSV</a>
    <a href="{rel(outputs['metric_long_csv'])}">metric long CSV</a>
    <a href="{rel(outputs['raw_sources_csv'])}">raw sources CSV</a>
    <a href="{rel(outputs['notebook'])}">notebook</a>
    <a href="shared_agency_costly_mixture_step_level_fit.html">communicative action mixture step-level fit</a>
    <a href="shared_agency_log_odds_eta_sweep.html">log-odds full eta sweep</a>
    <a href="shared_agency_log_odds_legibility_fit.html">step-level log-odds likelihood report</a>
    <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">trial-level baseline report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Best Rho</h2>
    {html_table(best_df, sweep_cols)}
  </section>
  <section class="panel">
    <h2>Rho Sweep</h2>
    <a href="{rel(outputs['sweep_plot'])}"><img src="{rel(outputs['sweep_plot'])}" alt="communicative action mixture rho sweep"></a>
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

    sweep_df, best_row = run_rho_sweep()
    best_df = pd.DataFrame([best_row])
    raw_sources_df, metric_df, summary_df, btom_step_participant = build_report_tables(best_row)
    average_df = metric_df[metric_df["condition_scope"] == "average"].copy()
    equal_df = metric_df[metric_df["condition_scope"] == "equal_to_both"].copy()

    outputs = {
        "sweep_csv": OUT_DIR / "shared_agency_costly_mixture_rho_sweep.csv",
        "best_csv": OUT_DIR / "shared_agency_costly_mixture_best_rho.csv",
        "summary_csv": OUT_DIR / "shared_agency_costly_mixture_summary.csv",
        "metric_long_csv": OUT_DIR / "shared_agency_costly_mixture_metric_long.csv",
        "raw_sources_csv": OUT_DIR / "shared_agency_costly_mixture_raw_sources.csv",
        "summary_json": OUT_DIR / "shared_agency_costly_mixture_rho_sweep_summary.json",
        "sweep_plot": OUT_DIR / "shared_agency_costly_mixture_rho_sweep.png",
        "average_plot": OUT_DIR / "shared_agency_costly_mixture_average_6panel.png",
        "equal_plot": OUT_DIR / "shared_agency_costly_mixture_equal_to_both_6panel.png",
        "btom_trajectory_plot": OUT_DIR / "shared_agency_costly_mixture_btom_first5_trajectory.png",
        "btom_step_csv": OUT_DIR / "shared_agency_costly_mixture_btom_first5_step_per_participant.csv",
        "notebook": NOTEBOOK_PATH,
        "html": HTML_PATH,
    }
    sweep_df.to_csv(outputs["sweep_csv"], index=False)
    best_df.to_csv(outputs["best_csv"], index=False)
    summary_df.to_csv(outputs["summary_csv"], index=False)
    metric_df.to_csv(outputs["metric_long_csv"], index=False)
    raw_sources_df.to_csv(outputs["raw_sources_csv"], index=False)
    btom_step_participant.to_csv(outputs["btom_step_csv"], index=False)

    plot_rho_sweep(sweep_df, best_row, outputs["sweep_plot"])
    base.plot_comparison(average_df, outputs["average_plot"], f"{CAM_NAME}: All Distance Conditions", btom_step_participant)
    base.plot_comparison(equal_df, outputs["equal_plot"], f"{CAM_NAME}: Equal-to-Both", btom_step_participant, "equal_to_both")
    base.plot_btom_trajectory(btom_step_participant, outputs["btom_trajectory_plot"], max_step=5)
    write_notebook()
    write_html(best_df, sweep_df, summary_df, raw_sources_df, outputs)

    summary = {
        "html": str(HTML_PATH),
        "fixed_lambda": FIXED_LAMBDA,
        "rho_sweep_values": RHO_SWEEP_VALUES,
        "fit_objective": "trial/player-level commitment + signalingMove binomial NLL by distance condition",
        "best": json_ready(best_row),
        "evaluated_settings": int(sweep_df.shape[0]),
        "outputs": {key: str(value) for key, value in outputs.items()},
    }
    outputs["summary_json"].write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
