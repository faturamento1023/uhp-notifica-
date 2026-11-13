import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
export const roles = Object.freeze(['coordination', 'patient_safety', 'ccih']);
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');

export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function passwordMatches(password, encoded) {
  const [salt, key] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}

export function openStore(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON');
  db.exec(schema);
  return db;
}

export function atomic(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
