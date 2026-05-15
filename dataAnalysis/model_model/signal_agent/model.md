# SignalAgent - Methods

This document keeps equations in LaTeX display blocks. Inline math is intentionally avoided because some Markdown viewers in this project render inline formulas inconsistently.

## 1. Overview

`SignalAgent` extends `CommittedAgent` with a layer that biases action selection toward legible moves. A legible move is one that helps the partner infer the chosen goal. The signaling layer is decoupled from commitment: the target goal is sampled by the goal-selection rule, and the signaling wrapper applies around that sampled target.

`AlwaysSignalAgent` reuses the same signaling policy but switches posterior timing to the always-on `AlwaysCommittedAgent` form used by `sampleJointGoal_fromStart`.

`PosteriorOnlySignalAgent` keeps the same from-start signaling policy, but samples goals only from the inferred joint-goal posterior. It removes the expected-utility term from goal selection.

Implemented report labels:

| Report label | Implementation | Key difference |
|---|---|---|
| `sampleJointGoalAndSignal_afterNewGoal` | `SignalAgent` | signaling begins after new-goal presentation |
| `sampleJointGoalAndSignal_fromStart` | `AlwaysSignalAgent` | posterior and signaling are active from trial start |
| `sampleJointGoalAndRSASignal_fromStart` (`shared-agency model`) | `AlwaysSignalAgent` | from-start posterior timing with RSA/log-posterior signaling |
| `samplePosteriorOnlyGoalAndSignal_fromStart` | `PosteriorOnlySignalAgent` | from-start signaling, but goal choice uses posterior only |

## 2. Task and notation

- Task: 2P3G, two-player, three-goal grid coordination.
- Grid: 15 by 15, four-connected actions, synchronous moves.
- State: `s_t = (self_position, other_position)`.
- Goals: `G_t` starts with two goals and expands to three goals after the `newGoal` event.
- Posterior: `P_t(g)` is the agent's inferred probability that goal `g` is the partner's intended joint goal.

Action space:

$$
\mathcal{A} = \{(0,-1), (0,1), (-1,0), (1,0)\}
$$

## 3. Goal selection inherited from CommittedAgent

After joint-goal detection and new-goal presentation, the original committed-goal sampler draws a target goal from weights:

$$
W_\lambda(g) \propto \exp\left(\beta \cdot \mathrm{EU}(g)\right) \cdot P_t(g)^\lambda
$$

Expected utility is negative joint Manhattan distance:

$$
\mathrm{EU}(g) = -\left(d(s^{\mathrm{self}}, g) + d(s^{\mathrm{other}}, g)\right)
$$

Parameters:

- `beta`: utility sharpness. Fixed at `3.0` in these signal-agent analyses.
- `lambda`: posterior sharpness.

Before joint detection or new-goal presentation, `SignalAgent` uses joint-RL planning over all goals, with no specific committed target and no signaling.

`AlwaysSignalAgent` instead maintains `P_t(g)` from trial start, resizes the posterior when the new goal appears, samples a target every step, and applies the same signaling wrapper around that sampled target.

## 4. Listener posterior model

When the focal agent takes action `a` in state `s`, a one-step Bayesian listener updates:

$$
P(g \mid a) \propto P(g) \cdot \pi_{\mathrm{base}}(a \mid s, g)
$$

`pi_base(a | s, g)` is the joint-RL action probability under target goal `g`, computed by `RLAgent.getJointActionProbabilities`.

The listener model is naive: it does not anticipate signaling. It is symmetric across both agents.

## 5. Action-selection variants

The signaling policy is selected at construction with:

```js
score: "margin" | "logposterior" | "mixture"
horizon: integer >= 1
```

### 5.1 Single-step max-margin

Used when `score = "margin"` and `horizon = 1`.

$$
\pi(a) \propto \pi_{\mathrm{base}}(a \mid s, g^*) \cdot \exp\left(\alpha \cdot s_{\mathrm{margin}}(a)\right)
$$

