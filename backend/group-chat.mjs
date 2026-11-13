import { invalid, readJson, str } from './validation.mjs';

const pageSize = 50;
const columns = 'id::text AS id, author_name AS author, body, created_at AS "createdAt"';

export async function listGroupMessages(db, url) {
  const before = url.searchParams.get('before');
  if (before !== null && !/^[1-9][0-9]{0,17}$/.test(before)) invalid('before');
  const filter = before === null ? '' : 'WHERE id < ?';
  const args = before === null ? [] : [before];
  const rows = await db.all(
    `SELECT ${columns} FROM group_chat_messages ${filter} ORDER BY id DESC LIMIT ?`,
    ...args, pageSize + 1
  );
  const items = rows.slice(0, pageSize).reverse();
  return { items, before: rows.length > pageSize ? items[0].id : null };
}

export async function sendGroupMessage(db, request, user) {
  const input = await readJson(request, 8192);
  const message = str(input.message, 'mensagem', 1000);
  return db.get(
    `INSERT INTO group_chat_messages(author_id, author_name, body) VALUES (?,?,?) RETURNING ${columns}`,
    user.id, user.name, message
  );
}
