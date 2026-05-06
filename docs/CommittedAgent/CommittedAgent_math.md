# CommittedAgent Math and Parameters

This document describes the current main model in `client/src/ai/CommittedAgent.js`.

## Main Model

The main model is **pure every-step resampling**. There is no one-shot lock and no convergence threshold in the runtime model.

Before a new goal appears, the agent behaves like joint-RL. It also maintains a posterior over joint goals:

\[
P_t(g)=P(g\mid \text{joint action history}).
\]

The posterior is updated with the joint-RL likelihood restricted to one candidate goal:

\[
P_t(g)\propto P_{t-1}(g)
\cdot \pi_{\mathrm{joint}}^1(a_t^1\mid x_t^1,x_t^2,\{g\})
\cdot \pi_{\mathrm{joint}}^2(a_t^2\mid x_t^2,x_t^1,\{g\}).
\]

After `newGoalPresented == true` and `firstDetectedSharedGoal` is defined, the agent samples a joint goal at every step:

\[
W_\lambda(g)=
\frac{\exp(\beta EU(g))P_t(g)^\lambda}
{\sum_{g'}\exp(\beta EU(g'))P_t(g')^\lambda}.
\]

The utility term is negative joint distance:

\[
EU(g)=-(d(x_t^1,g)+d(x_t^2,g)).
\]

The sampled goal is converted into movement by the joint-RL policy restricted to that sampled goal:

\[
a_t^i\sim \pi_{\mathrm{joint}}^i(\cdot\mid x_t^i,x_t^j,\{g_t\}).
\]

The sampled goal is not fixed. On the next step, \(P_t(g)\) and \(EU(g)\) are recomputed and a new \(g_t\) is sampled.

## Current Parameters

- \(\beta=3.0\)
- \(\lambda=0.125\)

\(\lambda\) controls reliance on the inferred joint-goal posterior. \(\lambda=0\) ignores inferred commitment and uses only current joint utility; larger \(\lambda\) gives more weight to inferred shared intent.
