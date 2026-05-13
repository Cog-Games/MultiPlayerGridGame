#!/usr/bin/env python3
"""Create a notebook that summarizes the beta=3 CommittedAgent analyses."""

from __future__ import annotations

import json
from pathlib import Path


NOTEBOOK_PATH = Path(
    "dataAnalysis/model_model/committed_agent/notebooks/committed_agent_trial_commitment_fit_beta3/"
    "committed_beta3_lambda_fit_and_equal_to_both_comparison.ipynb"
)


def markdown_cell(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": source.strip("\n").splitlines(keepends=True),
    }


def code_cell(source: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source.strip("\n").splitlines(keepends=True),
    }


def main() -> None:
    cells = [
        markdown_cell(
            """
# CommittedAgent Beta=3 Lambda Fit and Equal-to-Both Comparison

This notebook organizes the three recent analyses:

1. Trial-level commitment fit for `CommittedAgent` with `beta = 3.0`, plotting lambda from `0` to `0.5` with two lines: overall average and `equal_to_both`.
2. Four-measure lambda sweep with the same two hues: overall average and `equal_to_both`.
3. Equal-to-both comparison among fitted `CommittedAgent`, `Joint-RL`, and `Human-Human`.
4. Average across all 2P3G distance conditions for the same three groups.

The fitted setting used for the comparison is:

```text
CommittedAgent beta = 3.0
lambda = 0.125
```
"""
        ),
        code_cell(
            """
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

plt.style.use('seaborn-v0_8-whitegrid')

PROJECT_ROOT = Path('/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO')
if not PROJECT_ROOT.exists():
    PROJECT_ROOT = Path.cwd()

BETA3_DIR = PROJECT_ROOT / 'dataAnalysis' / 'committed_agent_trial_commitment_fit_beta3'
COMPARISON_DIR = PROJECT_ROOT / 'dataAnalysis' / 'equal_to_both_agent_human_comparison'

TWO_LINE_CSV = BETA3_DIR / 'trial_level_commitment_lambda_fit_beta3_0_to_0p5_average_equal.csv'
FOUR_MEASURE_CSV = BETA3_DIR / 'committed_beta3_lambda_0_to_0p5_average_equal_4measures.csv'
COMPARISON_CSV = COMPARISON_DIR / 'equal_to_both_committed_joint_rl_human_4panel_summary.csv'
ALL_DISTANCE_CSV = COMPARISON_DIR / 'all_distance_committed_joint_rl_human_4panel_summary.csv'

TWO_LINE_PNG = BETA3_DIR / 'trial_level_commitment_lambda_fit_beta3_0_to_0p5_average_equal.png'
FOUR_MEASURE_PNG = BETA3_DIR / 'committed_beta3_lambda_0_to_0p5_average_equal_4measures.png'
COMPARISON_PNG = COMPARISON_DIR / 'equal_to_both_committed_beta3_lambda0p125_joint_rl_human_4panel.png'
ALL_DISTANCE_PNG = COMPARISON_DIR / 'all_distance_committed_beta3_lambda0p125_joint_rl_human_4panel.png'
"""
        ),
        markdown_cell(
            """
## 1. Commitment Fit: Average vs Equal-to-Both

This plot focuses on the fitted lambda range `0` to `0.5`. The blue line is the average commitment rate across the three new-goal distance conditions, weighted by the human condition sample counts. The green line is the `equal_to_both` condition.
"""
        ),
        code_cell(
            """
fit_df = pd.read_csv(TWO_LINE_CSV)
fit_df.round(4)
"""
        ),
        code_cell(
            """
human_avg = (54 + 80 + 54) / (96 + 94 + 94)
human_equal = 80 / 94

fig, ax = plt.subplots(figsize=(8, 5.5))
ax.plot(
    fit_df['lambda'],
    fit_df['sim_human_weighted_average'] * 100,
    marker='o',
    linewidth=2.5,
    markersize=5,
    color='#4f79a8',
    label='Average',
)
ax.plot(
    fit_df['lambda'],
    fit_df['sim_equal_to_both'] * 100,
    marker='o',
    linewidth=2.5,
    markersize=5,
    color='#59a14f',
    label='Equal-to-both',
)
ax.axhline(human_avg * 100, color='#4f79a8', linestyle='--', alpha=0.65, label='Human average')
ax.axhline(human_equal * 100, color='#59a14f', linestyle='--', alpha=0.65, label='Human equal-to-both')
best_lambda = fit_df.loc[fit_df['binomial_nll'].idxmin(), 'lambda']
ax.axvline(best_lambda, color='black', linestyle=':', alpha=0.8, label=f'Best lambda = {best_lambda:g}')
ax.set_title('CommittedAgent Commitment Fit, beta = 3.0', fontsize=15, fontweight='bold')
ax.set_xlabel('lambda')
ax.set_ylabel('Commitment (%)')
ax.set_xlim(-0.01, 0.51)
ax.set_ylim(0, 105)
ax.set_xticks([i / 10 for i in range(6)])
ax.legend(frameon=True)
for spine in ['top', 'right']:
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(TWO_LINE_PNG, dpi=200, bbox_inches='tight')
plt.show()
"""
        ),
        markdown_cell(
            """
## 2. Four Measures Across Lambda

This section uses the same two hues as above:

- `Average`: across all 2P3G new-goal conditions.
- `Equal-to-both`: only `distanceCondition == "equal_to_both"`.
"""
        ),
        code_cell(
            """
four_df = pd.read_csv(FOUR_MEASURE_CSV)
four_df.round(3)
"""
        ),
        code_cell(
            """
fig, axes = plt.subplots(2, 2, figsize=(13, 10), sharex=True)
fig.suptitle('CommittedAgent beta = 3.0: Average vs Equal-to-Both', fontsize=18, fontweight='bold', y=0.98)

panels = [
    ('Success Rate (%)', 'average_success_percent', 'equal_success_percent'),
    ('Coordination Efficiency (%)', 'average_efficiency_percent', 'equal_efficiency_percent'),
    ('Commitment (%)', 'average_commitment_percent', 'equal_commitment_percent'),
    ('Signaling Move (%)', 'average_signaling_percent', 'equal_signaling_percent'),
]

colors = {'Average': '#4f79a8', 'Equal-to-both': '#59a14f'}
for ax, (title, avg_col, eq_col) in zip(axes.ravel(), panels):
    ax.plot(four_df['lambda'], four_df[avg_col], marker='o', linewidth=2.5, markersize=5, color=colors['Average'], label='Average')
    ax.plot(four_df['lambda'], four_df[eq_col], marker='o', linewidth=2.5, markersize=5, color=colors['Equal-to-both'], label='Equal-to-both')
    ax.set_title(title, fontsize=15, fontweight='bold')
    ax.set_xlabel('lambda')
    ax.set_ylabel('(%)')
    ax.set_xlim(-0.01, 0.51)
    ax.set_ylim(0, 105)
    ax.set_xticks([i / 10 for i in range(6)])
    ax.grid(axis='y', color='#cfcfcf', linewidth=1.1)
    ax.grid(axis='x', visible=False)
    for spine in ['top', 'right']:
        ax.spines[spine].set_visible(False)
    ax.legend(frameon=True)

fig.tight_layout(rect=[0, 0, 1, 0.95])
fig.savefig(FOUR_MEASURE_PNG, dpi=200, bbox_inches='tight')
plt.show()
"""
        ),
        markdown_cell(
            """
## 3. Equal-to-Both: CommittedAgent vs Joint-RL vs Human-Human

This comparison focuses only on the `equal_to_both` condition. `CommittedAgent` uses the best trial-level fit from the beta=3 sweep:

```text
beta = 3.0
lambda = 0.125
```

Human-Human is computed from pure human-human unique 2P3G room-trials after deduplicating by `roomId + trialIndex`.
"""
        ),
        code_cell(
            """
comparison_df = pd.read_csv(COMPARISON_CSV)
comparison_df.round(3)
"""
        ),
        code_cell(
            """
group_order = ['CommittedAgent\\n(beta=3, lambda=0.125)', 'Joint-RL', 'Human-Human']
metric_order = ['Success Rate (%)', 'Coordination Efficiency (%)', 'Commitment (%)', 'Signaling Move (%)']
colors = ['#4f79a8', '#f28e2b', '#59a14f']

fig, axes = plt.subplots(2, 2, figsize=(13, 10))
fig.suptitle('Equal-to-Both Only: Agent and Human Comparison', fontsize=20, fontweight='bold', y=0.98)

for ax, metric in zip(axes.ravel(), metric_order):
    sub = comparison_df[comparison_df['metric'] == metric].set_index('group').loc[group_order].reset_index()
    x = np.arange(len(group_order))
    bars = ax.bar(
        x,
        sub['mean_percent'],
        yerr=sub['ci95_percent'],
        color=colors,
        alpha=0.88,
        capsize=5,
        edgecolor='white',
        linewidth=1.0,
    )
    ax.set_title(metric, fontsize=15, fontweight='bold')
    ax.set_ylim(0, 105)
    ax.set_ylabel('(%)')
    ax.set_xticks(x)
    ax.set_xticklabels(group_order, fontsize=10)
    ax.grid(axis='y', color='#cfcfcf', linewidth=1.1)
    ax.grid(axis='x', visible=False)
    for spine in ['top', 'right']:
        ax.spines[spine].set_visible(False)
    for bar, value in zip(bars, sub['mean_percent']):
        if pd.notna(value):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                max(2, value * 0.06),
                f'{value:.1f}',
                ha='center',
                va='bottom',
                color='white',
                fontsize=9,
                fontweight='bold',
            )

fig.tight_layout(rect=[0, 0, 1, 0.95])
fig.savefig(COMPARISON_PNG, dpi=200, bbox_inches='tight')
plt.show()
"""
        ),
        markdown_cell(
            """
## 4. All Distance Conditions: CommittedAgent vs Joint-RL vs Human-Human

This section averages across all retained 2P3G distance conditions. Success is computed over all 2P3G trials. Efficiency, commitment, and signaling use post-new-goal eligible observations.
"""
        ),
        code_cell(
            """
all_distance_df = pd.read_csv(ALL_DISTANCE_CSV)
all_distance_df.round(3)
"""
        ),
        code_cell(
            """
group_order = ['CommittedAgent\\n(beta=3, lambda=0.125)', 'Joint-RL', 'Human-Human']
metric_order = ['Success Rate (%)', 'Coordination Efficiency (%)', 'Commitment (%)', 'Signaling Move (%)']
colors = ['#4f79a8', '#f28e2b', '#59a14f']

fig, axes = plt.subplots(2, 2, figsize=(13, 10))
fig.suptitle('All 2P3G Distance Conditions: Agent and Human Comparison', fontsize=20, fontweight='bold', y=0.98)

for ax, metric in zip(axes.ravel(), metric_order):
    sub = all_distance_df[all_distance_df['metric'] == metric].set_index('group').loc[group_order].reset_index()
    x = np.arange(len(group_order))
    bars = ax.bar(
        x,
        sub['mean_percent'],
        yerr=sub['ci95_percent'],
        color=colors,
        alpha=0.88,
        capsize=5,
        edgecolor='white',
        linewidth=1.0,
    )
    ax.set_title(metric, fontsize=15, fontweight='bold')
    ax.set_ylim(0, 105)
    ax.set_ylabel('(%)')
    ax.set_xticks(x)
    ax.set_xticklabels(group_order, fontsize=10)
    ax.grid(axis='y', color='#cfcfcf', linewidth=1.1)
    ax.grid(axis='x', visible=False)
    for spine in ['top', 'right']:
        ax.spines[spine].set_visible(False)
    for bar, value in zip(bars, sub['mean_percent']):
        if pd.notna(value):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                max(2, value * 0.06),
                f'{value:.1f}',
                ha='center',
                va='bottom',
                color='white',
                fontsize=9,
                fontweight='bold',
            )

fig.tight_layout(rect=[0, 0, 1, 0.95])
fig.savefig(ALL_DISTANCE_PNG, dpi=200, bbox_inches='tight')
plt.show()
"""
        ),
        markdown_cell(
            """
## Key Takeaways

- The best trial-level commitment fit remains `lambda = 0.125` when `beta = 3.0`.
- In the `equal_to_both` condition, fitted `CommittedAgent` closely matches Human-Human commitment.
- Joint-RL remains highly successful and efficient, but its equal-to-both commitment is much lower because it does not preserve the old shared goal as an inferred commitment target.
- Human-Human signaling is higher than both agent baselines in the equal-to-both condition.
- Across all distance conditions, fitted `CommittedAgent` matches Human-Human commitment more closely than Joint-RL, while Human-Human has higher signaling.
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

    NOTEBOOK_PATH.parent.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_PATH.write_text(json.dumps(notebook, indent=1), encoding="utf-8")
    print(NOTEBOOK_PATH)


if __name__ == "__main__":
    main()
