# Shared-Agency Model: Methods Draft

This document describes the current shared-agency model from first principles. Equations are written as display LaTeX blocks so they render reliably in the project Markdown viewers.

## Modeling Motivation

The task requires two agents to coordinate on one shared goal while the available goal set can change during a trial. A successful agent therefore needs to solve two coupled problems.

First, it must infer which goal is likely to be jointly intended. Second, it must choose actions that both advance toward a goal and make its own intended goal interpretable to the partner. The shared-agency model formalizes these two computations as separate but interacting components:

```text
belief over joint goals
goal commitment from value and belief
action selection from movement value and communicative legibility
```

The key assumption is that signaling does not create a new goal preference. Instead, signaling changes how the agent moves after a goal has been sampled. This makes the commitment parameter and the signaling parameter conceptually separable: commitment controls which goal is selected; signaling controls how legibly the agent moves toward that selected goal.

## State, Goals, and Actions

At time step `t`, the state is:

$$
s_t = (x^1_t, x^2_t, \mathcal{G}_t)
$$

where `x^1_t` and `x^2_t` are the two players' positions and `G_t` is the current set of available goals. The action set contains the four cardinal movements:

$$
\mathcal{A}
=
\{(0,-1), (0,1), (-1,0), (1,0)\}
$$

The agent maintains a latent belief over which goal is the current joint goal:

$$
P_t(g),
\quad
g \in \mathcal{G}_t
$$

## Belief Update Over Joint Goals

The model treats observed actions as evidence about the latent joint goal. For a candidate goal `g`, the likelihood of an observed action is given by the goal-conditioned base policy:

$$
\pi_{\mathrm{base}}
\left(
a^i_t
\mid
x^i_t,
x^{-i}_t,
g
\right)
$$

The posterior over goals is updated by Bayes' rule:

$$
P_{t+1}(g)
\propto
P_t(g)
\prod_i
\pi_{\mathrm{base}}
\left(
a^i_t
\mid
x^i_t,
x^{-i}_t,
g
\right)
$$

After normalization:

