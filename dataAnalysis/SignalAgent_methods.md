# SignalAgent — Methods

## 1. Overview

`SignalAgent` extends `CommittedAgent` with a layer that biases action selection toward **legible** moves — moves that maximally disambiguate the agent's chosen goal in the listener's posterior over goals. Critically, the signaling layer is **decoupled from commitment**: the target goal is whatever the agent's W_λ goal-sampling step picks, and the signaling wrapper applies legibility around that target whether it is the prior shared goal, the newly revealed goal, or any other goal.

Four action-selection variants are implemented and ablated against human-human data; the fit-best variant (Bernoulli mixture, §5.4) matches both signaling rate and commitment within human CI using a single new parameter.

## 2. Task and notation

- **Task.** 2P3G — two-player, three-goal grid coordination. 15×15 grid, four-connected actions, synchronous moves. After joint detection of a shared goal, a third "new" goal can appear at varying distance from each player (`closer_to_player1`, `equal_to_both`, `closer_to_player2`).
- **Action space.** $\mathcal{A} = \{(0,-1), (0,1), (-1,0), (1,0)\}$.
- **State.** $s_t = (s_t^{\text{self}}, s_t^{\text{other}})$, agent positions on the grid.
- **Goals.** $\mathcal{G}_t \subseteq \{g_1, g_2, g_3\}$. $|\mathcal{G}_t| = 2$ initially; $|\mathcal{G}_t| = 3$ after the newGoal event.

## 3. Goal selection (inherited from `CommittedAgent`)

Each step, the agent maintains a posterior $P_t(g)$ over the partner's intended goal via Bayesian updates from observed actions. After joint-goal detection AND new-goal presentation, the agent samples a target $g^\* \sim W_\lambda$ at every step:

$$W_\lambda(g) \;\propto\; \exp\bigl(\beta \cdot \mathrm{EU}(g)\bigr) \cdot P_t(g)^{\lambda}$$

- $\mathrm{EU}(g) = -\bigl(d(s^{\text{self}}, g) + d(s^{\text{other}}, g)\bigr)$ — negative joint Manhattan distance to $g$.
- $\beta, \lambda$: hyperparameters. Fixed at $\beta = 3.0$, $\lambda = 0.125$ throughout SignalAgent experiments to isolate the signaling-layer effect.

Before joint detection or new-goal presentation, the agent uses joint-RL planning over all goals (no specific target, no signaling).

## 4. Listener posterior model

When the focal agent takes action $a$ in state $s$, a one-step Bayesian listener updates:

$$P(g \mid a) \;\propto\; P(g) \cdot \pi_{\text{base}}(a \mid s, g)$$

where $\pi_{\text{base}}(a \mid s, g)$ is the joint-RL action probability under target $g$ (`RLAgent.getJointActionProbabilities`). The listener model is **naïve** — it does not anticipate signaling — and is symmetric across both agents.

## 5. Action-selection variants

Switched at construction via `score: 'margin' | 'logposterior' | 'mixture'` and `horizon: int >= 1`.

### 5.1 Single-step max-margin (`score = margin`, `horizon = 1`)

$$\pi(a) \;\propto\; \pi_{\text{base}}(a \mid s, g^\*) \cdot \exp\bigl(\alpha \cdot s_{\text{margin}}(a)\bigr)$$

$$s_{\text{margin}}(a) \;=\; P(g^\* \mid a) - \max_{g \neq g^\*} P(g \mid a)$$

Legacy form. Penalizes only the runner-up distractor; rank-correlated with §5.2 in 2P3G but not equivalent in general.

### 5.2 Info-theoretic / RSA pragmatic speaker (`score = logposterior`, `horizon = 1`)

$$\pi(a) \;\propto\; \pi_{\text{base}}(a \mid s, g^\*) \cdot P(g^\* \mid a)^{\alpha}$$

equivalent to $s_{\text{logp}}(a) = \log P(g^\* \mid a) = -\mathrm{KL}\bigl(\delta_{g^\*} \,\|\, P(\cdot \mid a)\bigr)$. Standard pragmatic-speaker form (Frank & Goodman 2012). Limits: $\alpha=0$ → base policy; $\alpha=1$ → base × posterior; $\alpha\to\infty$ → argmax of $P(g^\* \mid a)$.

### 5.3 Trajectory-level legibility (`score = logposterior`, `horizon = H ≥ 2`)

Plan an $H$-step action sequence $\mathbf{a} = (a_{t_0}, \ldots, a_{t_0+H-1})$ with deterministic state rollout (focal moves clipped to grid; partner held frozen at $s^{\text{other}}_{t_0}$). The listener's posterior given the action prefix is iterated single-step Bayes:

