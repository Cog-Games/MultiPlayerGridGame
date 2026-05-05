// AiVsAiOrchestrator
//
// Headless driver that runs a full experiment sequence with two AI agents as
// player1 and player2. Reuses the existing GameStateManager / ExperimentManager
// / RLAgent / GptAgentClient / WeIntentAgent modules; no edits to those files.
//
// Enable via CONFIG.modelExp.enabled === true (set via `?modelExp=1`).
// See client/src/config/gameConfig.js for the modelExp block.

import { CONFIG, GameConfigUtils } from '../config/gameConfig.js';
import { GameHelpers } from '../utils/GameHelpers.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function actionDeltaToDirection(action) {
  if (!Array.isArray(action) || action.length < 2) return null;
  const [dr, dc] = action;
  if (dr === -1 && dc === 0) return 'up';
  if (dr === 1 && dc === 0) return 'down';
  if (dr === 0 && dc === -1) return 'left';
  if (dr === 0 && dc === 1) return 'right';
  return null;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function estimateOpenAICostUsd(modelName, promptTokens, completionTokens) {
  const model = String(modelName || '').trim();
  const pricing = {
    'gpt-4.1': { input: 2.00, output: 8.00 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 }
  };
  const rates = pricing[model] || pricing['gpt-4o-mini'];
  return ((toFiniteNumber(promptTokens) / 1_000_000) * rates.input) +
    ((toFiniteNumber(completionTokens) / 1_000_000) * rates.output);
}

export class AiVsAiOrchestrator {
  constructor({ gameStateManager, experimentManager, rlAgent, gptClient,
                vlmClient, weIntentAgent, uiManager = null } = {}) {
    this.gameStateManager = gameStateManager;
    this.experimentManager = experimentManager;
    this.rlAgent = rlAgent;
    this.gptClient = gptClient;
    this.vlmClient = vlmClient;
    this.weIntentAgent = weIntentAgent;
    this.uiManager = uiManager;
    this.onComplete = null;
    this.lastRemoteAgentRequestAt = 0;
  }

  /**
   * Drive the full experiment sequence declared in CONFIG.game.experiments.order
   * with both sides playing their configured modelExp agent.
   * Returns when every trial across every experiment has been finalized.
   */
  async run() {
    const cfg = CONFIG.modelExp || {};
    const experiments = Array.isArray(CONFIG?.game?.experiments?.order)
      ? CONFIG.game.experiments.order.slice()
      : [];

    console.log(`[modelExp] Starting AI-vs-AI sweep: ${cfg.player1Agent} (p1) vs ${cfg.player2Agent} (p2)`);
    console.log(
      `[modelExp] Experiments: ${experiments.join(', ')} | reps=${cfg.repetitionsPerMap} | ` +
      `stepDelay=${cfg.stepDelayMs}ms | serializeRemote=${Boolean(cfg.serializeRemoteAgentCalls)} | ` +
      `remoteSpacing=${Number(cfg.remoteAgentMinRequestSpacingMs) || 0}ms`
    );

    for (const expType of experiments) {
      await this.runExperiment(expType);
    }

    console.log('[modelExp] All experiments complete. Export will be triggered by caller.');
    if (typeof this.onComplete === 'function') {
      try { await this.onComplete(); } catch (e) { console.warn('[modelExp] onComplete handler failed:', e); }
    }
  }

  async runExperiment(expType) {
    const cfg = CONFIG.modelExp || {};
    const totalTrials = GameConfigUtils.getNumTrials(expType);
    const reps = Math.max(1, Number(cfg.repetitionsPerMap) || 1);

    for (let rep = 0; rep < reps; rep++) {
      for (let trialIndex = 0; trialIndex < totalTrials; trialIndex++) {
        // ExperimentManager owns map sampling; ask it for the design so we
        // match the same selection logic as the human flow.
        let design;
        try {
          design = await this.experimentManager.getTrialDesign(expType, trialIndex);
        } catch (e) {
          console.error(`[modelExp] getTrialDesign failed for ${expType}[${trialIndex}]:`, e);
          continue;
        }
        if (!design) {
          console.warn(`[modelExp] No design for ${expType}[${trialIndex}], skipping.`);
          continue;
        }
        // Keep ExperimentManager's own trial index in sync so any of its
        // side-channel bookkeeping (condition sequences, etc.) stays valid.
        this.experimentManager.currentTrialIndex = trialIndex;

        await this.runTrial(expType, trialIndex, design, rep);
      }
    }
  }

