# Joint-RL Baseline - Model

## Overview

The joint-RL baseline is a cooperative planner with no explicit commitment, no posterior over intentions, and no signaling term. Both agents use the same joint policy over the currently available goal set.

This baseline is useful because it estimates how much coordination can be explained by shared cooperative planning alone.

## State And Goals

At time $t$, the state is:

$$
s_t=(s_t^1,s_t^2)
$$

where $s_t^1$ and $s_t^2$ are the two players' grid positions.

The current goal set is:

$$
\mathcal{G}_t
$$

In 2P3G, $\lvert\mathcal{G}_t\rvert=2$ before the new goal appears and $\lvert\mathcal{G}_t\rvert=3$ afterward.

## Joint Policy

The planner computes a joint value function over both players' positions and the current goal set. The acting player's marginal action policy is:

$$
\pi_{\text{joint}}(a^i_t\mid s_t^i,s_t^{-i},\mathcal{G}_t)
$$

The action distribution is derived from joint-RL action values with a softmax:

$$
\pi_{\text{joint}}(a\mid s_t,\mathcal{G}_t)
\propto
\exp(\beta_{\text{RL}}Q(s_t,a;\mathcal{G}_t))
$$

The current implementation uses the shared `RLAgent` joint planner:

```js
RLAgent.getJointRLAction(playerPos, partnerPos, currentGoals)
```

and for analysis:

```js
RLAgent.getJointActionProbabilities(playerPos, partnerPos, currentGoals)
```

## No Commitment Or Signaling

The joint-RL baseline does not maintain:

$$
P_t(g)
$$

and does not sample a committed goal:

$$
g^{*}
$$

Actions are always selected from the joint policy over the full current goal set:

$$
a_t\sim \pi_{\text{joint}}(a\mid s_t,\mathcal{G}_t)
$$

## Parameter

The relevant policy parameter is the joint-RL softmax inverse temperature:

$$
\beta_{\text{RL}}=3.0
$$

This is fixed in the current model-model comparisons.
