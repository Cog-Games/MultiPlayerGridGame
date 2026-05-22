#!/usr/bin/env python3
"""Create a standalone full-coverage report for the shared-agency RSA model."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd

from fit_always_signal_rsa_lambda_alpha import (  # noqa: E402
    DEFAULT_RAW_DIR,
    HUMAN_RAW,
    MODEL,
    add_measures,
    comparison_rows,
    human_targets,
    load_raw,
    long_player_rows,
    measure_row,
    metric_binomial_nll,
    plot_comparison,
    simulated_rates,
    weighted_metric_rate,
)

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = DEFAULT_RAW_DIR
MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
ASSET_DIR = MODEL_ROOT / "report_assets" / "shared_agency_full"
HTML_PATH = MODEL_ROOT / "sampleJointGoalAndRSASignal_fromStart_full_heatmap.html"

PARAM_RE = re.compile(
    r"beta_(?P<beta>[^_]+)_lambda_(?P<lambda>[^_]+)_alpha_(?P<alpha>[^_]+)_sessions"
)
FIT_METRICS = ["commitment", "signalingMove"]


def decode_param(value: str) -> float:
    return float(value.replace("neg", "-").replace("p", "."))


def format_param(value: float) -> str:
    return f"{value:g}"


def available_raw_files() -> List[Tuple[float, float, Path]]:
    rows: List[Tuple[float, float, Path]] = []
    for path in sorted(RAW_DIR.glob("*.json.zst")):
        match = PARAM_RE.search(path.name)
        if not match:
            continue
        rows.append((
            decode_param(match.group("lambda")),
            decode_param(match.group("alpha")),
            path,
        ))
    if not rows:
        raise FileNotFoundError(f"No shared-agency raw .json.zst files found in {RAW_DIR}")
    return sorted(rows, key=lambda item: (item[0], item[1]))


def evaluate_raw(lambda_value: float, alpha: float, raw_path: Path, target: pd.DataFrame) -> Dict[str, Any]:
    raw_trials = load_raw(raw_path)
    sim_df = add_measures(long_player_rows(raw_trials, MODEL))
    rates = simulated_rates(sim_df)
    commitment_nll, signaling_nll = metric_binomial_nll(target, rates)
    row: Dict[str, Any] = {
        "lambda": float(lambda_value),
        "alpha": float(alpha),
        "commitment_nll": float(commitment_nll),
        "signaling_nll": float(signaling_nll),
        "binomial_nll": float(commitment_nll + signaling_nll),
        "sim_commitment_human_weighted_average": weighted_metric_rate(target, rates, "commitment"),
        "sim_signaling_human_weighted_average": weighted_metric_rate(target, rates, "signalingMove"),
        "sim_commitment_equal_to_both": rates.get(("equal_to_both", "commitment"), np.nan),
        "sim_signaling_equal_to_both": rates.get(("equal_to_both", "signalingMove"), np.nan),
        "raw_trials": str(raw_path),
        "fit_stage": "available_raw",
    }
    row.update(measure_row(lambda_value, alpha, raw_trials, sim_df))
    return row


def pivot_values(grid_df: pd.DataFrame, value_col: str) -> Tuple[pd.DataFrame, List[float], List[float]]:
    lambda_values = sorted(float(v) for v in grid_df["lambda"].dropna().unique())
    alpha_values = sorted(float(v) for v in grid_df["alpha"].dropna().unique())
    pivot = grid_df.pivot_table(index="alpha", columns="lambda", values=value_col, aggfunc="mean")
    pivot = pivot.reindex(index=alpha_values, columns=lambda_values)
    return pivot, lambda_values, alpha_values


def plot_heatmap(
    grid_df: pd.DataFrame,
    best_row: Dict[str, Any],
    value_col: str,
    title: str,
    cbar_label: str,
    output_path: Path,
    *,
    vmin: float | None = None,
    vmax: float | None = None,
    fmt: str = "{:.1f}",
    cmap_name: str = "viridis",
) -> None:
    pivot, lambda_values, alpha_values = pivot_values(grid_df, value_col)
    width = max(12.0, 0.72 * len(lambda_values) + 3.5)
    height = max(8.0, 0.52 * len(alpha_values) + 2.2)
    cmap = plt.get_cmap(cmap_name).copy()
    cmap.set_bad("#eef1f4")

    fig, ax = plt.subplots(figsize=(width, height))
    image = ax.imshow(
        pivot.to_numpy(dtype=float),
        aspect="auto",
        origin="lower",
        cmap=cmap,
        vmin=vmin,
        vmax=vmax,
    )
    ax.set_title(title, fontsize=16, fontweight="bold", pad=16)
    ax.set_xlabel("lambda")
    ax.set_ylabel("RSA alpha")
    ax.set_xticks(np.arange(len(lambda_values)))
    ax.set_xticklabels([format_param(v) for v in lambda_values], rotation=45, ha="right")
    ax.set_yticks(np.arange(len(alpha_values)))
    ax.set_yticklabels([format_param(v) for v in alpha_values])
    fig.colorbar(image, ax=ax, fraction=0.035, pad=0.03, label=cbar_label)

    best_lambda = float(best_row["lambda"])
    best_alpha = float(best_row["alpha"])
    if best_lambda in lambda_values and best_alpha in alpha_values:
        ax.scatter(
            [lambda_values.index(best_lambda)],
            [alpha_values.index(best_alpha)],
            marker="*",
            s=260,
            color="white",
            edgecolor="black",
            linewidth=1.2,
            zorder=5,
        )

    for y, alpha in enumerate(alpha_values):
        for x, lambda_value in enumerate(lambda_values):
            value = pivot.loc[alpha, lambda_value]
            if np.isfinite(value):
                ax.text(x, y, fmt.format(value), ha="center", va="center", fontsize=7)
            else:
                ax.text(x, y, "NA", ha="center", va="center", fontsize=6, color="#7b8794")

    ax.set_xlim(-0.5, len(lambda_values) - 0.5)
    ax.set_ylim(-0.5, len(alpha_values) - 0.5)
    fig.tight_layout()
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_four_metric_heatmaps(
    grid_df: pd.DataFrame,
    best_row: Dict[str, Any],
    scope: str,
    title: str,
    output_path: Path,
) -> None:
    panels = [
        ("Success Rate (%)", f"{scope}_success_percent"),
        ("Coordination Efficiency (%)", f"{scope}_efficiency_percent"),
        ("Commitment (%)", f"{scope}_commitment_percent"),
        ("Signaling Move (%)", f"{scope}_signaling_percent"),
    ]
    lambda_values = sorted(float(v) for v in grid_df["lambda"].dropna().unique())
    alpha_values = sorted(float(v) for v in grid_df["alpha"].dropna().unique())
    cmap = plt.get_cmap("viridis").copy()
    cmap.set_bad("#eef1f4")

    fig, axes = plt.subplots(2, 2, figsize=(16, 12))
    fig.suptitle(title, fontsize=17, fontweight="bold", y=0.98)
    best_lambda = float(best_row["lambda"])
    best_alpha = float(best_row["alpha"])
    best_x = lambda_values.index(best_lambda) if best_lambda in lambda_values else None
    best_y = alpha_values.index(best_alpha) if best_alpha in alpha_values else None

    for ax, (panel_title, col) in zip(axes.ravel(), panels):
        pivot = grid_df.pivot_table(index="alpha", columns="lambda", values=col, aggfunc="mean")
        pivot = pivot.reindex(index=alpha_values, columns=lambda_values)
        image = ax.imshow(pivot.to_numpy(dtype=float), aspect="auto", origin="lower", cmap=cmap, vmin=0, vmax=100)
        ax.set_title(panel_title, fontsize=13, fontweight="bold")
        ax.set_xlabel("lambda")
        ax.set_ylabel("RSA alpha")
        ax.set_xticks(np.arange(len(lambda_values)))
        ax.set_xticklabels([format_param(v) for v in lambda_values], rotation=45, ha="right", fontsize=8)
        ax.set_yticks(np.arange(len(alpha_values)))
        ax.set_yticklabels([format_param(v) for v in alpha_values], fontsize=8)
        fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04, label="%")
        if best_x is not None and best_y is not None:
            ax.scatter([best_x], [best_y], marker="*", s=190, color="white", edgecolor="black", linewidth=1.1, zorder=5)
        for y, alpha in enumerate(alpha_values):
            for x, lambda_value in enumerate(lambda_values):
                value = pivot.loc[alpha, lambda_value]
                if np.isfinite(value):
                    ax.text(x, y, f"{value:.0f}", ha="center", va="center", fontsize=6)

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def metric_table_rows(summary_df: pd.DataFrame) -> str:
    rows = []
    for row in summary_df.to_dict(orient="records"):
        rows.append(
            "<tr>"
            f"<td>{html.escape(str(row['condition_scope']))}</td>"
            f"<td>{html.escape(str(row['group']))}</td>"
            f"<td>{html.escape(str(row['metric']))}</td>"
            f"<td class=\"num\">{float(row['mean_percent']):.1f}</td>"
            f"<td class=\"num\">{float(row['ci95_percent']):.1f}</td>"
            f"<td class=\"num\">{int(row['n'])}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def top_settings_rows(grid_df: pd.DataFrame, count: int = 20) -> str:
    rows = []
    cols = [
        "lambda",
        "alpha",
        "binomial_nll",
        "commitment_nll",
        "signaling_nll",
        "average_success_percent",
        "average_efficiency_percent",
        "average_commitment_percent",
        "average_signaling_percent",
        "equal_success_percent",
        "equal_efficiency_percent",
        "equal_commitment_percent",
        "equal_signaling_percent",
    ]
    for row in grid_df.sort_values("binomial_nll").head(count)[cols].to_dict(orient="records"):
        rows.append(
            "<tr>"
            f"<td class=\"num\">{row['lambda']:.6g}</td>"
            f"<td class=\"num\">{row['alpha']:.6g}</td>"
            f"<td class=\"num\">{row['binomial_nll']:.2f}</td>"
            f"<td class=\"num\">{row['commitment_nll']:.2f}</td>"
            f"<td class=\"num\">{row['signaling_nll']:.2f}</td>"
            f"<td class=\"num\">{row['average_success_percent']:.1f}</td>"
            f"<td class=\"num\">{row['average_efficiency_percent']:.1f}</td>"
            f"<td class=\"num\">{row['average_commitment_percent']:.1f}</td>"
            f"<td class=\"num\">{row['average_signaling_percent']:.1f}</td>"
            f"<td class=\"num\">{row['equal_success_percent']:.1f}</td>"
            f"<td class=\"num\">{row['equal_efficiency_percent']:.1f}</td>"
            f"<td class=\"num\">{row['equal_commitment_percent']:.1f}</td>"
            f"<td class=\"num\">{row['equal_signaling_percent']:.1f}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def write_html(
    grid_df: pd.DataFrame,
    best_row: Dict[str, Any],
    summary_df: pd.DataFrame,
    outputs: Dict[str, Path],
) -> None:
    lambda_values = sorted(grid_df["lambda"].unique())
    alpha_values = sorted(grid_df["alpha"].unique())
    possible_cells = len(lambda_values) * len(alpha_values)
    coverage = 100.0 * len(grid_df) / possible_cells if possible_cells else 0.0
    top_rows = top_settings_rows(grid_df)
    metric_rows = metric_table_rows(summary_df)

    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sampleJointGoalAndRSASignal_fromStart Shared-Agency Full Heatmap</title>
<script>
window.MathJax = {{ tex: {{ inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] }} }};
</script>
<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<style>
:root {{
  --ink:#17202a;
  --muted:#5f6b7a;
  --line:#d9e1ea;
  --bg:#f7f9fb;
  --panel:#ffffff;
  --accent:#b38600;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg); }}
header {{ padding:28px 34px 20px; border-bottom:1px solid var(--line); background:#fff; }}
main {{ max-width:1280px; margin:0 auto; padding:24px 28px 40px; }}
h1 {{ margin:0 0 8px; font-size:30px; line-height:1.15; }}
h2 {{ margin:0 0 12px; font-size:22px; }}
h3 {{ margin:18px 0 8px; font-size:16px; }}
p {{ line-height:1.55; }}
.note {{ color:var(--muted); }}
.badge {{ display:inline-block; margin-left:8px; padding:3px 8px; border-radius:999px; background:#fff7d6; color:#6f5200; font-size:13px; vertical-align:middle; }}
.grid {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:20px 0; }}
.stat {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }}
.stat .label {{ color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }}
.stat .value {{ margin-top:6px; font-size:24px; font-weight:700; }}
.card {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; margin:18px 0; }}
.wide-img {{ display:block; width:100%; height:auto; border:1px solid var(--line); border-radius:6px; background:#fff; }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; background:#fff; }}
th,td {{ border-bottom:1px solid var(--line); padding:8px 9px; text-align:left; vertical-align:top; }}
th {{ color:#44515f; background:#f1f5f9; position:sticky; top:0; }}
.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
.scroll {{ overflow:auto; border:1px solid var(--line); border-radius:6px; max-height:520px; }}
.links a {{ color:#245a92; margin-right:12px; white-space:nowrap; }}
.equation {{ padding:12px 14px; background:#f9fafb; border:1px solid var(--line); border-radius:6px; }}
@media (max-width: 900px) {{
  .grid, .two {{ grid-template-columns:1fr; }}
  main {{ padding:18px; }}
}}
</style>
</head>
<body>
<header>
  <h1>sampleJointGoalAndRSASignal_fromStart <span class="badge">shared-agency model</span></h1>
  <p class="note">Standalone report for the full available lambda x RSA-alpha parameter grid using the unshaped JointRL shared-agency model. Blank cells in heatmaps are parameter combinations that do not currently have raw simulation output.</p>
</header>
<main>
  <section class="grid">
    <div class="stat"><div class="label">Available settings</div><div class="value">{len(grid_df)}</div></div>
    <div class="stat"><div class="label">Parameter coverage</div><div class="value">{coverage:.1f}%</div></div>
    <div class="stat"><div class="label">Best lambda</div><div class="value">{float(best_row['lambda']):g}</div></div>
    <div class="stat"><div class="label">Best RSA alpha</div><div class="value">{float(best_row['alpha']):g}</div></div>
  </section>

  <section class="card">
    <h2>Model</h2>
    <p>The agent uses from-start joint-goal sampling from <code>AlwaysSignalAgent</code>, with goal values and RSA base-action likelihoods from the same unshaped JointRL reward model. The fit objective is trial/player-level commitment plus signaling binomial NLL by distance condition.</p>
    <div class="equation">\\[
      W_\\lambda(g) \\propto \\exp(3\\widetilde V_g(s_t))P_t(g)^\\lambda,\\qquad
      \\pi_{{\\mathrm{{RSA}}}}(a\\mid g)\\propto \\pi_{{\\mathrm{{base}}}}(a\\mid s_t,g)P_t(g\\mid a)^\\alpha
    \\]</div>
    <div class="equation">\\[
      R(s,a,s')=30\\,\\mathbf 1[\\mathrm{{both\\ reach\\ }}g]-1\\,\\mathbf 1[\\mathrm{{not\\ done}}],\\quad
      \\gamma=.9,\\quad \\mathrm{{softmax}}\\ \\beta=3,\\quad \\mathrm{{proximityRewardWeight}}=0
    \\]</div>
    <p class="links">
      <a href="{rel(outputs['grid_csv'])}">full grid CSV</a>
      <a href="{rel(outputs['summary_json'])}">summary JSON</a>
      <a href="model_model_comparison.html#always_signal_rsa_agent">main model-model subsection</a>
      <a href="signal_agent/model.md">model.md</a>
    </p>
  </section>

  <section class="card">
    <h2>Full Fit Heatmap</h2>
    <p class="note">All available raw parameter settings are included. The white star marks the best commitment+signaling NLL setting: lambda = {float(best_row['lambda']):g}, alpha = {float(best_row['alpha']):g}, NLL = {float(best_row['binomial_nll']):.2f}.</p>
    <a href="{rel(outputs['nll_heatmap'])}"><img class="wide-img" src="{rel(outputs['nll_heatmap'])}" alt="Full lambda by RSA-alpha NLL heatmap for sampleJointGoalAndRSASignal_fromStart"></a>
  </section>

  <section class="card">
    <h2>Metric Heatmaps</h2>
    <div class="two">
      <div>
        <h3>Average all 2P3G</h3>
        <a href="{rel(outputs['average_heatmap'])}"><img class="wide-img" src="{rel(outputs['average_heatmap'])}" alt="Average all 2P3G full parameter heatmaps"></a>
      </div>
      <div>
        <h3>Equal-to-both only</h3>
        <a href="{rel(outputs['equal_heatmap'])}"><img class="wide-img" src="{rel(outputs['equal_heatmap'])}" alt="Equal-to-both full parameter heatmaps"></a>
      </div>
    </div>
  </section>

    <section class="card">
    <h2>Best Setting vs Human</h2>
    <p class="note">Success and efficiency are reported for the best NLL setting but are not part of the optimized objective.</p>
    <div class="two">
      <div>
        <h3>Average all 2P3G</h3>
        <a href="{rel(outputs['average_comparison_plot'])}"><img class="wide-img" src="{rel(outputs['average_comparison_plot'])}" alt="Shared-agency best setting compared with Human-Human across all 2P3G conditions"></a>
      </div>
      <div>
        <h3>Equal-to-both only</h3>
        <a href="{rel(outputs['equal_comparison_plot'])}"><img class="wide-img" src="{rel(outputs['equal_comparison_plot'])}" alt="Shared-agency best setting compared with Human-Human in equal-to-both trials"></a>
      </div>
    </div>
  </section>

  <section class="card">
    <h2>Best Available Settings</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>lambda</th><th>alpha</th><th>NLL</th><th>Commit NLL</th><th>Signal NLL</th><th>Avg Success</th><th>Avg Eff.</th><th>Avg Commit</th><th>Avg Signal</th><th>Equal Success</th><th>Equal Eff.</th><th>Equal Commit</th><th>Equal Signal</th></tr></thead>
        <tbody>{top_rows}</tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <h2>Best Setting Summary</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>Scope</th><th>Group</th><th>Metric</th><th>Mean %</th><th>95% CI</th><th>N</th></tr></thead>
        <tbody>{metric_rows}</tbody>
      </table>
    </div>
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, "Human-Human"))
    target = human_targets(human_df)

    rows = []
    raw_files = available_raw_files()
    for index, (lambda_value, alpha, raw_path) in enumerate(raw_files, start=1):
        print(f"[{index}/{len(raw_files)}] lambda={lambda_value:g} alpha={alpha:g}", flush=True)
        rows.append(evaluate_raw(lambda_value, alpha, raw_path, target))

    grid_df = pd.DataFrame(rows).sort_values(["lambda", "alpha"]).reset_index(drop=True)
    best_row = grid_df.loc[grid_df["binomial_nll"].idxmin()].to_dict()
    best_raw = load_raw(Path(str(best_row["raw_trials"])))
    best_label = (
        "sampleJointGoalAndRSASignal_fromStart (shared-agency model)\n"
        f"(lambda={float(best_row['lambda']):g}, alpha={float(best_row['alpha']):g})"
    )
    best_df = add_measures(long_player_rows(best_raw, best_label))

    comparison_rows_all: List[Dict[str, Any]] = []
    comparison_by_scope: Dict[str, pd.DataFrame] = {}
    for condition_scope, condition in [("average", None), ("equal_to_both", "equal_to_both")]:
        scope_rows: List[Dict[str, Any]] = []
        for group_label, raw_trials, df in [
            (best_label, best_raw, best_df),
            ("Human-Human", human_raw, human_df),
        ]:
            for row in comparison_rows(group_label, raw_trials, df, condition):
                scope_rows.append(dict(row))
                row["condition_scope"] = condition_scope
                comparison_rows_all.append(row)
        comparison_by_scope[condition_scope] = pd.DataFrame(scope_rows)
    summary_df = pd.DataFrame(comparison_rows_all)

    outputs = {
        "grid_csv": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_available_grid.csv",
        "summary_csv": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_best_summary.csv",
        "summary_json": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_summary.json",
        "nll_heatmap": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_nll_heatmap.png",
        "average_heatmap": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_average_4measure_heatmaps.png",
        "equal_heatmap": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_equal_to_both_4measure_heatmaps.png",
        "average_comparison_plot": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_best_vs_human_average_4panel.png",
        "equal_comparison_plot": ASSET_DIR / "sampleJointGoalAndRSASignal_fromStart_full_best_vs_human_equal_to_both_4panel.png",
    }

    grid_df.to_csv(outputs["grid_csv"], index=False)
    summary_df.to_csv(outputs["summary_csv"], index=False)
    plot_heatmap(
        grid_df,
        best_row,
        "binomial_nll",
        "sampleJointGoalAndRSASignal_fromStart: all available lambda x RSA-alpha fit NLL",
        "commitment + signaling NLL",
        outputs["nll_heatmap"],
        fmt="{:.1f}",
        cmap_name="magma_r",
    )
    plot_four_metric_heatmaps(
        grid_df,
        best_row,
        "average",
        "sampleJointGoalAndRSASignal_fromStart: all available parameters, average all 2P3G",
        outputs["average_heatmap"],
    )
    plot_four_metric_heatmaps(
        grid_df,
        best_row,
        "equal",
        "sampleJointGoalAndRSASignal_fromStart: all available parameters, equal-to-both",
        outputs["equal_heatmap"],
    )
    plot_comparison(
        comparison_by_scope["average"],
        outputs["average_comparison_plot"],
        "Best shared-agency setting vs Human-Human, average all 2P3G",
    )
    plot_comparison(
        comparison_by_scope["equal_to_both"],
        outputs["equal_comparison_plot"],
        "Best shared-agency setting vs Human-Human, equal-to-both",
    )

    summary = {
        "model": MODEL,
        "report_label": "sampleJointGoalAndRSASignal_fromStart (shared-agency model)",
        "raw_dir": str(RAW_DIR),
        "available_settings": int(grid_df.shape[0]),
        "available_lambdas": [float(v) for v in sorted(grid_df["lambda"].unique())],
        "available_alphas": [float(v) for v in sorted(grid_df["alpha"].unique())],
        "best_by_binomial_nll": best_row,
        "html": str(HTML_PATH),
        "outputs": {key: str(value) for key, value in outputs.items()},
    }
    outputs["summary_json"].write_text(json.dumps(summary, indent=2), encoding="utf-8")
    write_html(grid_df, best_row, summary_df, outputs)
    print(json.dumps({"html": str(HTML_PATH), "best": best_row, "settings": int(grid_df.shape[0])}, indent=2))


if __name__ == "__main__":
    main()