  async runTrial(expType, trialIndex, design, repIndex) {
    const cfg = CONFIG.modelExp || {};
    this.gameStateManager.initializeTrial(trialIndex, expType, design);

    // Stamp agent metadata directly onto the live trialData reference so it
    // survives the deep-clone in finalizeTrial. getCurrentTrialData() returns
    // a shallow clone, so we mutate this.trialData via the gameStateManager.
    const liveTd = this.gameStateManager.trialData;
    liveTd.player1AgentType = cfg.player1Agent;
    liveTd.player2AgentType = cfg.player2Agent;
    liveTd.player1Model = this._modelLabelFor(cfg.player1Agent);
    liveTd.player2Model = this._modelLabelFor(cfg.player2Agent);
    liveTd.repetitionIndex = repIndex;
    liveTd.runId = repIndex + 1;
    liveTd.trialIndexWithinRun = trialIndex + 1;
    liveTd.modelExpMode = true;
    liveTd.seed = Number(cfg.seed || 0) + ((repIndex + 1) * 1000) + Number(liveTd.mapId || trialIndex + 1);
    // Use AI indices consistent with no-human game.
    liveTd.humanPlayerIndex = null;
    liveTd.aiPlayerIndex = null;
    liveTd.player1PromptTokens = 0;
    liveTd.player1CompletionTokens = 0;
    liveTd.player2PromptTokens = 0;
    liveTd.player2CompletionTokens = 0;
    liveTd.player1VlmCalls = 0;
    liveTd.player2VlmCalls = 0;
    liveTd.vlmMinRemainingRequests = null;
    liveTd.vlmMinRemainingTokens = null;
    liveTd.vlmRemoteApiCalls = 0;
    liveTd.trialTotalPromptTokens = 0;
    liveTd.trialTotalCompletionTokens = 0;
    liveTd.trialEstimatedCostUsd = 0;

    // Initial UI render for visualization if UIManager is attached.
    this._render();

    const maxSteps = Math.max(1, Number(cfg.maxStepsPerTrial) || 100);
    let timedOut = false;

    while (true) {
      const state = this.gameStateManager.getCurrentState();
      if (this._isTrialFinished(state)) break;

      let move1 = null, move2 = null;
      try {
        [move1, move2] = await this._pickStepMoves(state);
      } catch (e) {
        console.error(`[modelExp] Agent decision failed trial ${trialIndex}:`, e);
        break;
      }
      this._recordAgentUsage(liveTd, 1, move1);
      this._recordAgentUsage(liveTd, 2, move2);
      let dir1 = move1?.action || null;
      let dir2 = move2?.action || null;

      // If a player has already reached its goal, skip its move (processSynchronizedMoves
      // already no-ops when goal reached, so passing null is equivalent and avoids
      // superfluous RL/GPT calls).
      const p1AtGoal = GameHelpers.isGoalReached(state.player1, state.currentGoals);
      const p2AtGoal = GameHelpers.isGoalReached(state.player2, state.currentGoals);
      if (p1AtGoal) dir1 = null;
      if (p2AtGoal) dir2 = null;

      // If both are no-ops we'd loop forever; treat as done.
      if (!dir1 && !dir2) break;

      let result = this.gameStateManager.processSynchronizedMoves(dir1, dir2);
      // GameStateManager guards re-entrancy for 100ms. If a previous call is
      // still winding down, back off and retry once so we don't drop a step.
      if (result && result.success === false && result.reason === 'already_moving') {
        await sleep(120);
        result = this.gameStateManager.processSynchronizedMoves(dir1, dir2);
      }
      this._render();
      if (result && result.trialComplete) break;

      if (this.gameStateManager.stepCount >= maxSteps) {
        console.warn(`[modelExp] Trial ${trialIndex} hit maxStepsPerTrial=${maxSteps}`);
        timedOut = true;
        break;
      }

      // Always wait at least 110ms between joint steps (the isMoving debounce
      // is 100ms), plus any configured pacing on top.
      const minDelay = 110;
      const delay = Math.max(minDelay, Number(cfg.stepDelayMs) || 0);
      await sleep(delay);
    }

    // Determine success using the same rules as ExperimentManager.handleTrialComplete.
    const finalState = this.gameStateManager.getCurrentState();
    const finalTd = this.gameStateManager.getCurrentTrialData();
    let success;
    if (expType && expType.startsWith('1P')) {
      success = !!(finalState?.player1 && GameHelpers.isGoalReached(finalState.player1, finalState.currentGoals));
    } else if (GameConfigUtils.isStagHuntExperiment(expType)) {
      success = !!GameHelpers.evaluateStagHuntOutcome(finalState, finalTd)?.success;
    } else {
      success = !!GameHelpers.didBothPlayersReachSameGoal(finalState);
    }

    if (timedOut) this.gameStateManager.trialData.trialTimedOut = true;
    liveTd.trialTotalPromptTokens = toFiniteNumber(liveTd.player1PromptTokens) + toFiniteNumber(liveTd.player2PromptTokens);
    liveTd.trialTotalCompletionTokens = toFiniteNumber(liveTd.player1CompletionTokens) + toFiniteNumber(liveTd.player2CompletionTokens);
    const pricingModel = liveTd.player1BaseModel || liveTd.player2BaseModel || liveTd.player1Model || liveTd.player2Model;
    liveTd.trialEstimatedCostUsd = Number(
      estimateOpenAICostUsd(pricingModel, liveTd.trialTotalPromptTokens, liveTd.trialTotalCompletionTokens).toFixed(6)
    );

    try {
      if (typeof process !== 'undefined' && process.env && process.env.ENABLE_VLM_DEBUG === 'true') {
        console.log(
          `[VLM debug] ${expType}[${trialIndex}] rep=${repIndex} ` +
          `minRemReq=${liveTd.vlmMinRemainingRequests ?? 'n/a'} minRemTok=${liveTd.vlmMinRemainingTokens ?? 'n/a'} ` +
          `remoteCalls=${liveTd.vlmRemoteApiCalls ?? 0} ` +
          `tokensIn=${liveTd.trialTotalPromptTokens} tokensOut=${liveTd.trialTotalCompletionTokens}`
        );
      }
    } catch (_) { /* ignore */ }

    this.gameStateManager.finalizeTrial(success);

    // Brief console summary per trial.
    const mapId = finalTd.mapId ?? '-';
    const steps = this.gameStateManager.stepCount;
    const u = finalTd.utilitySummary || {};
    console.log(
      `[modelExp] ${expType}[${trialIndex}] rep=${repIndex} map=${mapId} success=${success} steps=${steps} ` +
      `p1Pts=${finalTd.player1RoundPoints ?? '-'} p2Pts=${finalTd.player2RoundPoints ?? '-'} ` +
      `goal1=${finalTd.player1FinalReachedGoal} goal2=${finalTd.player2FinalReachedGoal} ` +
      `stagBaseline=${u.stag_final_utility ?? '-'} hareBaseline=${u.hare_final_utility ?? '-'}`
    );
  }

