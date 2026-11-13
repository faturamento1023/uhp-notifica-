import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createApi } from './api.mjs';
import { createStore, digest, passwordHash, token } from './store.mjs';

const origin = 'https://notifica.example.test';
const password = 'senha fictícia de teste';
const encodedPassword = passwordHash(password);

const migration = readFileSync(new URL('../supabase/migrations/20261113120820_uhp_notifica.sql', import.meta.url), 'utf8');

async function fixture(t) {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; BEGIN;');
  await db.exec(migration);
  await db.exec('COMMIT; SET search_path=uhp_notifica,pg_catalog; SET ROLE uhp_notifica_app;');
  const store = createStore(db, (work, readOnly) => db.transaction(async tx => {
    if (readOnly) await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return work(tx);
  }));
  const units = [];
  for (const intake of [token(), token()]) {
    const id = randomUUID();
    await store.run('INSERT INTO units VALUES (?,?,?)', id, 'Unidade de teste', digest(intake));
    units.push({ id, intake });
  }
  const users = [];
  const profiles = [
    ['coordination', 0], ['patient_safety', 0], ['ccih', 0], ['coordination', 1], ['patient_safety', 0]
  ];
  for (const [index, [role, unit]] of profiles.entries()) {
    const user = { id: randomUUID(), email: 'teste' + index + '@example.test', role };
    await store.run('INSERT INTO users(id,unit_id,email,name,role,password) VALUES (?,?,?,?,?,?)',
      user.id, units[unit].id, user.email, 'Conta de teste ' + index, role, encodedPassword);
    users.push(user);
  }
  const api = createApi(store, { origin, clock: () => new Date('2026-11-13T15:00:00Z') });
  async function call(method, path, { user, body, intake, status = 200, from = origin } = {}) {
    const headers = new Headers({ origin: from });
    if (user?.cookie) headers.set('cookie', user.cookie);
    if (intake) headers.set('x-intake-token', intake);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await api(new Request(origin + '/api/v1' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    }));
    const expected = Array.isArray(status) ? status : [status];
    assert(expected.includes(response.status), method + ' ' + path + (expected.includes(response.status) ? '' : ' ' + await response.clone().text()));
    return response;
  }
  async function login(user) {
    const response = await call('POST', '/session', { body: { email: user.email, password } });
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
    user.cookie = response.headers.get('set-cookie').split(';')[0];
  }
  const json = async (...args) => (await call(...args)).json();
  return { units, users, call, json, login, db };
}

