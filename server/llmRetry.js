const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryDateMs = Date.parse(value);
  if (Number.isFinite(retryDateMs)) {
    return Math.max(0, retryDateMs - nowMs);
  }

  return null;
}

function getRetryAfterHeader(response) {
  if (!response?.headers?.get) return null;
  return response.headers.get('retry-after');
}

export function getBackoffDelayMs({
  attempt,
  response = null,
  baseDelayMs = DEFAULT_RETRY_OPTIONS.baseDelayMs,
  maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
  jitterMs = DEFAULT_RETRY_OPTIONS.jitterMs,
  random = Math.random,
}) {
  const retryAfterMs = parseRetryAfterMs(getRetryAfterHeader(response));
  const delayWithoutJitter = retryAfterMs ?? baseDelayMs * (2 ** (attempt - 1));
  const jitter = retryAfterMs == null && jitterMs > 0 ? Math.floor(random() * jitterMs) : 0;
  return Math.min(delayWithoutJitter + jitter, maxDelayMs);
}

export async function fetchWithRetry(url, fetchOptions = {}, options = {}) {
  const {
    provider = 'llm',
    model = 'unknown',
    fetchImpl = globalThis.fetch,
    wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
    logger = console,
    random = Math.random,
    maxAttempts = DEFAULT_RETRY_OPTIONS.maxAttempts,
    baseDelayMs = DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
    jitterMs = DEFAULT_RETRY_OPTIONS.jitterMs,
  } = options;

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url, fetchOptions);
      lastResponse = response;

      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        return {
          response,
          retryCount: attempt - 1,
          retriesExhausted: isRetryableStatus(response.status) && attempt === maxAttempts,
        };
      }

      const waitMs = getBackoffDelayMs({
        attempt,
        response,
        baseDelayMs,
        maxDelayMs,
        jitterMs,
        random,
      });
      logger.warn?.('[LLM] retrying request', {
        provider,
        model,
        status: response.status,
        attempt,
        maxAttempts,
        waitMs,
      });
      await wait(waitMs);
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        const exhaustedError = new Error(`LLM request retries exhausted after ${maxAttempts} attempts: ${error.message}`);
        exhaustedError.cause = error;
        exhaustedError.retryCount = attempt - 1;
        throw exhaustedError;
      }

      const waitMs = getBackoffDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitterMs,
        random,
      });
      logger.warn?.('[LLM] retrying request', {
        provider,
        model,
        error: error.message,
        attempt,
        maxAttempts,
        waitMs,
      });
      await wait(waitMs);
    }
  }

  if (lastResponse) {
    return { response: lastResponse, retryCount: maxAttempts - 1, retriesExhausted: true };
  }

  const exhaustedError = new Error(`LLM request retries exhausted after ${maxAttempts} attempts: ${lastError?.message || 'unknown error'}`);
  exhaustedError.cause = lastError;
  exhaustedError.retryCount = maxAttempts - 1;
  throw exhaustedError;
}
