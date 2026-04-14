// Collaborative Agency Model (WeAgent)
// Implements the computational model from NSF Proposal Section 3.3, Aim 2
//
// Three phases of collaborative decision-making:
//   1. Monitoring  — Bayesian ToM to track partner, self, and we-intentions (Eq 1-2)
//   2. Deliberating — Role selection (signal-giver/waiter) and intention communication (Eq 5-8)
//   3. Committed   — Joint planning toward shared intention (Eq 9-11)

import { CONFIG } from '../config/gameConfig.js';
import { RunIndividualVI, JointPlanner4Action, softmax, RL_AGENT_CONFIG } from './RLAgent.js';

const ACTIONS = ['up', 'down', 'left', 'right'];
const DELTAS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

export class WeIntentAgent {
  constructor(config = {}) {
    this.cfg = {
      ...(CONFIG?.game?.agent?.weAgent || {}),
      ...config
    };
    this.reset();
  }

  reset() {
    this.goalKeys = [];
    this.goalTypes = [];           // 'big' | 'small' parallel to goalKeys
    this.partnerBelief = null;     // P(intention_partner | actions) — Eq 1
    this.selfRevealedBelief = null; // P(revealed_intention_self | own actions) — Eq 1 (self)
    this.weIntentionBelief = null; // P(intention_we) — Eq 2
    this.phase = 'monitoring';     // 'monitoring' | 'deliberating' | 'committed'
    this.committedGoal = null;     // [r, c] once committed — Eq 9
    this.sampledIntention = null;  // signal-giver's chosen goal — Eq 6
    this.currentRole = null;       // 'signal-giver' | 'signal-waiter'
    this.qCache = new Map();
    this.stepCount = 0;
    this.lastPartnerTrajLen = 0;
    this.lastSelfTrajLen = 0;
  }

