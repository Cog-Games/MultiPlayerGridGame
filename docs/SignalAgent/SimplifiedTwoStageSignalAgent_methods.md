# Simplified Two-Stage Signal Agent

## Overview

The simplified two-stage model keeps the main idea of `TwoStageSignalAgent` but removes the early ambiguity-preservation parameter. The agent initially follows flexible joint-RL over all available goals. As confidence in a joint goal increases, it smoothly transitions into posterior-weighted goal-conditioned joint-RL with legible action selection.

This version has two fitted parameters:

\[
\lambda,\tau
\]

and fixed defaults:

\[
\beta=3.0,\quad k=10,\quad \alpha=1.0
\]

## Joint Goal Posterior

The agent maintains a posterior over candidate joint goals:

\[
P_t(g)
\]

At trial start:

\[
P_0(g)=\frac{1}{|\mathcal G_0|}
\]

After observing previous actions:

\[
P_t(g)\propto P_{t-1}(g)
\prod_i
\pi_{\text{joint}}(a^i_{t-1}\mid s^i_{t-1},s^{-i}_{t-1},g)
\]

When a new goal appears, it receives prior mass:

\[
P_t(g_{\text{new}})=\frac{1}{|\mathcal G_t|}
\]

Old goals are rescaled while preserving relative odds:

\[
P_t(g_{\text{old}})
=
\left(1-\frac{1}{|\mathcal G_t|}\right)
\frac{P_{t^-}(g_{\text{old}})}
{\sum_{g'\in\mathcal G_{t^-}}P_{t^-}(g')}
\]

## Confidence Gate

Confidence is the maximum posterior over joint goals:

\[
C_t=\max_g P_t(g)
\]

The continuous transition gate is:

\[
\rho_t=\sigma(k(C_t-\tau))
\]

where \(k=10\) is fixed and \(\tau\) is fit.

If \(C_t\ll\tau\), behavior is mostly flexible joint-RL. If \(C_t\gg\tau\), behavior is mostly committed signaling.

## Early Policy

Before confidence is high, the agent does not sample a goal and does not apply signaling:

\[
\pi_{\text{early}}(a)=
\pi_{\text{joint}}(a\mid s_t,\mathcal G_t)
\]

This means the early phase is not modeled as hiding or deception. It is simply an uncommitted flexible coordination policy.

## Late Goal Weighting

For the committed part of the policy, candidate goals are weighted by:

\[
W_\lambda(g)
\propto
\exp(\beta EU_t(g))P_t(g)^\lambda
\]

with:

\[
EU_t(g)=-
\left[
d(s_t^{self},g)+d(s_t^{other},g)
\right]
\]

\(\beta=3.0\) is fixed and \(\lambda\) is fit.

## Legible Goal-Conditioned Policy

For each candidate goal \(g\), the listener posterior after observing action \(a\) is:

\[
P_t(g\mid a)
\propto
P_t(g)\pi_{\text{joint}}(a\mid s_t,g)
\]

The goal-conditioned signaling policy is:

\[
\pi_{\text{signal}}(a\mid g)
\propto
\pi_{\text{joint}}(a\mid s_t,g)
P_t(g\mid a)^\alpha
\]

with \(\alpha=1.0\) fixed.

The late policy marginalizes over candidate goals:

\[
\pi_{\text{late}}(a)
=
\sum_g W_\lambda(g)\pi_{\text{signal}}(a\mid g)
\]

## Final Policy

The executed action distribution is:

\[
\boxed{
\pi(a)
=
(1-\rho_t)\pi_{\text{joint}}(a\mid s_t,\mathcal G_t)
+
\rho_t
\sum_g W_\lambda(g)\pi_{\text{signal}}(a\mid g)
}
\]

The agent samples one movement action from this distribution.

## Free Parameters

| Parameter | Meaning |
|---|---|
| \(\lambda\) | How strongly the posterior affects committed goal weighting |
| \(\tau\) | Confidence midpoint for transitioning into committed signaling |

Fixed:

| Parameter | Value | Meaning |
|---|---:|---|
| \(\beta\) | 3.0 | EU inverse temperature |
| \(k\) | 10 | Sigmoid sharpness |
| \(\alpha\) | 1.0 | Signaling strength |

## Fitted Result

Using trial-level human-human commitment and signaling targets, with \(\alpha=1.0\), this simplified fit selected:

\[
\lambda=0.15,\quad \tau=0.70
\]

Model-model simulation results at \(n=30\) sessions, 12 2P3G trials/session:

| Scope | Success | Efficiency | Commitment | Signaling |
|---|---:|---:|---:|---:|
| Average all 2P3G | 96.7% | 88.7% | 67.9% | 40.5% |
| Equal-to-both | 100.0% | 97.5% | 79.4% | 55.0% |

## Interpretation

This model says the agent is initially flexible, not covert. It becomes increasingly committed as inferred joint-goal confidence rises, and once commitment dominates, actions are selected to be legible with respect to the posterior-weighted candidate goal.