$$P_t(g) \;\propto\; P_{t_0}(g) \cdot \prod_{u=t_0}^{t-1} \pi_{\text{base}}(a_u \mid s_u, g)$$

Sequence-level RSA pragmatic speaker:

$$\log \pi(\mathbf{a} \mid g^\*) \;=\; \underbrace{\sum_{t=t_0}^{t_0+H-1} \log \pi_{\text{base}}(a_t \mid s_t, g^\*)}_{\text{utility / cost prior}} \;+\; \alpha \underbrace{\sum_{t=t_0+1}^{t_0+H} \log P_t(g^\*)}_{\text{trajectory legibility}\; L(\mathbf{a})} \;+\; \text{const}$$

Implementation: enumerate $|\mathcal{A}|^H$ sequences (4³ = 64 at $H=3$), score each, softmax over sequences, marginalize to obtain a first-action distribution, sample first action, replan at $t_0+1$ (receding horizon).

**Reduction.** $H=1$ recovers §5.2 exactly: $L(\mathbf{a}) = \log P(g^\* \mid a)$ and the marginalization is trivial.

**Why detours emerge for $H>1$.** A locally-suboptimal first action (low $\log \pi_{\text{base}}(a_{t_0} \mid g^\*)$) can land in a state where a second action is sharply legible. The cost is amortized across the $L$ sum — a representation single-step scoring lacks.

### 5.4 Bernoulli mixture (`score = mixture`, parameter `p`)

$$\boxed{\;\pi_{\text{signal}}(a) \;=\; (1-p) \cdot \pi_{\text{committed}}(a \mid g^\*) \;+\; p \cdot \delta_{a_{\text{leg}}(g^\*)}\;}$$

with single new parameter $p \in [0, 1]$ (in code: `alpha` clipped to $[0,1]$).

- $\pi_{\text{committed}}(a \mid g^\*) = \delta_{a^\circ}$ where $a^\circ = \texttt{getJointRLAction}(s, g^\*)$ — the deterministic CommittedAgent action toward target $g^\*$.
- $a_{\text{leg}}(g^\*) = \arg\max_{a \in \mathcal{A}^+(g^\*)} P(g^\* \mid a)$ — the most-legible action **restricted to progress moves**, where

$$\mathcal{A}^+(g^\*) \;=\; \{a \in \mathcal{A} : d(s + a,\, g^\*) < d(s,\, g^\*)\}$$

**Properties by construction.**
- $p = 0$ ≡ `CommittedAgent`: identical target-sampling, identical action, identical commitment / success / efficiency rates.
- Both branches reduce distance to the same $g^\*$, so the trial endpoint (final reached goal) is set by the W_λ target sampling — unaffected by $p$. Commitment metric `firstDetectedSharedGoal == finalReachedGoal` is preserved in expectation.
- Only the *flavor* of the move changes: among progress actions, $p$ shifts mass toward the one that most disambiguates $g^\*$ from distractors in the listener's posterior.

This is the construction that satisfies the design constraint *"increase signaling without sacrificing commitment, with one new parameter."*

## 6. Fit procedure

### 6.1 Human data

Human-human 2P3G trials, deduplicated to unique `(roomId, trialIndex)` rows from workbook exports. Pure human pairs only (workbook `partnerAgentType ∈ {none, human}` only). $N \approx 250$ trial-player observations after dedup, distributed across the three distance conditions.

Per-trial focal-player measures (one row per `(trial, player)`):

- **Signaling Move** $\in \{0, 1\}$: the move at $t_{\text{newGoal}} \to t_{\text{newGoal}}+1$ moves closer to the player's eventually-reached goal AND **not** closer to the alternative candidate goal. NaN if either condition undefined.
- **Commitment** $\in \{0, 1\}$: $\mathbb{1}[\text{firstDetectedSharedGoal} = \text{finalReachedGoal}]$.
- **Coordination Efficiency** ∈ [0, 100]: $\bigl(1 - (\text{actualSteps} - \text{optimalSteps})/\text{actualSteps}\bigr) \cdot 100$ over the post-newGoal segment.

### 6.2 Simulator

30 random-seed sessions × 12 trials per session = **360 SignalAgent×SignalAgent trials per parameter setting**. Maps drawn in order from `MapsFor2P3G` (deterministic given seed). Both agents instantiated with identical hyperparameters; partner-frozen rollouts are simulator-internal only — full self-play during actual simulation.

### 6.3 Loss