  // ────────────────────────────────────────
  // Main entry point (preserves interface contract)
  // ────────────────────────────────────────
  getNextAction(gameState, { aiPlayerNumber = 2 } = {}) {
    const { gridMatrix, currentGoals, currentGoalTypes, player1, player2, trialData, claimedSmallGoals } = gameState || {};
    if (!Array.isArray(gridMatrix) || !Array.isArray(currentGoals) || currentGoals.length === 0) return 'right';

    const myPos = (aiPlayerNumber === 1) ? player1 : player2;
    const partnerPos = (aiPlayerNumber === 1) ? player2 : player1;
    if (!Array.isArray(myPos) || !Array.isArray(partnerPos)) return 'right';

    // Initialize / reset beliefs when goals change
    this.ensureBelief(currentGoals, currentGoalTypes);
    this.stepCount++;

    // --- Bayesian monitoring (Eq 1, 2) ---
    this.updatePartnerBelief(trialData, aiPlayerNumber, gridMatrix);
    this.updateSelfRevealedBelief(trialData, aiPlayerNumber, gridMatrix);
    this.updateWeIntentionBelief();

    // --- Authoritative claim set (game rule: a claimed rabbit is off-limits) ---
    const claimedSet = (claimedSmallGoals && typeof claimedSmallGoals.has === 'function')
      ? claimedSmallGoals
      : new Set();
    const isClaimedSmall = (idx) => {
      if (idx === null || idx === undefined || idx < 0) return false;
      const t = this.goalTypes[idx] || 'small';
      return t !== 'big' && claimedSet.has(idx);
    };
    const goalIdxOf = (pos) => {
      if (!Array.isArray(pos)) return -1;
      return this.goalKeys.indexOf(`${pos[0]},${pos[1]}`);
    };

    // Defensive: if currently committed to a claimed small goal, drop it
    if (this.committedGoal) {
      const cIdx = goalIdxOf(this.committedGoal);
      if (isClaimedSmall(cIdx)) {
        console.log(`[WeAgent] Committed goal [${this.committedGoal}] is claimed; de-committing`);
        this.committedGoal = null;
        this.sampledIntention = null;
        this.phase = 'deliberating';
      }
    }

    // --- Authoritative override: partner has reached a goal (ground truth) ---
    // Prefer claimedSmallGoals + partner position; fall back to trialData fields.
    let partnerReachedIdx = -1;
    const partnerOnGoalIdx = goalIdxOf(partnerPos);
    if (partnerOnGoalIdx >= 0) {
      const t = this.goalTypes[partnerOnGoalIdx] || 'small';
      if (t === 'big' || claimedSet.has(partnerOnGoalIdx)) {
        partnerReachedIdx = partnerOnGoalIdx;
      }
    }
    if (partnerReachedIdx < 0) {
      const fromTrial = (aiPlayerNumber === 1)
        ? trialData?.player2FinalReachedGoal
        : trialData?.player1FinalReachedGoal;
      if (Number.isInteger(fromTrial) && fromTrial >= 0 && fromTrial < currentGoals.length) {
        partnerReachedIdx = fromTrial;
      }
    }

    if (partnerReachedIdx >= 0) {
      const reachedType = this.goalTypes[partnerReachedIdx] || 'small';
      if (reachedType === 'big') {
        this.committedGoal = [...currentGoals[partnerReachedIdx]];
      } else {
        this.committedGoal = this._pickBestSmallGoal(myPos, currentGoals, partnerReachedIdx, claimedSet);
      }
      if (this.committedGoal) {
        this.phase = 'committed';
        this.sampledIntention = null;
        console.log(`[WeAgent] Partner at goal idx=${partnerReachedIdx} (${reachedType}); committing to [${this.committedGoal}]`);
        return this.committedAction(myPos, partnerPos, gridMatrix);
      }
    }

    const weEntropy = this.entropy(this.goalKeys.map(k => this.weIntentionBelief[k]));

    // --- Committed phase (Eq 10/11) with partner monitoring ---
    let justDecommitted = false;
    if (this.phase === 'committed' && this.committedGoal) {
      const gk = `${this.committedGoal[0]},${this.committedGoal[1]}`;
      const gIdx = this.goalKeys.indexOf(gk);
      const goalType = gIdx >= 0 ? this.goalTypes[gIdx] : 'small';

      // For big goals: check if partner still heading there
      if (goalType === 'big') {
        const pPartner = this.partnerBelief[gk] ?? 0;
        if (pPartner < (this.cfg.deltaCommit ?? 0.5)) {
          // Partner diverged — re-select goal
          this.committedGoal = null;
          this.sampledIntention = null;
          this.phase = 'deliberating';
          justDecommitted = true;
          console.log(`[WeAgent] Partner diverged from ${gk} (P=${pPartner.toFixed(3)}), re-selecting goal`);
          // Fall through to deliberating logic below
        } else {
          return this.committedAction(myPos, partnerPos, gridMatrix);
        }
      } else {
        return this.committedAction(myPos, partnerPos, gridMatrix);
      }
    }

    // --- Check for commitment transition (Eq 9) — skip if just de-committed ---
    if (!justDecommitted && weEntropy < (this.cfg.deltaCommit ?? 0.5)) {
      const candidate = this.sampleFromBelief(this.weIntentionBelief);
      const ck = `${candidate[0]},${candidate[1]}`;
      const ckIdx = this.goalKeys.indexOf(ck);
      const ckType = ckIdx >= 0 ? this.goalTypes[ckIdx] : 'small';

      // For big goals, only commit if partner belief also supports it
      const pPartnerCandidate = this.partnerBelief[ck] ?? 0;
      const canCommit = (ckType !== 'big') || (pPartnerCandidate >= (this.cfg.deltaCommit ?? 0.5));

      if (canCommit) {
        this.committedGoal = candidate;
        this.phase = 'committed';
        console.log(`[WeAgent] Committed to goal [${this.committedGoal}] (${ckType}), H(we)=${weEntropy.toFixed(3)}, P_partner=${pPartnerCandidate.toFixed(3)}`);
        return this.committedAction(myPos, partnerPos, gridMatrix);
      }
    }

    // --- Deliberating phase ---
    this.phase = 'deliberating';

    // Compute EIG per action (Eq 4)
    const eigValues = this.computeEIGPerAction(myPos, currentGoals, gridMatrix);

    // Select role (Eq 5)
    this.currentRole = this.selectRole(eigValues);

    if (this.currentRole === 'signal-giver') {
      // Sample intention if not yet chosen (Eq 6)
      if (!this.sampledIntention) {
        this.sampledIntention = this.sampleIntention(currentGoals, this.goalTypes, myPos, partnerPos, claimedSet);
      }
      // Signal-giver action (Eq 7)
      return this.signalGiverAction(myPos, currentGoals, gridMatrix);
    } else {
      // Signal-waiter action (Eq 8)
      return this.signalWaiterAction(myPos, currentGoals, gridMatrix);
    }
  }

