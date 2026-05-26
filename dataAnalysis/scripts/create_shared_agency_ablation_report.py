#!/usr/bin/env python3
"""Create a standalone ablation report for the unshaped JointRL shared-agency model."""

from __future__ import annotations

import html
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from fit_always_signal_rsa_lambda_alpha import (  # noqa: E402
    DEFAULT_OUTPUT_DIR,
    HUMAN_RAW,
    MODEL,
    SIM_SCRIPT,
    add_measures,
    comparison_rows,
    human_targets,
    load_raw,
    long_player_rows,
    measure_row,
    metric_binomial_nll,
    raw_path_for,
    simulated_rates,
    weighted_metric_rate,
)
from fit_signal_alpha_beta3 import resolved_raw_path  # noqa: E402


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "signal_agent" / "outputs" / "signal_agent_from_start_rsa_ablation"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "signal_agent"
    / "from_start_rsa_unshaped_jointrl_ablation"
)
NOTEBOOK_DIR = MODEL_ROOT / "signal_agent" / "notebooks" / "signal_agent_from_start_rsa_ablation"
NOTEBOOK_PATH = NOTEBOOK_DIR / "AlwaysSignalAgent_shared_agency_ablation_results.ipynb"
HTML_PATH = MODEL_ROOT / "sampleJointGoalAndRSASignal_fromStart_ablation_comparison.html"
FULL_SUMMARY_PATH = DEFAULT_OUTPUT_DIR / "always_signal_rsa_lambda_alpha_fit_summary.json"

SESSIONS = 30
TRIALS = 12
SEED = 42
BETA = 3.0
SCORE = "logposterior"
HORIZON = 1
FIT_METRICS = ["commitment", "signalingMove"]


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def load_full_best() -> Dict[str, Any]:
    summary = json.loads(FULL_SUMMARY_PATH.read_text(encoding="utf-8"))
    best = summary["best_by_binomial_nll"]
    raw = Path(summary.get("best_raw_trials") or best["raw_trials"])
    return {
        "lambda": float(best["lambda"]),
        "alpha": float(best["alpha"]),
        "raw_trials": resolved_raw_path(raw),
    }


def run_ablation_simulation(lambda_value: float, alpha: float) -> Path:
    raw_path = raw_path_for(RAW_DIR, BETA, lambda_value, alpha, SESSIONS)
    cmd = [
        "node",
        str(SIM_SCRIPT),
        "--sessions", str(SESSIONS),
        "--trials", str(TRIALS),
        "--seed", str(SEED),
        "--lambda", str(lambda_value),
        "--alpha", str(alpha),
        "--beta", str(BETA),
        "--score", SCORE,
        "--horizon", str(HORIZON),
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir", str(OUT_DIR / "simulations"),
        "--raw-output-dir", str(RAW_DIR),
    ]
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        raise RuntimeError(f"Ablation simulation failed for lambda={lambda_value:g}, alpha={alpha:g}")
    if not raw_path.exists():
        raise FileNotFoundError(f"Expected raw trials missing after simulation: {raw_path}")
    return compress_raw(raw_path)


def compress_raw(raw_path: Path) -> Path:
    zst_path = Path(f"{raw_path}.zst")
    subprocess.run(["zstd", "-q", "-f", "--rm", str(raw_path)], cwd=PROJECT_ROOT, check=True)
    return zst_path