  _isTrialFinished(state) {
    // Trial is finished when internal completion check reports done. Use a
    // zero-move probe by consulting the same predicate GameStateManager uses.
    try { return !!this.gameStateManager.checkTrialCompletion(); } catch (_) { return false; }
  }

  _render() {
    if (this.uiManager && typeof this.uiManager.updateGameDisplay === 'function') {
      try { this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState()); } catch (_) { /* ignore */ }
    }
  }

  _modelLabelFor(agentType) {
    if (agentType === 'gpt' || agentType === 'gpt-ToM') return CONFIG?.game?.agent?.gpt?.model || agentType;
    if (agentType === 'vlm' || agentType === 'vlm-ToM') return CONFIG?.game?.agent?.vlm?.model || agentType;
    if (agentType === 'gemini' || agentType === 'claude') return agentType;
    return agentType; // RL/WeAgent: label is the agent type itself
  }

  _recordAgentUsage(trialData, playerNum, moveOut) {
    if (!trialData || !moveOut || typeof moveOut !== 'object') return;
    const prefix = playerNum === 1 ? 'player1' : 'player2';
    const promptTokens = toFiniteNumber(moveOut?.usage?.prompt_tokens);
    const completionTokens = toFiniteNumber(moveOut?.usage?.completion_tokens);

    if (promptTokens > 0 || completionTokens > 0) {
      trialData[`${prefix}PromptTokens`] = toFiniteNumber(trialData[`${prefix}PromptTokens`]) + promptTokens;
      trialData[`${prefix}CompletionTokens`] = toFiniteNumber(trialData[`${prefix}CompletionTokens`]) + completionTokens;
      trialData[`${prefix}VlmCalls`] = toFiniteNumber(trialData[`${prefix}VlmCalls`]) + 1;
      trialData.vlmRemoteApiCalls = toFiniteNumber(trialData.vlmRemoteApiCalls) + 1;
    }

    const rate = moveOut?.rate;
    if (rate && typeof rate === 'object') {
      const rr = rate.remainingRequests;
      const rt = rate.remainingTokens;
      const rrn = rr !== undefined && rr !== null && rr !== '' ? Number(rr) : NaN;
      const rtn = rt !== undefined && rt !== null && rt !== '' ? Number(rt) : NaN;
      if (Number.isFinite(rrn)) {
        trialData.vlmMinRemainingRequests = trialData.vlmMinRemainingRequests == null
          ? rrn
          : Math.min(trialData.vlmMinRemainingRequests, rrn);
      }
      if (Number.isFinite(rtn)) {
        trialData.vlmMinRemainingTokens = trialData.vlmMinRemainingTokens == null
          ? rtn
          : Math.min(trialData.vlmMinRemainingTokens, rtn);
      }
    }

    if (moveOut?.baseModel) {
      trialData[`${prefix}BaseModel`] = moveOut.baseModel;
      trialData[`${prefix}Model`] = moveOut.baseModel;
    }
    if (moveOut?.model) {
      trialData[`${prefix}AgentLabel`] = moveOut.model;
    }
  }

  _isRemoteAgent(agentType) {
    return ['gpt', 'gpt-ToM', 'vlm', 'vlm-ToM', 'gemini', 'claude'].includes(String(agentType || ''));
  }

  async _waitForRemoteAgentSlot() {
    const cfg = CONFIG.modelExp || {};
    const minSpacingMs = Math.max(0, Number(cfg.remoteAgentMinRequestSpacingMs) || 0);
    if (minSpacingMs <= 0) {
      this.lastRemoteAgentRequestAt = Date.now();
      return;
    }

    const elapsed = Date.now() - this.lastRemoteAgentRequestAt;
    const remaining = minSpacingMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
    this.lastRemoteAgentRequestAt = Date.now();
  }

  async _pickDirectionWithOptionalThrottle(agentType, playerNum, state) {
    if (this._isRemoteAgent(agentType)) {
      await this._waitForRemoteAgentSlot();
    }
    return this._pickDirection(agentType, playerNum, state);
  }

  async _pickStepMoves(state) {
    const cfg = CONFIG.modelExp || {};
    const player1Agent = cfg.player1Agent;
    const player2Agent = cfg.player2Agent;
    const shouldSerializeRemote = Boolean(cfg.serializeRemoteAgentCalls) &&
      (this._isRemoteAgent(player1Agent) || this._isRemoteAgent(player2Agent));

    if (!shouldSerializeRemote) {
      return Promise.all([
        this._pickDirection(player1Agent, /*playerNum*/1, state),
        this._pickDirection(player2Agent, /*playerNum*/2, state)
      ]);
    }

    const move1 = await this._pickDirectionWithOptionalThrottle(player1Agent, /*playerNum*/1, state);
    const move2 = await this._pickDirectionWithOptionalThrottle(player2Agent, /*playerNum*/2, state);
    return [move1, move2];
  }

  async _pickDirection(agentType, playerNum, state) {
    // If this player is already at a goal, no-op.
    const selfPos = (playerNum === 1) ? state.player1 : state.player2;
    const partnerPos = (playerNum === 1) ? state.player2 : state.player1;
    if (!selfPos) return { action: null };
    if (GameHelpers.isGoalReached(selfPos, state.currentGoals)) return { action: null };

    const stateWithTrial = { ...state, trialData: this.gameStateManager.getCurrentTrialData() };

    switch (agentType) {
      case 'rl_individual':
      case 'rl_joint':
      case 'rl_individual_python': {
        if (!this.rlAgent) throw new Error('RL agent not initialized');
        // Temporarily force agent.type so legacy routing picks the right planner.
        const savedAgentType = CONFIG.game.agent.type;
        if (agentType === 'rl_joint') CONFIG.game.agent.type = 'joint';
        else CONFIG.game.agent.type = 'individual';
        try {
          const action = this.rlAgent.getAIAction(
            state.gridMatrix,
            selfPos,
            state.currentGoals,
            partnerPos,
            this.experimentManager.buildRLContext(state)
          );
          return { action: actionDeltaToDirection(action) };
        } finally {
          CONFIG.game.agent.type = savedAgentType;
        }
      }

      case 'we_intent_js': {
        if (!this.weIntentAgent) throw new Error('WeIntentAgent not initialized');
        const dir = this.weIntentAgent.getNextAction(stateWithTrial, { aiPlayerNumber: playerNum });
        return (dir && typeof dir === 'object') ? { ...dir, action: dir.action || null } : { action: dir };
      }

      case 'gpt':
      case 'gpt-ToM': {
        if (!this.gptClient) throw new Error('GPT client not initialized');
        const out = await this.gptClient.getNextAction(
          stateWithTrial,
          { aiPlayerNumber: playerNum, model: (agentType === 'gpt-ToM' ? 'gpt-ToM' : undefined) }
        );
        return (out && typeof out === 'object') ? { ...out, action: out.action || null } : { action: out };
      }

      case 'vlm':
      case 'vlm-ToM': {
        if (!this.vlmClient) throw new Error('VLM client not initialized');
        const out = await this.vlmClient.getNextAction(
          stateWithTrial,
          { aiPlayerNumber: playerNum, model: (agentType === 'vlm-ToM' ? 'vlm-ToM' : undefined) }
        );
        return (out && typeof out === 'object') ? { ...out, action: out.action || null } : { action: out };
      }

      case 'gemini':
      case 'claude':
        throw new Error(`[modelExp] Agent '${agentType}' not yet implemented (milestone 2).`);

      default:
        throw new Error(`[modelExp] Unknown agent type: ${agentType}`);
    }
  }
}