  // ────────────────────────────────────────
  // Belief initialization
  // ────────────────────────────────────────
  ensureBelief(goals, goalTypes) {
    const keys = goals.map(g => `${g[0]},${g[1]}`);
    const keySig = keys.join('|');
    if (!this.partnerBelief || keySig !== this.goalKeys.join('|')) {
      // Goals changed — full reset
      const p = 1 / keys.length;
      this.partnerBelief = Object.fromEntries(keys.map(k => [k, p]));
      this.selfRevealedBelief = Object.fromEntries(keys.map(k => [k, p]));
      this.weIntentionBelief = Object.fromEntries(keys.map(k => [k, p]));
      this.goalKeys = keys;
      this.goalTypes = (Array.isArray(goalTypes) && goalTypes.length === keys.length)
        ? [...goalTypes]
        : keys.map(() => 'small');
      this.phase = 'monitoring';
      this.committedGoal = null;
      this.sampledIntention = null;
      this.currentRole = null;
      this.stepCount = 0;
      this.lastPartnerTrajLen = 0;
      this.lastSelfTrajLen = 0;
      this.qCache.clear();
    }
  }

  // ────────────────────────────────────────
  // Eq 1: Bayesian ToM — partner belief update
  // P(intention | action_1:T, state_1:T) ∝ P(action_1:T | intention, state_1:T) * P(intention)
  // ────────────────────────────────────────
  updatePartnerBelief(trialData, aiPlayerNumber, grid) {
    if (!trialData) return;
    const partnerTraj = (aiPlayerNumber === 1) ? trialData.player2Trajectory : trialData.player1Trajectory;
    if (!Array.isArray(partnerTraj) || partnerTraj.length < 2) return;
    if (partnerTraj.length <= this.lastPartnerTrajLen) return;
    this.lastPartnerTrajLen = partnerTraj.length;

    const prev = partnerTraj[partnerTraj.length - 2];
    const curr = partnerTraj[partnerTraj.length - 1];
    if (!Array.isArray(prev) || !Array.isArray(curr)) return;

    this._bayesianUpdate(this.partnerBelief, prev, curr);
  }

  // ────────────────────────────────────────
  // Eq 1 (self): Monitor own revealed intention from third-party perspective
  // ────────────────────────────────────────
  updateSelfRevealedBelief(trialData, aiPlayerNumber, grid) {
    if (!trialData) return;
    const selfTraj = (aiPlayerNumber === 1) ? trialData.player1Trajectory : trialData.player2Trajectory;
    if (!Array.isArray(selfTraj) || selfTraj.length < 2) return;
    if (selfTraj.length <= this.lastSelfTrajLen) return;
    this.lastSelfTrajLen = selfTraj.length;

    const prev = selfTraj[selfTraj.length - 2];
    const curr = selfTraj[selfTraj.length - 1];
    if (!Array.isArray(prev) || !Array.isArray(curr)) return;

    this._bayesianUpdate(this.selfRevealedBelief, prev, curr);
  }

  // Shared Bayesian update logic: how much did moving from prev→curr change distance to each goal?
  _bayesianUpdate(belief, prev, curr) {
    const scale = this.cfg.likelihoodScale ?? 1.5;
    let sum = 0;
    for (const k of this.goalKeys) {
      const [gr, gc] = k.split(',').map(Number);
      const dPrev = Math.abs(prev[0] - gr) + Math.abs(prev[1] - gc);
      const dCurr = Math.abs(curr[0] - gr) + Math.abs(curr[1] - gc);
      const delta = dPrev - dCurr; // positive = moved closer
      const likelihood = Math.exp(scale * delta);
      belief[k] = (belief[k] ?? (1 / this.goalKeys.length)) * likelihood;
      sum += belief[k];
    }
    if (sum > 0) for (const k of this.goalKeys) belief[k] /= sum;
  }

