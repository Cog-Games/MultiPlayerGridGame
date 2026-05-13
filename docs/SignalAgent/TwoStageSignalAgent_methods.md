# TwoStageSignalAgent - Methods

## Overview

`TwoStageSignalAgent` models deferred commitment without treating the early phase as deception. The agent starts with a flexible joint-RL policy over all currently available goals, while continuously maintaining a Bayesian posterior over candidate joint goals. As posterior confidence increases, a sigmoid gate smoothly shifts control toward a goal-conditioned committed policy with signaling.

The model is continuous: it does not hard-switch between two discrete modes. The gate controls how much the current action distribution reflects flexible coordination versus committed signaling.

## Posterior Over Joint Goals

Let \(P_t(g)\) be the agent's posterior that \(g\) is the intended joint goal. At trial start:

\[
P_0(g)=\frac{1}{|\mathcal G_0|}
\]

After observing both players' previous actions:

\[
P_t(g)\propto P_{t-1}(g)\prod_i \pi_{\text{joint}}(a^i_{t-1}\mid s^i_{t-1},s^{-i}_{t-1},g)
\]

where \(\pi_{\text{joint}}(\cdot\mid s,g)\) is the joint-RL policy conditioned on a single candidate goal \(g\).

When a new goal appears, it receives prior mass \(1/|\mathcal G_t|\). Old goals are rescaled to preserve their relative odds:

\[
P_t(g_{\text{new}})=\frac{1}{|\mathcal G_t|}
\]

\[
P_t(g_{\text{old}})=
\left(1-\frac{1}{|\mathcal G_t|}\right)
\frac{P_{t^-}(g_{\text{old}})}
{\sum_{g'\in \mathcal G_{t^-}}P_{t^-}(g')}
\]

## Confidence Gate

The agent's commitment confidence is:

\[
C_t=\max_g P_t(g)
\]

The continuous commitment gate is:

\[
\rho_t=\sigma(k(C_t-\tau))
\]

where \(k\) is fixed to \(10\) by default, and \(\tau\) is fit.

When \(C_t\ll\tau\), \(\rho_t\approx 0\), so behavior is mostly flexible joint-RL. When \(C_t\gg\tau\), \(\rho_t\approx 1\), so behavior is mostly committed signaling.

## Early Flexible Policy

Before confidence is high, the agent uses joint-RL over all current goals, with an ambiguity-preservation term:

\[
\pi_{\text{early}}(a)\propto
\pi_{\text{joint}}(a\mid s_t,\mathcal G_t)
\exp\left(\eta H(P_t(g\mid a))\right)
\]

The listener posterior after observing action \(a\) is:

\[
P_t(g\mid a)\propto P_t(g)\pi_{\text{joint}}(a\mid s_t,g)
\]

and:

\[
H(P_t(g\mid a))=-\sum_gP_t(g\mid a)\log P_t(g\mid a)
\]

\(\eta\) controls how strongly early actions preserve ambiguity. This is not modeled as hiding or deception; it is a pressure against premature commitment.

## Late Committed-Signaling Policy

Goal-selection weights are:

\[
W_\lambda(g)\propto \exp(\beta EU_t(g))P_t(g)^\lambda
\]

with:

\[
EU_t(g)=-(d(s_t^{self},g)+d(s_t^{other},g))
\]

\(\beta\) is fixed to \(3.0\) by default, and \(\lambda\) is fit.

For each candidate goal:

\[
\pi_{\text{signal}}(a\mid g)\propto
\pi_{\text{joint}}(a\mid s_t,g)
P_t(g\mid a)^\alpha
\]

\(\alpha\) controls signaling strength.

The late policy marginalizes over possible committed goals:

\[
\pi_{\text{late}}(a)=\sum_g W_\lambda(g)\pi_{\text{signal}}(a\mid g)
\]

## Final Action Policy

The executed action distribution is:

\[
\pi(a)=(1-\rho_t)\pi_{\text{early}}(a)+\rho_t\pi_{\text{late}}(a)
\]

Then one movement action is sampled from \(\pi(a)\).

## Parameters

Fixed by default:

| Parameter | Meaning | Default |
|---|---:|---:|
| \(\beta\) | EU inverse temperature in goal weights | 3.0 |
| \(k\) | sigmoid gate sharpness | 10.0 |

Fit:

| Parameter | Meaning |
|---|---|
| \(\lambda\) | posterior strength in committed goal weighting |
| \(\tau\) | confidence midpoint for transition |
| \(\alpha\) | signaling strength after confidence rises |
| \(\eta\) | ambiguity-preservation strength before confidence rises |

## Fit Target

The 4-parameter fit is trial-level, not step-level. It matches human-human 2P3G commitment and signaling rates by distance condition using model-model simulations.

Commitment:

\[
\mathbf 1[\text{firstDetectedSharedGoal}=\text{finalReachedGoal}]
\]

Signaling follows the existing notebook definition: the first move after new-goal presentation moves closer to the eventually reached goal and not closer to the alternative candidate goal.