test('recebe, encaminha, aprova e encerra caso com duas tratativas independentes', async t => {
  const { units, users, call, json, login } = await fixture(t);
  const [coord, safety, ccih, external, otherSafety] = users;
  await Promise.all(users.map(login));
  const draft = {
    requestId: randomUUID(), kind: 'incident', occurredOn: '2026-11-12', sector: 'Unidade de teste',
    period: 'Manhã', subject: 'Queda do paciente', harm: 'Nenhum (incidente sem dano)', description: 'Ocorrência fictícia.',
    entries: [['Raça/cor', 'Não informada']]
  };
  await call('POST', '/notifications', { body: draft, status: 403 });
  await call('POST', '/notifications', { body: draft, intake: units[0].intake, from: 'https://other.example.test', status: 403 });
  const intake = units[0].intake;
  const first = await Promise.all([0, 1].map(() => call('POST', '/notifications', { body: draft, intake, status: [200, 201] })));
  assert.deepEqual(first.map(response => response.status).sort(), [200, 201]);
  const [notification, duplicate] = await Promise.all(first.map(response => response.json()));
  assert.deepEqual(duplicate, notification);
  await call('POST', '/notifications', { body: { ...draft, sector: 'Outro setor' }, intake, status: 409 });
  await call('POST', '/notifications', { body: { ...draft, occurredOn: '2026-02-31' }, intake, status: 400 });
  const nc = { requestId: randomUUID(), kind: 'nonconformity', occurredOn: '2026-11-13', sector: 'Setor fictício', period: 'Tarde', description: 'Relato fictício.' };
  await call('POST', '/notifications', { body: nc, intake, status: 201 });
  assert.equal((await json('GET', '/notifications', { user: coord })).items.length, 2);
  assert.equal((await json('GET', '/notifications', { user: safety })).items.length, 0);
  const path = '/notifications/' + notification.id;
  await call('GET', path, { status: 401 });
  await call('GET', path, { user: external, status: 404 });
  await call('POST', path + '/close', { user: coord, body: { conclusion: 'Conclusão fictícia' }, status: 409 });
  const deadline = { opinionDue: '2026-11-12', actionsDue: '2026-11-12' };
  const safetyAssignment = await json('POST', path + '/assignments', { user: coord, body: { area: safety.role, assigneeId: safety.id, ...deadline }, status: 201 });
  const ccihAssignment = await json('POST', path + '/assignments', { user: coord, body: { area: ccih.role, assigneeId: ccih.id, ...deadline }, status: 201 });
  assert.equal(safetyAssignment.overdue.opinion, true);
  const scoped = await json('GET', path, { user: safety });
  assert.deepEqual(scoped.assignments.map(row => row.id), [safetyAssignment.id]);
  assert.equal(scoped.history.length, 1);
  await call('GET', path, { user: otherSafety, status: 404 });
  await call('POST', '/assignments/' + ccihAssignment.id + '/submit', { user: safety, body: { body: 'Fictício' }, status: 404 });
  const main = '/assignments/' + safetyAssignment.id;
  await call('POST', main + '/draft', { user: safety, body: { body: 'Primeiro parecer' } });
  await call('POST', main + '/submit', { user: safety, body: {} });
  await call('POST', main + '/decision', { user: safety, body: { version: 1, decision: 'approved' }, status: 403 });
  await call('POST', main + '/decision', { user: coord, body: { version: 1, decision: 'rejected' }, status: 400 });
  await call('POST', main + '/decision', { user: coord, body: { version: 1, decision: 'rejected', reason: 'Completar descrição' } });
  await call('POST', main + '/submit', { user: safety, body: { body: 'Parecer revisado' } });
  await call('POST', main + '/decision', { user: coord, body: { version: 1, decision: 'approved' }, status: 409 });
  await call('POST', main + '/decision', { user: coord, body: { version: 2, decision: 'approved' } });
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX9sAAAAASUVORK5CYII=', 'base64');
  for (const [area, assignment] of [[safety, safetyAssignment], [ccih, ccihAssignment]]) {
    const base = '/assignments/' + assignment.id;
    if (area === ccih) {
      await call('POST', base + '/submit', { user: area, body: { body: 'Parecer CCIH' } });
      await call('POST', base + '/decision', { user: coord, body: { version: 1, decision: 'approved' } });
    }
    const action = await json('POST', base + '/actions', { user: area, body: { description: 'Ação fictícia', performedOn: '2026-11-13' }, status: 201 });
    await call('POST', base + '/submit-actions', { user: area, body: {}, status: 409 });
    const uploadPath = '/actions/' + action.id + '/evidence';
    await call('POST', uploadPath, { user: area, body: { name: 'teste.png', mime: 'image/png', contentBase64: 'Zm9v' }, status: 400 });
    const evidence = await json('POST', uploadPath, { user: area, body: { name: 'teste.png', mime: 'image/png', contentBase64: bytes.toString('base64') }, status: 201 });
    const download = '/evidence/' + evidence.id;
    await call('GET', download, { user: area === safety ? ccih : safety, status: 404 });
    await call('GET', download, { user: external, status: 404 });
    const response = await call('GET', download, { user: coord });
    assert.match(response.headers.get('content-disposition'), /^attachment/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    await call('POST', base + '/submit-actions', { user: area, body: {} });
    const latestSubmission = async () => (await json('GET', path, { user: coord })).history.findLast(e => e.assignmentId === assignment.id && e.event === 'actions_submitted').id;
    let submissionId = await latestSubmission();
    if (area === safety) {
      await call('POST', base + '/validate', { user: coord, body: { submissionId, decision: 'complement', reason: 'Adicionar evidência complementar' } });
      await call('POST', uploadPath, { user: area, body: { name: 'complemento.png', mime: 'image/png', contentBase64: bytes.toString('base64') }, status: 201 });
      await call('POST', base + '/submit-actions', { user: area, body: {} });
      await call('POST', base + '/validate', { user: coord, body: { submissionId, decision: 'validated' }, status: 409 });
      submissionId = await latestSubmission();
    }
    await call('POST', base + '/validate', { user: coord, body: { submissionId, decision: 'validated' } });
    if (area === safety) await call('POST', path + '/close', { user: coord, body: { conclusion: 'Ainda pendente' }, status: 409 });
  }
  const closed = await json('POST', path + '/close', { user: coord, body: { conclusion: 'Conclusão fictícia' } });
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.assignments.find(item => item.id === safetyAssignment.id).opinions.map(item => item.decision), ['rejected', 'approved']);
  await call('POST', main + '/actions', { user: safety, body: {}, status: 409 });
  await call('DELETE', '/session', { user: safety, status: 204 });
  await call('GET', path, { user: safety, status: 401 });
});

test('troca o responsável, limita o acesso da conta anterior e mantém o histórico', async t => {
  const { units, users, call, json, login } = await fixture(t);
  const [coord, safety, , , replacement] = users;
  await Promise.all([coord, safety, replacement].map(login));
  const { id } = await json('POST', '/notifications', {
    body: { requestId: randomUUID(), kind: 'nonconformity', occurredOn: '2026-11-13', period: 'Noite', sector: 'Teste', description: 'Ocorrência fictícia.' },
    intake: units[0].intake, status: 201
  });
  const path = '/notifications/' + id;
  const assignment = await json('POST', path + '/assignments', {
    user: coord, body: { area: safety.role, assigneeId: safety.id, opinionDue: '2026-11-13', actionsDue: '2026-11-14' }, status: 201
  });
  await call('POST', '/assignments/' + assignment.id + '/reassign', {
    user: coord, body: { assigneeId: replacement.id, opinionDue: '2026-11-14', actionsDue: '2026-11-15', reason: 'Substituição fictícia' }
  });
  await call('GET', path, { user: safety, status: 404 });
  const detail = await json('GET', path, { user: replacement });
  assert.equal(detail.assignments[0].assigneeId, replacement.id);
  assert.equal(detail.history.at(-1).event, 'assignment_updated');
});

