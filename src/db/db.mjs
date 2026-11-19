// SQLite bağlantısı (Node'un kendi node:sqlite modülü). WAL + synchronous=FULL: ani kapanmada son
// commit kaybolmaz.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

export function openDb(dataDir) {
  let db;
  if (dataDir === ':memory:') {
    db = new DatabaseSync(':memory:');
  } else {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(path.join(dataDir, 'musteri.db'));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 10000');
  db.exec(readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
  return db;
}

// BEGIN IMMEDIATE: yazma kilidini en başta alır.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
