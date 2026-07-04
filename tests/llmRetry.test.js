import assert from 'node:assert/strict';
import { fetchWithRetry } from '../server/llmRetry.js';

function runScenario(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch(error => {
      console.error(`FAIL ${name}`);
      throw error;
    });
}

function jsonResponse(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

runScenario('succeeds on first try with retryCount 0', async () => {
  let calls = 0;
  const result = await fetchWithRetry('https://example.test', {}, {
    fetchImpl: async () => {
      calls++;
      return jsonResponse(200, { ok: true });
    },
    wait: async () => {},
    random: () => 0,
  });

  assert.equal(calls, 1);
  assert.equal(result.response.status, 200);
  assert.equal(result.retryCount, 0);
  assert.equal(result.retriesExhausted, false);
});

runScenario('retries after 429 with retry-after', async () => {
  const waits = [];
  const responses = [
    jsonResponse(429, { error: { message: 'rate limited' } }, { 'retry-after': '2' }),
    jsonResponse(200, { ok: true }),
  ];

  const result = await fetchWithRetry('https://example.test', {}, {
    fetchImpl: async () => responses.shift(),
    wait: async delayMs => waits.push(delayMs),
    random: () => 0,
  });

  assert.deepEqual(waits, [2000]);
  assert.equal(result.response.status, 200);
  assert.equal(result.retryCount, 1);
});

runScenario('retries network error then succeeds', async () => {
  const waits = [];
  let calls = 0;

  const result = await fetchWithRetry('https://example.test', {}, {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error('socket hang up');
      return jsonResponse(200, { ok: true });
    },
    wait: async delayMs => waits.push(delayMs),
    random: () => 0,
  });

  assert.deepEqual(waits, [1000]);
  assert.equal(result.response.status, 200);
  assert.equal(result.retryCount, 1);
});

runScenario('does not retry non-transient 400', async () => {
  let calls = 0;
  const result = await fetchWithRetry('https://example.test', {}, {
    fetchImpl: async () => {
      calls++;
      return jsonResponse(400, { error: { message: 'bad request' } });
    },
    wait: async () => {
      throw new Error('wait should not be called');
    },
    random: () => 0,
  });

  assert.equal(calls, 1);
  assert.equal(result.response.status, 400);
  assert.equal(result.retryCount, 0);
  assert.equal(result.retriesExhausted, false);
});

runScenario('returns exhausted transient response after max attempts', async () => {
  const waits = [];
  let calls = 0;

  const result = await fetchWithRetry('https://example.test', {}, {
    maxAttempts: 3,
    fetchImpl: async () => {
      calls++;
      return jsonResponse(503, { error: { message: 'unavailable' } });
    },
    wait: async delayMs => waits.push(delayMs),
    random: () => 0,
  });

  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(result.response.status, 503);
  assert.equal(result.retryCount, 2);
  assert.equal(result.retriesExhausted, true);
});