test('gera PDF A4 institucional no navegador apenas para a Coordenação', async t => {
  const { units, users, call, json, login } = await fixture(t);
  const [coord, safety, , external] = users;
  await Promise.all([coord, safety, external].map(login));
  const record = await json('POST', '/notifications', {
    body: {
      requestId: randomUUID(), kind: 'incident', occurredOn: '2026-11-12',
      sector: 'Internação', period: 'Manhã', subject: 'Queda do paciente',
      harm: 'Leve', description: 'Ocorrência fictícia para conferência do PDF.',
      entries: [['Fatores contribuintes', 'Comunicação entre equipes']],
      photo: { name: 'foto-ficticia.png', mime: 'image/png',
        contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX9sAAAAASUVORK5CYII=' }
    },
    intake: units[0].intake, status: 201
  });
  const path = '/notifications/' + record.id + '/pdf';
  await call('GET', path, { status: 401 });
  await call('GET', path, { user: safety, status: 403 });
  await call('GET', path, { user: external, status: 404 });
  const response = await call('GET', path, { user: coord });
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /^inline; filename="UHP-/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  assert(pdf.context.enumerateIndirectObjects().filter(([, object]) => object?.dict?.get?.(PDFName.of('Subtype'))?.toString() === '/Image').length >= 3);
});

test('anexa foto opcional nos dois tipos e restringe sua visualização', async t => {
  const { units, users, call, json, login } = await fixture(t);
  const [coord, safety, ccih, external] = users;
  await Promise.all([coord, safety, ccih, external].map(login));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX9sAAAAASUVORK5CYII=';
  const photo = { name: 'foto-ficticia.png', mime: 'image/png', contentBase64: png };
  const common = { occurredOn: '2026-11-13', period: 'Tarde', sector: 'Teste', description: 'Ocorrência fictícia.' };
  const intake = units[0].intake;
  for (const data of [{ kind: 'nonconformity' }, { kind: 'incident', subject: 'Queda do paciente', harm: 'Nenhum (incidente sem dano)' }]) {
    const body = { ...common, ...data, requestId: randomUUID(), photo };
    const record = await json('POST', '/notifications', { body, intake, status: 201 });
    assert.deepEqual(await json('POST', '/notifications', { body, intake }), record);
    await call('POST', '/notifications', { body: { ...body, photo: { ...photo, name: 'outra.png' } }, intake, status: 409 });
    const path = '/notifications/' + record.id;
    const detail = await json('GET', path, { user: coord });
    assert.deepEqual(detail.photo, { name: photo.name, mime: photo.mime, size: Buffer.from(png, 'base64').length });
    assert.equal(detail.history[0].detail.photoAttached, true);
    await call('GET', path + '/photo', { status: 401 });
    await call('GET', path + '/photo', { user: external, status: 404 });
    await call('GET', path + '/photo', { user: safety, status: 404 });
    await call('POST', path + '/assignments', {
      user: coord, body: { area: safety.role, assigneeId: safety.id, opinionDue: '2026-11-13', actionsDue: '2026-11-14' }, status: 201
    });
    const image = await call('GET', path + '/photo', { user: safety });
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
    await call('GET', path + '/photo', { user: ccih, status: 404 });
  }
  const plain = { ...common, kind: 'nonconformity', requestId: randomUUID() };
  for (const bad of [null, { ...photo, mime: 'image/jpeg' }, { ...photo, mime: 'application/pdf' }]) {
    await call('POST', '/notifications', { body: { ...plain, photo: bad }, intake, status: 400 });
  }
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
  Buffer.from(png, 'base64').copy(oversized);
  await call('POST', '/notifications', {
    body: { ...plain, photo: { ...photo, contentBase64: oversized.toString('base64') } }, intake, status: 400
  });
  const record = await json('POST', '/notifications', { body: plain, intake, status: 201 });
  assert.equal((await json('GET', '/notifications/' + record.id, { user: coord })).photo, null);
  await call('GET', '/notifications/' + record.id + '/photo', { user: coord, status: 404 });
});


test('bloqueia acesso direto aos dados assistenciais pelos papéis da Data API', async t => {
  const { db } = await fixture(t);
  await db.exec('RESET ROLE');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const privileges = await db.query(
      "SELECT has_schema_privilege($1, 'uhp_notifica', 'USAGE') AS schema_access, has_table_privilege($1, 'uhp_notifica.notifications', 'SELECT') AS table_access", [role]);
    assert.deepEqual(privileges.rows[0], { schema_access: false, table_access: false });
  }
  const tables = await db.query(`SELECT relname, relrowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='uhp_notifica' AND c.relkind='r'`);
  assert.equal(tables.rows.length, 11);
  assert(tables.rows.every(row => row.relrowsecurity));
});
