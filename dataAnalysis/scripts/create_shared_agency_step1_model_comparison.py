#!/usr/bin/env python3
"""First-post-new-goal-step fit for shared-agency model comparison."""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = PROJECT_ROOT / "dataAnalysis" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import create_shared_agency_step_level_model_comparison as base  # noqa: E402
from create_no_latent_joint_rl_shared_agency_baseline_report import SHARED_FULL_LABEL  # noqa: E402


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_step1_model_comparison"
ASSET_DIR = OUT_DIR / "assets"
SIM_DIR = OUT_DIR / "simulations"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "shared_agency_step1_model_comparison"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_step1_model_comparison"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_step1_model_comparison.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_step1_model_comparison.html"


def patch_base_paths() -> None:
    base.OUT_DIR = OUT_DIR
    base.ASSET_DIR = ASSET_DIR
    base.SIM_DIR = SIM_DIR
    base.RAW_DIR = RAW_DIR
    base.NOTEBOOK_DIR = NOTEBOOK_DIR
    base.NOTEBOOK_PATH = NOTEBOOK_PATH
    base.HTML_PATH = HTML_PATH


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


def step1_observations(rows: Sequence[Dict[str, Any]]) -> List[base.StepObs]:
    observations = base.build_observations(rows, "always_signal_rsa")
    time_map = new_goal_time_map(rows)
    return [
        obs
        for obs in observations
        if time_map.get((obs.room_id, obs.trial_index)) is not None
        and int(obs.step) - int(time_map[(obs.room_id, obs.trial_index)]) == 1
    ]


