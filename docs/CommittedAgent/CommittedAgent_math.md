# CommittedAgent Math and Parameter Fitting

This document describes the current `CommittedAgent` model implemented in [client/src/ai/CommittedAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/CommittedAgent.js), together with the fitting procedure for its free parameter `lambda`.

It reflects the current branch implementation, not the earlier sigmoid-bias version.

## 1. Model Summary

The current committed agent has two regimes:

1. Before a shared goal is detected, or before the new goal appears:
   it behaves like the existing joint RL agent.
2. After a shared goal has been detected and a new goal appears:
   at each step it re-samples a joint goal using

\[
W_\lambda(g) \propto \exp(\beta \, EU(g)) \, P_t(g)^\lambda
\]

and then generates that step's movement from the AI component of a joint RL policy that only considers the sampled joint goal.

So the model is:

\[
\text{CommittedAgent}
=
\text{joint-RL before switch}
+
\text{Bayesian posterior over goals}
+
\text{utility-posterior weighted goal sampling after switch}.
\]

## 2. Notation

Let:

- \(G_t = \{g_1,\dots,g_n\}\) be the currently available goals at time \(t\)
- \(x_t^A\) be the AI position
- \(x_t^H\) be the human position
- \(a_t^A, a_t^H\) be the observed actions at step \(t\)
- \(P_t(g)\) be the posterior probability that joint goal \(g\) is the currently intended/shared goal
- \(d(x,g)\) be Manhattan distance from position \(x\) to goal \(g\)
- \(EU(g)\) be the joint-distance utility of joint goal \(g\)
- \(\beta\) be the fixed utility sensitivity
- \(\lambda\) be the fitted reliance on inferred intent

In the current config:

- \(\beta = 1.0\)
- `lambda` is the only fitted free parameter

## 3. Pre-switch Behavior

Before commitment logic becomes active, `CommittedAgent` just calls the base RL agent in joint mode:

\[
a_t^A \sim \pi_{\text{joint}}(\cdot \mid x_t^A, x_t^H, G_t).
\]

Operationally, the switch has not happened yet if either:

- no new goal has been presented, or
- `firstDetectedSharedGoal` has not been set yet.

So:

\[
\text{if } \neg \texttt{newGoalPresented} \text{ or no shared goal detected, use joint RL.}
\]

## 4. Posterior Over Goal Intent

The model maintains a posterior over goals:

\[
P_t(g) = P(g \mid \text{observed actions up to step } t).
\]

### 4.1 Initial prior

At trial start, if there are \(n\) goals:

\[
P_0(g_i) = \frac{1}{n}.
\]

### 4.2 Posterior expansion when a new goal appears

If a new goal is added, the posterior vector is resized.

- existing goal masses are copied over
- the new goal is initialized with mass \(1/n\)
- the whole vector is renormalized

This matches `_ensurePosterior(...)` in [CommittedAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/CommittedAgent.js).

### 4.3 Likelihood model

For each candidate joint goal \(g\), the model evaluates how likely the observed actions are under the joint RL policy restricted to \(\{g\}\):

\[
L_t(g)
=
\pi_{\text{joint}}^A(a_t^A \mid x_t^A, x_t^H, \{g\})
\cdot
\pi_{\text{joint}}^H(a_t^H \mid x_t^H, x_t^A, \{g\}).
\]

If only one player has an action at that step, only the available factor is used.

The posterior update is:

\[
P_t(g) \propto P_{t-1}(g)\,L_t(g),
\]

followed by normalization:

\[
P_t(g) =
\frac{P_t(g)}
{\sum_{g' \in G_t} P_t(g')}.
\]

The implementation uses a small floor \(\varepsilon\) for numerical stability when an action probability is missing or zero:

\[
\pi_{\text{joint}}(a \mid x^A,x^H,\{g\}) \leftarrow
\max(\pi_{\text{joint}}(a \mid x^A,x^H,\{g\}), \varepsilon).
\]

## 5. Restricted Joint RL Policy For Intent Inference

The posterior likelihood model uses the focal player's own action component from the joint RL policy restricted to one candidate joint goal:

\[
\pi_{\text{joint}}^A(a \mid x^A,x^H,\{g\}).
\]

This policy is computed in [client/src/ai/RLAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/RLAgent.js) by:

1. evaluating the joint RL action values for the restricted goal set \(\{g\}\)
2. applying a softmax over joint action values
3. marginalizing or extracting the focal player's own action component