$$
s_{\mathrm{margin}}(a) = P(g^* \mid a) - \max_{g \ne g^*} P(g \mid a)
$$

This is the legacy form. It penalizes only the runner-up distractor.

### 5.2 Single-step log-posterior speaker

Used when `score = "logposterior"` and `horizon = 1`.

$$
\pi(a) \propto \pi_{\mathrm{base}}(a \mid s, g^*) \cdot P(g^* \mid a)^\alpha
$$

Equivalent score:

$$
s_{\mathrm{logp}}(a) = \log P(g^* \mid a)
$$

Limits:

- `alpha = 0`: base policy.
- `alpha = 1`: base policy times posterior.
- very large `alpha`: choose the action that maximizes `P(g* | a)`.

### 5.3 Trajectory-level legibility

Used when `score = "logposterior"` and `horizon >= 2`.

The agent plans an action sequence:

$$
\mathbf{a} = (a_{t_0}, \ldots, a_{t_0+H-1})
$$

The listener posterior is updated along the action prefix:

$$
P_t(g) \propto P_{t_0}(g) \cdot \prod_{u=t_0}^{t-1} \pi_{\mathrm{base}}(a_u \mid s_u, g)
$$

Sequence-level score:

$$
\log \pi(\mathbf{a} \mid g^*) =
\sum_{t=t_0}^{t_0+H-1} \log \pi_{\mathrm{base}}(a_t \mid s_t, g^*)
+ \alpha \sum_{t=t_0+1}^{t_0+H} \log P_t(g^*)
+ \mathrm{const}
$$

The implementation enumerates all action sequences, scores each sequence, softmaxes over sequences, marginalizes to the first action, and replans at the next step.

When `H = 1`, this reduces to the single-step log-posterior speaker.

## 5.4 Bernoulli mixture

Used when `score = "mixture"`. In code, `alpha` is interpreted as the mixture probability `p`.

$$
\pi_{\mathrm{signal}}(a) =
(1-p) \cdot \pi_{\mathrm{committed}}(a \mid g^*)
+ p \cdot \delta_{a_{\mathrm{leg}}(g^*)}(a)
$$

Committed branch:

$$
\pi_{\mathrm{committed}}(a \mid g^*) = \delta_{a^\circ}(a)
$$

where `a_circ` is the deterministic `CommittedAgent` action toward target `g*`.

Legible branch:

$$
a_{\mathrm{leg}}(g^*) =
\arg\max_{a \in \mathcal{A}^+(g^*)} P(g^* \mid a)
$$

Progress actions:

$$
\mathcal{A}^+(g^*) =
\{a \in \mathcal{A} : d(s+a, g^*) < d(s, g^*)\}
$$

Properties:

- `p = 0` is equivalent to `CommittedAgent`.
- Both branches reduce distance to the same sampled target `g*`.
- The endpoint is controlled by goal sampling; `p` changes the move style, not the sampled target.

## 5.5 From-start Bernoulli mixture

`AlwaysSignalAgent` is analysis-only and is not exposed as a live app player type.

It combines:

- `AlwaysCommittedAgent` posterior timing:
  - initial posterior: `P_0(g) = 1 / number_of_initial_goals`
  - new-goal posterior mass: `P_t(new_goal) = 1 / number_of_current_goals`
  - old-goal mass is rescaled to the remaining probability
- `SignalAgent` Bernoulli mixture actions:

$$
\pi(a_t) =
\sum_g W_\lambda(g)
\left[
(1-p)\pi_{\mathrm{joint}}(a_t \mid s_t, \{g\})
+ p\,\delta_{a_{\mathrm{leg}}(g)}(a_t)
\right]
$$

The primary report fits this variant with an adaptive `lambda x p` grid against trial/player-level commitment plus signaling binomial NLL. The step-level report fits the same two parameters against all-step human action likelihood.

## 5.6 From-start RSA/log-posterior signaling