def html_table(df: pd.DataFrame, columns: Sequence[str]) -> str:
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
            {"cell_type": "markdown", "metadata": {}, "source": ["# Shared-Agency Step-1 Model Comparison\n"]},
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from pathlib import Path\n",
                    "import pandas as pd\n",
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "model_nll = pd.read_csv(OUT / 'step1_model_comparison_nll.csv')\n",
                    "grid = pd.read_csv(OUT / 'step1_lambda_alpha_grid.csv')\n",
                    "trial_vs_step1 = pd.read_csv(OUT / 'trial_level_vs_step1_best_shared_agency.csv')\n",
                    "behavior = pd.read_csv(OUT / 'shared_agency_step_level_behavior_summary.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Held-Out Step-1 NLL\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["model_nll.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Lambda x Alpha Grid\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["grid.sort_values('negative_log_likelihood').head(10).round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Trial-Level Best vs Step-1 Best\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["trial_vs_step1.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Behavioral Posterior Predictive Checks\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["behavior.round(2)\n"]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def write_html(
    model_nll: pd.DataFrame,
    best: Dict[str, Any],
    behavior_outputs: Dict[str, Path],
    trial_step1_df: pd.DataFrame,
    raw_sources: pd.DataFrame,
    n_actions: int,
) -> None:
    nll_cols = [
        "model",
        "lambda",
        "alpha",
        "n_params",
        "actions",
        "in_sample_nll",
        "heldout_nll",
        "heldout_nll_per_action",
        "delta_heldout_nll",
        "aic",
        "bic",
    ]
    best_cols = [
        "fit_source",
        "lambda",
        "alpha",
        "human_step_level_nll",
        "average_commitment_percent",
        "average_signaling_percent",
        "equal_commitment_percent",
        "equal_signaling_percent",
    ]
    raw_cols = ["model", "lambda", "alpha", "rawTrialsPath"]
    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency Step-1 Model Comparison</title>
<style>
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f8fb; color:#1f2933; }}
header {{ padding:34px 48px 24px; background:#ffffff; border-bottom:1px solid #d9e2ec; }}
main {{ max-width:1200px; margin:0 auto; padding:28px 24px 60px; }}
h1 {{ margin:0 0 8px; font-size:31px; }}
h2 {{ margin:30px 0 12px; font-size:21px; }}
p {{ line-height:1.55; }}
.note {{ color:#52606d; max-width:980px; }}
.panel {{ background:#fff; border:1px solid #d9e2ec; border-radius:8px; padding:18px; margin:18px 0; }}
.links a {{ display:inline-block; margin:0 12px 10px 0; color:#2458a6; text-decoration:none; }}
img {{ width:100%; height:auto; display:block; border:1px solid #d9e2ec; border-radius:6px; background:white; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; background:white; }}
th,td {{ border:1px solid #d9e2ec; padding:8px 10px; text-align:left; vertical-align:top; }}
th {{ background:#eef3f8; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
code {{ background:#eef3f8; padding:2px 5px; border-radius:4px; }}
</style>
</head>
<body>
<header>
  <h1>Shared-Agency Step-1 Model Comparison</h1>
  <p class="note">Fit target: human actions only on the first step after new-goal presentation. This is the narrowest possible test of immediate signaling.</p>
  <div class="links">
    <a href="{rel(OUT_DIR / 'step1_model_comparison_nll.csv')}">model NLL CSV</a>
    <a href="{rel(OUT_DIR / 'step1_lambda_alpha_grid.csv')}">lambda x alpha grid CSV</a>
    <a href="{rel(OUT_DIR / 'trial_level_vs_step1_best_shared_agency.csv')}">trial-vs-step1 CSV</a>
    <a href="{rel(NOTEBOOK_PATH)}">notebook</a>
    <a href="shared_agency_signal_window_model_comparison.html">step 1-3 signal-window report</a>
    <a href="shared_agency_uncertainty_gated_rho_fit.html">uncertainty-gated rho fit</a>
    <a href="shared_agency_information_gain_fit.html">information-gain fit</a>
    <a href="shared_agency_tiebreak_signal_fit.html">tie-break signaling fit</a>
    <a href="shared_agency_costly_legibility_fit.html">costly legibility fit</a>
    <a href="shared_agency_log_odds_legibility_fit.html">log-odds legibility fit</a>
    <a href="shared_agency_log_odds_eta_sweep.html">log-odds full eta sweep</a>
    <a href="shared_agency_costly_mixture_rho_sweep.html">communicative action mixture rho sweep</a>
    <a href="shared_agency_step_level_model_comparison.html">all-step step-level report</a>
    <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">trial-level baseline report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Primary Step-1 Model Comparison</h2>
    <p class="note">The fit uses {n_actions} player-actions from the first post-new-goal step only. Held-out folds are grouped by room ID.</p>
    {html_table(model_nll, nll_cols)}
  </section>
  <section class="panel">
    <h2>Shared-Agency Lambda x Alpha Step-1 Fit</h2>
    <p class="note">Full-data best pair: lambda={float(best['lambda']):g}, alpha={float(best['alpha']):g}, step-1 NLL={float(best['negative_log_likelihood']):.2f}.</p>
    <a href="{rel(ASSET_DIR / 'step1_lambda_alpha_heatmap.png')}"><img src="{rel(ASSET_DIR / 'step1_lambda_alpha_heatmap.png')}" alt="step-1 lambda alpha heatmap"></a>
  </section>
  <section class="panel">
    <h2>Held-Out Step-1 NLL Plot</h2>
    <a href="{rel(ASSET_DIR / 'step1_model_nll_comparison.png')}"><img src="{rel(ASSET_DIR / 'step1_model_nll_comparison.png')}" alt="held-out step-1 NLL comparison"></a>
  </section>
  <section class="panel">
    <h2>Posterior Predictive Checks: All Distance Conditions</h2>
    <a href="{rel(behavior_outputs['average_plot'])}"><img src="{rel(behavior_outputs['average_plot'])}" alt="step-1 fitted all-distance behavioral comparison"></a>
  </section>
  <section class="panel">
    <h2>Posterior Predictive Checks: Equal-to-Both</h2>
    <a href="{rel(behavior_outputs['equal_plot'])}"><img src="{rel(behavior_outputs['equal_plot'])}" alt="step-1 fitted equal-to-both behavioral comparison"></a>
  </section>
  <section class="panel">
    <h2>BToM Trajectory</h2>
    <a href="{rel(behavior_outputs['btom_trajectory_plot'])}"><img src="{rel(behavior_outputs['btom_trajectory_plot'])}" alt="step-1 fitted BToM trajectory"></a>
  </section>
  <section class="panel">
    <h2>Trial-Level Best vs Step-1 Best</h2>
    {html_table(trial_step1_df, best_cols)}
  </section>
  <section class="panel">
    <h2>Raw Sources</h2>
    {html_table(raw_sources, raw_cols)}
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    patch_base_paths()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)

    human_rows = base.load_human_rows()
    observations = step1_observations(human_rows)
    commitment_grid, full_grid, fits = base.fit_all_models(observations)
    cv_df = base.cross_validated_scores(observations, base.CV_FOLDS)
    model_nll = base.summarize_cv(cv_df, fits, len(observations))

    commitment_grid.to_csv(OUT_DIR / "step1_commitment_lambda_grid.csv", index=False)
    full_grid.to_csv(OUT_DIR / "step1_lambda_alpha_grid.csv", index=False)
    cv_df.to_csv(OUT_DIR / "step1_model_comparison_cv_folds.csv", index=False)
    model_nll.to_csv(OUT_DIR / "step1_model_comparison_nll.csv", index=False)
    base.plot_step_level_heatmap(full_grid, fits[SHARED_FULL_LABEL], ASSET_DIR / "step1_lambda_alpha_heatmap.png")
    base.plot_model_nll(model_nll, ASSET_DIR / "step1_model_nll_comparison.png")

    raw_paths, raw_sources = base.run_report_simulations(fits)
    raw_sources.to_csv(OUT_DIR / "step1_raw_sources.csv", index=False)
    behavior_outputs = base.build_behavior_outputs(raw_paths)
    trial_step1_df = base.trial_vs_step_best(observations, fits[SHARED_FULL_LABEL], raw_paths[SHARED_FULL_LABEL])
    trial_step1_df.loc[
        trial_step1_df["fit_source"].eq("step-level human action NLL"),
        "fit_source",
    ] = "step-1 human action NLL"
    trial_step1_df.to_csv(OUT_DIR / "trial_level_vs_step1_best_shared_agency.csv", index=False)
    write_notebook()
    write_html(model_nll, fits[SHARED_FULL_LABEL], behavior_outputs, trial_step1_df, raw_sources, len(observations))

    summary = {
        "html": str(HTML_PATH),
        "fit_window": "first post-new-goal step only",
        "actions": len(observations),
        "best_heldout_model": str(model_nll.iloc[0]["model"]),
        "full_data_fits": fits,
        "outputs": {
            "model_nll_csv": str(OUT_DIR / "step1_model_comparison_nll.csv"),
            "lambda_alpha_grid_csv": str(OUT_DIR / "step1_lambda_alpha_grid.csv"),
            "lambda_alpha_heatmap": str(ASSET_DIR / "step1_lambda_alpha_heatmap.png"),
            "notebook": str(NOTEBOOK_PATH),
        },
    }
    (OUT_DIR / "step1_report_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