The focal action distribution can be written as:

\[
\pi_{\text{joint}}^A(a^A \mid x^A,x^H,\{g\})
=
\sum_{a^H}
\frac{\exp(\beta_{\text{RL}} Q_{\{g\}}(x^A,x^H,a^A,a^H))}
{\sum_{\tilde a^A,\tilde a^H}
\exp(\beta_{\text{RL}} Q_{\{g\}}(x^A,x^H,\tilde a^A,\tilde a^H))}.
\]

Current RL constants:

- grid size: `15`
- discount factor: \(\gamma = 0.9\)
- goal reward: `30`
- step cost: `-1`
- RL softmax inverse temperature: \(\beta_{\text{RL}} = 3.0\)

## 6. Utility Term Over Goals

After the switch, each candidate goal gets a utility based on total joint distance:

\[
EU(g) = -\bigl(d(x_t^A,g) + d(x_t^H,g)\bigr).
\]

So:

- closer joint goals have larger \(EU(g)\)
- farther joint goals have smaller \(EU(g)\)

The exponential utility term used by the model is:

\[
\exp(\beta\,EU(g)).
\]

In the current branch, \(\beta = 1.0\).

## 7. Post-switch Goal Selection Model

At every post-switch step where:

- `newGoalPresented == true`
- `firstDetectedSharedGoal` is defined

the agent uses the current posterior and current positions to compute:

\[
W_\lambda(g) \propto \exp(\beta \, EU(g)) \, P_t(g)^\lambda.
\]

Normalized:

