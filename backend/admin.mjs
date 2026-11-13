import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { digest, openStore, passwordHash, roles, token } from './store.mjs';

const [operation, ...args] = process.argv.slice(2);
const db = openStore();

try {
  if (operation === 'unit' && args.length === 1 && args[0].trim()) {
    const unitId = randomUUID();
    const intakeToken = token();
    await db.run('INSERT INTO units(id,name,intake_hash) VALUES (?,?,?)', unitId, args[0].trim(), digest(intakeToken));
    console.log(JSON.stringify({ unitId, intakeToken }));
  } else if (operation === 'rotate-intake' && args.length === 1) {
    const intakeToken = token();
    const result = await db.run('UPDATE units SET intake_hash=? WHERE id=?', digest(intakeToken), args[0]);
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
    await db.run('INSERT INTO users(id,unit_id,email,name,role,password) VALUES (?,?,?,?,?,?)', userId, unitId, email, name, role, passwordHash(password));
    console.log(JSON.stringify({ userId }));
  } else if (operation === 'disable-user' && args.length === 1) {
    await db.atomic(async () => {
      const result = await db.run('UPDATE users SET active=0 WHERE id=?', args[0]);
      if (!result.changes) throw new Error('Usuário não encontrado.');
      await db.run('DELETE FROM sessions WHERE user_id=?', args[0]);
    });
  } else if (operation === 'prune-expired' && args.length === 0) {
    const now = Date.now();
    await db.atomic(async () => {
      await db.run('DELETE FROM sessions WHERE expires<=?', now);
      await db.run('DELETE FROM rate_limits WHERE expires<=?', now);
    });
  } else {
    throw new Error('Comandos: unit NOME | rotate-intake ID | user UNIDADE EMAIL PERFIL NOME (senha em stdin) | disable-user ID | prune-expired');
  }
} catch (error) {
  console.error(error.code ? "Falha no banco (" + error.code + ")." : error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
