#!/usr/bin/env python3
"""Create a notebook for the AlwaysCommitted equal-to-both commitment fit."""

from __future__ import annotations

import json
from pathlib import Path


NOTEBOOK_PATH = Path(
    "dataAnalysis/model_model/always_committed_agent/notebooks/"
    "always_committed_equal_to_both_trial_commitment_fit/"
    "always_committed_equal_to_both_lambda_fit.ipynb"
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
# AlwaysCommittedAgent Equal-to-Both Trial-Level Commitment Fit

This notebook summarizes the `AlwaysCommittedAgent` version fitted directly to **equal-to-both trial-level commitment**.

Model:

\\[
W_\\lambda(g) \\propto \\exp(\\beta EU(g)) P_t(g)^\\lambda
\\]

Fixed:

```text
beta = 3.0
fit target = Human-Human equal-to-both trial-level commitment
fitted lambda = 0.15
```

The fit target uses the same commitment definition as the model-model plots:

```text
firstDetectedSharedGoal == finalReachedGoal
```
"""
        ),
        code_cell(
            """
from pathlib import Path
import json

import pandas as pd
from IPython.display import Image, display

PROJECT_ROOT = Path('/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO')
if not PROJECT_ROOT.exists():
    PROJECT_ROOT = Path.cwd()

FIT_DIR = PROJECT_ROOT / 'dataAnalysis' / 'model_model' / 'always_committed_agent' / 'outputs' / 'always_committed_trial_commitment_fit'
SIM_DIR = PROJECT_ROOT / 'dataAnalysis' / 'model_model' / 'always_committed_agent' / 'outputs' / 'always_committed_vs_always_committed_simulation'

FIT_SUMMARY_JSON = FIT_DIR / 'always_committed_trial_commitment_fit_grid_equal_to_both_0_to_0.2_summary.json'
FIT_GRID_CSV = FIT_DIR / 'always_committed_trial_commitment_fit_grid_equal_to_both_0_to_0.2.csv'
FIT_GRID_PNG = FIT_DIR / 'always_committed_trial_commitment_fit_grid_equal_to_both_0_to_0.2.png'

FOUR_MEASURE_CSV = SIM_DIR / 'always_committed_equal_to_both_commitment_fitted_lambda_0p15_human_side_by_side_summary.csv'
FOUR_MEASURE_PNG = SIM_DIR / 'always_committed_equal_to_both_commitment_fitted_lambda_0p15_human_side_by_side_bar_4panel.png'
MODEL_ONLY_CSV = SIM_DIR / 'always_committed_equal_to_both_commitment_fitted_lambda_0p15_average_equal_summary.csv'
MODEL_ONLY_PNG = SIM_DIR / 'always_committed_equal_to_both_commitment_fitted_lambda_0p15_average_equal_bar_4panel.png'
"""
        ),
        markdown_cell(
            """
## 1. Fit Result

Lambda was selected by direct simulated grid search over `0.00` to `0.20` with step size `0.01`, minimizing squared error to Human-Human equal-to-both commitment.
"""
        ),
        code_cell(
            """
fit_summary = json.loads(FIT_SUMMARY_JSON.read_text())
fit_summary
"""
        ),
        code_cell(
            """
fit_grid = pd.read_csv(FIT_GRID_CSV)
fit_grid[['lambda', 'equal_to_both_commitment_percent', 'average_commitment_percent', 'loss']].round(3)
"""
        ),
        code_cell(
            """
display(Image(filename=str(FIT_GRID_PNG)))
"""
        ),
        markdown_cell(
            """
## 2. Four-Measure Comparison With Human-Human

At the fitted value `lambda = 0.15`, the model matches Human-Human commitment in the equal-to-both condition:

```text
AlwaysCommitted equal-to-both commitment = 85.6%
Human-Human equal-to-both commitment    = 85.1%
```

The same parameter overpredicts average all-distance commitment:

```text
AlwaysCommitted average commitment = 78.5%
Human-Human average commitment    = 66.2%
```
"""
        ),
        code_cell(
            """
comparison = pd.read_csv(FOUR_MEASURE_CSV)
comparison_pivot = comparison.pivot_table(
    index=['condition_label', 'group'],
    columns='metric',
    values='mean_percent',
).round(1)
comparison_pivot
"""
        ),
        code_cell(
            """
display(Image(filename=str(FOUR_MEASURE_PNG)))
"""
        ),
        markdown_cell(
            """
## 3. Model-Only Average vs Equal-to-Both

This plot keeps only the fitted AlwaysCommitted model and compares average all-distance vs equal-to-both values.
"""
        ),
        code_cell(
            """
model_only = pd.read_csv(MODEL_ONLY_CSV)
model_only[[
    'lambda',
    'condition_scope',
    'success_percent',
    'efficiency_percent',
    'commitment_percent',
    'signaling_percent',
]].round(2)
"""
        ),
        code_cell(
            """
display(Image(filename=str(MODEL_ONLY_PNG)))
"""
        ),
        markdown_cell(
            """
## Interpretation

The equal-to-both-only fit supports a small but nonzero posterior reliance parameter:

```text
lambda = 0.15
```

This is much smaller than the step-level action-likelihood fit (`lambda ≈ 32.89`) and larger than the average trial-level commitment fit (`lambda = 0.04`).

The reason is that the equal-to-both human pattern requires stronger old-shared-goal persistence than the all-distance average, but not nearly as much as the step-level action likelihood implies.

At the exact new-goal onset, the model posterior is approximately:

```text
P(old shared)      = 2/3
P(old alternative) = 0
P(new goal)        = 1/3
```

With `lambda = 0.15`, this creates only a moderate old-goal selection bias, enough to match equal-to-both trial-level commitment in the current simulation.
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
    NOTEBOOK_PATH.write_text(json.dumps(notebook, indent=2), encoding="utf-8")
    print(NOTEBOOK_PATH)


if __name__ == "__main__":
    main()
