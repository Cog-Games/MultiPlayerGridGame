import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../client/src/config/gameConfig.js';
import { GameStateManager } from '../client/src/game/GameStateManager.js';

test('the existing one-round game-test URL starts 2P3G and marks test records explicitly', async () => {
  assert.equal(CONFIG.twoP3G.conditionQuota.enabled, true);
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  globalThis.window = { location: { search: '?kidTestMode=game&kidTestTrials=1&kidTestExperiment=2P3G' }, io() {} };
  globalThis.document = { getElementById() { return {}; }, addEventListener() {} };
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    await import('../client/main.js');
    const gsm = new GameStateManager();
    gsm.initializeTrial(0, '2P3G', { initPlayerGrid: [0, 0], initAIGrid: [0, 2], target1: [4, 4], target2: [8, 8] });
    assert.equal(gsm.trialData.isTestSession, true);
    assert.equal(CONFIG.twoP3G.conditionQuota.enabled, false);
    assert.equal(CONFIG.twoP3G.conditionQuota.trialsPerCondition, 2);
  } finally {
    globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.fetch = oldFetch;
  }
});
