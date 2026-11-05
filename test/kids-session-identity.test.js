import test from 'node:test';
import assert from 'node:assert/strict';
import { DataSyncManager } from '../client/src/utils/DataSyncManager.js';

test('reload/new experiment gets a fresh ID despite the same tab and participant', () => {
  const previous = globalThis.window;
  const saved = new Map([['kidExperimentDataSyncSessionId', 'old-session']]);
  let next = 0;
  globalThis.window = { sessionStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) },
    crypto: { randomUUID: () => `new-run-${++next}` }, addEventListener() {} };
  try {
    const a = new DataSyncManager({ uploadEnabled:false, participantIdProvider:()=> 'C009' });
    const b = new DataSyncManager({ uploadEnabled:false, participantIdProvider:()=> 'C009' });
    assert.notEqual(a.sessionId,b.sessionId);
    assert.notEqual(a.sessionId,'old-session');
    assert.equal(a.nextSequenceNumber(),1);
    assert.equal(b.nextSequenceNumber(),1);
    assert.equal(a.sessionId,'new-run-1');
  } finally { globalThis.window = previous; }
});
