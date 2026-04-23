# Committed Agent: Mathematical Specification

This document explains the math implemented by the committed agent in the current codebase. The main implementation lives in [client/src/ai/CommittedAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/CommittedAgent.js) and depends on the base RL planners in [client/src/ai/RLAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/RLAgent.js).

## 1. High-level idea

The committed agent is not a separately trained network or policy table. It is a wrapper around the existing RL agent with three extra pieces of decision logic:

1. Infer which goal is currently intended from observed player actions.
2. Combine that inferred intent with a simple joint-distance utility over goals.
3. After a shared goal has been detected and a new goal appears, add a commitment bias toward the old shared goal.

So the committed agent is best understood as:

\[
\text{CommittedAgent} = \text{Base RL motion model} + \text{Bayesian goal inference} + \text{commitment gate}.
\]

## 2. Notation

Let:

- \(G = \{g_1, \dots, g_n\}\) be the set of currently available goals.
- \(x_t^{A}\) be the AI position at time \(t\).
- \(x_t^{H}\) be the human position at time \(t\).
- \(a_t^{A}\) and \(a_t^{H}\) be the observed actions of AI and human.
- \(g_{\mathrm{old}}\) be the first detected shared goal before the new goal appears.
- \(d(x, g)\) be Manhattan distance from grid position \(x\) to goal \(g\).

The code uses Manhattan distance through `GameHelpers.calculateGridDistance(...)`.

## 3. Base RL math under the committed agent

The committed agent delegates actual movement to the existing RL agent.

### 3.1 Individual RL policy

The individual planner in [client/src/ai/RLAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/RLAgent.js) builds a goal-conditioned MDP with:

- discount factor: \(\gamma = 0.9\)
- goal reward: \(R_{\text{goal}} = 30\)
- step cost: \(c_{\text{step}} = -1\)
- action noise: \(0\)
- softmax inverse temperature: \(\beta_{\text{RL}} = 3.0\)

