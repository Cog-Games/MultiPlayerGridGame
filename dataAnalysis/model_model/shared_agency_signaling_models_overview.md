# Shared-Agency Signaling Models Discussed

This note summarizes the signaling models considered for the shared-agency model. The common backbone is:

$$
g_t^* \sim W_\lambda(g)
$$

$$
\pi(a_t \mid s_t)
=
\sum_g
W_\lambda(g)
\pi(a_t \mid s_t,g)
$$

The signaling variants differ only in the conditional action policy after a goal has been sampled.

## Common Listener Model

For any candidate action, a listener updates its belief over joint goals:

$$
P_t(g \mid a)
=
\frac{
P_t(g)\pi_{\mathrm{base}}(a \mid s_t,g)
}{
\sum_{g'}
P_t(g')\pi_{\mathrm{base}}(a \mid s_t,g')
}
$$

The base policy is the unshaped JointRL marginal own-action policy:

$$
\pi_{\mathrm{base}}(a^i \mid s_t,g)
=
\sum_{a^{-i}}
\pi_{\mathrm{joint}}(a^i,a^{-i} \mid s_t,g)
$$

## 1. No Signaling

The agent moves according to the base policy for the sampled goal:

$$
\pi(a \mid s_t,g)
=
\pi_{\mathrm{base}}(a \mid s_t,g)
$$

This is the baseline for isolating the effect of the signaling component.

## 2. Bernoulli Mixture Signaling

With probability `p`, the agent takes a deterministic legible progress action; otherwise it follows the committed/base action.

$$
\pi(a \mid s_t,g)
=
(1-p)
\pi_{\mathrm{base}}(a \mid s_t,g)
+
p
\delta_{a_{\mathrm{leg}}(g)}(a)
$$

The legible action is the progress action that maximizes listener posterior for the sampled goal:

$$
a_{\mathrm{leg}}(g)
=
\arg\max_{a \in \mathcal{A}^{+}(g)}
P_t(g \mid a)
$$

where:

$$
\mathcal{A}^{+}(g)
=
\{a : d(x_t+a,g) < d(x_t,g)\}
$$

## 3. RSA / Log-Posterior Signaling

The action policy is reweighted by the posterior probability assigned to the sampled goal after the action:

$$
\pi(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
P_t(g \mid a)^\alpha
$$

Equivalently:

$$
\pi(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
\exp
\left[
\alpha \log P_t(g \mid a)
\right]
$$

## 4. Trajectory-Level RSA

The model evaluates action sequences rather than single actions:

$$
\mathbf a
=
(a_t,\ldots,a_{t+H-1})
$$

Sequence utility combines base movement likelihood and accumulated listener posterior:

$$
\log \pi(\mathbf a \mid g)
=
\sum_u
\log \pi_{\mathrm{base}}(a_u \mid s_u,g)
+
\alpha
\sum_u
\log P_u(g \mid a_{t:u})
+C
$$

The model marginalizes over sequences to obtain the first-action policy.

## 5. Uncertainty-Gated RSA

Signaling strength is larger when goal belief is uncertain:

$$
\rho_t
=
\rho_{\max}H(P_t)
$$

where normalized entropy is:

$$
H(P_t)
=
-
\frac{
\sum_g P_t(g)\log P_t(g)
}{
\log |\mathcal{G}_t|
}
$$

The action policy mixes base movement with an RSA speaker:

$$
\pi(a \mid s_t,g)
=
(1-\rho_t)
\pi_{\mathrm{base}}(a \mid s_t,g)
+
\rho_t
\pi_{\mathrm{RSA}}(a \mid s_t,g)
$$

## 6. Information-Gain Signaling

The agent prefers actions that improve the listener's belief state.

Posterior-lift version:

$$
S_{\mathrm{lift}}(a,g)
=
\log P_t(g \mid a)
-
\log P_t(g)
$$

Entropy-reduction version:

$$
S_{\mathrm{entropy}}(a)
=
H(P_t)
-
H(P_t(\cdot \mid a))
$$

Policy:

$$
\pi(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
\exp
\left[
\eta S(a,g)
\right]
$$

## 7. Tie-Break / Value-Safe Signaling

The agent only signals among actions that are nearly value-equivalent:

$$
\mathcal{A}_{\mathrm{safe}}
=
\left\{
a :
Q(a)
\geq
\max_{a'}Q(a')-\epsilon
\right\}
$$

Within this safe set, the policy favors actions that increase listener belief in the sampled goal:

$$
\pi_{\mathrm{safe}}(a \mid s_t,g)
\propto
\mathbf{1}
[a \in \mathcal{A}_{\mathrm{safe}}]
\exp
\left[
\beta_L
\left(
\log P_t(g \mid a)
-
\log P_t(g)
\right)
\right]
$$

## 8. Costly Legibility Utility

The agent trades off base movement value and posterior lift:

$$
\pi(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
\exp
\left[
\eta
\left(
\log P_t(g \mid a)
-
\log P_t(g)
\right)
\right]
$$

This allows locally costly actions if they increase the partner's belief in the sampled goal.

## 9. Log-Odds Legibility

Legibility is the log odds of the sampled goal against all alternatives:

$$
L_t(a,g)
=
\log P_t(g \mid a)
-
\log
\sum_{g' \neq g}
P_t(g' \mid a)
$$

Policy:

$$
\pi(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
\exp
\left[
\eta L_t(a,g)
\right]
$$

This was theoretically clean, but the empirical increase in signaling metrics was modest.

## 10. Communicative Action Mixture (Legibility Over Alternatives)

First construct a communicative policy:

$$
\pi_{\mathrm{comm}}(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
\exp
\left[
L_t(a,g)
\right]
$$

Then mix base and communicative policies:

$$
\pi_{\mathrm{CAM}}(a \mid s_t,g)
=
(1-\rho)
\pi_{\mathrm{base}}(a \mid s_t,g)
+
\rho
\pi_{\mathrm{comm}}(a \mid s_t,g)
$$

This is the current full shared-agency signaling model. The name refers directly to the formula: actions are sampled from a mixture of the efficient base policy and a communicative policy, and communicative value is the sampled goal's legibility over alternative goals.

## 11. Opportunity-Gated Communicative Action Mixture

This model gates communicative action mixture signaling by both uncertainty and local signaling opportunity.

Uncertainty:

$$
H(P_t)
=
-
\frac{
\sum_g P_t(g)\log P_t(g)
}{
\log |\mathcal{G}_t|
}
$$

Opportunity:

$$
O_t(g)
=
1-\exp
\left[
-
\left(
\max_a L_t(a,g)
-
\min_a L_t(a,g)
\right)
\right]
$$

Gate:

$$
\rho_t
=
\rho_{\max}H(P_t)O_t(g)
$$

Policy:

$$
\pi(a \mid s_t,g)
=
(1-\rho_t)
\pi_{\mathrm{base}}(a \mid s_t,g)
+
\rho_t
\pi_{\mathrm{comm}}(a \mid s_t,g)
$$

## 12. Goal-Contrast Signaling

This model asks whether an action distinguishes the sampled goal from the most relevant competing goal rather than from all alternatives.

For the new-goal task, the contrast goal is the previous shared goal when the sampled goal is not the shared goal; when the sampled goal is the previous shared goal, the contrast is the new goal.

$$
L^{\mathrm{contrast}}_t(a,g)
=
\log P_t(g \mid a)
-
\log P_t(g_{\mathrm{contrast}} \mid a)
$$

The current implementation uses the same mixture form as Communicative Action Mixture:

$$
\pi(a \mid s_t,g)
=
(1-\rho)
\pi_{\mathrm{base}}(a \mid s_t,g)
+
\rho
\pi_{\mathrm{contrast}}(a \mid s_t,g)
$$

where:

$$
\pi_{\mathrm{contrast}}(a \mid s_t,g)
\propto
\pi_{\mathrm{base}}(a \mid s_t,g)
\exp
\left[
L^{\mathrm{contrast}}_t(a,g)
\right]
$$

## 13. One-Step Deliberate Signal Then Act

This model assumes that deliberate signaling is concentrated immediately after the new goal appears.

Let `r_t` be the number of steps after new-goal presentation. The policy is:

$$
\pi(a \mid s_t,g)
=
\begin{cases}
(1-\rho)
\pi_{\mathrm{base}}(a \mid s_t,g)
+
\rho
\pi_{\mathrm{comm}}(a \mid s_t,g),
&
r_t=1
\\
\pi_{\mathrm{base}}(a \mid s_t,g),
&
\mathrm{otherwise}
\end{cases}
$$

This model keeps commitment unchanged and allows one explicit communicative move before returning to efficient goal-directed movement.
