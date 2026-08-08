'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PATTERN = /^[A-Za-z0-9:._-]{16,128}$/;

function digestRequest(method, pathname, body) {
  return crypto.createHash('sha256').update(JSON.stringify({ method, pathname, body })).digest('hex');
}

class ResultLedger {
  constructor(options = {}) {
    this.retentionMs = options.retentionMs || 5 * 60_000;
    this.maxEntries = options.maxEntries || 500;
    this.filePath = options.filePath || null;
    this.now = options.now || Date.now;
    this.entries = new Map();
    this.load();
  }

  load() {
    if (!this.filePath) return;
    try {
      const payload = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(payload.entries)) return;
      for (const entry of payload.entries) {
        if (
          entry && typeof entry.cacheKey === 'string' && typeof entry.digest === 'string' &&
          typeof entry.expiresAt === 'number' && Number.isInteger(entry.status) &&
          entry.expiresAt > this.now()
        ) this.entries.set(entry.cacheKey, entry);
      }
      this.cleanup();
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const quarantine = `${this.filePath}.invalid-${this.now()}`;
        try { fs.renameSync(this.filePath, quarantine); } catch { /* startup continues with an empty ledger */ }
      }
    }
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    const persistent = [...this.entries.values()].filter((entry) => entry.persistent);
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, entries: persistent }, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600,
    });
    try { fs.chmodSync(temporary, 0o600); } catch { /* Windows has no POSIX mode. */ }
    fs.renameSync(temporary, this.filePath);
  }

  cleanup() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  prepare({ controllerId, idempotencyKey, deadline, method, pathname, body }) {
    this.cleanup();
    if (!KEY_PATTERN.test(idempotencyKey || '')) return { kind: 'error', status: 400, error: 'A valid idempotency key is required.' };
    const deadlineMs = Date.parse(deadline || '');
    if (!Number.isFinite(deadlineMs) || deadlineMs <= this.now()) return { kind: 'error', status: 408, error: 'The remote command deadline expired.' };
    const cacheKey = `${controllerId}:${idempotencyKey}`;
    const digest = digestRequest(method, pathname, body);
    const existing = this.entries.get(cacheKey);
    if (existing) {
      if (existing.digest !== digest) return { kind: 'error', status: 409, error: 'The idempotency key was reused for a different command.' };
      return { kind: 'replay', status: existing.status, body: existing.body };
    }
    return { kind: 'new', cacheKey, digest, idempotencyKey };
  }

  record(context, status, body, persistent = false) {
    this.entries.set(context.cacheKey, {
      cacheKey: context.cacheKey,
      idempotencyKey: context.idempotencyKey,
      digest: context.digest,
      status,
      body,
      persistent,
      expiresAt: this.now() + this.retentionMs,
    });
    this.cleanup();
    if (persistent) this.save();
  }

  acknowledge(controllerId, keys) {
    let removed = 0;
    for (const key of keys) {
      if (this.entries.delete(`${controllerId}:${key}`)) removed += 1;
    }
    if (removed > 0) this.save();
    return removed;
  }
}

module.exports = { ResultLedger, digestRequest };