`sampleJointGoalAndRSASignal_fromStart` is labeled as the `shared-agency model` in reports. It is analysis-only and is not exposed as a live app player type.

It uses the same from-start posterior timing and goal-selection weights as `sampleJointGoalAndSignal_fromStart`:

$$
W_\lambda(g) \propto
\exp\left(\beta \cdot \mathrm{EU}(g)\right) \cdot P_t(g)^\lambda
$$

Only the signaling action policy changes. For a sampled target goal, the RSA/log-posterior policy is:

$$
\pi_{\mathrm{RSA}}(a \mid g^*) \propto
\pi_{\mathrm{base}}(a \mid s_t, g^*) \cdot P_t(g^* \mid a)^\alpha
$$

The marginal likelihood used by the step-level fit sums over sampled goals:

$$
\pi(a_t) =
\sum_g W_\lambda(g)\pi_{\mathrm{RSA}}(a_t \mid g)
$$

The primary report fits this variant with an adaptive `lambda x alpha` grid against trial/player-level commitment plus signaling binomial NLL. The step-level report fits `lambda` and RSA `alpha` against all-step human action likelihood, then simulates the best setting for report metrics and BToM caches.

## 5.7 Posterior-only from-start Bernoulli mixture

`PosteriorOnlySignalAgent` is analysis-only and is not exposed as a live app player type.

It inherits the from-start posterior timing, posterior resize behavior, and Bernoulli mixture signaling policy from `AlwaysSignalAgent`, but replaces the goal-selection weights with posterior-only sharpening:

$$
W_\lambda(g) =
\frac{P_t(g)^\lambda}{\sum_{g'} P_t(g')^\lambda}
$$

The removed expected-utility factor is:

$$
\exp\left(\beta \cdot \mathrm{EU}(g)\right)
$$

This isolates the behavioral contribution of inferred joint-goal posterior from the distance-based efficiency pressure in the original committed-goal sampler.

The primary report fits this variant with the same reduced adaptive `lambda x p` trial-level fit used for `sampleJointGoalAndSignal_fromStart`. The step-level report fits `lambda` and `p` against all-step human action likelihood, then simulates the best setting for report metrics and BToM caches.

## 6. Fit procedure

### 6.1 Human data

Human-human 2P3G trials are deduplicated to unique `(roomId, trialIndex)` rows from workbook exports. Only pure human pairs are used.

Per-trial focal-player measures:

- Signaling Move: whether the first post-new-goal move goes closer to the eventual reached goal and not closer to the alternative candidate goal.
- Commitment: `firstDetectedSharedGoal == finalReachedGoal`.
- Coordination Efficiency:

$$
100 \cdot \left(1 - \frac{\mathrm{actualSteps} - \mathrm{optimalSteps}}{\mathrm{actualSteps}}\right)
$$

### 6.2 Simulator

Default trial-level simulations use:

$$
30\ \mathrm{sessions} \times 12\ \mathrm{trials} = 360\ \mathrm{simulated\ trials\ per\ parameter\ setting}
$$

Both agents are instantiated with identical hyperparameters. Partner-frozen rollouts are simulator-internal only; actual simulation is full self-play.

### 6.3 Trial-level loss

For each parameter setting, simulator rates are compared against human counts in each distance condition.

$$
\mathcal{L}(\theta) =
\sum_c
\left[
-k_c \log \hat{p}_c(\theta)
-(n_c-k_c)\log\left(1-\hat{p}_c(\theta)\right)
\right]
$$

The trial-level adaptive fits optimize commitment plus signaling binomial NLL. Success and efficiency are reported but not optimized.

### 6.4 Parameter grids