  // ────────────────────────────────────────
  // Eq 2: We-intention belief
  // P(intention_we) ∝ P_partner(g) * P_self_revealed(g)
  // Both agents seem to be heading toward the same goal
  // ────────────────────────────────────────
  updateWeIntentionBelief() {
    let sum = 0;
    for (const k of this.goalKeys) {
      const pPartner = this.partnerBelief[k] ?? 0;
      const pSelf = this.selfRevealedBelief[k] ?? 0;
      this.weIntentionBelief[k] = pPartner * pSelf;
      sum += this.weIntentionBelief[k];
    }
    if (sum > 0) for (const k of this.goalKeys) this.weIntentionBelief[k] /= sum;
    else {
      // Fallback to uniform
      const p = 1 / this.goalKeys.length;
      for (const k of this.goalKeys) this.weIntentionBelief[k] = p;
    }
  }

  // ────────────────────────────────────────
  // Eq 3: Shannon entropy (log base 2)
  // H(X) = -Σ p_i * log2(p_i)
  // ────────────────────────────────────────
  entropy(probabilities) {
    let H = 0;
    for (const p of probabilities) {
      if (p > 1e-12) H -= p * Math.log2(p);
    }
    return H;
  }

  // ────────────────────────────────────────
  // Eq 4: Expected Information Gain per action
  // EIG(a) = H(revealed_intention_t) - E[H(revealed_intention_{t+1} | a)]
  // ────────────────────────────────────────
  computeEIGPerAction(myPos, goals, grid) {
    const currentProbs = this.goalKeys.map(k => this.selfRevealedBelief[k]);
    const entropyBefore = this.entropy(currentProbs);
    const scale = this.cfg.likelihoodScale ?? 1.5;

    return ACTIONS.map(dir => {
      const nextPos = this.applyAction(myPos, dir, grid);
      // Simulate what a third-party observer would infer about our intention
      let norm = 0;
      const weights = [];
      for (const g of goals) {
        const d0 = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
        const d1 = Math.abs(nextPos[0] - g[0]) + Math.abs(nextPos[1] - g[1]);
        const w = Math.exp(scale * (d0 - d1));
        weights.push(w);
        norm += w;
      }
      const posteriorProbs = weights.map(w => w / (norm || 1));
      const entropyAfter = this.entropy(posteriorProbs);
      return Math.max(0, entropyBefore - entropyAfter);
    });
  }

  // ────────────────────────────────────────
  // Eq 5: Role selection
  // P(signal-giver) ∝ exp(θ * maxEIG)
  // ────────────────────────────────────────
  selectRole(eigValues) {
    const maxEig = Math.max(...eigValues);
    const theta = this.cfg.thetaRole ?? 1.0;
    const pGiver = 1 / (1 + Math.exp(-theta * maxEig)); // sigmoid
    const role = Math.random() < pGiver ? 'signal-giver' : 'signal-waiter';
    return role;
  }

