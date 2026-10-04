# Two kids play：SA fallback 与分析数据检查（2026-10-04）

修改位于 `kids` 工作目录；线上 Render 部署状态仍待登录确认。没有修改既有参与者数据；浏览器短程验证记录均为 `isTestSession=true`，包括 `DEPLOY-TEST-` 和自动生成的测试 ID，分析时应排除。

## SA 的对照依据

`collabAIdata/outputs/tier0_analysis_frame_20260920/sa_parameter_audit.csv` 中，儿童 SA 数据的模型版本是 `local-fallback-2026-05-28`，参数为 lambda=0.2、alpha/rho=0.5、beta=3。
对应程序为相邻仓库 `nsfExp1.1-nodeGameVersion/js/sharedAgencyAgent.js`，底层策略为 `rlAgent.js` 中的 `getSoftmaxOptimalJointRLActionFast`。

原 two-kid 程序虽然使用同样的参数，但 `AlwaysSignalAgent` 的后验更新、新目标处理和动作分布不是这份实际采数实现。现在儿童模式的 `alwaysSignalAgent` 通过 `KidSharedAgencyAgent` 调用保留原文的决策核心和 fast RL；非儿童模式不受影响。

- `kidPartner=human` 的 fallback 固定为 SA；旧的 `ai`/`kidAI` 链接参数不会把 two-kid fallback 换成另一种模型。
- `kidPartner=committed` 默认使用同一 SA 工厂；显式选择其他实验 agent 的入口仍保留。
- 适配层把 canonical 玩家 1/2 映射到旧程序的 human/AI，不改变模型运算。
- 同步移动时，旧模型能观察本次尚未执行的人类动作；记录层只记录一次。AI 已到目标或人类撞墙时不新增 SA 决策。
- 保留原模型在新增目标时重置后验并重新处理人类动作历史的行为，没有将其替换为另一种算法。
- 原模型的 `useUnshapedJointRL=true` 元数据与底层 fast planner 的 proximity reward 0.02 并不完全吻合。这里保留实际运行的代码及原始元数据，避免仅按参数标签换用不同策略。

`client/src/ai/kidSaReference/source-manifest.json` 保存了原始文件 SHA-256。固定种子样例从相邻仓库原文件独立运行生成，覆盖同步输入、独立移动、新目标出现和两种 AI 玩家位置。模型版本、参数、每次决策及适配层版本写入 trial。

## 数据修复

- fallback 状态持续到后续合作 trial，记录原因、时点、阶段和 AI 玩家位置；不会错误标记之前的单人热身。
- 每个真人同步回合同时传递主端动作记录与棋盘状态，客端接管后保留此前的真人动作、新目标和计时；忽略过期回合以及接管后的迟到状态包。
- 断线接管停止旧 inactivity 计时器，防止重复 fallback；第二位孩子接管后继续看到自己为红点。
- 模型始终接收当前 trial 的稳定记录对象，避免临时副本导致每步重置后验及丢失模型元数据、决策历史。
- trial 途中接管保留动作边界，`mixedPartnerTrial=true`，并保存 `partnerAgentTypeAtTrialStart`，避免把真人片段误当成纯 SA。
- 每个 trial 使用独立的数据对象，保存时深拷贝；模型决策历史和新目标元数据不再串到下一 trial。异步 checkpoint 同样使用快照。
- trial 超过 60 秒时保持原计时起点。
- 保留退出匹配前的 roomId，供配对分析追踪。
- 新 schema 为 `kids-canonical-events-v1`。旧的轨迹/动作/RT 数组仍然保留，轨迹为动作前位置，RT 为从 trial 起点到动作应用的累计毫秒。双人同步模式的 RT 包含等待另一位玩家的时间，不能解释为纯按键反应时。
- 每步追加 `moveEvents`：序号、round、canonical 玩家、累计时间、动作前后位置、请求/实际动作、当时可见目标、实际控制类型。
- 新目标记录 round、毫秒、出现前事件数、出现时双方位置及已有生成几何信息。
- Excel 的 `MoveEvents` 独立工作表保存动作流水，避免单个 cell 的 32767 字符上限。`ExperimentData` 保留分析字段，含 `rlAgentType`、连续年龄及 fallback 标记。
- 完整 JSON 写入 final checkpoint；Excel 库不可用或导出报错时提供 JSON 下载。

