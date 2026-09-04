// Fixed-path opportunity replay. This does not simulate behavior under new goals.
// Usage: node scripts/replay-kids-dynamic-quota.mjs INPUT.json OUTPUT.json [SEEDS=100]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { NewGoalGenerator as G } from '../client/src/utils/NewGoalGenerator.js';
import { NewGoalQuotaScheduler as Q } from '../client/src/utils/NewGoalQuotaScheduler.js';

const [input, output, count = '100'] = process.argv.slice(2);
if (!input || !output || !Number.isInteger(Number(count)) || Number(count) < 1) {
  throw new Error('Provide input JSON, output JSON, and optionally a positive number of random seeds');
}
const trials = JSON.parse(fs.readFileSync(input)).sort((a, b) =>
  a.roomId.localeCompare(b.roomId) || a.participantId.localeCompare(b.participantId) || a.trialIndex - b.trialIndex);
const noNew = 'no_new_goal';
const originalRandom = Math.random;

function run(mode, initialSeed) {
  let seed = initialSeed;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const sessions = {};
  for (const t of trials) {
    const scope = t.partnerAgentType === 'human' ? t.roomId : `${t.roomId}:${t.participantId}`;
    const session = sessions[scope] ||= { participant:t.participantId, balances:{}, rows:[], controls:0 };
    const row = { trialIndex:t.trialIndex, scheduled:t.distanceCondition, selected:null, round:null };
    if (t.distanceCondition === noNew) {
      row.selected = noNew;
      row.status = 'scheduled_control';
      session.controls++;
    } else {
      let firstShared = null;
      const end = Math.min(t.newGoalPresented ? t.newGoalPresentedTime : Infinity,
        t.player1GoalReachedStep - 1, t.player2GoalReachedStep - 1);
      row.status = 'no_shared_goal_before_first_arrival';
      for (let k = 1; k <= end; k++) {
        const g1 = t.player1CurrentGoal[k - 1], g2 = t.player2CurrentGoal[k - 1];
        const shared = Number.isInteger(g1) && g1 === g2 && g1 >= 0 && g1 < 2;
        if (firstShared === null && shared) firstShared = g1;
        const reference = shared ? g1 : firstShared;
        if (reference === null) continue;
        const p1 = t.player1Trajectory[k], p2 = t.player2Trajectory[k];
        assert(p1 && p2, 'Missing pre-arrival, pre-reveal position');
        let goal;
        if (mode === 'dynamic') {
          const result = Q.select({ player1:p1, player2:p2, goals:t.initialGoalPositions,
            referenceGoal:reference, balances:session.balances });
          goal = result.goal;
          row.status = result.reason;
        } else {
          goal = G.generateNewGoal(p2, p1, t.initialGoalPositions, reference, t.distanceCondition,
            { allowTolerance:true, balance:session.balances[t.distanceCondition] || G.emptyBalance() });
          row.status = goal ? 'presented' : 'no_candidate_within_tolerance';
        }
        if (goal) {
          session.balances[goal.conditionType] = goal.balanceAfter;
          Object.assign(row, { selected:goal.conditionType, round:k, mode:goal.generationMode,
            position:goal.position, referenceGoal:reference });
          break;
        }
      }
    }
    session.rows.push(row);
  }
  for (const session of Object.values(sessions)) {
    session.realized = { ...Q.counts(session.balances), [noNew]:session.controls };
    session.newGoalOpportunities = Object.values(Q.counts(session.balances)).reduce((a, b) => a + b, 0);
    session.exact2222 = Object.values(session.realized).every(n => n === 2);
    assert(session.rows.length <= 8, 'Replay must never add trials');
    if (mode === 'dynamic') assert(Object.values(session.realized).every(n => n <= 2), 'Quota exceeded');
  }
  return { seed:initialSeed, newGoalOpportunities:Object.values(sessions).reduce((a, s) => a + s.newGoalOpportunities, 0), sessions };
}

try {
  const baseline = run('fixed', 20260904);
  assert.equal(baseline.newGoalOpportunities, 15, 'Fixed-condition baseline must match the prior audit');
  const example = run('dynamic', 20260904);
  const sensitivity = {};
  const totalFrequency = {};
  for (let i = 0; i < Number(count); i++) {
    const result = run('dynamic', 20260904 + i);
    totalFrequency[result.newGoalOpportunities] = (totalFrequency[result.newGoalOpportunities] || 0) + 1;
    for (const [scope, session] of Object.entries(result.sessions)) {
      const stats = sensitivity[scope] ||= { participant:session.participant, recordedTrials:session.rows.length,
        seeds:Number(count), minOpportunities:Infinity, maxOpportunities:0, exact2222Runs:0 };
      stats.minOpportunities = Math.min(stats.minOpportunities, session.newGoalOpportunities);
      stats.maxOpportunities = Math.max(stats.maxOpportunities, session.newGoalOpportunities);
      stats.exact2222Runs += Number(session.exact2222);
    }
  }
  const report = {
    scope:'Fixed recorded paths up to original reveal and before either arrival. Original control slots retained. No added trials. Seed variation describes allocation sensitivity on these paths, not a future success probability.',
    policy:Q.POLICY_VERSION, baseline, example, totalFrequency, sensitivity
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ baseline:baseline.newGoalOpportunities, example:example.newGoalOpportunities,
    totalFrequency, sensitivity }, null, 2));
} finally { Math.random = originalRandom; }
