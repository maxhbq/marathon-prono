import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const dataDir = resolve(process.env.DATA_DIR || '.data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(resolve(dataDir, 'marathon.sqlite'));
chmodSync(resolve(dataDir, 'marathon.sqlite'), 0o600);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
 id INTEGER PRIMARY KEY, race_name TEXT NOT NULL DEFAULT 'Marathon de Lille',
 starts_at TEXT, closed INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
 roster_version INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO settings(id, starts_at) VALUES(1, '2026-10-25T08:00:00.000Z');
CREATE TABLE IF NOT EXISTS runners (
 id INTEGER PRIMARY KEY, race_id INTEGER NOT NULL REFERENCES settings(id), name TEXT NOT NULL, photo TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','finished','dnf','dns')),
 result_minutes INTEGER, result_position INTEGER
);
CREATE TABLE IF NOT EXISTS predictions (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 race_id INTEGER NOT NULL REFERENCES settings(id),
 items TEXT NOT NULL, roster_version INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id, race_id)
);
`);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
const dummyHash = hashPassword(randomBytes(24).toString('hex'));
export function verifyPassword(password, stored = dummyHash) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