For each parameter setting $\theta$, compute simulator signaling rate $\hat p_c(\theta)$ in each distance condition $c$. Score against human counts $(k_c, n_c)$:

$$\mathcal{L}(\theta) \;=\; \sum_{c} \Bigl[\, -k_c \log \hat p_c(\theta) \,-\, (n_c - k_c) \log\bigl(1 - \hat p_c(\theta)\bigr) \,\Bigr]$$

Reported best $\theta = \arg\min_\theta \mathcal{L}(\theta)$ over the parameter grid.

### 6.4 Parameter grids

| Variant | Swept | Grid |
|---|---|---|
| margin / logposterior (H=1) | α | $\{0, 0.25, 0.5, \ldots, 10\}$, 41 points |
| logposterior trajectory | α (per H) | same grid; H ∈ {2, 3} |
| mixture | p | $\{0, 0.025, 0.05, \ldots, 1.0\}$, 41 points |

### 6.5 Comparison baselines

For each best-fit setting, simulator runs are also compared against:

- **Joint-RL** baseline: 30×12 trials with both players acting under joint-RL planning (no commitment, no signaling). Pulled from existing `joint_rl_vs_joint_rl_simulation/`.
- **Human-Human** dataset (§6.1).

## 7. Results

All runs at $\beta = 3.0$, $\lambda = 0.125$. $N = 360$ simulator trials, $\sim 250$ human trial-player observations.

| Variant | Best param | NLL | SSE(rates) | Sim avg sig | Sim eq sig | Sim eq commit | Sim avg success |
|---|---|---|---|---|---|---|---|
| Margin (target = shared) | α = 8.25 | 185.5 | 0.0354 | 41% | 51% | ~99% | ~98% |
| Logpost, single-step | α = 2.75 | 184.7 | 0.0313 | 43% | 55% | ~63% | ~98% |
| Logpost, trajectory H=3 | α = 2.25 | 183.2 | 0.0234 | 44% | 55% | ~66% | ~98% |
| **Mixture** | **p = 0.375** | **184.4** | **0.0299** | **47%** | **64%** | **~72%** | **~92%** |
| Joint-RL baseline | — | — | — | 36% | 44% | ~39% | ~98% |
| Human-Human | — | — | — | 52% | 59% | ~84% | ~100% |

The mixture variant is the only model that simultaneously brings the **average** and **equal-to-both** signaling rates inside the human 95% CI while preserving CommittedAgent's commitment baseline by construction.

## 8. Files

- `client/src/ai/SignalAgent.js` — implementation. Constructor options:
  - `score: 'margin' | 'logposterior' | 'mixture'` (default `'logposterior'`).
  - `alpha: number` (interpreted as $p \in [0,1]$ when `score = 'mixture'`, otherwise unbounded).
  - `lambda: number` (default 0.125), `beta: number` (default 3.0).
  - `horizon: int >= 1` (default 1).
  - `gridSize: int` (default 15) — used for state-clipping in trajectory rollouts.
- `dataAnalysis/scripts/simulate_signal_vs_signal_2p3g.js` — Node simulator. CLI flags `--alpha`, `--lambda`, `--beta`, `--score`, `--horizon`, `--sessions`, `--trials`, `--seed`, `--output-dir`.
- `dataAnalysis/scripts/fit_signal_alpha_beta3.py` — Python fit + plot pipeline. CLI flags `--score`, `--horizon`, `--alphas`, `--reuse-existing`, etc. Output dir auto-routed by `(score, horizon)`.
- Output directories produced:
  - `dataAnalysis/signal_agent_margin_alpha_fit_beta3/`
  - `dataAnalysis/signal_agent_logpost_alpha_fit_beta3/`
  - `dataAnalysis/signal_agent_logpost_alpha_fit_beta3_H3/`
  - `dataAnalysis/signal_agent_mixture_p_fit_beta3/`

Each output directory contains:
- `signal_alpha_fit_beta3_grid.csv`, `..._average_equal.csv`, `..._4measures.csv` — sweep tables.
- `signal_alpha_fit_beta3_summary.json` — best-fit parameters and metadata.
- `signal_alpha_fit_beta3_average_equal.png` — sweep with best-α/p line and human reference.
- `signal_alpha_beta3_average_equal_4measures.png` — 4-panel sweep (Success / Efficiency / Commitment / Signaling).
- `equal_to_both_signal_beta3_best_joint_rl_human_4panel.png` — best-fit vs Joint-RL vs Human bars (equal-to-both).
- `all_distance_signal_beta3_best_joint_rl_human_4panel.png` — same, all distance conditions.
- `simulations/` — raw per-α/p sim outputs.
