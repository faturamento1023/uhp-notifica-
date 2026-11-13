import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { atomic, digest, openStore, passwordHash, roles, token } from './store.mjs';

const [operation, ...args] = process.argv.slice(2);
const path = resolve(process.env.UHP_DB ?? 'data/uhp.sqlite');
process.umask(0o077);
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
closeSync(openSync(path, 'a', 0o600));
chmodSync(path, 0o600);
const db = openStore(path);

try {
  if (operation === 'unit' && args.length === 1 && args[0].trim()) {
    const unitId = randomUUID();
    const intakeToken = token();
    db.prepare('INSERT INTO units(id,name,intake_hash) VALUES (?,?,?)').run(unitId, args[0].trim(), digest(intakeToken));
    console.log(JSON.stringify({ unitId, intakeToken }));
  } else if (operation === 'rotate-intake' && args.length === 1) {
    const intakeToken = token();
    const result = db.prepare('UPDATE units SET intake_hash=? WHERE id=?').run(digest(intakeToken), args[0]);
    if (!result.changes) throw new Error('Unidade não encontrada.');
    console.log(JSON.stringify({ unitId: args[0], intakeToken }));
  } else if (operation === 'user' && args.length === 4) {
    const [unitId, rawEmail, role, rawName] = args;
    const email = rawEmail.trim().toLowerCase();
    const name = rawName.trim();
    const password = readFileSync(0, 'utf8').trim();
    if (!roles.includes(role) || !name || name.length > 180 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
      throw new Error('Dados de usuário inválidos.');
    }
    if (password.length < 14 || password.length > 256) throw new Error('A senha precisa ter de 14 a 256 caracteres.');
    const userId = randomUUID();
    db.prepare('INSERT INTO users(id,unit_id,email,name,role,password) VALUES (?,?,?,?,?,?)')
      .run(userId, unitId, email, name, role, passwordHash(password));
    console.log(JSON.stringify({ userId }));
  } else if (operation === 'disable-user' && args.length === 1) {
    atomic(db, () => {
      const result = db.prepare('UPDATE users SET active=0 WHERE id=?').run(args[0]);
      if (!result.changes) throw new Error('Usuário não encontrado.');
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(args[0]);
    });
  } else {
    throw new Error('Comandos: unit NOME | rotate-intake ID | user UNIDADE EMAIL PERFIL NOME (senha em stdin) | disable-user ID');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
