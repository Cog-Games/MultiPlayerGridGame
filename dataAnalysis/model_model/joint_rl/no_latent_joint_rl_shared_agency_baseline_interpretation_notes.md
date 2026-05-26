# No-Latent JointRL / Shared-Agency Baseline Interpretation Notes

本文档记录 `shared_agency_joint_lambda_alpha_baseline_comparison.html` 中两个容易误解的 baseline 问题。

## 1. 为什么 Equal-to-Both 条件下 commitment 不一定是 50%

当前 report 中的 commitment 定义是：

$$
\mathrm{commitment}=1[\mathrm{finalReachedGoal}=\mathrm{firstDetectedSharedGoal}]
$$

这个指标不是一个纯粹的二选一指标。New goal 出现后，模型实际面对的是 3 个 goals：

1. `firstDetectedSharedGoal`
2. `newGoal`
3. 另一个 old goal

在 Equal-to-Both 条件下，`firstDetectedSharedGoal` 和 `newGoal` 的 joint distance / EU 可以接近相等，因此这两个目标之间确实应该接近 50/50。但是第三个 old goal 仍然在当前 goal set 和 policy 中，没有被移除。

当前 raw count 说明这一点：

| Model | Commit to old shared | Switch to new | Go to other old | Old shared vs new rate |
| --- | ---: | ---: | ---: | ---: |
| Joint RL | 82 | 83 | 15 | 82 / (82 + 83) = 49.7% |
| Shared agency no commitment no signaling | 78 | 79 | 23 | 78 / (78 + 79) = 49.7% |

所以，old shared vs new 这两个目标之间基本是 50%。但当前 commitment 指标把 `other old` 也算作 non-commitment，因此总体 commitment 会低于 50%。

结论：50% baseline 只适合解释 `old shared` vs `new goal` 的二选一比较；如果使用当前三目标环境下的 post-hoc commitment 指标，整体 commitment 不一定等于 50%。

## 2. Signaling Move 的 baseline 不是 50%

当前 signaling move 的定义是第一步动作是否提供排他性的目标证据：

$$
1[
d(s_{t+1}, g_{\mathrm{final}}) < d(s_t, g_{\mathrm{final}})
\ \mathrm{and}\
d(s_{t+1}, g_{\mathrm{other}}) \ge d(s_t, g_{\mathrm{other}})
]
$$

也就是说，动作必须同时满足：

1. 更接近最终到达的目标。
2. 没有同时更接近对照目标。

因此 signaling move 不是“选择 old goal 还是 new goal”的二选一指标，chance baseline 不自然是 50%。原因包括：

- Grid action 有 4 个方向，不是二选一。
- 有些动作会同时更接近两个目标，这种动作虽然 task-efficient，但不算 signaling move。
- 有些动作对两个目标距离都不变，也不算 signaling move。
- 只考虑 action EU 的模型优化的是到达目标和效率，不优化让 partner 更容易 infer 自己的目标。

因此，action-EU-only 的合理 baseline 应该是 alpha = 0 / no-signaling model 的 empirical rate，而不是固定 50%。

当前 Equal-to-Both 条件下：

| Group | Signaling Move |
| --- | ---: |
| Joint RL | 41.39% |
| Shared agency no commitment no signaling | 37.78% |
| Human-Human | 59.38% |

解释上，Joint RL 和 no-signaling shared-agency model 的 signaling move rate 表示“仅由 task/action EU 产生的 legibility”。Human-Human 高于这个 baseline 的部分，更适合作为 intentional signaling 或 shared-agency behavior 的证据。