  // ────────────────────────────────────────
  // Eq 6: Sample intention based on expected utilities
  // intention ~ P(intentions) ∝ exp[β * E(U(intentions))]
  // ────────────────────────────────────────
  sampleIntention(goals, goalTypes, myPos = null, partnerPos = null, claimedSet = null) {
    const hasClaim = claimedSet && typeof claimedSet.has === 'function';
    const beta = this.cfg.betaUtility ?? 3.0;
    const stagBonus = this.cfg.stagUtilityBonus ?? 2.0;
    const smallReward = CONFIG?.game?.rewards?.smallGoalReward ?? 1;
    const bigReward = CONFIG?.game?.rewards?.bigGoalJointReward ?? 3;

    const utilities = goals.map((g, i) => {
      const gk = `${g[0]},${g[1]}`;
      const type = (goalTypes && goalTypes[i]) || 'small';
      // Claimed small goals are off-limits → zero utility
      if (type !== 'big' && hasClaim && claimedSet.has(i)) return -1e9;
      if (type === 'big') {
        // Expected utility: joint reward * probability partner also heads there
        const pPartner = this.partnerBelief[gk] ?? 0;
        return bigReward * pPartner + stagBonus;
      } else {
        // Small goal: only one player can claim it (game rule).
        // Discount by probability partner reaches first, weighted by belief.
        const pPartner = this.partnerBelief[gk] ?? 0;
        let raceFactor = 1;
        if (Array.isArray(myPos) && Array.isArray(partnerPos)) {
          const dMe = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
          const dPartner = Math.abs(partnerPos[0] - g[0]) + Math.abs(partnerPos[1] - g[1]);
          // If partner is strictly closer, assume they claim first when heading here
          if (dPartner < dMe) raceFactor = 0;
          else if (dPartner === dMe) raceFactor = 0.5;
        }
        const claimProb = 1 - pPartner * (1 - raceFactor); // partner claims with prob pPartner*(1-raceFactor)
        return smallReward * claimProb;
      }
    });

    // Softmax sampling
    const probs = softmax(utilities, beta);
    let r = Math.random(), acc = 0;
    for (let i = 0; i < goals.length; i++) {
      acc += probs[i];
      if (r <= acc) return [...goals[i]];
    }
    return [...goals[goals.length - 1]];
  }

  // ────────────────────────────────────────
  // Eq 7: Signal-giver action
  // P(a | s) ∝ exp(α * P(revealed_intention = intended_goal | a, s))
  // Choose actions that make our revealed intention match our sampled goal
  // ────────────────────────────────────────
  signalGiverAction(myPos, goals, grid) {
    const alpha = this.cfg.alphaSignal ?? 2.0;
    const beta = this.cfg.betaUtility ?? 3.0;
    const scale = this.cfg.likelihoodScale ?? 1.5;
    const targetKey = `${this.sampledIntention[0]},${this.sampledIntention[1]}`;

    const scores = ACTIONS.map(dir => {
      const nextPos = this.applyAction(myPos, dir, grid);
      // P(revealed_intention = target | action): how much does this action point toward our goal?
      let norm = 0;
      const weights = {};
      for (const g of goals) {
        const gk = `${g[0]},${g[1]}`;
        const d0 = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
        const d1 = Math.abs(nextPos[0] - g[0]) + Math.abs(nextPos[1] - g[1]);
        const w = Math.exp(scale * (d0 - d1));
        weights[gk] = w;
        norm += w;
      }
      const pRevealedTarget = (weights[targetKey] || 0) / (norm || 1);

      // Also add utility toward the target
      const d0 = Math.abs(myPos[0] - this.sampledIntention[0]) + Math.abs(myPos[1] - this.sampledIntention[1]);
      const d1 = Math.abs(nextPos[0] - this.sampledIntention[0]) + Math.abs(nextPos[1] - this.sampledIntention[1]);
      const utilityProgress = d0 - d1;

      return alpha * pRevealedTarget + beta * utilityProgress;
    });

    return this._sampleSoftmax(ACTIONS, scores);
  }

