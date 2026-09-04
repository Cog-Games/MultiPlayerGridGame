import { CONFIG } from '../config/gameConfig.js';
import { NewGoalGenerator as G } from './NewGoalGenerator.js';

// Counts are derived from committed presentations, never from search attempts
// or collaboration outcomes. Searching all conditions does not consume quota.
export class NewGoalQuotaScheduler {
  static POLICY_VERSION = 'kids-fixed-eight-dynamic-quota-v1';
  static CONDITIONS = ['closer_to_player1', 'closer_to_player2', 'equal_to_both'];

  static targets() {
    const target = CONFIG.twoP3G.conditionQuota.trialsPerCondition;
    if (!Number.isInteger(target) || target < 1) throw new Error('Invalid new-goal quota');
    return Object.fromEntries(this.CONDITIONS.map(condition => [condition, target]));
  }

  static counts(balances = {}) {
    return Object.fromEntries(this.CONDITIONS.map(condition =>
      [condition, balances[condition]?.generatedCount ?? 0]));
  }

  static select({ player1, player2, goals, referenceGoal, gridMatrix, balances = {}, random = Math.random }) {
    const quotaTarget = this.targets();
    const quotaBefore = this.counts(balances);
    const candidates = [];
    const conditionCandidates = {};
    for (const condition of this.CONDITIONS) {
      const remaining = Math.max(0, quotaTarget[condition] - quotaBefore[condition]);
      const details = { remaining, strictCandidateCount: 0, relaxedCandidateCount: 0 };
      conditionCandidates[condition] = details;
      if (!remaining) {
        details.status = 'quota_filled';
        continue;
      }
      const goal = G.generateNewGoal(player2, player1, goals, referenceGoal, condition, {
        allowTolerance: CONFIG.twoP3G.generationTolerance?.enabled === true,
        balance: balances[condition] || G.emptyBalance(), gridMatrix, diagnostics: details
      });
      details.status = goal ? 'feasible' : 'no_candidate_within_tolerance';
      if (goal) candidates.push({ goal, remaining });
    }
    const diagnostics = { allocationPolicy: this.POLICY_VERSION, quotaTarget, quotaBefore,
      conditionCandidates, eligibleConditions: candidates.map(c => c.goal.conditionType) };
    if (!candidates.length) {
      return { goal: null, diagnostics, reason: Object.values(conditionCandidates).every(c => !c.remaining)
        ? 'new_goal_quota_filled' : 'no_candidate_for_remaining_quota' };
    }

    // Deficit first. When deficits tie, reserve equal slots for positions where
    // neither closer manipulation is possible (e.g. overlapping players).
    const maxRemaining = Math.max(...candidates.map(c => c.remaining));
    let pool = candidates.filter(c => c.remaining === maxRemaining);
    const closer = pool.filter(c => c.goal.conditionType !== 'equal_to_both');
    if (closer.length) pool = closer;
    const strict = pool.filter(c => c.goal.generationMode === 'strict');
    if (strict.length) pool = strict;
    diagnostics.selectionPool = pool.map(c => c.goal.conditionType);
    const selected = pool[Math.floor(random() * pool.length)].goal;
    const quotaAfter = { ...quotaBefore, [selected.conditionType]: quotaBefore[selected.conditionType] + 1 };
    return { goal: { ...selected, ...diagnostics, quotaAfter,
      goalGenerationBalancesAfter: {
        ...structuredClone(balances), [selected.conditionType]: structuredClone(selected.balanceAfter)
      }
    }, diagnostics, reason: 'presented' };
  }
}
