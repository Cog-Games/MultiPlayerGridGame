# 固定 8 条＋动态配额

适用于 `kids` 分支。2P3G 总试次数保持 8，不补试。目标为 `closer_to_player1`、`closer_to_player2`、`equal_to_both` 和 `no_new_goal` 各 2 次。这里 close/far 的方向使用固定 P1/P2 身份，不能按每个浏览器的本地玩家重新解释。

## 分配方式

1. 开始前仍生成包含四种条件各两次的随机序列，**两个 no-new-goal 的位置固定保留**。双人模式继续使用双方共享的随机种子。其余六个位置为动态新目标试次；原先条件仅作为可追溯的预排标签。
2. 每次有效触发时，检查所有尚未满额的新目标条件。有效触发仍要求两位玩家尚未到达、至少检测过一次共同旧目标；优先使用当前共同旧目标，否则使用已记录的共同旧目标。
3. 每种条件内部先找严格解，无解才找之前定义的有限容错解。搜索期间不修改次数或距离偏差。
4. 在可行条件中先选择**剩余配额最多**的。缺口相同时优先 closer，把 equal 名额留给玩家重合等只能生成 equal 的情况；随后优先严格解，再随机打平。不同条件之间可以为了配额选择一个有容错解的条件，即使另一个条件存在严格解；同一条件内部仍始终优先严格解。
5. 实际把新目标加入棋盘并记录呈现后，该条件计数加 1；上限为 2。合作是否成功不参与配额更新。距离偏差仍按所选条件单独累计和抵消。
6. 未满额条件都无解则继续等待下一轮。试次结束仍未呈现时记为未呈现，不消耗任何新目标配额，也不变成 no-new-goal 控制试次。第 8 条后按既有流程结束，即使配额未齐。

这套在线规则只使用当前及此前的信息。它不能预知后续轨迹，因此不保证任意八条自由运动试次都恰好达到 2/2/2/2。不能将此前“事后寻找最佳分配”的结果作为在线保证。

## 关键文件和配置

- `client/src/utils/NewGoalQuotaScheduler.js`：三个条件的搜索、剩余配额排序与选择；规则版本为 `kids-fixed-eight-dynamic-quota-v1`。
- `client/src/config/gameConfig.js`：`CONFIG.twoP3G.conditionQuota.enabled = true`、`trialsPerCondition = 2`；`CONFIG.game.experiments.numTrials['2P3G'] = 8`。启用配额时检查总试次数等于四类配额总和，避免配置不一致。
- `client/src/experiments/ExperimentManager.js`：保留控制位置，在新目标实际呈现前调用调度器，仅由双人主机作决定。
- `client/src/game/GameStateManager.js`：次数来自已提交呈现的 `goalGenerationBalance[condition].generatedCount`，不再另存一套会失配的新目标计数；保存配额快照及试次结束汇总。

## 同步和数据含义

主机发送实际条件、预排条件、呈现轮次、所选位置和全部条件的累计状态。客机直接采用主机决定，不独立抽条件。绝对计数快照只接受更新的呈现次数，重复或旧包不会重复计数、回退偏差，迟到的两目标数据包不会把实际条件改回预排条件。仅收到最终 canonical trial 数据也可以恢复全部新目标次数。试次初始化保留计数；完整实验 reset 清零。状态仍在当前内存会话中保存。

导出的字段包括：

| 字段 | 含义 |
|---|---|
| `newGoalScheduledCondition` | 原预排序列条件；控制位置由此确定 |
| `distanceCondition`、`newGoalConditionType` | 呈现前为预排条件；呈现后更新为实际选中的条件 |
| `newGoalRealizedCondition` | 实际新目标条件；预设控制试次结束后为 `no_new_goal`；生成失败为 null |
| `newGoalConditionReassigned` | 是否从预排条件改分配为另一种新目标条件 |
| `newGoalAllocationPolicy` | 动态分配规则版本；与几何规则版本分开 |
| `newGoalQuotaAtTrialStart` | 本条开始前实际呈现的三类计数 |
| `newGoalQuotaBefore`、`newGoalQuotaAfter`、`newGoalQuotaTarget` | 本次呈现前后计数及三类目标配额 |
| `newGoalGenerationAttempts` | 每个不同轮次/状态的检查结果，包括三类候选数、剩余配额及不可行原因 |
| `newGoalMetadata` | 完整生成与配额选择信息，包括可行条件、最终抽选池、各条件累计状态 |
| `newGoalQuotaSummary` | 每条结束后的四类目标、实际计数、剩余缺口、已结束试次数、失败的新目标试次数和是否达到 2/2/2/2 |

新目标“实际次数”按呈现计数；控制次数按预设控制试次结束计数。`completed` 在原项目里与结果成功相关，因此不以 `completed=true` 筛选配额。导出器现有字段并集机制会带上上述新字段。

后续分析应使用实际条件和 `newGoalPresented`，同时保留预排条件、呈现位置/轮次及容错标志。按当前位置选择条件会让条件与生成前几何状态相关，不能把动态分配的数据当作原来预先完全随机分配的条件数据；历史 notebook 不应不加区分地直接合并这两种协议。

## 验证

运行 `npm test` 和 `npm run build`。18 项测试覆盖固定 8 条、每类配额上限、改分配、失败与控制的区分、按呈现而非合作成功计数、距离偏差补偿、跨试次状态、主客机同步、重复/迟到包及重置。

部署前另在浏览器中用两个独立 Socket.IO 客户端连接本地真实服务器，完成 8 条试次；双方均达到 2/2/2/2，重复同步和 canonical completion 保持计数一致。该检查未向外部保存实验数据。

历史轨迹机会回放脚本为 `scripts/replay-kids-dynamic-quota.mjs INPUT.json OUTPUT.json 100`。输入数据单独保管，不随代码提交；回放是固定路径上的机会检查，不模拟改变目标后的行为，也不代表未来成功概率。
