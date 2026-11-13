import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

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

export function createStore(connection, transaction) {
  const context = new AsyncLocalStorage();
  async function query(sql, ...params) {
    let index = 0;
    // The API's fixed SQL strings use ? placeholders. Values stay separate from SQL.
    const statement = sql.replaceAll('?', () => '$' + ++index);
    return (context.getStore() ?? connection).query(statement, params);
  }
  return {
    get: async (sql, ...params) => (await query(sql, ...params)).rows[0],
    all: async (sql, ...params) => (await query(sql, ...params)).rows,
    run: async (sql, ...params) => ({ changes: (await query(sql, ...params)).rowCount }),
    atomic: work => transaction(client => context.run(client, work), false),
    read: work => transaction(client => context.run(client, work), true)
  };
}

export function openStore(env = process.env) {
  if (!env.UHP_DATABASE_URL) throw new Error('Configure UHP_DATABASE_URL no servidor.');
  const endpoint = new URL(env.UHP_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(endpoint.protocol) || endpoint.search) {
    throw new Error('Use uma URL PostgreSQL sem parâmetros. Configure o certificado em UHP_DB_CA_FILE.');
  }
  const ca = env.UHP_DB_CA_FILE ? readFileSync(env.UHP_DB_CA_FILE, 'utf8') : undefined;
  const pool = new pg.Pool({
    connectionString: env.UHP_DATABASE_URL,
    ssl: { rejectUnauthorized: true, ca },
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 20000
  });
  pool.on('error', error => console.error('Falha em conexão ociosa do PostgreSQL', error.code ?? 'unknown'));

  const store = createStore(pool, async (work, readOnly) => {
    const client = await pool.connect();
    let broken;
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        broken = rollbackError;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  });
  return { ...store, close: () => pool.end() };
}
