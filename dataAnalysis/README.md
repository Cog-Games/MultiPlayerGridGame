# dataAnalysis layout

This directory is organized by artifact role.

## Raw data

- `raw_data/human/` contains original human experiment exports and raw human trial JSON used by comparisons.
- `raw_data/model_model_simulations/` contains model-model raw trial JSON, grouped by agent family:
  - `joint_rl/`
  - `committed_agent/`
  - `always_committed_agent/`
  - `signal_agent/`
  - `two_stage_signal_agent/`

## Analyses

- `analyses/notebooks/` contains human-data notebooks and cross-model comparison notebooks.
- `analyses/outputs/` contains derived non-model-model outputs.
- `model_model/` is the standalone model-model analysis area. Each model has its own folder:
  - `model_model/committed_agent/`
  - `model_model/always_committed_agent/`
  - `model_model/signal_agent/`
  - `model_model/two_stage_signal_agent/`
  - `model_model/joint_rl/`

Each model-model folder follows the same layout:

- `model.md` describes the model math.
- `notebooks/` contains result notebooks.
- `outputs/` contains derived CSV, PNG, and summary JSON outputs.

## Scripts and model docs

- `scripts/` contains analysis and simulation scripts.
- Model math, method, and version notes are mirrored into each `model_model/<model>/model.md`. Longer notes also live under the repository-level `docs/` tree:
  - `docs/CommittedAgent/`
  - `docs/SignalAgent/`

## Migration manifest

`REORG_MANIFEST.json` records the file moves from the previous layout to the current one. It intentionally stores old paths so historical references can be traced.