## collabAIdata 读取

最新 `dyad_coordination_process.reconstruct` 仍把所有 Kids 当作旧格式：human 固定玩家 1，2P3G 的 AI 动作成对重复。新 two-kid 导出不满足这个假设。**不要直接把新文件塞进旧 kids 重建分支，也不要制造重复动作来迎合它。**

使用 `scripts/collab_ai_data_adapter.py`：

```python
import sys
sys.path.insert(0, '/path/to/kids-balanced-new-goals/scripts')
from collab_ai_data_adapter import load_trials, reconstruct

rows = load_trials('new_export.xlsx')  # 也支持完整 JSON / trial checkpoint
events, reveal = reconstruct(rows[0])
# events 可交给 collabAIdata 的 snapshots、prospective、build_states、actor_first_moves
```

或验证并导出事件：

```bash
python3 scripts/collab_ai_data_adapter.py new_export.xlsx --output /tmp/trial-events.json
```

读取器按真实事件序号和 round 重建，验证轨迹、动作、RT、玩家次序、新目标可见性和终点一致性，支持儿童为玩家 2。真人 dyad 使用固定 canonical P1/P2；混合 trial 的事件保留实际 actor_type。比较纯条件时应排除或分段处理 `mixedPartnerTrial`。

这次增加了读取器并用最新分析函数验证接口；没有改写 collabAIdata 已冻结的样本、notebook 或统计结果。要把新一批数据纳入旧 notebook，需要在其数据加载入口选用此读取器，并按实际研究设计处理真人双人和混合 trial。

## 验证与限制

35 项测试全部通过，`npm run build` 成功。回归覆盖 SA 一致性、fallback 跨 trial/角色、数据隔离、长 trial 时钟、Excel 事件表和 JSON 降级下载。另用合成数据做 Excel/JSON 往返，并实际调用本地 collabAIdata 的 `snapshots`、`prospective`、`build_states` 和 `actor_first_moves`。

复现验证（从 kids 工作目录运行）：

```bash
KIDS_TEST_EXPORT_PATH=/tmp/kids-export-fixture.json npm test
python3 scripts/validate-kids-analysis.py --collab-data ../../../collabAIdata
npm run build
```

已使用本地生产构建和实际 Socket.IO 服务完成浏览器验证：等待后 SA fallback、两页真人匹配/同步、主端断线后由 SA 控制 canonical P1、第二位孩子继续控制红点、协作成功及 Excel 导出。短测试入口的八轮配额冲突已修复；正式八轮配额不变。

最终测试 `DEPLOY-TEST-H-20261004` 的 2P3G trial 协作成功：26 个动作事件（接管前 2 个真人事件）、12 条 SA 决策，fallback 仅一次且发生在 eventIndex=2。导出包含 `local-fallback-2026-05-28`、lambda=0.2、alpha=0.5、beta=3 及模型完整参数。该次未触发新目标；新目标时序由固定参考与合成往返测试覆盖。

