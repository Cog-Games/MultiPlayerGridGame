// Server-side VLM/OpenAI rate shaping: token + request headroom using response
// headers when available, with a local sliding window fallback (target RPM/TPM).

const SAFETY = 0.2; // wait before a call if remaining would drop below 20% of limit

export const LOW_DETAIL_IMAGE_TOKENS_EST = 85;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter() {
  return Math.floor(Math.random() * 500);
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Rough input token estimate when usage is not yet known (~4 chars/token). */
export function estimateVlmPromptTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * OpenAI sends values like "6ms", "1s", or plain milliseconds.
 */
export function parseResetToMs(value) {
  if (value == null) return 0;
  const s = String(value).trim();
  const msMatch = s.match(/^(\d+(?:\.\d+)?)\s*ms$/i);
  if (msMatch) return Math.ceil(Number(msMatch[1]));
  const sMatch = s.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (sMatch) return Math.ceil(Number(sMatch[1]) * 1000);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    // Heuristic: values < 1000 treated as seconds (Retry-After style)
    return n < 1000 ? Math.ceil(n * 1000) : Math.ceil(n);
  }
  return 0;
}

export class VlmRateLimiter {
  constructor() {
    // Note: ES module import order may run this before server/index.js loads .env;
    // targets are refreshed on each acquireBudget().
    this.targetRpm = 400;
    this.targetTpm = 160_000;
    /** @type {'openai'|'google'|null} Per-request hint (client sends provider=google). */
    this._providerHint = null;
    this.lastSnap = null;
    this._tail = Promise.resolve();
    /** Do not issue next request before this timestamp (ms). */
    this._nextEarliest = 0;
    this._reqTimes = [];
    this._tokEvents = [];
  }

  bumpFrom429(delayMs) {
    const until = Date.now() + delayMs + jitter();
    this._nextEarliest = Math.max(this._nextEarliest, until);
  }

  /**
   * Align sliding-window limits with the provider for this call (overrides VLM_PROVIDER when set).
   */
  setProviderHint(provider) {
    const p = String(provider || '').toLowerCase();
    this._providerHint = (p === 'google' || p === 'openai') ? p : null;
  }

  /**
   * Serialize all VLM API traffic so concurrent requests cannot burst.
   */
  async runExclusive(fn) {
    const prev = this._tail;
    let resolveChain;
    this._tail = new Promise((r) => { resolveChain = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolveChain();
    }
  }

  _prune(now) {
    const cutoff = now - 60_000;
    this._reqTimes = this._reqTimes.filter((t) => t > cutoff);
    this._tokEvents = this._tokEvents.filter((e) => e.t > cutoff);
  }

  /**
   * Wait until local budgets and header-derived headroom allow a request
   * of ~estimatedTokens.
   */
  async acquireBudget(estimatedTokens) {
    const envP = String(process.env.VLM_PROVIDER || 'openai').toLowerCase();
    const provider = this._providerHint || envP;
    if (provider === 'google') {
      this.targetRpm = Math.max(1, parseNum(process.env.GOOGLE_VLM_TARGET_RPM) || 25);
      this.targetTpm = Math.max(1000, parseNum(process.env.GOOGLE_VLM_TARGET_TPM) || 120_000);
    } else {
      this.targetRpm = Math.max(1, parseNum(process.env.VLM_TARGET_RPM) || 400);
      this.targetTpm = Math.max(1000, parseNum(process.env.VLM_TARGET_TPM) || 160_000);
    }

    const est = Math.max(1, Math.ceil(estimatedTokens));

    for (;;) {
      const now = Date.now();
      if (now < this._nextEarliest) {
        await sleep(this._nextEarliest - now);
        continue;
      }

      this._prune(now);

      // Header-based: avoid dropping below safety margin on tokens or requests
      if (this.lastSnap && this.lastSnap.limT > 0 && this.lastSnap.remT != null) {
        const afterT = this.lastSnap.remT - est;
        if (afterT < SAFETY * this.lastSnap.limT) {
          const w = parseResetToMs(this.lastSnap.resetT);
          if (w > 0) {
            await sleep(Math.min(60_000, w + 10 + jitter()));
            continue;
          }
        }
      }
      if (this.lastSnap && this.lastSnap.limR > 0 && this.lastSnap.remR != null) {
        const afterR = this.lastSnap.remR - 1;
        if (afterR < SAFETY * this.lastSnap.limR) {
          const w = parseResetToMs(this.lastSnap.resetR);
          if (w > 0) {
            await sleep(Math.min(60_000, w + 10 + jitter()));
            continue;
          }
        }
      }

      // Local sliding window vs targets (80% of configured RPM/TPM)
      const reqBudget = Math.max(1, Math.floor(this.targetRpm * 0.8));
      const tokBudget = Math.max(1000, Math.floor(this.targetTpm * 0.8));

      if (this._reqTimes.length >= reqBudget) {
        const wait = 60_000 - (now - this._reqTimes[0]) + 5;
        await sleep(Math.max(50, Math.min(60_000, wait)));
        continue;
      }

      const sumTok = this._tokEvents.reduce((a, e) => a + e.tokens, 0);
      if (sumTok + est > tokBudget) {
        if (this._tokEvents.length === 0) {
          await sleep(100);
          continue;
        }
        const wait = 60_000 - (now - this._tokEvents[0].t) + 5;
        await sleep(Math.max(50, Math.min(60_000, wait)));
        continue;
      }

      return;
    }
  }

  /**
   * Record a successful completion; refresh header snapshot for next acquire.
   */
  recordSuccess(totalTokensFromUsage, estimatedTokens, headers) {
    const now = Date.now();
    this._reqTimes.push(now);
    const actual = parseNum(totalTokensFromUsage);
    const tokens = actual != null ? actual : estimatedTokens;
    this._tokEvents.push({ t: now, tokens: Math.max(1, tokens) });

    if (!headers || typeof headers.get !== 'function') return;

    const remR = parseNum(headers.get('x-ratelimit-remaining-requests'));
    const limR = parseNum(headers.get('x-ratelimit-limit-requests'));
    const remT = parseNum(headers.get('x-ratelimit-remaining-tokens'));
    const limT = parseNum(headers.get('x-ratelimit-limit-tokens'));

    if (remR != null && limR != null && remT != null && limT != null) {
      this.lastSnap = {
        remR,
        limR,
        remT,
        limT,
        resetR: headers.get('x-ratelimit-reset-requests'),
        resetT: headers.get('x-ratelimit-reset-tokens')
      };
    }
  }
}

export const vlmLimiter = new VlmRateLimiter();
