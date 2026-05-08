#!/usr/bin/env python3
"""Plot average vs equal-to-both metrics for one AlwaysCommittedAgent simulation."""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from run_always_committed_lambda_sweep import (
    DEFAULT_OUTPUT_DIR,
    collect_metrics,
)


DEFAULT_HUMAN_COMPARISON_DIR = Path(
    "dataAnalysis/analyses/outputs/comparisons/equal_to_both_agent_human_comparison"
)

PANELS = [
    ("Success Rate (%)", "success"),
    ("Coordination Efficiency (%)", "efficiency"),
    ("Commitment (%)", "commitment"),
    ("Signaling Move (%)", "signaling"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lambda", dest="lambda_value", type=float, required=True)
    parser.add_argument("--beta", type=float, default=3.0)
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--prefix", default="always_committed_fitted_lambda")
    parser.add_argument("--human-comparison-dir", type=Path, default=DEFAULT_HUMAN_COMPARISON_DIR)
    return parser.parse_args()


def plot_bar_summary(df: pd.DataFrame, output_path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(12, 9))
    fitted_lambda = float(df["lambda"].iloc[0])
    fig.suptitle(
        f"AlwaysCommittedAgent Fitted Lambda = {fitted_lambda:.3f}",
        fontsize=18,
        fontweight="bold",
        y=0.98,
    )

    panels = [
        ("Success Rate (%)", "success_percent", "success_ci_lower", "success_ci_upper"),
        ("Coordination Efficiency (%)", "efficiency_percent", "efficiency_ci_lower", "efficiency_ci_upper"),
        ("Commitment (%)", "commitment_percent", "commitment_ci_lower", "commitment_ci_upper"),
        ("Signaling Move (%)", "signaling_percent", "signaling_ci_lower", "signaling_ci_upper"),
    ]
    labels = {
        "average": "Average\nAll 2P3G",
        "equal_to_both": "Equal-to-Both\nOnly",
    }
    colors = ["#4f79a8", "#f28e2b"]

    for ax, (title, mean_col, low_col, high_col) in zip(axes.ravel(), panels):
        sub = df.set_index("condition_scope").loc[["average", "equal_to_both"]].reset_index()
        y = sub[mean_col].to_numpy(dtype=float)
        low = sub[low_col].to_numpy(dtype=float)
        high = sub[high_col].to_numpy(dtype=float)
        yerr = [y - low, high - y]
        x = range(len(sub))

        bars = ax.bar(x, y, color=colors, alpha=0.88, yerr=yerr, capsize=5, width=0.58)
        ax.set_title(title, fontsize=14, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_ylabel("(%)")
        ax.set_xticks(list(x))
        ax.set_xticklabels([labels[value] for value in sub["condition_scope"]], fontsize=11)
        ax.grid(axis="y", color="#d0d0d0", linewidth=1.1)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
        for bar, value in zip(bars, y):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                max(2, value * 0.08),
                f"{value:.1f}",
                ha="center",
                va="bottom",
                color="white",
                fontsize=11,
                fontweight="bold",
            )

    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def build_human_side_by_side_df(agent_df: pd.DataFrame, human_comparison_dir: Path) -> pd.DataFrame:
    human_files = {
        "average": human_comparison_dir / "all_distance_committed_joint_rl_human_4panel_summary.csv",
        "equal_to_both": human_comparison_dir / "equal_to_both_committed_joint_rl_human_4panel_summary.csv",
    }
    scope_labels = {
        "average": "Average all 2P3G",
        "equal_to_both": "Equal-to-Both only",
    }

    human_frames = {
        scope: pd.read_csv(path).query("group == 'Human-Human'").copy()
        for scope, path in human_files.items()
    }
    fitted_lambda = float(agent_df["lambda"].iloc[0])
    rows = []

    for scope in ["average", "equal_to_both"]:
        agent_row = agent_df.loc[agent_df["condition_scope"] == scope].iloc[0]
        human_scope = human_frames[scope]
        for metric_name, metric_key in PANELS:
            rows.append({
                "condition_scope": scope,
                "condition_label": scope_labels[scope],
                "group": f"AlwaysCommitted\n(lambda={fitted_lambda:.3f})",
                "metric": metric_name,
                "mean_percent": float(agent_row[f"{metric_key}_percent"]),
                "ci95_percent": max(
                    float(agent_row[f"{metric_key}_percent"]) - float(agent_row[f"{metric_key}_ci_lower"]),
                    float(agent_row[f"{metric_key}_ci_upper"]) - float(agent_row[f"{metric_key}_percent"]),
                ),
                "n": int(agent_row[f"{metric_key}_n"]),
            })
            human_row = human_scope.loc[human_scope["metric"] == metric_name].iloc[0]
            rows.append({
                "condition_scope": scope,
                "condition_label": scope_labels[scope],
                "group": "Human-Human",
                "metric": metric_name,
                "mean_percent": float(human_row["mean_percent"]),
                "ci95_percent": float(human_row["ci95_percent"]),
                "n": int(human_row["n"]),
            })

    return pd.DataFrame(rows)


def plot_human_side_by_side(df: pd.DataFrame, output_path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(14, 9.5))
    fig.suptitle(
        "AlwaysCommittedAgent vs Human-Human",
        fontsize=18,
        fontweight="bold",
        y=0.98,
    )

    condition_order = ["average", "equal_to_both"]
    condition_labels = ["Average\nAll 2P3G", "Equal-to-Both\nOnly"]
    group_order = [group for group in df["group"].drop_duplicates() if group != "Human-Human"] + ["Human-Human"]
    colors = {
        group_order[0]: "#4f79a8",
        "Human-Human": "#59a14f",
    }
    x = np.arange(len(condition_order))
    width = 0.36

    for ax, (metric_name, _metric_key) in zip(axes.ravel(), PANELS):
        metric_df = df.loc[df["metric"] == metric_name]
        for offset_idx, group in enumerate(group_order):
            group_df = metric_df.set_index(["condition_scope", "group"])
            means = [
                group_df.loc[(scope, group), "mean_percent"]
                for scope in condition_order
            ]
            errors = [
                group_df.loc[(scope, group), "ci95_percent"]
                for scope in condition_order
            ]
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


def main() -> None:
    args = parse_args()
    rows = collect_metrics(args.output_dir, args.beta, args.lambda_value, args.sessions)
    df = pd.DataFrame(rows)
    csv_path = args.output_dir / f"{args.prefix}_average_equal_summary.csv"
    png_path = args.output_dir / f"{args.prefix}_average_equal_bar_4panel.png"
    comparison_csv_path = args.output_dir / f"{args.prefix}_human_side_by_side_summary.csv"
    comparison_png_path = args.output_dir / f"{args.prefix}_human_side_by_side_bar_4panel.png"
    df.to_csv(csv_path, index=False)
    plot_bar_summary(df, png_path)
    comparison_df = build_human_side_by_side_df(df, args.human_comparison_dir)
    comparison_df.to_csv(comparison_csv_path, index=False)
    plot_human_side_by_side(comparison_df, comparison_png_path)
    print(df[[
        "lambda",
        "condition_scope",
        "success_percent",
        "efficiency_percent",
        "commitment_percent",
        "signaling_percent",
    ]].round(2).to_string(index=False))
    print(f"csv={csv_path}")
    print(f"png={png_path}")
    print(f"comparison_csv={comparison_csv_path}")
    print(f"comparison_png={comparison_png_path}")


if __name__ == "__main__":
    main()