For a state \(s\), action \(a\), and next state \(s'\), the one-step reward is:

\[
R(s,a,s') =
\begin{cases}
-1 + 30, & \text{if } s' \text{ is a goal state} \\
-1, & \text{otherwise.}
\end{cases}
\]

The value iteration update is the standard Bellman optimality update:

\[
V(s) = \max_a \sum_{s'} T(s' \mid s,a)\left[R(s,a,s') + \gamma V(s')\right].
\]

Then the code constructs action values

\[
Q(s,a) = \sum_{s'} T(s' \mid s,a)\left[R(s,a,s') + \gamma V(s')\right]
\]

and turns them into a stochastic policy with softmax:

\[
\pi_{\text{ind}}(a \mid s,g) =
\frac{\exp(\beta_{\text{RL}} Q_g(s,a))}
{\sum_{a'} \exp(\beta_{\text{RL}} Q_g(s,a'))}.
\]

When the committed agent has selected a concrete goal \(g\), it moves with this individual policy toward that goal.

### 3.2 Joint RL policy before commitment takes over

Before commitment logic becomes active, the committed agent behaves like the joint RL planner.

In the current configuration, `RLAgent` uses the BFS-style joint planner by default. The joint state is:

\[
s_t = (x_t^{A}, x_t^{H}).
\]

For every pair of next actions, the planner evaluates a joint action value using:

\[
Q_{\text{joint}}(s, a^{A}, a^{H}) = r(s, a^{A}, a^{H}) + \gamma \cdot \text{futureValue}(s').
\]

The immediate reward is approximately:

\[
r =
\begin{cases}
30, & \text{if both agents reach the same goal now} \\
-1 - \lambda \min_{g \in G}\left[d(x'^{A}, g) + d(x'^{H}, g)\right], & \text{otherwise}
\end{cases}
\]

with \(\lambda = 0.01\).

This means the joint RL planner prefers actions that reduce the total distance of the two players to some common goal. The planner then applies a softmax over joint \(Q\)-values and returns the AI component of the sampled joint action.

## 4. State machine of the committed agent

The main branch condition is in [client/src/ai/CommittedAgent.js](/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/client/src/ai/CommittedAgent.js).

The committed agent has two regimes.

### Regime A: before commitment matters

If either of the following is true:

- no new goal has appeared yet, or
- no shared goal has been detected yet,

then the agent simply uses joint RL.

Formally:

\[
\text{if } \neg \texttt{newGoalPresented} \;\; \text{or} \;\; g_{\mathrm{old}} \text{ is undefined,}
\quad a_t^{A} \sim \pi_{\text{joint}}(\cdot \mid x_t^{A}, x_t^{H}, G).
\]

### Regime B: after shared-goal detection and new-goal presentation

Once:

- a shared goal has been identified, and
- a new goal has appeared,

the committed agent switches from direct joint RL control to goal selection with commitment bias, followed by individual RL motion toward the selected goal.

## 5. Bayesian intent inference

The agent stores a posterior over goals:

\[
P_t(g) = P(g \mid \text{observed actions up to time } t).
\]

### 5.1 Prior

At the beginning of a trial, the posterior is initialized uniformly:

\[
P_0(g_i) = \frac{1}{|G|}.
\]

If a new goal is added later, the posterior vector is resized and renormalized.

### 5.2 Likelihood model

For each observed step \(t\), and for each candidate goal \(g\), the code multiplies together action likelihoods from whichever players have an action recorded:

\[
L_t(g) =
\pi_{\text{ind}}(a_t^{H} \mid x_t^{H}, g)
\times
\pi_{\text{ind}}(a_t^{A} \mid x_t^{A}, g).
\]

More precisely, if one action is missing, only the available factor is used. The posterior update is:

\[
P_t(g) \propto P_{t-1}(g)\,L_t(g).
\]

Then normalize:

\[
P_t(g) = \frac{P_t(g)}{\sum_{g' \in G} P_t(g')}.
\]

The code uses a floor \(\varepsilon = 10^{-6}\) whenever an action probability is missing or zero, to prevent the posterior from collapsing numerically:

\[
\pi_{\text{ind}}(a \mid x,g) \leftarrow \max(\pi_{\text{ind}}(a \mid x,g), \varepsilon).
\]

### 5.3 Interpretation

This posterior is not modeling "what goal is optimal in the abstract." It is modeling:

\[
\text{Which goal would make the observed actions look most consistent with the single-goal RL policy?}
\]

That is why the action likelihood is evaluated under the individual goal-conditioned RL policy.

## 6. Goal utility term

The committed agent also computes a simple utility for each goal based on joint distance:

\[
EU(g) = -\left[d(x^{A}, g) + d(x^{H}, g)\right].
\]

This is implemented as negative joint Manhattan distance, so:

- a closer common goal has higher utility,
- a farther common goal has lower utility.

The utility values are transformed into a softmax distribution:

\[
W_{\text{EU}}(g) =
\frac{\exp(\beta_{\text{EU}} EU(g))}
{\sum_{g' \in G} \exp(\beta_{\text{EU}} EU(g'))},
\]

with \(\beta_{\text{EU}} = 1.0\).

## 7. Combining utility and inferred intent

Before the explicit commitment gate is applied, the agent forms a proposal distribution over goals:

\[
\tilde{W}(g) \propto W_{\text{EU}}(g)\,P_t(g).
\]

After normalization:

\[
W(g) = \frac{\tilde{W}(g)}{\sum_{g' \in G}\tilde{W}(g')}.
\]

Interpretation:

- \(P_t(g)\) says which goal best explains the observed behavior.
- \(W_{\text{EU}}(g)\) says which goal is best in terms of current joint distance.
- Their product prefers goals that are both inferred and jointly efficient.

If there were no special commitment rule, the agent would simply sample:

\[
g_t \sim W(g).
\]

## 8. Commitment bias after a new goal appears

This is the core committed-agent equation.

Once an old shared goal \(g_{\mathrm{old}}\) exists and a new goal is present, the code computes a score:

\[
S(g) = EU(g) + \log P_t(g).
\]

In implementation, the log uses a floor:

\[
S(g) = EU(g) + \log(\max(P_t(g), \varepsilon)).
\]

Then it compares the old shared goal against the best available alternative:

\[
\Delta S = S(g_{\mathrm{old}}) - \max_{g \neq g_{\mathrm{old}}} S(g).
\]

The probability of sticking with the old goal is:

\[
P(\text{choose old}) =
\sigma\left(\logit(0.8) + \kappa \Delta S\right),
\]

where:

\[
\sigma(z) = \frac{1}{1+e^{-z}},
\qquad
\logit(0.8) = \log\frac{0.8}{0.2} = \log 4.
\]

The only free commitment parameter in the code is:

\[
\kappa = 0.5
\]

by default.

### 8.1 Why the baseline is 0.8

If \(\Delta S = 0\), then:

\[
P(\text{choose old}) = \sigma(\logit(0.8)) = 0.8.
\]

So even when the old goal and the best alternative are equally attractive under the score \(S(g)\), the agent still keeps an 80% tendency to remain committed.

### 8.2 Effect of \(\kappa\)

- If \(\kappa = 0\), the agent ignores the score difference and always uses a fixed 80% commitment rate.
- If \(\kappa > 0\), commitment becomes sensitive to evidence.
- Larger \(\kappa\) means small changes in \(\Delta S\) produce larger changes in sticking probability.

For example:

\[
\Delta S = 2
\quad \Rightarrow \quad
P(\text{choose old}) = \sigma(\log 4 + 0.5 \cdot 2) \approx 0.916.
\]

\[
\Delta S = -2
\quad \Rightarrow \quad
P(\text{choose old}) = \sigma(\log 4 - 1) \approx 0.595.
\]

So the old goal keeps a strong prior advantage, but sufficiently bad evidence can still reduce commitment.

## 9. Final action-selection algorithm

Putting the pieces together, after shared-goal detection and new-goal presentation:

1. Infer posterior \(P_t(g)\) from observed actions.
2. Compute distance utility \(EU(g)\).
3. Compute combined proposal weights \(W(g)\propto \text{Softmax}(EU(g))P_t(g)\).
4. Compute the old-goal stickiness probability
   \[
   p_{\mathrm{old}} = \sigma(\logit(0.8) + \kappa \Delta S).
   \]
5. With probability \(p_{\mathrm{old}}\), choose \(g_{\mathrm{old}}\).
6. Otherwise, sample among the remaining goals with weights proportional to \(W(g)\).
7. Once a goal \(g_t\) is selected, move with the individual RL policy toward that goal:
   \[
   a_t^{A} \sim \pi_{\text{ind}}(\cdot \mid x_t^{A}, g_t).
   \]

This makes the committed agent a hybrid model:

- joint RL early,
- Bayesian goal inference in the middle,
- commitment-biased goal choice after the environment changes,
- individual RL motion once the goal has been chosen.

## 10. What the model is really assuming

The math encodes a specific cognitive story:

1. Both agents' actions reveal which goal is currently intended.
2. Jointly closer goals are more attractive.
3. Once a shared plan has formed, the old shared goal gets inertia.
4. That inertia is not absolute; it is modulated by evidence through \(\Delta S\).

In plain language, the committed agent says:

"I infer what goal we seemed to be coordinating on, I compare that to new alternatives, and I still favor staying with the old plan unless the evidence against it is strong."

## 11. Important implementation caveats in the current code

These points matter if you are using this document to interpret behavior from the live code.

### 11.1 Missing likelihood helper in `RLAgent`

The Bayesian update calls:

\[
\texttt{this.rl.getIndividualActionProbabilities(pos, goal)}
\]

inside `CommittedAgent._actionLikelihood(...)`.

However, the current `RLAgent` class does not define `getIndividualActionProbabilities(...)`. So the intended Bayesian math is clear, but the supporting helper is absent in the current implementation. In other words:

- the probabilistic model is specified,
- but one required RL likelihood API is currently missing from the live class.

This is the single most important code-level caveat.

### 11.2 The "forceJoint" extra argument is not used by `RLAgent`

`CommittedAgent.getAIAction(...)` calls:

```js
this.rl.getAIAction(gameState?.gridMatrix, aiPos, goals, humanPos, { forceJoint: true })
```

but the current `RLAgent.getAIAction(...)` signature does not use that fifth argument. In practice the early-phase behavior is still joint because the config usually keeps `CONFIG.game.agent.type === 'joint'`, but mathematically the forced-joint behavior is relying on configuration rather than an explicit API guarantee.

### 11.3 The committed agent is mainly used as fallback policy

In the current experiment flow, the committed agent is typically used when LLM/VLM action generation fails and the fallback policy is set to `committedAgent`. So in the present system it is best described as:

\[
\text{LLM/VLM fallback policy with commitment bias},
\]

not as the only default agent in all modes.

## 12. Short summary

The committed agent implements:

\[
P_t(g) \propto P_{t-1}(g)\prod_{\text{observed players } i}\pi_{\text{ind}}(a_t^i \mid x_t^i, g),
\]

\[
EU(g) = -\left[d(x^{A}, g)+d(x^{H}, g)\right],
\]

\[
W(g) \propto \text{Softmax}(EU(g))\,P_t(g),
\]

\[
P(\text{choose old}) = \sigma\left(\logit(0.8) + \kappa\left[S(g_{\mathrm{old}})-\max_{g\neq g_{\mathrm{old}}}S(g)\right]\right),
\]

with

\[
S(g) = EU(g) + \log P_t(g).
\]

After choosing a goal, it uses ordinary individual RL to move toward that goal.

That is the math of the committed agent in this repository.
