# Committed Agent: Methods / Model

We modeled the committed agent as a two-stage policy operating in the `2P3G` task. Before a shared goal had been detected, or before the new goal appeared, the agent followed the same joint RL policy as the baseline model. After a shared goal had been detected and a new goal was introduced, the agent selected among currently available joint goals by combining inferred joint-goal intent with current joint utility.

At each step \(t\), the agent maintained a posterior over goals,
\[
P_t(g)=P(g \mid \text{action history up to } t),
\]
which was updated from the observed actions of both players using the restricted joint RL policy as the likelihood model:
\[
P_t(g)\propto P_{t-1}(g)\,
\pi_{\mathrm{joint}}^A(a_t^A\mid x_t^A,x_t^H,\{g\})\,
\pi_{\mathrm{joint}}^H(a_t^H\mid x_t^H,x_t^A,\{g\}).
\]

For each candidate joint goal \(g\), we defined a joint-distance utility
\[
EU(g)= -\bigl(d(x_t^A,g)+d(x_t^H,g)\bigr),
\]
where \(d(\cdot,\cdot)\) is Manhattan distance. After the new goal appeared, the agent re-sampled a joint goal at each step according to
\[
W_\lambda(g)\propto \exp(\beta EU(g))\,P_t(g)^\lambda.
\]
Here, \(\beta\) controls sensitivity to joint utility and was fixed to \(1.0\), while \(\lambda\) controls how strongly joint-goal choice depends on inferred prior/shared intent. When \(\lambda=0\), the model ignores inferred intent and selects based only on utility; larger values of \(\lambda\) produce stronger commitment to the inferred prior joint-goal structure.

After sampling a joint goal for the current step, the agent executed movement using the AI component of the joint RL policy restricted to that single sampled joint goal. The sampled goal was not fixed; posterior inference and goal sampling were repeated on the next step. Thus, the post-switch action policy is a mixture over candidate joint goals:
\[
P(a_t^A)=\sum_g W_\lambda(g)\,\pi_{\mathrm{joint}}^A(a_t^A\mid x_t^A,x_t^H,\{g\}).
\]
Here, \(\pi_{\mathrm{joint}}^A\) denotes the focal agent's own action component extracted from the joint RL policy.

We fit the single free parameter \(\lambda\) using pure human-human `2P3G` data. Only trials in which a new goal was presented and a shared goal had been detected were included. For each post-new-goal decision step, we reconstructed the posterior \(P_t(g)\), computed \(EU(g)\), and evaluated the likelihood of the observed human action under the mixture policy above. We then estimated \(\lambda\) by minimizing the negative log-likelihood across all step-level observations:
\[
\mathcal{L}(\lambda)=\sum_t \log \left(\sum_g W_\lambda(g)\,\pi_{\mathrm{joint}}^A(a_t\mid x_t^A,x_t^H,\{g\})\right).
\]

Using 189 unique human-human `2P3G` room-trials (1532 step-level post-new-goal observations), the fitted value was
\[
\hat{\lambda}=6.37,
\]
indicating that human post-switch choices were strongly modulated by inferred prior/shared intent.
