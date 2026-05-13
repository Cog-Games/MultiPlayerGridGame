#!/usr/bin/env python3
"""Run AlwaysCommittedAgent lambda sweep and plot average vs equal-to-both metrics."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


DEFAULT_OUTPUT_DIR = Path(
    "dataAnalysis/model_model/always_committed_agent/outputs/"
    "always_committed_vs_always_committed_simulation"
)
SIM_SCRIPT = Path("dataAnalysis/scripts/simulate_always_committed_vs_always_committed_2p3g.js")
ANALYZER_SCRIPT = Path("dataAnalysis/scripts/analyze_committed_vs_committed_notebook_metrics.py")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", type=int, default=30)
    parser.add_argument("--trials-per-session", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--beta", type=float, default=3.0)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--skip-existing", action="store_true")
    return parser.parse_args()


def lambda_values() -> list[float]:
    return [round(i / 10, 1) for i in range(11)]


def format_number(value: float) -> str:
    if math.isclose(value, round(value)):
        return str(int(round(value)))
    text = str(value)
    return text.rstrip("0").rstrip(".") if "." in text else text


def path_token(value: float) -> str:
    return format_number(value).replace("-", "neg").replace(".", "p")


def mean_ci(values: list[float]) -> tuple[float, float, float, int]:
    arr = np.asarray([v for v in values if pd.notna(v)], dtype=float)
    if arr.size == 0:
        return np.nan, np.nan, np.nan, 0
    mean = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1)) if arr.size > 1 else 0.0
    se = sd / np.sqrt(arr.size) if arr.size else np.nan
    ci = 1.96 * se if np.isfinite(se) else np.nan
    return mean, mean - ci, mean + ci, int(arr.size)


def run_command(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def simulation_paths(output_dir: Path, beta: float, lam: float, sessions: int) -> dict[str, Path]:
    suffix = f"beta_{path_token(beta)}_lambda_{path_token(lam)}_sessions_0_to_{sessions - 1}"
    return {
        "summary": output_dir / f"always_committed_vs_always_committed_2p3g_summary_{suffix}.json",
        "trials": output_dir / f"always_committed_vs_always_committed_2p3g_trials_{suffix}.json",
        "raw": output_dir / f"always_committed_vs_always_committed_2p3g_raw_trials_{suffix}.json",
        "metrics": output_dir / f"always_committed_vs_always_committed_2p3g_notebook_metrics_{suffix}.json",
    }


def session_metric_from_trials(trials: list[dict], sessions: int, scope: str, metric: str) -> tuple[float, float, float, int]:
    values: list[float] = []
    for session in range(sessions):
        rows = [row for row in trials if int(row.get("sessionIndex", -1)) == session]
        if scope == "equal_to_both":
            rows = [row for row in rows if row.get("distanceCondition") == "equal_to_both"]
        if not rows:
            continue

        if metric == "success":
            values.append(sum(1 for row in rows if row.get("collaborationSucceeded")) / len(rows))
        elif metric == "commitment":
            eligible = [row for row in rows if row.get("commitmentEligible")]
            committed = []
            for row in eligible:
                if row.get("player1Committed") is not None:
                    committed.append(bool(row.get("player1Committed")))
                if row.get("player2Committed") is not None:
                    committed.append(bool(row.get("player2Committed")))
            if committed:
                values.append(sum(1 for value in committed if value) / len(committed))

    return mean_ci(values)


def participant_metric_from_rows(row_df: pd.DataFrame, scope: str, value_col: str, success_only: bool, scale: float) -> tuple[float, float, float, int]:
    df = row_df.copy()
    df = df[df["newGoalPresented"] == True]
    if scope == "equal_to_both":
        df = df[df["distanceCondition"] == "equal_to_both"]
    if success_only:
        df = df[df["collaborationSucceeded"] == True]
    df = df.dropna(subset=[value_col])
    if df.empty:
        return np.nan, np.nan, np.nan, 0
    grouped = df.groupby(["participantId", "partnerType"], as_index=False)[value_col].mean()
    values = (grouped[value_col].astype(float) * scale).tolist()
    return mean_ci(values)


def collect_metrics(output_dir: Path, beta: float, lam: float, sessions: int) -> list[dict]:
    paths = simulation_paths(output_dir, beta, lam, sessions)
    summary = json.loads(paths["summary"].read_text())
    trials = json.loads(paths["trials"].read_text())
    metrics = json.loads(paths["metrics"].read_text())
    row_df = pd.DataFrame(metrics["row_level_measures"])

    if summary.get("totalTrials") != sessions * summary.get("trialsPerSession", 0):
        raise ValueError(f"Unexpected trial count for lambda={lam}: {summary.get('totalTrials')}")

    rows = []
    for scope, label in [
        ("average", "Average all 2P3G distance conditions"),
        ("equal_to_both", "Equal-to-both only"),
    ]:
        success = session_metric_from_trials(trials, sessions, scope, "success")
        commitment = session_metric_from_trials(trials, sessions, scope, "commitment")
        efficiency = participant_metric_from_rows(row_df, scope, "efficiencyPercent", success_only=True, scale=1.0)
        signaling = participant_metric_from_rows(row_df, scope, "signalingMove", success_only=False, scale=100.0)

        rows.append({
            "lambda": lam,
            "condition_scope": scope,
            "condition_label": label,
            "success_percent": success[0] * 100,
            "success_ci_lower": success[1] * 100,
            "success_ci_upper": success[2] * 100,
            "success_n": success[3],
            "efficiency_percent": efficiency[0],
            "efficiency_ci_lower": efficiency[1],
            "efficiency_ci_upper": efficiency[2],
            "efficiency_n": efficiency[3],
            "commitment_percent": commitment[0] * 100,
            "commitment_ci_lower": commitment[1] * 100,
            "commitment_ci_upper": commitment[2] * 100,
            "commitment_n": commitment[3],
            "signaling_percent": signaling[0],
            "signaling_ci_lower": signaling[1],
            "signaling_ci_upper": signaling[2],
            "signaling_n": signaling[3],
        })
    return rows


def plot_summary(df: pd.DataFrame, output_path: Path) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(13, 10), sharex=True)
    fig.suptitle("AlwaysCommittedAgent vs AlwaysCommittedAgent", fontsize=20, fontweight="bold", y=0.98)

    panels = [
        ("Success Rate (%)", "success_percent", "success_ci_lower", "success_ci_upper"),
        ("Coordination Efficiency (%)", "efficiency_percent", "efficiency_ci_lower", "efficiency_ci_upper"),
        ("Commitment (%)", "commitment_percent", "commitment_ci_lower", "commitment_ci_upper"),
        ("Signaling Move (%)", "signaling_percent", "signaling_ci_lower", "signaling_ci_upper"),
    ]
    colors = {
        "Average all 2P3G distance conditions": "#4f79a8",
        "Equal-to-both only": "#f28e2b",
    }

    for ax, (title, mean_col, low_col, high_col) in zip(axes.ravel(), panels):
        for label, sub in df.groupby("condition_label", sort=False):
            sub = sub.sort_values("lambda")
            x = sub["lambda"].to_numpy(dtype=float)
            y = sub[mean_col].to_numpy(dtype=float)
            low = sub[low_col].to_numpy(dtype=float)
            high = sub[high_col].to_numpy(dtype=float)
            yerr = np.vstack([y - low, high - y])
            ax.errorbar(
                x,
                y,
                yerr=yerr,
                marker="o",
                linewidth=2.5,
                markersize=6,
                capsize=3,
                color=colors[label],
                label=label,
            )
        ax.set_title(title, fontsize=15, fontweight="bold")
        ax.set_ylim(0, 105)
        ax.set_xlim(-0.03, 1.03)
        ax.set_xticks(lambda_values())
        ax.set_xlabel("lambda")
        ax.set_ylabel("(%)")
        ax.grid(axis="y", color="#cfcfcf", linewidth=1.1)
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)

    handles, labels = axes.ravel()[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=2, frameon=False, fontsize=12)
    fig.tight_layout(rect=[0, 0.05, 1, 0.95])
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    all_rows = []
    for lam in lambda_values():
        paths = simulation_paths(args.output_dir, args.beta, lam, args.sessions)
        if not args.skip_existing or not (paths["summary"].exists() and paths["trials"].exists() and paths["raw"].exists()):
            run_command([
                "node",
                str(SIM_SCRIPT),
                "--sessions",
                str(args.sessions),
                "--trials-per-session",
                str(args.trials_per_session),
                "--seed",
                str(args.seed),
                "--beta",
                format_number(args.beta),
                "--lambda",
                format_number(lam),
                "--output-dir",
                str(args.output_dir),
            ])

        if not args.skip_existing or not paths["metrics"].exists():
            run_command([
                "python3",
                str(ANALYZER_SCRIPT),
                "--input",
                str(paths["raw"]),
                "--output",
                str(paths["metrics"]),
            ])

        raw_rows = json.loads(paths["raw"].read_text())
        if len(raw_rows) != args.sessions * args.trials_per_session:
            raise ValueError(f"lambda={lam}: expected {args.sessions * args.trials_per_session} raw rows, found {len(raw_rows)}")
        if {row.get("partnerType") for row in raw_rows} != {"always_committed"}:
            raise ValueError(f"lambda={lam}: raw rows have unexpected partnerType values")
        if {row.get("experimentType") for row in raw_rows} != {"2P3G"}:
            raise ValueError(f"lambda={lam}: raw rows have unexpected experimentType values")

        all_rows.extend(collect_metrics(args.output_dir, args.beta, lam, args.sessions))

    out_df = pd.DataFrame(all_rows)
    csv_path = args.output_dir / "always_committed_lambda_sweep_average_equal_summary.csv"
    png_path = args.output_dir / "always_committed_lambda_sweep_average_equal_4panel.png"
    out_df.to_csv(csv_path, index=False)
    plot_summary(out_df, png_path)

    print(json.dumps({
        "csv": str(csv_path),
        "png": str(png_path),
        "rows": len(out_df),
        "table": out_df[[
            "lambda",
            "condition_scope",
            "success_percent",
            "efficiency_percent",
            "commitment_percent",
            "signaling_percent",
        ]].round(2).to_dict(orient="records"),
    }, indent=2))


if __name__ == "__main__":
    main()