[Drive 最终测试文件](https://docs.google.com/spreadsheets/d/11YjDV_eoUY-egHZUbOOXwCLSrTc9Tkad/edit) 已重新下载，与浏览器本地导出逐字节一致，SHA-256 为 `9bf5e0ad58e94836afd8b9d6b75451100df0985836c8924de5cf3571648b2567`。该真实导出通过 adapter 重建，并调用最新 collabAIdata 产生 26 个 snapshots、13 个 states 和 26 次 prospective 计算。

较早测试 A/C/E 用于定位问题，不能视为最终版本验证数据；所有 DEPLOY-TEST 文件均为合成测试，应从研究样本排除。没有删除这些审计记录。

目前验证的是 localhost 生产构建，不等于线上 Render 已部署。Render 登录停留在 GitHub 账号选择，自动审批拒绝使用个人账号（仓库属于 Cog-Games），等待用户确认部署账号或提供线上地址。现有 Apps Script 使用 `no-cors`，正常客户端仍将状态标为 `sent_unconfirmed` 并保留本地 checkpoint；本次另通过 Drive 读回独立确认了落盘。

## 首步/新目标卡顿修复

原 fast planner 在首次遇到一个目标时同步构建 50,625 状态、810,000 Q 值，阻塞浏览器主线程。SA 按一个抽样目标调用 planner；首次抽到新目标会再次触发计算。

`kidSaPlanner.js` 预先计算不变的转移和奖励、只排序一次状态顺序，保留 Float32 Q/V、Gauss-Seidel 更新顺序、停止条件和抽样次序。参考文件与 SA 决策核心不改动。四组角落、内部与双目标测试对全部 Q 值做完全相等比较；原固定随机种子的模型行为测试也通过。

本机 Node 单目标冷启动测量为 398–1371 ms → 21–59 ms；不是所有浏览器/设备的性能保证。开局两个目标在 trial 时钟开始前预热，不消耗随机数。新目标第一次采样仍同步计算，但使用优化实现。

移动门关闭时提前拒绝输入，避免先改变模型后验/随机数、再拒绝动作。新增 `sharedAgencyDecisionTimings` 与 `humanInputEvents`，分别记录规划耗时，以及按键处理开始到动作应用的延迟。既有 RT 仍保持原含义；不能用新字段倒推旧文件的纯按键时间。

优化后的本地 Chrome 2P3G 短程触发新目标并协作成功，导出重建通过：26 个事件、13 条实际 AI 动作、13 条模型历史；本轮规划耗时 0.1–0.3 ms，输入处理到应用 0–1 ms。本轮 AI 始终选择已预热目标，因此新目标冷启动耗时由上述独立基准验证。最终代码通过 39 项测试、生产构建和 Excel/JSON 分析接口验证。

## 单人基线条件与论文覆盖

发现 1P2G 旧配置禁止等距生成，却仍分配等距 trial；没有候选位置时旧实现随机放目标并保留原条件标签。新实现启用精确等距、严格保持 closer/farther 条件，无候选则等待后续位置，且以刚表达的目标为参照。保存参照目标、原/新距离、候选数与 `solo-intended-goal-strict-v1` 版本。旧数据不改写；分析必须从出现时的坐标重新计算距离，不应把旧标签当成几何事实，也不能认为每个参与者必然有有效等距单人 trial。

核对依据为 `AgencyGap_Main_Intro_Results_1001.docx`、`AgencyGap_SI_Appendix_1001.docx` 与 collabAIdata 当前源码。canonical 事件可支持成功率、效率、目标保持/改变、行动可读性、信号响应、冲突过程及单人基线。实际调用了 `score`、原 notebook 的无噪声 BToM 策略、`actor_first_moves`、`initiation`、`process_actor`、`signal_uptake`、`solo_scores`。

接入正式分析仍需在加载入口选用新 adapter，关联 session 的伙伴条件到单人 trial，生成统一参与者 ID、规范化问卷和标记测试/混合条件。既有 frozen notebook/样本未更改。旧时间数据混有计算延迟，旧模型历史可能包含未执行决策；不能据此宣称所有时间与逐步模型复现分析都完备。跨条件群体模型、self/cross-play 模拟、参数恢复等还需要各自的数据集。

匹配页 Enter 在满 10 秒后对普通和测试场次都生效，取消真人匹配并进入 SA，原因记录为 `teammate-wait-enter-skip`；本次保留此行为。
