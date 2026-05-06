# CommittedAgent Model Versions and Results

This document separates the current main model from exploratory variants tested during simulation.

All reported values are percentages from `n=30` simulated sessions with `12` `2P3G` trials per session unless otherwise noted.

## Main Model

The active runtime model is **pure every-step resampling**:

\[
W_\lambda(g)\propto \exp(\beta EU(g))P_t(g)^\lambda.
\]

After the new goal appears and a shared goal has been detected, the agent samples a joint goal every step and executes the joint-RL policy restricted to that sampled goal. There is no one-shot lock and no confidence threshold in the main model.

Current parameters:

- \(\beta=3.0\)
- \(\lambda=0.125\)

## Tested Model Variants

| Model | Description | Status |
|---|---|---|
| Pure every-step resampling | Recompute \(W_\lambda(g)\) and sample a goal every post-new-goal step. | Main model |
| One-shot private sample | Sample once over candidate goals, then keep that sampled goal fixed. | Rejected for agent-agent simulation because private samples often diverge |
| Mutual-inference lock, \(\tau=0.75\) | Every-step resampling plus partner individual-goal inference; stop resampling once both agents infer the same goal above threshold. | Experimental; increased commitment but adds threshold |
| Posterior lock-in, \(n=3,\tau=0.75\) | Sample for first three post-new-goal decisions, then lock once joint posterior confidence crosses threshold. | Experimental |
| Centralized shared sample | Force both agents to use the same sampled goal. | Diagnostic upper bound, not psychologically plausible |

## Average Across All 2P3G Distance Conditions

| Model | Success | Efficiency | Commitment | Signaling |
|---|---:|---:|---:|---:|
| CommittedAgent main: every-step resampling, \(\beta=3,\lambda=0.125\) | 92.5 | 90.0 | 69.2 | 31.2 |
| One-shot private sample, \(\beta=3,\lambda=0.125\) | 75.8 | 89.3 | 72.4 | 37.6 |
| Every-step + mutual-inference lock, \(\tau=0.75\) | 92.5 | 89.9 | 85.0 | 31.6 |
| Every-step + posterior lock-in, \(n=3,\tau=0.75\) | 91.9 | 88.9 | 73.3 | 31.7 |
| Centralized shared sample | 94.4 | 90.1 | 66.9 | 40.8 |
| Joint-RL | 98.3 | 88.7 | 53.9 | 35.9 |
| Human-Human | 100.0 | 81.6 | 66.2 | 51.7 |

## Equal-to-Both Condition Only

| Model | Success | Efficiency | Commitment | Signaling |
|---|---:|---:|---:|---:|
| CommittedAgent main: every-step resampling, \(\beta=3,\lambda=0.125\) | 98.9 | 98.5 | 84.5 | 43.9 |
| One-shot private sample, \(\beta=3,\lambda=0.125\) | 74.4 | 99.2 | 75.0 | 48.1 |
| Every-step + mutual-inference lock, \(\tau=0.75\) | 98.9 | 98.9 | 87.9 | 46.4 |
| Every-step + posterior lock-in, \(n=3,\tau=0.75\) | 100.0 | 99.0 | 77.8 | 42.8 |
| Centralized shared sample | 100.0 | 99.5 | 65.8 | 55.6 |
| Joint-RL | 100.0 | 97.7 | 38.4 | 45.9 |
| Human-Human | 100.0 | 96.6 | 85.1 | 58.5 |

## Interpretation

The pure every-step model is the best current main model because it keeps success high and matches the equal-to-both commitment pattern reasonably well without adding extra stopping thresholds. The mutual-inference lock raises commitment, but it relies on an additional threshold parameter and therefore is kept as an experimental variant rather than the main model.