  // ────────────────────────────────────────
  // Eq 8: Signal-waiter action
  // P(a | s) ∝ exp(γ * H(revealed_intention_{t+1} | a))
  // Maintain high ambiguity about own intention while waiting
  // ────────────────────────────────────────
  signalWaiterAction(myPos, goals, grid) {
    const gamma = this.cfg.gammaWait ?? 1.0;
    const beta = this.cfg.betaUtility ?? 3.0;
    const scale = this.cfg.likelihoodScale ?? 1.5;

    // Also compute utility toward MAP goal from partner belief (still want to make progress)
    const mapGoal = this.argmaxFromBelief(this.partnerBelief);

    const scores = ACTIONS.map(dir => {
      const nextPos = this.applyAction(myPos, dir, grid);
      // Compute entropy of revealed intention after taking this action
      let norm = 0;
      const weights = [];
      for (const g of goals) {
        const d0 = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
        const d1 = Math.abs(nextPos[0] - g[0]) + Math.abs(nextPos[1] - g[1]);
        const w = Math.exp(scale * (d0 - d1));
        weights.push(w);
        norm += w;
      }
      const probs = weights.map(w => w / (norm || 1));
      const hRevealed = this.entropy(probs);

      // Utility toward MAP goal (gentle pull)
      const d0 = Math.abs(myPos[0] - mapGoal[0]) + Math.abs(myPos[1] - mapGoal[1]);
      const d1 = Math.abs(nextPos[0] - mapGoal[0]) + Math.abs(nextPos[1] - mapGoal[1]);
      const utilProgress = d0 - d1;

      return gamma * hRevealed + beta * 0.3 * utilProgress;
    });

    return this._sampleSoftmax(ACTIONS, scores);
  }

  // ────────────────────────────────────────
  // Eq 10 / 11: Committed action
  // Eq 10: a ~ exp(β * Q(a | s, intention_we))  — joint Q-value planning
  // Eq 11: P(a | s) ∝ exp(α * P(intention_we = jointGoal | a))  — continued signaling
  // ────────────────────────────────────────
  committedAction(myPos, partnerPos, grid) {
    const gk = `${this.committedGoal[0]},${this.committedGoal[1]}`;
    const gIdx = this.goalKeys.indexOf(gk);
    const goalType = gIdx >= 0 ? this.goalTypes[gIdx] : 'small';

    if (this.cfg.continueSignalingAfterCommit) {
      // Eq 11: continued signaling of we-intention
      return this._signalCommitment(myPos, grid);
    } else {
      // Eq 10: joint Q-value maximization
      return this._qValueAction(myPos, partnerPos, grid, goalType);
    }
  }

  // Eq 11 implementation: signal commitment to the shared goal
  _signalCommitment(myPos, grid) {
    const alpha = this.cfg.alphaSignal ?? 2.0;
    const beta = this.cfg.betaUtility ?? 3.0;
    const scale = this.cfg.likelihoodScale ?? 1.5;
    const targetKey = `${this.committedGoal[0]},${this.committedGoal[1]}`;
    const goals = this.goalKeys.map(k => k.split(',').map(Number));

    const scores = ACTIONS.map(dir => {
      const nextPos = this.applyAction(myPos, dir, grid);
      // P(intention_we = committedGoal | a)
      let norm = 0;
      const weights = {};
      for (const g of goals) {
        const gk = `${g[0]},${g[1]}`;
        const d0 = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
        const d1 = Math.abs(nextPos[0] - g[0]) + Math.abs(nextPos[1] - g[1]);
        const w = Math.exp(scale * (d0 - d1));
        weights[gk] = w;
        norm += w;
      }
      const pCommit = (weights[targetKey] || 0) / (norm || 1);

      // Direct utility toward committed goal
      const d0 = Math.abs(myPos[0] - this.committedGoal[0]) + Math.abs(myPos[1] - this.committedGoal[1]);
      const d1 = Math.abs(nextPos[0] - this.committedGoal[0]) + Math.abs(nextPos[1] - this.committedGoal[1]);
      const utilProgress = d0 - d1;

      return alpha * pCommit + beta * utilProgress;
    });

    return this._sampleSoftmax(ACTIONS, scores);
  }

