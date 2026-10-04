# Two kids play：SA fallback 与分析数据检查（2026-10-04）

修改位于 `kids` 工作目录；已推送修复，线上 Render 部署状态仍待登录确认。没有修改既有参与者数据；浏览器验证产生的记录均以 `DEPLOY-TEST-` 命名且 `isTestSession=true`，分析时应排除。

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
