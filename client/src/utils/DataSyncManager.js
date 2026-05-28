export class DataSyncManager {
  constructor(options = {}) {
    this.scriptUrl = options.scriptUrl || '';
    this.uploadEnabled = options.uploadEnabled !== false;
    this.participantIdProvider = options.participantIdProvider || (() => null);
    this.dbName = options.dbName || 'kidExperimentDataSync';
    this.storeName = options.storeName || 'checkpoints';
    this.localStorageKey = options.localStorageKey || 'kidExperimentDataSyncFallback';
    this.maxBatchSize = Number(options.maxBatchSize) || 4;
    this.flushDelayMs = Number(options.flushDelayMs) || 250;
    this.flushTimer = null;
    this.flushInProgress = false;
    this.dbPromise = null;
    this.sequenceNumber = this.restoreSequenceNumber();
    this.sessionId = this.restoreSessionId();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.scheduleFlush(250));
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flush({ limit: 1 });
        }
      });
      window.addEventListener('pagehide', () => this.flush({ limit: 1 }));
    }
  }

  restoreSessionId() {
    const fallbackId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const key = 'kidExperimentDataSyncSessionId';
      const existing = window.sessionStorage.getItem(key);
      if (existing) return existing;
      const generated = (window.crypto?.randomUUID?.() || fallbackId);
      window.sessionStorage.setItem(key, generated);
      return generated;
    } catch (_) {
      return fallbackId;
    }
  }

  restoreSequenceNumber() {
    try {
      const raw = window.sessionStorage.getItem('kidExperimentDataSyncSequence');
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (_) {
      return 0;
    }
  }

  nextSequenceNumber() {
    this.sequenceNumber += 1;
    try {
      window.sessionStorage.setItem('kidExperimentDataSyncSequence', String(this.sequenceNumber));
    } catch (_) { /* noop */ }
    return this.sequenceNumber;
  }

  async openDb() {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available');
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('uploaded', 'uploaded', { unique: false });
          store.createIndex('nextRetryAt', 'nextRetryAt', { unique: false });
          store.createIndex('sequenceNumber', 'sequenceNumber', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });

    return this.dbPromise;
  }

  async putRecord(record) {
    try {
      const db = await this.openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      });
      return true;
    } catch (error) {
      this.putRecordFallback(record);
      return false;
    }
  }

  putRecordFallback(record) {
    try {
      const raw = window.localStorage.getItem(this.localStorageKey);
      const records = raw ? JSON.parse(raw) : [];
      const index = records.findIndex(item => item.id === record.id);
      if (index >= 0) {
        records[index] = record;
      } else {
        records.push(record);
      }
      window.localStorage.setItem(this.localStorageKey, JSON.stringify(records.slice(-500)));
    } catch (error) {
      console.warn('Could not write data checkpoint fallback storage:', error);
    }
  }

  async getPendingRecords(limit = this.maxBatchSize) {
    const now = Date.now();
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const request = tx.objectStore(this.storeName).getAll();
        request.onsuccess = () => {
          const records = (request.result || [])
            .filter(record => !record.uploaded && (!record.nextRetryAt || record.nextRetryAt <= now))
            .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0))
            .slice(0, limit);
          resolve(records);
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
      });
    } catch (_) {
      return this.getPendingRecordsFallback(limit, now);
    }
  }

  getPendingRecordsFallback(limit, now) {
    try {
      const raw = window.localStorage.getItem(this.localStorageKey);
      const records = raw ? JSON.parse(raw) : [];
      return records
        .filter(record => !record.uploaded && (!record.nextRetryAt || record.nextRetryAt <= now))
        .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0))
        .slice(0, limit);
    } catch (_) {
      return [];
    }
  }

  async updateRecord(record) {
    try {
      const db = await this.openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB update failed'));
      });
    } catch (_) {
      this.putRecordFallback(record);
    }
  }

  async enqueue(eventType, payload = {}, options = {}) {
    const sequenceNumber = this.nextSequenceNumber();
    const createdAt = new Date().toISOString();
    const participantId = this.safeId(this.participantIdProvider?.() || payload.participantId || 'unknown');
    const record = {
      id: `${this.sessionId}_${String(sequenceNumber).padStart(6, '0')}_${this.safeId(eventType)}`,
      sessionId: this.sessionId,
      sequenceNumber,
      eventType,
      participantId,
      createdAt,
      updatedAt: createdAt,
      uploaded: false,
      uploadedAt: null,
      uploadAttempts: 0,
      nextRetryAt: 0,
      lastError: null,
      payload,
      priority: options.priority || 'normal'
    };

    await this.putRecord(record);
    this.scheduleFlush();
    return record.id;
  }

  scheduleFlush(delayMs = this.flushDelayMs) {
    if (!this.uploadEnabled || !this.scriptUrl) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flush().catch(error => console.warn('Data checkpoint flush failed:', error));
    }, delayMs);
  }

  async flush(options = {}) {
    if (this.flushInProgress || !this.uploadEnabled || !this.scriptUrl) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    this.flushInProgress = true;
    try {
      const records = await this.getPendingRecords(options.limit || this.maxBatchSize);
      for (const record of records) {
        await this.uploadRecord(record);
      }
    } finally {
      this.flushInProgress = false;
    }

    const remaining = await this.getPendingRecords(1);
    if (remaining.length > 0) {
      this.scheduleFlush(1000);
    }
  }

  async uploadRecord(record) {
    try {
      const json = JSON.stringify(record);
      const base64 = this.toBase64(json);
      const formData = new FormData();
      formData.append('filename', this.getCheckpointFilename(record));
      formData.append('filedata', base64);
      formData.append('filetype', 'json');
      formData.append('checkpoint', 'true');
      formData.append('eventType', record.eventType);
      formData.append('sessionId', record.sessionId);
      formData.append('sequenceNumber', String(record.sequenceNumber));
      formData.append('participantId', record.participantId || '');

      await fetch(this.scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: formData,
        keepalive: json.length < 55000
      });

      record.uploaded = true;
      record.uploadedAt = new Date().toISOString();
      record.updatedAt = record.uploadedAt;
      record.lastError = null;
      await this.updateRecord(record);
    } catch (error) {
      record.uploadAttempts = (Number(record.uploadAttempts) || 0) + 1;
      record.updatedAt = new Date().toISOString();
      record.lastError = error?.message || String(error);
      const backoffMs = Math.min(5 * 60 * 1000, 5000 * Math.pow(2, Math.min(record.uploadAttempts, 6)));
      record.nextRetryAt = Date.now() + backoffMs;
      await this.updateRecord(record);
      throw error;
    }
  }

  toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  getCheckpointFilename(record) {
    const timestamp = String(record.createdAt || new Date().toISOString()).replace(/[:.]/g, '-');
    const participantId = this.safeId(record.participantId || 'unknown');
    const eventType = this.safeId(record.eventType || 'checkpoint');
    return `checkpoint_${participantId}_${this.sessionId}_${String(record.sequenceNumber).padStart(6, '0')}_${eventType}_${timestamp}.json`;
  }

  safeId(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  }

  async getStats() {
    const fallbackStats = () => {
      try {
        const raw = window.localStorage.getItem(this.localStorageKey);
        const records = raw ? JSON.parse(raw) : [];
        return {
          total: records.length,
          pending: records.filter(record => !record.uploaded).length,
          uploaded: records.filter(record => record.uploaded).length
        };
      } catch (_) {
        return { total: 0, pending: 0, uploaded: 0 };
      }
    };

    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const request = tx.objectStore(this.storeName).getAll();
        request.onsuccess = () => {
          const records = request.result || [];
          resolve({
            total: records.length,
            pending: records.filter(record => !record.uploaded).length,
            uploaded: records.filter(record => record.uploaded).length
          });
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB stats failed'));
      });
    } catch (_) {
      return fallbackStats();
    }
  }
}
