import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { KidSharedAgencyAgent } from '../client/src/ai/KidSharedAgencyAgent.js';
import { CONFIG, GameConfigUtils } from '../client/src/config/gameConfig.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/kid-sa-reference.json', import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(new URL('../client/src/ai/kidSaReference/source-manifest.json', import.meta.url)));
const originalRandom = Math.random;
const clone = value => JSON.parse(JSON.stringify(value));

test('vendored decision body is byte-for-byte the source used to generate parity fixtures', () => {
  const module = fs.readFileSync(new URL('../client/src/ai/kidSaReference/sharedAgencyCore.js', import.meta.url), 'utf8');
  const body = module.slice(module.indexOf('/**'), module.lastIndexOf('\nreturn window.SharedAgencyAgent;'));
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), manifest.files['sharedAgencyAgent.js']);
  assert.equal(fixture.sourceSHA256, manifest.files['sharedAgencyAgent.js']);
});

test('kid-SA action, posterior, weights and mixture decisions match the independently executed old experiment on either player side', () => {
  const agent = new KidSharedAgencyAgent();
  const log = console.log;
  console.log = () => {};
  try {
    for (const aiPlayer of [2, 1]) for (const c of fixture.cases) {
      agent.reset();
      let rng = c.seed;
      Math.random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const humanPlayer = aiPlayer === 1 ? 2 : 1;
      const trial = { player1StartPosition: aiPlayer === 2 ? [3, 4] : [5, 4],
        player2StartPosition: aiPlayer === 2 ? [5, 4] : [3, 4] };
      c.inputs.forEach((input, i) => {
        trial[`player${humanPlayer}Actions`] = input.player1Actions;
        trial[`player${humanPlayer}Trajectory`] = input.player1Trajectory;
        trial.moveEvents = i ? [{ round: i }] : [];
        const state = { experimentType: '2P3G', trialIndex: 0,
          gridMatrix: Array.from({ length: 15 }, () => Array(15).fill(0)),
          currentGoals: input.state.currentGoals,
          [`player${humanPlayer}`]: input.state.player1, [`player${aiPlayer}`]: input.state.player2 };
        const action = agent.getAIAction(state, trial, aiPlayer, input.pendingAction);
        assert.deepEqual(clone({ action, posterior: trial.alwaysSignalAgentSampledJointGoalPosterior,
          weights: trial.alwaysSignalAgentSampledJointGoalWeights, goalIndex: trial.alwaysSignalAgentSampledJointGoalIndex,
          baseAction: trial.sharedAgencyBaseAction, legibilityAction: trial.sharedAgencyLegibilityAction }), c.expected[i]);
        assert.equal(trial.sharedAgencyModelVersion, 'local-fallback-2026-05-28');
        assert.equal(trial[`alwaysSignalAgentPlayer${aiPlayer}SampledJointGoalHistory`].length, i + 1);
      });
    }
  } finally { Math.random = originalRandom; console.log = log; }
});

test('direct kid-SA and two-kid fallback use the same reference agent factory and registered parameters', async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const { ExperimentManager } = await import('../client/src/experiments/ExperimentManager.js');
  globalThis.fetch = fetch;
  const manager = Object.create(ExperimentManager.prototype);
  const type = GameConfigUtils.configureKidCommittedAgent('sa-model');
  assert.equal(CONFIG.multiplayer.fallbackAIType, type);
  for (const mode of ['human', 'committed']) {
    CONFIG.kids.partnerMode = mode;
    const agent = manager.createAlwaysSignalAgent();
    assert(agent instanceof KidSharedAgencyAgent);
    const cfg = agent.getConfig();
    assert.equal(cfg.lambda, .2); assert.equal(cfg.alpha, .5); assert.equal(cfg.beta, 3);
    assert.equal(cfg.jointPolicyKind, 'joint-rl-fast');
  }
  CONFIG.kids.partnerMode = 'human';
});