  // Eq 10 implementation: Q-value planning toward committed goal
  _qValueAction(myPos, partnerPos, grid, goalType) {
    const beta = this.cfg.betaUtility ?? 3.0;
    const obstacles = this._extractObstacles(grid);
    const goal = this.committedGoal;

    try {
      if (goalType === 'big') {
        // Joint planner — both must reach the same goal
        const action = JointPlanner4Action.getAction(
          myPos, partnerPos, [goal], beta, obstacles
        );
        if (action) return this._deltaToDirection(action);
      }

      // Individual planner for small goals (or fallback)
      const gridSize = grid.length;
      const runner = new RunIndividualVI(
        gridSize,
        [[0, -1], [0, 1], [-1, 0], [1, 0]],
        [[0, -1], [0, 1], [-1, 0], [1, 0]],
        0, 0.9, 30, beta
      );
      const { policy } = runner.call([goal], obstacles);
      const probsMap = policy.call(myPos);
      // Sample from policy
      const entries = Object.entries(probsMap);
      let r = Math.random(), acc = 0;
      for (const [aStr, prob] of entries) {
        acc += prob;
        if (r <= acc) {
          const delta = aStr.split(',').map(Number);
          return this._deltaToDirection(delta);
        }
      }
    } catch (e) {
      console.warn('[WeAgent] Q-value computation failed, falling back to greedy:', e.message);
    }

    // Fallback: greedy toward committed goal
    return this._bestDirectionToward(myPos, goal, grid);
  }

  // ────────────────────────────────────────
  // Utility helpers
  // ────────────────────────────────────────

  applyAction(pos, dir, grid) {
    const move = DELTAS[dir] || [0, 1];
    const nr = pos[0] + move[0];
    const nc = pos[1] + move[1];
    if (!this._inBounds(grid, nr, nc) || grid[nr][nc] === 4) return pos; // obstacle = 4
    return [nr, nc];
  }

  _inBounds(grid, r, c) {
    return Array.isArray(grid) && r >= 0 && c >= 0 && r < grid.length && c < grid[0].length;
  }

  argmaxFromBelief(belief) {
    let bestKey = this.goalKeys[0];
    let bestVal = -Infinity;
    for (const k of this.goalKeys) {
      if ((belief[k] ?? 0) > bestVal) { bestVal = belief[k]; bestKey = k; }
    }
    return bestKey.split(',').map(Number);
  }

  sampleFromBelief(belief) {
    let r = Math.random(), acc = 0;
    for (const k of this.goalKeys) {
      acc += belief[k] ?? 0;
      if (r <= acc) return k.split(',').map(Number);
    }
    return this.goalKeys[this.goalKeys.length - 1].split(',').map(Number);
  }

  _sampleSoftmax(actions, scores) {
    const maxS = Math.max(...scores);
    const prefs = scores.map(s => Math.exp(s - maxS));
    const sum = prefs.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random(), acc = 0;
    for (let i = 0; i < prefs.length; i++) {
      acc += prefs[i] / sum;
      if (r <= acc) return actions[i];
    }
    return actions[actions.length - 1];
  }

  _pickBestSmallGoal(myPos, goals, excludeIdx, claimedSet = null) {
    const hasClaim = claimedSet && typeof claimedSet.has === 'function';
    let bestGoal = null, bestDist = Infinity;
    for (let i = 0; i < goals.length; i++) {
      if (i === excludeIdx) continue;
      if ((this.goalTypes[i] || 'small') !== 'small') continue;
      if (hasClaim && claimedSet.has(i)) continue; // already taken by someone
      const g = goals[i];
      const d = Math.abs(myPos[0] - g[0]) + Math.abs(myPos[1] - g[1]);
      if (d < bestDist) { bestDist = d; bestGoal = [...g]; }
    }
    return bestGoal;
  }

  _bestDirectionToward(pos, goal, grid) {
    let bestDir = 'right', bestGain = -Infinity;
    for (const dir of ACTIONS) {
      const next = this.applyAction(pos, dir, grid);
      const d0 = Math.abs(pos[0] - goal[0]) + Math.abs(pos[1] - goal[1]);
      const d1 = Math.abs(next[0] - goal[0]) + Math.abs(next[1] - goal[1]);
      if (d0 - d1 > bestGain) { bestGain = d0 - d1; bestDir = dir; }
    }
    return bestDir;
  }

  _deltaToDirection(delta) {
    if (delta[0] === -1) return 'up';
    if (delta[0] === 1) return 'down';
    if (delta[1] === -1) return 'left';
    if (delta[1] === 1) return 'right';
    return 'right';
  }

  _extractObstacles(grid) {
    const obstacles = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        if (grid[r][c] === 4) obstacles.push([r, c]);
      }
    }
    return obstacles;
  }
}