| Variant | Swept | Grid |
|---|---|---|
| margin / logposterior, `H = 1` | `alpha` | `{0, 0.25, 0.5, ..., 10}`, 41 points |
| logposterior trajectory | `alpha` per `H` | same alpha grid; `H in {2, 3}` |
| mixture | `p` | `{0, 0.025, 0.05, ..., 1.0}`, 41 points |
| from-start mixture | `lambda, p` | coarse `7 x 7` plus local `5 x 5`; max 74 settings |
| from-start RSA/log-posterior | `lambda, alpha` | coarse `7 x 7` plus local `5 x 5`; max 74 settings |
| posterior-only from-start mixture | `lambda, p` | coarse `7 x 7` plus local `5 x 5`; max 74 settings |

## 7. Results

Post-new-goal variants use `beta = 3.0` and `lambda = 0.125`. From-start variants fit both `lambda` and `p`.

| Variant | Best param | Fit score | Sim avg sig | Sim eq sig | Sim eq commit | Sim avg success |
|---|---:|---:|---:|---:|---:|---:|
| Margin, target = shared | `alpha = 8.25` | NLL `185.5` | 41% | 51% | about 99% | about 98% |
| Logpost, single-step | `alpha = 2.75` | NLL `184.7` | 43% | 55% | about 63% | about 98% |
| Logpost, trajectory H=3 | `alpha = 2.25` | NLL `183.2` | 44% | 55% | about 66% | about 98% |
| Mixture | `p = 0.375` | NLL `184.4` | 47% | 64% | about 72% | about 92% |
| From-start mixture | `lambda = 0.20, p = 0.4375` | commitment+signaling NLL `360.9` | 44% | 61% | about 87% | about 86% |
| From-start RSA/log-posterior | `lambda = 0.325, alpha = 7.25` | commitment+signaling NLL `357.6` | 42% | 61% | about 96% | about 94% |
| Posterior-only from-start mixture | `lambda = 0.325, p = 0.5625` | commitment+signaling NLL `357.1` | 47% | 69% | about 95% | about 83% |
| Joint-RL baseline | none | none | 36% | 44% | about 39% | about 98% |
| Human-Human | reference | none | 52% | 59% | about 84% | about 100% |

## 8. Files

- `client/src/ai/SignalAgent.js`: post-new-goal signaling implementation.
- `client/src/ai/AlwaysSignalAgent.js`: analysis-only from-start signaling implementation.
- `client/src/ai/PosteriorOnlySignalAgent.js`: analysis-only posterior-only from-start signaling implementation.
- `dataAnalysis/scripts/simulate_signal_vs_signal_2p3g.js`: post-new-goal simulator.
- `dataAnalysis/scripts/simulate_always_signal_vs_always_signal_2p3g.js`: from-start signal simulator.
- `dataAnalysis/scripts/simulate_posterior_only_signal_vs_posterior_only_signal_2p3g.js`: posterior-only from-start simulator.
- `dataAnalysis/scripts/fit_signal_alpha_beta3.py`: post-new-goal signal fit and plot pipeline.
- `dataAnalysis/scripts/fit_always_signal_lambda_p.py`: adaptive trial-level `lambda x p` fit for `sampleJointGoalAndSignal_fromStart`.
- `dataAnalysis/scripts/fit_always_signal_rsa_lambda_alpha.py`: adaptive trial-level `lambda x alpha` fit for `sampleJointGoalAndRSASignal_fromStart`.
- `dataAnalysis/scripts/fit_posterior_only_signal_lambda_p.py`: adaptive trial-level `lambda x p` fit for `samplePosteriorOnlyGoalAndSignal_fromStart`.

Output directories:

- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_margin_alpha_fit_beta3/`
- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_logpost_alpha_fit_beta3/`
- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_logpost_alpha_fit_beta3_H3/`
- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_mixture_p_fit_beta3/`
- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_from_start_lambda_p_fit/`
- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_from_start_rsa_lambda_alpha_fit/`
- `dataAnalysis/model_model/signal_agent/outputs/signal_agent_posterior_only_lambda_p_fit/`

Raw `*raw_trials*.json` simulation files are compressed to `.json.zst` and kept out of git. Signal-agent raw archives live under `dataAnalysis/raw_data/model_model_simulations/signal_agent/`.