\[
W_\lambda(g)
=
\frac{\exp(\beta \, EU(g)) \, P_t(g)^\lambda}
{\sum_{g' \in G_t} \exp(\beta \, EU(g')) \, P_t(g')^\lambda }.
\]

Interpretation:

- \(\exp(\beta EU(g))\): current geometric attractiveness of goal \(g\)
- \(P_t(g)\): how strongly observed behavior supports goal \(g\)
- \(\lambda\): how strongly goal choice depends on inferred intent

Special cases:

- \(\lambda = 0\): ignore inferred intent, choose by utility only
- \(\lambda = 1\): use the posterior exactly as written
- \(\lambda > 1\): amplify inferred intent
- \(0 < \lambda < 1\): weaken inferred intent

The sampled joint goal is not fixed across future steps. On the next step, the posterior is updated again from newly observed actions, \(EU(g)\) is recomputed from the new positions, and a new \(g_t\) is sampled from the updated \(W_\lambda\).

## 8. Action Generation After Joint-Goal Selection

After sampling a joint goal \(g_t\) from \(W_\lambda(g)\) at step \(t\), the agent does not act directly in goal space. It converts that sampled joint goal into movement by calling the joint RL policy with the candidate goal set restricted to \(\{g_t\}\), then taking the agent's own action component:

\[
g_t \sim W_\lambda(g),
\qquad
a_t^A \sim \pi_{\text{joint}}^A(\cdot \mid x_t^A, x_t^H, \{g_t\}).
\]

So the full post-switch policy is a mixture:

\[
P(a_t^A \mid x_t^A, x_t^H)
=
\sum_{g \in G_t}
W_\lambda(g)\,
\pi_{\text{joint}}^A(a_t^A \mid x_t^A, x_t^H, \{g\}).
\]

Here, \(\pi_{\text{joint}}^A\) denotes the AI player's own action component extracted from the joint RL policy.

## 9. Free Parameter

The current model has one fitted free parameter:

\[
\lambda.
\]

It measures how much the agent relies on inferred intent \(P_t(g)\) when choosing among goals after the new goal appears.

`beta` is currently fixed:

\[
\beta = 1.0.
\]

So the fit is one-dimensional.

## 10. Data Used to Fit `lambda`

The fitting pipeline is implemented in [dataAnalysis/scripts/fit_committed_lambda.py](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/dataAnalysis/scripts/fit_committed_lambda.py).

Data sources:

- `human-human-locaked action-with-commitAgent-fallback`
- `human-human-locaked action-with-vlm-tom-fallback`

Filtering rules:

1. keep only workbooks whose `partnerAgentType` values are restricted to `{none, human}`
2. within those workbooks, keep only `experimentType == 2P3G` and `partnerAgentType == human`
3. deduplicate duplicated participant exports at the `roomId + trialIndex` level
4. fit only trials where:
   - `newGoalPresented == true`
   - `firstDetectedSharedGoal` is defined

Counts from the saved fit summary in [lambda_fit_summary.json](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/dataAnalysis/committed_agent_lambda_fit/lambda_fit_summary.json):

- pure human workbooks: `30`
- pure human `2P3G` participant rows: `357`
- unique `2P3G` room-trials: `189`
- fit-eligible room-trials: `142`
- step-level observations: `1532`

## 11. How the Fit Dataset Is Constructed

The fitting is done at the step level, not just at the final-goal level.

For each eligible post-new-goal decision step, the script records:

- current candidate goals
- current posterior \(P_t(g)\)
- current utility vector \(EU(g)\)
- observed focal-player action
- per-joint-goal action probabilities under the AI component of the restricted joint RL policy

For one observation \(o\), the script stores:

\[
\pi_{\text{joint}}^A(a_o \mid x_o^A,x_o^H,\{g_1\}),\dots,
\pi_{\text{joint}}^A(a_o \mid x_o^A,x_o^H,\{g_n\}).
\]

These are the `action_goal_probs` in the fitting script.

## 12. Likelihood Used for Fitting

Given a candidate \(\lambda\), the model first forms goal weights:

\[
W_\lambda(g \mid o)
=
\frac{\exp(\beta EU_o(g))\,P_o(g)^\lambda}
{\sum_{g'} \exp(\beta EU_o(g'))\,P_o(g')^\lambda}.
\]

The probability of the actually observed action is then the mixture:

\[
P(a_o \mid \lambda)
=
\sum_{g \in G_o}
W_\lambda(g \mid o)\,
\pi_{\text{joint}}^A(a_o \mid x_o^A,x_o^H,\{g\}).
\]

The total log-likelihood over all step-level observations is:

\[
\log \mathcal{L}(\lambda)
=
\sum_{o=1}^{N}
\log P(a_o \mid \lambda).
\]

Equivalently, the script minimizes the negative log-likelihood:

\[
\mathcal{J}(\lambda)
=
- \sum_{o=1}^{N}
\log \left(
\sum_{g \in G_o}
W_\lambda(g \mid o)\,
\pi_{\text{joint}}^A(a_o \mid x_o^A,x_o^H,\{g\})
\right).
\]

This is implemented in `lambda_negative_log_likelihood(...)`.

## 13. Optimization Procedure

The script uses bounded scalar optimization:

- optimizer: `scipy.optimize.minimize_scalar`
- method: `bounded`
- search interval: \([0, 10]\)

So the fitted parameter is:

\[
\hat{\lambda}
=
\arg\min_{\lambda \in [0,10]} \mathcal{J}(\lambda).
\]

The standard error is approximated from the local curvature of the negative log-likelihood around \(\hat{\lambda}\), using a finite-difference Hessian approximation.

## 14. Current Fitted Result

From [lambda_fit_summary.json](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/dataAnalysis/committed_agent_lambda_fit/lambda_fit_summary.json):

\[
\hat{\lambda} = 6.36701374103809
\]

with:

- negative log-likelihood: `1095.8853170907087`
- standard error: `0.2662513628785118`
- 95% CI: `[5.845161069796206, 6.888866412279973]`

This means the fitted model places substantially more weight on posterior intent than the \(\lambda = 1\) baseline.

## 15. Interpretation

The current committed-agent model says:

1. infer which goal best explains the pair's observed behavior
2. combine that with the current geometry of the scene
3. after a new goal appears, choose goals using a posterior-weighted utility model
4. use a single fitted parameter `lambda` to determine how strongly inferred intent should matter

The main behavioral interpretation is:

\[
\text{commitment}
\approx
\text{stronger reliance on inferred prior/shared intent after the switch}.
\]

This is different from the earlier model family where commitment was represented as an extra old-goal intercept or sigmoid bias.

## 16. Code References

- Model implementation:
  [client/src/ai/CommittedAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/CommittedAgent.js)
- RL policies:
  [client/src/ai/RLAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/RLAgent.js)
- Fit script:
  [dataAnalysis/scripts/fit_committed_lambda.py](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/dataAnalysis/scripts/fit_committed_lambda.py)
- Fit result:
  [dataAnalysis/committed_agent_lambda_fit/lambda_fit_summary.json](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/dataAnalysis/committed_agent_lambda_fit/lambda_fit_summary.json)
