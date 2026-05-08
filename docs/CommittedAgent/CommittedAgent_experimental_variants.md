# Experimental CommittedAgent Variants

The production/runtime model is the one-shot committed choice in `client/src/ai/CommittedAgent.js`.

Experimental variants live here so they do not define the main model.

## `CommittedAgentEveryStepExperimental.js`

Legacy model that re-samples a joint goal at every post-new-goal step:

\[
W_\lambda(g)\propto \exp(\beta EU(g))P_t(g)^\lambda.
\]

It also includes the optional posterior lock-in rule:

\[
\max_g P_t(g)\ge \tau
\]

after an initial sampling window of \(n\) steps.

Use this only for exploratory simulations. Do not use it for the main reported model unless explicitly changing the theory back to every-step resampling.

## Centralized Shared Sample

The centralized shared-sample idea is simulation-only. It forces both agents to share the same sampled goal and therefore assumes a coordination channel not available to two independent agents.

Use it only as a diagnostic upper bound for whether failures are caused by independent sampling.
