import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildKidSaPlanner, prepareKidSaGoals } from '../client/src/ai/kidSaPlanner.js';

// Expose the untouched reference builder inside the test only. Compare all
// 810,000 Q-values, rather than just observing a few sampled actions.
let source = fs.readFileSync(new URL('../client/src/ai/kidSaReference/jointRLFast.js', import.meta.url), 'utf8');
source = 'let referenceBuild;\n' + source.replace('    // ---------- public function',
  '    referenceBuild = buildPlannerFast;\n    // ---------- public function') + '\nexport {referenceBuild};';
const { referenceBuild } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('optimized planner has exactly the reference Q table at corners, interior and multiple goals', () => {
  const log = console.log;
  console.log = () => {};
  try {
    for (const goals of [[[0, 0]], [[7, 8]], [[14, 14]], [[0, 8], [14, 8]]]) {
      const reference = referenceBuild(goals);
      const optimized = buildKidSaPlanner(goals);
      assert.deepEqual(optimized.Q, reference.Q);
      assert.deepEqual(optimized.goalSet, reference.goalSet);
    }
  } finally { console.log = log; }
});

test('prewarming does not consume randomness or make model decisions', () => {
  const random = Math.random;
  Math.random = () => { throw new Error('prewarming must not sample'); };
  try { prepareKidSaGoals([[0, 8], [14, 8]]); prepareKidSaGoals([[0, 8], [14, 8]]); }
  finally { Math.random = random; }
});
