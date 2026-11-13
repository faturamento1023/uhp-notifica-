import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = new URL(process.argv[2]);
assert.equal(base.protocol, 'https:', 'Use a URL HTTPS da homologação.');
assert.equal(base.origin + '/', base.href, 'Informe apenas a origem do Deploy Preview.');
const intake = process.env.UHP_TEST_INTAKE_TOKEN;
const credentials = [
  ['coordination', 'UHP_TEST_COORD_EMAIL', 'UHP_TEST_COORD_PASSWORD'],
  ['patient_safety', 'UHP_TEST_SAFETY_EMAIL', 'UHP_TEST_SAFETY_PASSWORD'],
  ['ccih', 'UHP_TEST_CCIH_EMAIL', 'UHP_TEST_CCIH_PASSWORD']
];

async function request(method, path, { body, cookie, intakeToken, status = 200 } = {}) {
  const headers = { origin: base.origin };
  if (cookie) headers.cookie = cookie;
  if (intakeToken) headers['x-intake-token'] = intakeToken;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const result = await fetch(new URL('/api/v1' + path, base), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20000)
  });
  assert.equal(result.status, status, method + ' ' + path);
  return result;
}

const health = await (await request('GET', '/health')).json();
assert.equal(health.status, 'ok');
await request('GET', '/session', { status: 401 });
console.log('Conexão com o banco e exigência de sessão verificadas.');
if (!process.argv.includes('--full')) process.exit(0);

assert.equal(health.provisioned, true, 'Cadastre a unidade fictícia primeiro.');
assert(intake, 'Configure UHP_TEST_INTAKE_TOKEN para a unidade fictícia.');
for (const [, emailKey, passwordKey] of credentials) {
  assert(process.env[emailKey]?.endsWith('@example.test'), 'Use uma conta fictícia em ' + emailKey);
  assert(process.env[passwordKey], 'Configure ' + passwordKey);
}

const accounts = new Map();
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX9sAAAAASUVORK5CYII=';
const photo = { name: 'homologacao.png', mime: 'image/png', contentBase64: png };
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const input = {
  requestId: randomUUID(), kind: 'incident', occurredOn: today, sector: 'Unidade fictícia',
  period: 'Tarde', subject: 'Queda do paciente', harm: 'Nenhum (incidente sem dano)',
  description: 'Registro fictício gerado pelo teste de homologação.', photo
};

try {
  for (const [role, emailKey, passwordKey] of credentials) {
    const login = await request('POST', '/session', { body: { email: process.env[emailKey], password: process.env[passwordKey] } });
    const session = login.headers.get('set-cookie');
    assert(session?.startsWith('__Host-uhp_session=') && /;\s*Secure/i.test(session), 'Cookie seguro ausente.');
    const account = await login.json();
    accounts.set(role, { ...account, cookie: session.split(';')[0] });
    assert.equal(account.role, role);
  }

  const coord = accounts.get('coordination');
  const safety = accounts.get('patient_safety');
  const ccih = accounts.get('ccih');
  assert(accounts.values().every(account => account.unitId === coord.unitId), 'As contas precisam estar na mesma unidade fictícia.');
  const { id, protocol } = await (await request('POST', '/notifications', { body: input, intakeToken: intake, status: 201 })).json();
  const notification = '/notifications/' + id;
  const retry = await (await request('POST', '/notifications', { body: input, intakeToken: intake })).json();
  assert.equal(retry.protocol, protocol);
  await request('GET', notification + '/photo', { cookie: safety.cookie, status: 404 });
  await request('POST', notification + '/close', { cookie: coord.cookie, body: { conclusion: 'Teste de bloqueio' }, status: 409 });

  for (const [area, other] of [[safety, ccih], [ccih, safety]]) {
    const assigned = await (await request('POST', notification + '/assignments', {
      cookie: coord.cookie, body: { area: area.role, assigneeId: area.id, opinionDue: today, actionsDue: today }, status: 201
    })).json();
    const img = await request('GET', notification + '/photo', { cookie: area.cookie });
    assert.equal(Buffer.from(await img.arrayBuffer()).toString('base64'), png);
    const treatment = '/assignments/' + assigned.id;
    await request('POST', treatment + '/submit', { cookie: area.cookie, body: { body: 'Parecer fictício.' } });
    await request('POST', treatment + '/decision', { cookie: coord.cookie, body: { version: 1, decision: 'approved' } });
    const action = await (await request('POST', treatment + '/actions', {
      cookie: area.cookie, body: { description: 'Ação fictícia', performedOn: today }, status: 201
    })).json();
    const evidence = await (await request('POST', '/actions/' + action.id + '/evidence', { cookie: area.cookie, body: photo, status: 201 })).json();
    await request('GET', '/evidence/' + evidence.id, { cookie: other.cookie, status: 404 });
    await request('POST', treatment + '/submit-actions', { cookie: area.cookie, body: {} });
    const detail = await (await request('GET', notification, { cookie: coord.cookie })).json();
    const submission = detail.history.findLast(event => event.assignmentId === assigned.id && event.event === 'actions_submitted');
    assert(submission, 'Envio de ações ausente do histórico.');
    await request('POST', treatment + '/validate', { cookie: coord.cookie, body: { submissionId: submission.id, decision: 'validated' } });
  }
  const closed = await (await request('POST', notification + '/close', { cookie: coord.cookie, body: { conclusion: 'Homologação fictícia concluída.' } })).json();
  assert.equal(closed.status, 'closed');
  console.log('Fluxo de homologação concluído com foto, pareceres e evidências nas duas áreas.');
} finally {
  const results = await Promise.allSettled([...accounts.values()].map(({ cookie }) => request('DELETE', '/session', { cookie, status: 204 })));
  if (results.some(result => result.status === 'rejected')) console.error('Ao menos uma sessão de teste não pôde ser encerrada.');
}
