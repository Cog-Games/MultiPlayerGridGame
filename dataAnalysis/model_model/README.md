# Model-Model Analyses

This folder contains model-model analyses separated by model family. Raw simulation JSON is intentionally kept outside this folder under `dataAnalysis/raw_data/model_model_simulations/`.

Each model folder has:

- `model.md`: model math and parameter description.
- `notebooks/`: analysis notebooks for that model.
- `outputs/`: derived CSV, PNG, and summary JSON outputs.

## Model Folders

| Folder | Model |
|---|---|
| `committed_agent/` | Main CommittedAgent variants and commitment fits |
| `always_committed_agent/` | Always-on committed goal-selection model |
| `signal_agent/` | Signaling variants built on committed goal selection |
| `two_stage_signal_agent/` | Confidence-gated two-stage signal model |
| `joint_rl/` | Joint-RL baseline |

## Path Convention

Use paths relative to the repository root:

```python
PROJECT_ROOT / "dataAnalysis" / "model_model" / "<model>" / "outputs"
PROJECT_ROOT / "dataAnalysis" / "model_model" / "<model>" / "notebooks"
```

Do not write raw trial dumps here. Use:

```python
PROJECT_ROOT / "dataAnalysis" / "raw_data" / "model_model_simulations"
```
