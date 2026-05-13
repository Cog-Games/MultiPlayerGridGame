#!/usr/bin/env python3
"""Create the CommittedAgent lambda-sweep plotting notebook."""

from __future__ import annotations

import json
from pathlib import Path


NOTEBOOK_PATH = Path("dataAnalysis/model_model/committed_agent/notebooks/legacy_root/committed_vs_committed_lambda_sweep_plots.ipynb")


def code_cell(source: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source.strip("\n").splitlines(keepends=True),
    }


def markdown_cell(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": source.strip("\n").splitlines(keepends=True),
    }


def main() -> None:
    cells = [
        markdown_cell(
            """
# CommittedAgent vs CommittedAgent Lambda Sweep

This notebook analyzes `CommittedAgent` vs `CommittedAgent` simulations for `2P3G`, sweeping `lambda` from 0 to 10. Each lambda value uses 30 simulated sessions, with 12 `2P3G` trials per session.
"""
        ),
        code_cell(
            """
from pathlib import Path
import json

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

SWEEP_DIR = Path('committed_vs_committed_lambda_sweep')
LAMBDAS = list(range(11))
"""
        ),
        code_cell(
            """
def mean_ci(values):
    values = np.asarray([v for v in values if pd.notna(v)], dtype=float)
    if values.size == 0:
        return np.nan, np.nan, np.nan, 0
    mean = float(np.mean(values))
    sd = float(np.std(values, ddof=1)) if values.size > 1 else 0.0
    se = sd / np.sqrt(values.size) if values.size else np.nan
    ci = 1.96 * se if np.isfinite(se) else np.nan
    return mean, mean - ci, mean + ci, int(values.size)


rows = []
for lam in LAMBDAS:
    summary_path = SWEEP_DIR / f'committed_vs_committed_2p3g_summary_lambda_{lam}_sessions_0_to_29.json'
    metrics_path = SWEEP_DIR / f'committed_vs_committed_2p3g_notebook_metrics_lambda_{lam}_sessions_0_to_29.json'

    summary = json.loads(summary_path.read_text())
    metrics = json.loads(metrics_path.read_text())['summary']

    success_mean, success_low, success_high, success_n = mean_ci(
        [row['successRate'] for row in summary['sessionSummaries']]
    )
    commitment_mean, commitment_low, commitment_high, commitment_n = mean_ci(
        [row['commitmentRate'] for row in summary['sessionSummaries']]
    )
    efficiency = metrics['overall']['efficiency_success_only']
    signaling = metrics['overall']['signaling_all_new_goal']

    rows.append({
        'lambda': lam,
        'total_trials': summary['totalTrials'],
        'successful_trials': summary['successfulTrials'],
        'success_rate': summary['successRate'],
        'success_mean': success_mean,
        'success_ci_lower': success_low,
        'success_ci_upper': success_high,
        'success_n': success_n,
        'commitment_rate': summary['commitmentRate'],
        'commitment_mean': commitment_mean,
        'commitment_ci_lower': commitment_low,
        'commitment_ci_upper': commitment_high,
        'commitment_n': commitment_n,
        'efficiency_mean': efficiency['mean'] / 100.0,
        'efficiency_ci_lower': efficiency['ci_lower'] / 100.0,
        'efficiency_ci_upper': efficiency['ci_upper'] / 100.0,
        'efficiency_n': efficiency['n_participants'],
        'signaling_mean': signaling['mean'],
        'signaling_ci_lower': signaling['ci_lower'],
        'signaling_ci_upper': signaling['ci_upper'],
        'signaling_n': signaling['n_participants'],
    })

df = pd.DataFrame(rows)
df.to_csv(SWEEP_DIR / 'committed_vs_committed_lambda_sweep_summary.csv', index=False)
df
"""
        ),
        code_cell(
            """
plt.style.use('seaborn-v0_8-whitegrid')

fig, axes = plt.subplots(2, 2, figsize=(13, 10), sharex=True)
fig.suptitle('CommittedAgent vs CommittedAgent', fontsize=22, fontweight='bold', y=0.98)

panels = [
    ('Success Rate (%)', 'success_mean', 'success_ci_lower', 'success_ci_upper'),
    ('Coordination Efficiency (%)', 'efficiency_mean', 'efficiency_ci_lower', 'efficiency_ci_upper'),
    ('Commitment (%)', 'commitment_mean', 'commitment_ci_lower', 'commitment_ci_upper'),
    ('Signaling Move (%)', 'signaling_mean', 'signaling_ci_lower', 'signaling_ci_upper'),
]

color = '#4f79a8'
for ax, (title, mean_col, low_col, high_col) in zip(axes.ravel(), panels):
    x = df['lambda'].to_numpy()
    y = df[mean_col].to_numpy() * 100
    low = df[low_col].to_numpy() * 100
    high = df[high_col].to_numpy() * 100
    yerr = np.vstack([y - low, high - y])

    ax.errorbar(
        x,
        y,
        yerr=yerr,
        color=color,
        marker='o',
        linewidth=2.5,
        markersize=7,
        capsize=4,
    )
    ax.set_title(title, fontsize=16, fontweight='bold')
    ax.set_ylim(0, 105)
    ax.set_xlim(-0.3, 10.3)
    ax.set_xticks(LAMBDAS)
    ax.set_xlabel('lambda')
    ax.set_ylabel('(%)')
    ax.grid(axis='y', color='#cfcfcf', linewidth=1.2)
    ax.grid(axis='x', visible=False)
    for spine in ['top', 'right']:
        ax.spines[spine].set_visible(False)

fig.tight_layout(rect=[0, 0, 1, 0.95])
fig.savefig(SWEEP_DIR / 'committed_vs_committed_lambda_sweep_4panel.png', dpi=200, bbox_inches='tight')
plt.show()
"""
        ),
        code_cell(
            """
display_cols = [
    'lambda',
    'success_rate',
    'efficiency_mean',
    'commitment_rate',
    'signaling_mean',
]
display_df = df[display_cols].copy()
for col in display_cols[1:]:
    display_df[col] = display_df[col] * 100
display_df.round(2)
"""
        ),
    ]

    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {
                "name": "python",
                "pygments_lexer": "ipython3",
            },
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    NOTEBOOK_PATH.write_text(json.dumps(notebook, indent=1))
    print(NOTEBOOK_PATH)


if __name__ == "__main__":
    main()