$$
P_{t+1}(g)
=
\frac{
P_t(g)
\prod_i
\pi_{\mathrm{base}}
\left(
a^i_t
\mid
x^i_t,
x^{-i}_t,
g
\right)
}{
\sum_{g' \in \mathcal{G}_t}
P_t(g')
\prod_i
\pi_{\mathrm{base}}
\left(
a^i_t
\mid
x^i_t,
x^{-i}_t,
g'
\right)
}
$$

When a new goal appears, the posterior is resized to include the new goal. The old-goal posterior mass is preserved proportionally, and the new goal receives the symmetric prior mass for a three-goal set:

$$
P_t(g_{\mathrm{new}})=\frac{1}{3}
$$

$$
\sum_{g \in \mathcal{G}_{\mathrm{old}}} P_t(g)=\frac{2}{3}
$$

## JointRL Reward Function

The base movement policy is derived from a joint reward function. For a candidate goal `g`, both agents receive a shared terminal reward if they reach `g` together, and each active agent pays a step cost until reaching the goal.

Let:

$$
R_{\mathrm{goal}}=30
$$

$$
c_{\mathrm{step}}=1
$$

Let `n_active(s_t,g)` be the number of players not yet at goal `g`:

$$
n_{\mathrm{active}}(s_t,g)
=
\sum_{i=1}^{2}
\mathbf{1}
\left[
x^i_t \neq g
\right]
$$

The one-step reward is:

$$
r_g(s_t,a_t,s_{t+1})
=
R_{\mathrm{goal}}
\mathbf{1}
\left[
x^1_{t+1}=g
\ \mathrm{and}\
x^2_{t+1}=g
\right]
-
c_{\mathrm{step}}
n_{\mathrm{active}}(s_t,g)
$$

This means each player pays `-1` only while still active. If one player has already reached the candidate goal, only the other player continues to pay step cost.

For the current reports, the value of a candidate goal is the corresponding shortest-completion value:

$$
V_g(s_t)
=
R_{\mathrm{goal}}
-
c_{\mathrm{step}}
\left[
d(x^1_t,g)
+
d(x^2_t,g)
\right]
$$

With the fixed values above:

$$
V_g(s_t)
=
30
-
\left[
d(x^1_t,g)
+
d(x^2_t,g)
\right]
$$

Thus, if the shared old goal and the new goal have the same joint Manhattan distance sum, they have the same value. This property is important because the value term should not by itself prefer one of two equally reachable joint goals.

## Base Action Policy

For a candidate goal `g`, the model evaluates joint actions using the reward function above. The joint action value is:

$$
Q_g(s_t,a^1,a^2)
=
r_g(s_t,(a^1,a^2),s_{t+1})
+
V_g(s_{t+1})
$$

Joint actions are converted into probabilities with a softmax:

$$
\pi_{\mathrm{joint}}(a^1,a^2 \mid s_t,g)
=
\frac{
\exp
\left[
\beta Q_g(s_t,a^1,a^2)
\right]
}{
\sum_{\bar a^1,\bar a^2}
\exp
\left[
\beta Q_g(s_t,\bar a^1,\bar a^2)
\right]
}
$$

The current reports use:

$$
\beta=3
$$

The model's own-action base policy is the marginal of this joint policy:

$$
\pi_{\mathrm{base}}(a^i \mid s_t,g)
=
\sum_{a^{-i} \in \mathcal{A}}
\pi_{\mathrm{joint}}(a^i,a^{-i} \mid s_t,g)
$$

This base policy captures efficient goal-directed movement under the joint reward function.

## Commitment: Sampling a Joint Goal

The agent samples a target goal from a distribution that combines current value and inferred joint-goal belief.

Because raw values are on the reward scale, values are first normalized within the current goal set:

$$
\widetilde{V}_g(s_t)
=
\frac{
V_g(s_t)
-
\min_{g' \in \mathcal{G}_t} V_{g'}(s_t)
}{
\max_{g' \in \mathcal{G}_t} V_{g'}(s_t)
-
\min_{g' \in \mathcal{G}_t} V_{g'}(s_t)
+
\epsilon
}
$$

The commitment distribution is:

$$
W_\lambda(g)
\propto
\exp
\left[
3\widetilde{V}_g(s_t)
\right]
P_t(g)^\lambda
$$

Equivalently:

$$
W_\lambda(g)
=
\frac{
\exp
\left[
3\widetilde{V}_g(s_t)
\right]
P_t(g)^\lambda
}{
\sum_{g' \in \mathcal{G}_t}
\exp
\left[
3\widetilde{V}_{g'}(s_t)
\right]
P_t(g')^\lambda
}
$$

The sampled target is:

$$
g^*_t \sim W_\lambda(g)
$$

The parameter `lambda` controls commitment to the inferred joint goal. When `lambda=0`, the sampled goal depends only on the current value term. When `lambda` is larger, the model gives more weight to the inferred shared goal.

## Legibility: Listener Inference From a Candidate Action

To decide whether an action is communicative, the model asks how a partner would update their belief after observing that action. The partner is modeled as a Bayesian listener who assumes the actor follows the goal-conditioned base policy.

For a candidate action `a`, the listener posterior is:

$$
P_t(g \mid a)
\propto
P_t(g)
\pi_{\mathrm{base}}(a \mid s_t,g)
$$

After normalization:

$$
P_t(g \mid a)
=
\frac{
P_t(g)
\pi_{\mathrm{base}}(a \mid s_t,g)
}{
\sum_{g' \in \mathcal{G}_t}
P_t(g')
\pi_{\mathrm{base}}(a \mid s_t,g')
}
$$

For the sampled goal `g^*_t`, action legibility is defined as the log odds that the listener assigns to that goal relative to all alternative goals after observing the action:

$$
L_t(a,g^*_t)
=
\log P_t(g^*_t \mid a)
-
\log
\sum_{g' \neq g^*_t}
P_t(g' \mid a)
$$

Because the posterior is normalized, the denominator is equivalent to `1 - P_t(g^*_t | a)`. The summation form makes explicit that legibility is defined as evidence for the sampled goal against the competing goals.

## Signaling: Communicative Action Mixture (Legibility Over Alternatives)

The signaling policy is a mixture of efficient movement and communicative movement. First, the communicative policy reweights the base action policy by legibility:

$$
\pi_{\mathrm{comm}}(a \mid s_t,g^*_t)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g^*_t)
\exp
\left[
L_t(a,g^*_t)
\right]
$$

Then the final action policy mixes the base policy with the communicative policy:

$$
\pi_{\mathrm{CAM}}(a \mid s_t,g^*_t)
=
(1-\rho)
\pi_{\mathrm{base}}(a \mid s_t,g^*_t)
+
\rho
\pi_{\mathrm{comm}}(a \mid s_t,g^*_t)
$$

The parameter `rho` controls signaling strength. When `rho=0`, actions are selected from the efficient base policy for the sampled goal. When `rho>0`, the agent gives additional probability to actions that make the sampled goal more legible to the partner.

The name **Communicative Action Mixture (Legibility Over Alternatives)** reflects the two operations in the formula: the agent mixes efficient and communicative action policies, and the communicative component is defined by the posterior log odds of the sampled goal over alternative goals. Communicative actions need not be the locally most efficient actions under the base policy; they are favored when they increase the partner's posterior belief in the sampled goal relative to competing goals.

## Full Action Likelihood

Because the sampled goal is latent to the observer, the likelihood of an action marginalizes over possible sampled goals:

$$
\pi(a_t \mid s_t)
=
\sum_{g \in \mathcal{G}_t}
W_\lambda(g)
\pi_{\mathrm{CAM}}(a_t \mid s_t,g)
$$

This equation is the central model likelihood. It combines:

```text
belief-based commitment over goals
value-based movement toward a sampled goal
costly legibility-based action modulation
```

## Parameter Fitting

The current model has two fitted psychological parameters:

```text
lambda: strength of commitment to the inferred joint goal
rho: strength of costly communicative action selection
```

Trial-level fitting evaluates whether simulated model behavior matches human commitment and signaling rates:

$$
\mathcal{L}_{\mathrm{trial}}
=
-
\sum_m
\left[
k_m \log q_m
+
(n_m-k_m)
\log(1-q_m)
\right]
$$

where `m` indexes behavioral measures, `k_m` is the human count, `n_m` is the number of eligible observations, and `q_m` is the corresponding model-predicted probability.

Step-level fitting evaluates the probability assigned to human actions in the signal-relevant window after the new goal appears:

$$
\mathcal{L}_{\mathrm{step}}
=
-
\sum_{t \in \mathcal{T}}
\log
\pi(a^{\mathrm{human}}_t \mid s_t)
$$

For the current signal-window report:

$$
\mathcal{T}
=
\{\text{steps 1--3 after new-goal presentation}\}
$$

## Current Fitted Parameters

The trial-level report uses:

$$
\lambda = 0.2
$$

$$
\rho = 0.5
$$

The step-level signal-window report uses:

$$
\lambda = 0.2
$$

$$
\rho = 0.1
$$

The two fits emphasize different targets. Trial-level fitting asks whether the model reproduces aggregate commitment and signaling rates. Step-level fitting asks whether the model assigns high likelihood to the specific human actions observed immediately after the new goal appears.

## Interpretation

The model implements shared agency as a probabilistic coupling between joint-goal inference, commitment, and communicative action. The commitment term explains why agents preserve an inferred shared goal even when a new option appears. The signaling term explains why agents sometimes choose movements that are not only efficient but also informative about the sampled goal.

The model's core theoretical claim is:

$$
\text{shared agency}
=
\text{belief-guided commitment}
+
\text{costly goal-legible action}
$$

This formulation separates commitment from signaling while allowing both to arise from the same inferred joint-goal belief.