def evaluate_model(row: Dict[str, Any], target: pd.DataFrame) -> Dict[str, Any]:
    raw_path = Path(row["raw_trials"])
    raw_trials = load_raw(raw_path)
    sim_df = add_measures(long_player_rows(raw_trials, MODEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    out: Dict[str, Any] = {
        "key": row["key"],
        "label": row["label"],
        "lambda": float(row["lambda"]),
        "alpha": float(row["alpha"]),
        "raw_source": row["raw_source"],
        "raw_trials": str(raw_path),
        "commitment_nll": float(commitment_nll),
        "signaling_nll": float(signaling_nll),
        "binomial_nll": float(commitment_nll + signaling_nll),
        "sim_commitment_human_weighted_average": weighted_metric_rate(target, rates, "commitment"),
        "sim_signaling_human_weighted_average": weighted_metric_rate(target, rates, "signalingMove"),
        "sim_commitment_equal_to_both": rates.get(("equal_to_both", "commitment"), np.nan),
        "sim_signaling_equal_to_both": rates.get(("equal_to_both", "signalingMove"), np.nan),
    }
    out.update(measure_row(float(row["lambda"]), float(row["alpha"]), raw_trials, sim_df))
    return out


def comparison_dataframe(models: List[Dict[str, Any]], human_raw: List[Dict[str, Any]], human_df: pd.DataFrame, condition: str | None) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for model in models:
        raw_trials = load_raw(Path(model["raw_trials"]))
        df = add_measures(long_player_rows(raw_trials, model["label"]))
        rows.extend(comparison_rows(model["label"], raw_trials, df, condition))
    rows.extend(comparison_rows("Human-Human", human_raw, human_df, condition))
    return pd.DataFrame(rows)


def plot_comparison_many(df: pd.DataFrame, path: Path, title: str) -> None:
    metric_order = ["Success Rate (%)", "Coordination Efficiency (%)", "Commitment (%)", "Signaling Move (%)"]
    group_order = list(dict.fromkeys(df["group"].tolist()))
    colors = ["#4f79a8", "#f28e2b", "#59a14f", "#b07aa1", "#9c755f"]
    fig, axes = plt.subplots(2, 2, figsize=(15.5, 10.5))
    fig.suptitle(title, fontsize=18, fontweight="bold", y=0.98)
    for ax, metric in zip(axes.ravel(), metric_order):
        sub = df[df["metric"] == metric].set_index("group").loc[group_order].reset_index()
        x = np.arange(len(group_order))
        ax.bar(
            x,
            sub["mean_percent"],
            yerr=sub["ci95_percent"],
            color=colors[: len(group_order)],
            alpha=0.9,
            capsize=4,
            edgecolor="white",
        )
        ax.set_title(metric, fontsize=13, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(x)
        ax.set_xticklabels(group_order, fontsize=8, rotation=18, ha="right")
        ax.grid(axis="y", color="#cfcfcf", linewidth=1.0)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_nll(df: pd.DataFrame, path: Path) -> None:
    rows = df.sort_values("binomial_nll").reset_index(drop=True)
    x = np.arange(rows.shape[0])
    fig, ax = plt.subplots(figsize=(11, 6.5))
    ax.bar(x, rows["commitment_nll"], color="#4f79a8", label="Commitment NLL")
    ax.bar(x, rows["signaling_nll"], bottom=rows["commitment_nll"], color="#f28e2b", label="Signaling NLL")
    ax.set_title("Shared-Agency Ablations: Commitment + Signaling NLL", fontsize=15, fontweight="bold")
    ax.set_ylabel("Binomial NLL")
    ax.set_xticks(x)
    ax.set_xticklabels(rows["label"], rotation=18, ha="right", fontsize=9)
    ax.legend(frameon=True)
    ax.grid(axis="y", color="#d6dce2", linewidth=1)
    ax.grid(axis="x", visible=False)
    for idx, value in enumerate(rows["binomial_nll"]):
        ax.text(idx, value + 3, f"{value:.1f}", ha="center", va="bottom", fontsize=9)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def write_notebook() -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# Shared-Agency Ablation Comparison\n",
                "\n",
                "Compares the full unshaped JointRL shared-agency model against fixed-parameter ablations for RSA signaling and inferred-goal posterior weighting.\n",
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
                "summary = pd.read_csv(OUT / 'shared_agency_ablation_summary.csv')\n",
                "nll = pd.read_csv(OUT / 'shared_agency_ablation_nll.csv')\n",
                "metrics = pd.read_csv(OUT / 'shared_agency_ablation_metric_long.csv')\n",
                "raw_sources = pd.read_csv(OUT / 'shared_agency_ablation_raw_sources.csv')\n",
            ],
        },
        {"cell_type": "markdown", "metadata": {}, "source": ["## Parameter and Raw Sources\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["raw_sources\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## NLL Ranking\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["nll.sort_values('binomial_nll').round(4)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## Summary Metrics\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["summary.round(3)\n"]},
        {"cell_type": "markdown", "metadata": {}, "source": ["## Long Metric Table\n"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["metrics.round(3)\n"]},
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
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def html_table(df: pd.DataFrame, columns: List[str], numeric: set[str] | None = None) -> str:
    numeric = numeric or set()
    header = "".join(f"<th>{html.escape(col)}</th>" for col in columns)
    body_rows = []
    for row in df[columns].to_dict(orient="records"):
        cells = []
        for col in columns:
            value = row[col]
            cls = " class=\"num\"" if col in numeric else ""
            if isinstance(value, float):
                text = f"{value:.3g}" if col in {"lambda", "alpha"} else f"{value:.2f}"
            else:
                text = str(value)
            cells.append(f"<td{cls}>{html.escape(text)}</td>")
        body_rows.append("<tr>" + "".join(cells) + "</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"


def write_html(summary_df: pd.DataFrame, nll_df: pd.DataFrame, metric_df: pd.DataFrame, outputs: Dict[str, Path]) -> None:
    best = nll_df.sort_values("binomial_nll").iloc[0]
    nll_table = html_table(
        nll_df.sort_values("binomial_nll"),
        ["label", "lambda", "alpha", "commitment_nll", "signaling_nll", "binomial_nll", "raw_source"],
        {"lambda", "alpha", "commitment_nll", "signaling_nll", "binomial_nll"},
    )
    metric_table = html_table(
        metric_df,
        ["condition_scope", "group", "metric", "mean_percent", "ci95_percent", "n"],
        {"mean_percent", "ci95_percent", "n"},
    )
    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency Ablation Comparison</title>
<style>
:root {{ --ink:#17202a; --muted:#5f6b7a; --line:#d9e1ea; --bg:#f7f9fb; --panel:#fff; --accent:#8b5e00; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg); }}
header {{ padding:28px 34px 20px; border-bottom:1px solid var(--line); background:#fff; }}
main {{ max-width:1280px; margin:0 auto; padding:24px 28px 42px; }}
h1 {{ margin:0 0 8px; font-size:30px; line-height:1.15; }}
h2 {{ margin:0 0 12px; font-size:22px; }}
h3 {{ margin:16px 0 8px; font-size:16px; }}
p {{ line-height:1.55; }}
.note {{ color:var(--muted); }}
.badge {{ display:inline-block; margin-left:8px; padding:3px 8px; border-radius:999px; background:#fff7d6; color:#6f5200; font-size:13px; vertical-align:middle; }}
.grid {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:20px 0; }}
.stat {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }}
.stat .label {{ color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }}
.stat .value {{ margin-top:6px; font-size:22px; font-weight:700; }}
.card {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; margin:18px 0; }}
.wide-img {{ display:block; width:100%; height:auto; border:1px solid var(--line); border-radius:6px; background:#fff; }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; background:#fff; }}
th,td {{ border-bottom:1px solid var(--line); padding:8px 9px; text-align:left; vertical-align:top; }}
th {{ color:#44515f; background:#f1f5f9; }}
.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
.scroll {{ overflow:auto; border:1px solid var(--line); border-radius:6px; max-height:520px; }}
.links a {{ color:#245a92; margin-right:12px; white-space:nowrap; }}
@media (max-width: 900px) {{ .grid, .two {{ grid-template-columns:1fr; }} main {{ padding:18px; }} }}
</style>
</head>
<body>
<header>
  <h1>sampleJointGoalAndRSASignal_fromStart <span class="badge">ablation comparison</span></h1>
  <p class="note">The three ablation conditions were rerun with the current unshaped JointRL shared-agency implementation. The full row uses the current best-fit raw simulation from the shared-agency fit summary.</p>
</header>
<main>
  <section class="grid">
    <div class="stat"><div class="label">Models compared</div><div class="value">{len(summary_df)}</div></div>
    <div class="stat"><div class="label">Best NLL row</div><div class="value">{html.escape(str(best['label']))}</div></div>
    <div class="stat"><div class="label">Best lambda</div><div class="value">{float(best['lambda']):g}</div></div>
    <div class="stat"><div class="label">Best alpha</div><div class="value">{float(best['alpha']):g}</div></div>
  </section>

  <section class="card">
    <h2>Artifacts</h2>
    <p class="links">
      <a href="{rel(outputs['summary_csv'])}">summary CSV</a>
      <a href="{rel(outputs['nll_csv'])}">NLL CSV</a>
      <a href="{rel(outputs['metric_long_csv'])}">long metric CSV</a>
      <a href="{rel(outputs['raw_sources_csv'])}">raw sources CSV</a>
      <a href="{rel(NOTEBOOK_PATH)}">notebook</a>
      <a href="sampleJointGoalAndRSASignal_fromStart_full_heatmap.html">full heatmap report</a>
      <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">shared-agency baseline comparison</a>
    </p>
  </section>

  <section class="card">
    <h2>NLL Comparison</h2>
    <a href="{rel(outputs['nll_plot'])}"><img class="wide-img" src="{rel(outputs['nll_plot'])}" alt="Shared-agency ablation NLL comparison"></a>
    <div class="scroll">{nll_table}</div>
  </section>

  <section class="card">
    <h2>Metric Comparison</h2>
    <div class="two">
      <div>
        <h3>Average all 2P3G</h3>
        <a href="{rel(outputs['average_plot'])}"><img class="wide-img" src="{rel(outputs['average_plot'])}" alt="Shared-agency ablation metric comparison across all 2P3G conditions"></a>
      </div>
      <div>
        <h3>Equal-to-both only</h3>
        <a href="{rel(outputs['equal_plot'])}"><img class="wide-img" src="{rel(outputs['equal_plot'])}" alt="Shared-agency ablation metric comparison in equal-to-both trials"></a>
      </div>
    </div>
  </section>

  <section class="card">
    <h2>Long Metric Table</h2>
    <div class="scroll">{metric_table}</div>
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "simulations").mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    full = load_full_best()
    full_lambda = float(full["lambda"])
    full_alpha = float(full["alpha"])

    model_rows: List[Dict[str, Any]] = [
        {
            "key": "full",
            "label": f"Full shared-agency\n(lambda={full_lambda:g}, alpha={full_alpha:g})",
            "lambda": full_lambda,
            "alpha": full_alpha,
            "raw_source": "reused current full-model best raw",
            "raw_trials": str(full["raw_trials"]),
        },
        {
            "key": "no_rsa_signaling",
            "label": f"No RSA signaling\n(lambda={full_lambda:g}, alpha=0)",
            "lambda": full_lambda,
            "alpha": 0.0,
            "raw_source": "rerun ablation raw",
            "raw_trials": str(run_ablation_simulation(full_lambda, 0.0)),
        },
        {
            "key": "no_posterior_weighting",
            "label": f"No posterior weighting\n(lambda=0, alpha={full_alpha:g})",
            "lambda": 0.0,
            "alpha": full_alpha,
            "raw_source": "rerun ablation raw",
            "raw_trials": str(run_ablation_simulation(0.0, full_alpha)),
        },
        {
            "key": "value_base_only",
            "label": "Value/base only\n(lambda=0, alpha=0)",
            "lambda": 0.0,
            "alpha": 0.0,
            "raw_source": "rerun ablation raw",
            "raw_trials": str(run_ablation_simulation(0.0, 0.0)),
        },
    ]

    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, "Human-Human"))
    target = human_targets(human_df)

    summary_rows = [evaluate_model(row, target) for row in model_rows]
    summary_df = pd.DataFrame(summary_rows)
    nll_cols = [
        "key",
        "label",
        "lambda",
        "alpha",
        "commitment_nll",
        "signaling_nll",
        "binomial_nll",
        "sim_commitment_human_weighted_average",
        "sim_signaling_human_weighted_average",
        "raw_source",
        "raw_trials",
    ]
    nll_df = summary_df[nll_cols].copy()

    average_df = comparison_dataframe(model_rows, human_raw, human_df, None)
    average_df["condition_scope"] = "average_all_2p3g"
    equal_df = comparison_dataframe(model_rows, human_raw, human_df, "equal_to_both")
    equal_df["condition_scope"] = "equal_to_both"
    metric_df = pd.concat([average_df, equal_df], ignore_index=True)

    outputs = {
        "summary_csv": OUT_DIR / "shared_agency_ablation_summary.csv",
        "nll_csv": OUT_DIR / "shared_agency_ablation_nll.csv",
        "metric_long_csv": OUT_DIR / "shared_agency_ablation_metric_long.csv",
        "raw_sources_csv": OUT_DIR / "shared_agency_ablation_raw_sources.csv",
        "average_plot": OUT_DIR / "shared_agency_ablation_average_4panel.png",
        "equal_plot": OUT_DIR / "shared_agency_ablation_equal_to_both_4panel.png",
        "nll_plot": OUT_DIR / "shared_agency_ablation_nll.png",
        "summary_json": OUT_DIR / "shared_agency_ablation_summary.json",
    }
    summary_df.to_csv(outputs["summary_csv"], index=False)
    nll_df.to_csv(outputs["nll_csv"], index=False)
    metric_df.to_csv(outputs["metric_long_csv"], index=False)
    pd.DataFrame(model_rows).to_csv(outputs["raw_sources_csv"], index=False)

    plot_comparison_many(average_df, outputs["average_plot"], "Shared-Agency Ablations vs Human-Human, Average all 2P3G")
    plot_comparison_many(equal_df, outputs["equal_plot"], "Shared-Agency Ablations vs Human-Human, Equal-to-Both")
    plot_nll(nll_df, outputs["nll_plot"])
    write_notebook()

    summary_json = {
        "model": MODEL,
        "report_label": "sampleJointGoalAndRSASignal_fromStart (shared-agency model) ablations",
        "full_best": {"lambda": full_lambda, "alpha": full_alpha, "raw_trials": str(full["raw_trials"])},
        "ablation_raw_policy": "three ablation conditions are force-rerun with current unshaped JointRL code",
        "settings": model_rows,
        "outputs": {key: str(value) for key, value in outputs.items()},
        "notebook": str(NOTEBOOK_PATH),
        "html": str(HTML_PATH),
    }
    outputs["summary_json"].write_text(json.dumps(summary_json, indent=2), encoding="utf-8")
    write_html(summary_df, nll_df, metric_df, outputs)
    print(json.dumps({"html": str(HTML_PATH), "notebook": str(NOTEBOOK_PATH), "outputs": summary_json["outputs"]}, indent=2))


if __name__ == "__main__":
    main()
