import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { digest, passwordHash, passwordMatches, roles, token } from './store.mjs';
import { notificationPdf } from './notification-pdf.mjs';
import { conflict, day, fail, forbidden, HttpError, id, invalid, oneOf, readJson, str, unavailable } from './validation.mjs';

const areas = roles.slice(1);
const kinds = ['nonconformity', 'incident'];
const harmLevels = ['Nenhum (incidente sem dano)', 'Leve', 'Moderado', 'Grave', 'Óbito em decorrência do evento adverso'];
const periods = ['Manhã', 'Tarde', 'Noite', 'Madrugada'];
const timeZone = 'America/Sao_Paulo';
const dummyHash = passwordHash(token());
const sessionSeconds = 8 * 60 * 60;
const defaultEvidenceLimit = 5 * 1024 * 1024;
const photoLimit = 2 * 1024 * 1024;
const photoTypes = ['image/jpeg', 'image/png'];
const evidenceTypes = {
  'application/pdf': bytes => bytes.subarray(0, 5).equals(Buffer.from('%PDF-')),
  'image/png': bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': bytes => bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
};

function today(now) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return date.year + '-' + date.month + '-' + date.day;
}

function notificationInput(body) {
  const kind = oneOf(body.kind, kinds, 'kind');
  const entries = body.entries ?? [];
  if (!Array.isArray(entries) || entries.length > 30) invalid('entries');
  const extra = entries.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) invalid('entries');
    return [str(entry[0], 'entries.label', 160), str(entry[1], 'entries.value', 5000)];
  });
  return {
    kind,
    occurredOn: day(body.occurredOn, 'occurredOn'),
    sector: str(body.sector, 'sector', 120, kind === 'incident'),
    period: oneOf(body.period, periods, 'period'),
    description: str(body.description, 'description', 5000),
    subject: kind === 'incident' ? str(body.subject, 'subject', 240) : '',
    harm: kind === 'incident' ? oneOf(body.harm, harmLevels, 'harm') : '',
    entries: extra
  };
}

function decodeEvidence(body, allowedTypes = Object.keys(evidenceTypes), limit = defaultEvidenceLimit) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('photo');
  const mime = oneOf(body.mime, allowedTypes, 'mime');
  const name = str(body.name, 'name', 180);
  const base64 = str(body.contentBase64, 'contentBase64', Math.ceil(limit / 3) * 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4) invalid('contentBase64');
  const content = Buffer.from(base64, 'base64');
  if (content.length > limit || !evidenceTypes[mime](content)) invalid('contentBase64');
  return { mime, name, content };
}

export function createApi(db, { origin, clock = () => new Date(), evidenceLimit = defaultEvidenceLimit }) {
  const secure = new URL(origin).protocol === 'https:';
  const cookieName = secure ? '__Host-uhp_session' : 'uhp_session';
  const { get, all, run, atomic } = db;

  function json(data, status = 200, headers = {}) {
    return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
  }

  function cookie(raw, duration) {
    return cookieName + '=' + raw + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + duration + (secure ? '; Secure' : '');
  }

  function sessionKey(request) {
    const match = request.headers.get('cookie')?.match(new RegExp('(?:^|;\\s*)' + cookieName + '=([a-f0-9]{64})(?:;|$)'));
    return match ? digest(match[1]) : '';
  }

  async function actor(request) {
    const user = await get(`SELECT u.id, u.unit_id AS "unitId", u.email, u.name, u.role FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.active=1`, sessionKey(request), +clock());
    if (!user) fail(401, 'unauthorized', 'Faça login para acessar o painel.');
    return user;
  }

  function coordinator(user) {
    if (user.role !== 'coordination') forbidden();
  }

  async function throttle(key, count, seconds) {
    const now = +clock();
    const allowed = await get(`INSERT INTO rate_limits(key, attempts, expires) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET
        attempts=CASE WHEN rate_limits.expires<=? THEN 1 ELSE rate_limits.attempts+1 END,
        expires=CASE WHEN rate_limits.expires<=? THEN excluded.expires ELSE rate_limits.expires END
      WHERE rate_limits.expires<=? OR rate_limits.attempts<?
      RETURNING attempts`, key, now + seconds * 1000, now, now, now, count);
    if (!allowed) fail(429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  async function notification(user, notificationId, lock = false) {
    const record = await get('SELECT * FROM notifications WHERE id=? AND unit_id=?' + (lock ? ' FOR UPDATE' : ''), notificationId, user.unitId);
    if (!record) unavailable();
    if (user.role !== 'coordination' && !await get('SELECT id FROM assignments WHERE notification_id=? AND assignee_id=? AND area=?', notificationId, user.id, user.role)) unavailable();
    return record;
  }

  async function assignment(user, assignmentId, lock = false) {
    if (lock) {
      const parent = await get('SELECT notification_id FROM assignments WHERE id=?', assignmentId);
      if (!parent) unavailable();
      await notification(user, parent.notification_id, true);
    }
    const row = await get(`SELECT a.*, n.status AS notification_status FROM assignments a
      JOIN notifications n ON n.id=a.notification_id WHERE a.id=? AND n.unit_id=?`, assignmentId, user.unitId);
    if (!row || (user.role !== 'coordination' && (row.assignee_id !== user.id || row.area !== user.role))) unavailable();
    return row;
  }

  function requireState(row, states) {
    if (row.notification_status === 'closed' || !states.includes(row.status)) {
      conflict('A operação não está disponível na etapa atual.');
    }
  }

  function areaOwner(user) {
    if (user.role === 'coordination') forbidden();
  }

  async function audit(notificationId, assignmentId, actorId, event, detail = null) {
    await run('INSERT INTO history(notification_id,assignment_id,actor_id,event,detail,created_at) VALUES (?,?,?,?,?,?)',
      notificationId, assignmentId, actorId, event, detail === null ? null : JSON.stringify(detail), clock().toISOString());
  }

  function assignmentView(row) {
    const date = today(clock());
    const awaitingOpinion = ['draft', 'revision', 'pending_approval'].includes(row.status);
    const awaitingActions = ['actions', 'pending_validation', 'complement'].includes(row.status);
    return {
      id: row.id, notificationId: row.notification_id, area: row.area, assigneeId: row.assignee_id,
      opinionDue: row.opinion_due, actionsDue: row.actions_due, status: row.status,
      overdue: { opinion: awaitingOpinion && row.opinion_due < date, actions: awaitingActions && row.actions_due < date }
    };
  }

  async function detail(user, row) {
    const assignments = user.role === 'coordination'
      ? await all('SELECT * FROM assignments WHERE notification_id=? ORDER BY area', row.id)
      : await all('SELECT * FROM assignments WHERE notification_id=? AND assignee_id=? AND area=?', row.id, user.id, user.role);
    const events = user.role === 'coordination'
      ? await all('SELECT * FROM history WHERE notification_id=? ORDER BY id', row.id)
      : await all(`SELECT h.* FROM history h JOIN assignments a ON a.id=h.assignment_id
        WHERE h.notification_id=? AND a.assignee_id=? AND a.area=? ORDER BY h.id`, row.id, user.id, user.role);
    const treatments = [];
    for (const item of assignments) {
      const opinions = await all(`SELECT version, body, submitted_by AS "submittedBy", submitted_at AS "submittedAt",
        decision, reason, decided_by AS "decidedBy", decided_at AS "decidedAt"
        FROM opinions WHERE assignment_id=? ORDER BY version`, item.id);
      const actions = await all(`SELECT id, description, performed_on AS "performedOn", created_by AS "createdBy", created_at AS "createdAt"
        FROM actions WHERE assignment_id=? ORDER BY created_at,id`, item.id);
      const attachments = await all(`SELECT e.action_id, e.id, e.name, e.mime, octet_length(e.content) AS size, e.created_at AS "createdAt"
        FROM evidence e JOIN actions a ON a.id=e.action_id WHERE a.assignment_id=? ORDER BY e.created_at,e.id`, item.id);
      const byAction = new Map(actions.map(action => [action.id, []]));
      for (const { action_id, ...attachment } of attachments) byAction.get(action_id).push(attachment);
      treatments.push({
        ...assignmentView(item),
        draft: item.assignee_id === user.id ? item.draft : null,
        opinions,
        actions: actions.map(action => ({ ...action, evidence: byAction.get(action.id) }))
      });
    }
    return {
      id: row.id, protocol: row.protocol, status: row.status, createdAt: row.created_at, ...JSON.parse(row.payload),
      closure: row.closure, closedAt: row.closed_at, closedBy: row.closed_by,
      photo: await get('SELECT name,mime,octet_length(content) AS size FROM notification_photos WHERE notification_id=?', row.id) ?? null,
      assignments: treatments,
      history: events.map(event => ({
        id: event.id, assignmentId: event.assignment_id, actorId: event.actor_id,
        event: event.event, detail: event.detail === null ? null : JSON.parse(event.detail), createdAt: event.created_at
      }))
    };
  }

  async function queue(user, url) {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) invalid('offset');
    const limit = 30;
    const found = user.role === 'coordination'
      ? await all('SELECT * FROM notifications WHERE unit_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?', user.unitId, limit + 1, offset)
      : await all(`SELECT n.* FROM notifications n JOIN assignments a ON a.notification_id=n.id
        WHERE n.unit_id=? AND a.assignee_id=? AND a.area=? ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`,
        user.unitId, user.id, user.role, limit + 1, offset);
    const page = found.slice(0, limit);
    const ids = page.map(row => row.id);
    const scoped = user.role === 'coordination'
      ? await all('SELECT * FROM assignments WHERE notification_id=ANY(?::text[]) ORDER BY area', ids)
      : await all('SELECT * FROM assignments WHERE notification_id=ANY(?::text[]) AND assignee_id=? AND area=?', ids, user.id, user.role);
    const byNotification = new Map(ids.map(notificationId => [notificationId, []]));
    for (const row of scoped) byNotification.get(row.notification_id).push(assignmentView(row));
    return {
      items: page.map(row => {
        const { kind, sector, occurredOn, subject, harm } = JSON.parse(row.payload);
        return { id: row.id, protocol: row.protocol, status: row.status, createdAt: row.created_at, kind, sector, occurredOn, subject, harm, assignments: byNotification.get(row.id) };
      }),
      nextOffset: found.length > limit ? offset + limit : null
    };
  }

  async function updateAssignment(user, row, operation, body) {
    const timestamp = clock().toISOString();
    let status;
    let event;
    let metadata = null;
    if (operation === 'draft' || operation === 'submit') {
      areaOwner(user);
      requireState(row, ['draft', 'revision']);
      if (operation === 'draft') {
        const draft = str(body.body, 'body', 12000, true);
        await run('UPDATE assignments SET draft=? WHERE id=?', draft, row.id);
        return { ...assignmentView(row), draft };
      }
      const opinion = str(body.body ?? row.draft, 'body', 12000);
      const version = (await get('SELECT coalesce(max(version),0)+1 AS next FROM opinions WHERE assignment_id=?', row.id)).next;
      await run('INSERT INTO opinions(assignment_id,version,body,submitted_by,submitted_at) VALUES (?,?,?,?,?)', row.id, version, opinion, user.id, timestamp);
      await run('UPDATE assignments SET draft=NULL WHERE id=?', row.id);
      status = 'pending_approval';
      event = 'opinion_submitted';
      metadata = { version };
    } else if (operation === 'decision') {
      coordinator(user);
      requireState(row, ['pending_approval']);
      const decision = oneOf(body.decision, ['approved', 'rejected'], 'decision');
      const reason = str(body.reason, 'reason', 3000, decision === 'approved');
      const version = (await get('SELECT max(version) AS version FROM opinions WHERE assignment_id=?', row.id)).version;
      if (body.version !== version) conflict('O parecer mudou. Atualize a tela antes de decidir.');
      await run('UPDATE opinions SET decision=?,reason=?,decided_by=?,decided_at=? WHERE assignment_id=? AND version=?', decision, reason, user.id, timestamp, row.id, version);
      status = decision === 'approved' ? 'actions' : 'revision';
      event = decision === 'approved' ? 'opinion_approved' : 'opinion_rejected';
      metadata = { version, reason };
    } else if (operation === 'submit-actions') {
      areaOwner(user);
      requireState(row, ['actions', 'complement']);
      const counts = await get(`SELECT count(e.id)::integer AS attachments FROM actions a
        LEFT JOIN evidence e ON e.action_id=a.id WHERE a.assignment_id=?`, row.id);
      const missing = await get(`SELECT a.id FROM actions a WHERE a.assignment_id=? AND NOT EXISTS
        (SELECT 1 FROM evidence e WHERE e.action_id=a.id) LIMIT 1`, row.id);
      if (!counts.attachments || missing) conflict('Registre pelo menos uma ação e anexe evidência a cada ação.');
      status = 'pending_validation';
      event = 'actions_submitted';
    } else {
      coordinator(user);
      requireState(row, ['pending_validation']);
      const latest = (await get("SELECT max(id) AS id FROM history WHERE assignment_id=? AND event='actions_submitted'", row.id)).id;
      if (body.submissionId !== latest) conflict('As ações foram reenviadas. Atualize a tela antes de decidir.');
      const decision = oneOf(body.decision, ['validated', 'complement'], 'decision');
      const reason = str(body.reason, 'reason', 3000, decision === 'validated');
      status = decision;
      event = decision === 'validated' ? 'actions_validated' : 'actions_complement_requested';
      metadata = { reason };
    }
    await run('UPDATE assignments SET status=? WHERE id=?', status, row.id);
    await audit(row.notification_id, row.id, user.id, event, metadata);
    return assignmentView({ ...row, status });
  }

  return async function handle(request, clientAddress = 'local') {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      if (method !== 'GET' && request.headers.get('origin') !== origin) forbidden();

      if (method === 'POST' && path === '/api/v1/session') {
        const body = await readJson(request);
        const email = str(body.email, 'email', 254).toLowerCase();
        const password = str(body.password, 'password', 256);
        await throttle('login:address:' + clientAddress, 30, 900);
        await throttle('login:email:' + digest(email), 8, 900);
        const user = await get('SELECT * FROM users WHERE email=? AND active=1', email);
        if (!passwordMatches(password, user?.password ?? dummyHash) || !user) {
          fail(401, 'invalid_credentials', 'E-mail ou senha inválidos.');
        }
        const raw = token();
        await atomic(async () => {
          await run('DELETE FROM sessions WHERE expires<=? OR hash=?', +clock(), sessionKey(request));
          await run('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)', digest(raw), user.id, +clock() + sessionSeconds * 1000);
          await run('DELETE FROM rate_limits WHERE key=?', 'login:email:' + digest(email));
        });
        return json({ id: user.id, unitId: user.unit_id, email: user.email, name: user.name, role: user.role }, 200, { 'set-cookie': cookie(raw, sessionSeconds) });
      }

      if (method === 'POST' && path === '/api/v1/notifications') {
        const intake = request.headers.get('x-intake-token');
        if (!intake || !/^[a-f0-9]{64}$/.test(intake)) forbidden();
        const unit = await get('SELECT id FROM units WHERE intake_hash=?', digest(intake));
        if (!unit) forbidden();
        const body = await readJson(request, 160000 + Math.ceil(photoLimit / 3) * 4);
        const payload = notificationInput(body);
        const requestId = id(body.requestId, 'requestId');
        const encoded = JSON.stringify(payload);
        const photo = body.photo === undefined ? null : decodeEvidence(body.photo, photoTypes, photoLimit);
        const hash = digest(photo ? JSON.stringify([encoded, photo.name, photo.mime, digest(photo.content)]) : encoded);
        const previous = await get('SELECT id,protocol,request_hash FROM notifications WHERE unit_id=? AND request_id=?', unit.id, requestId);
        if (!previous) await throttle('intake:' + unit.id + ':' + clientAddress, 60, 900);
        return await atomic(async () => {
          if (!await get('SELECT id FROM units WHERE id=? AND intake_hash=? FOR UPDATE', unit.id, digest(intake))) forbidden();
          const existing = await get('SELECT id,protocol,request_hash FROM notifications WHERE unit_id=? AND request_id=?', unit.id, requestId);
          if (existing) {
            if (existing.request_hash !== hash) conflict('Este identificador já foi usado em outro envio.');
            return json({ id: existing.id, protocol: existing.protocol });
          }
          const identifier = randomUUID();
          const protocol = 'UHP-' + today(clock()).slice(0, 4) + '-' + identifier.replaceAll('-', '').slice(0, 16).toUpperCase();
          await run(`INSERT INTO notifications(id,unit_id,protocol,request_id,request_hash,kind,payload,status,created_at)
            VALUES (?,?,?,?,?,?,?,'received',?)`, identifier, unit.id, protocol, requestId, hash, payload.kind, encoded, clock().toISOString());
          if (photo) {
            await run('INSERT INTO notification_photos(notification_id,name,mime,content) VALUES (?,?,?,?)',
              identifier, photo.name, photo.mime, photo.content);
          }
          await audit(identifier, null, null, 'notification_received', photo ? { photoAttached: true } : null);
          return json({ id: identifier, protocol }, 201);
        });
      }

      const authenticated = async () => {
        const user = await actor(request);
        if (path === '/api/v1/session' && method === 'GET') return json(user);
        if (path === '/api/v1/session' && method === 'DELETE') {
          await run('DELETE FROM sessions WHERE hash=?', sessionKey(request));
          return new Response(null, { status: 204, headers: { 'set-cookie': cookie('', 0), 'cache-control': 'no-store' } });
        }
        if (method === 'GET' && path === '/api/v1/notifications') return json(await queue(user, url));
        if (method === 'GET' && path === '/api/v1/assignees') {
          coordinator(user);
          return json({ items: await all("SELECT id,name,role FROM users WHERE unit_id=? AND active=1 AND role!='coordination' ORDER BY name", user.unitId) });
        }

        let match = path.match(/^\/api\/v1\/notifications\/([^/]+)(?:\/(assignments|close|photo|pdf))?$/);
        if (match) {
          const notificationId = id(match[1]);
          const operation = match[2];
          if (method === 'GET' && !operation) return json(await detail(user, await notification(user, notificationId)));
          if (method === 'GET' && operation === 'photo') {
            await notification(user, notificationId);
            const photo = await get('SELECT mime,content FROM notification_photos WHERE notification_id=?', notificationId);
            if (!photo) unavailable();
            return new Response(photo.content, { headers: {
              'cache-control': 'no-store', 'content-type': photo.mime, 'x-content-type-options': 'nosniff'
            } });
          }
          if (method === 'GET' && operation === 'pdf') {
            coordinator(user);
            const row = await notification(user, notificationId);
            const bytes = await notificationPdf({ protocol: row.protocol, ...JSON.parse(row.payload) }, clock());
            return new Response(bytes, { headers: {
              'cache-control': 'no-store',
              'content-type': 'application/pdf',
              'content-disposition': 'inline; filename="' + row.protocol + '.pdf"',
              'x-content-type-options': 'nosniff'
            } });
          }
          if (operation === 'photo' || operation === 'pdf') unavailable();
          if (method !== 'POST' || !operation) unavailable();
          coordinator(user);
          const body = await readJson(request);
          return await atomic(async () => {
            const user = await actor(request);
            coordinator(user);
            const row = await notification(user, notificationId, true);
            if (row.status === 'closed') conflict('A notificação está finalizada.');
            if (operation === 'close') {
              const conclusion = str(body.conclusion, 'conclusion', 6000);
              const assignments = await all('SELECT status FROM assignments WHERE notification_id=?', row.id);
              if (!assignments.length || assignments.some(item => item.status !== 'validated')) {
                conflict('Finalize todas as tratativas antes do encerramento.');
              }
              await run("UPDATE notifications SET status='closed',closure=?,closed_by=?,closed_at=? WHERE id=?", conclusion, user.id, clock().toISOString(), row.id);
              await audit(row.id, null, user.id, 'notification_closed');
              return json(await detail(user, await notification(user, row.id)));
            }
            const area = oneOf(body.area, areas, 'area');
            const assigneeId = id(body.assigneeId, 'assigneeId');
            const opinionDue = day(body.opinionDue, 'opinionDue');
            const actionsDue = day(body.actionsDue, 'actionsDue');
            if (actionsDue < opinionDue) invalid('actionsDue');
            if (!await get('SELECT id FROM users WHERE id=? AND unit_id=? AND role=? AND active=1', assigneeId, user.unitId, area)) invalid('assigneeId');
            if (await get('SELECT id FROM assignments WHERE notification_id=? AND area=?', row.id, area)) conflict('Já existe uma tratativa para esta área.');
            const assignmentId = randomUUID();
            await run(`INSERT INTO assignments(id,notification_id,area,assignee_id,opinion_due,actions_due,status)
              VALUES (?,?,?,?,?,?,'draft')`, assignmentId, row.id, area, assigneeId, opinionDue, actionsDue);
            await run("UPDATE notifications SET status='in_progress' WHERE id=?", row.id);
            await audit(row.id, assignmentId, user.id, 'assignment_created', { area, assigneeId, opinionDue, actionsDue });
            return json(assignmentView(await assignment(user, assignmentId)), 201);
          });
        }

        match = path.match(/^\/api\/v1\/assignments\/([^/]+)\/(draft|submit|decision|actions|submit-actions|validate|reassign)$/);
        if (match && method === 'POST') {
          const assignmentId = id(match[1]);
          const operation = match[2];
          const body = await readJson(request);
          return await atomic(async () => {
            const user = await actor(request);
            const row = await assignment(user, assignmentId, true);
            if (operation === 'reassign') {
              coordinator(user);
              if (row.notification_status === 'closed' || row.status === 'validated') conflict('A tratativa está encerrada.');
              const assigneeId = id(body.assigneeId, 'assigneeId');
              const opinionDue = day(body.opinionDue, 'opinionDue');
              const actionsDue = day(body.actionsDue, 'actionsDue');
              if (actionsDue < opinionDue) invalid('actionsDue');
              if (!await get('SELECT id FROM users WHERE id=? AND unit_id=? AND role=? AND active=1', assigneeId, user.unitId, row.area)) invalid('assigneeId');
              const reason = str(body.reason, 'reason', 3000);
              await run('UPDATE assignments SET assignee_id=?,opinion_due=?,actions_due=? WHERE id=?', assigneeId, opinionDue, actionsDue, row.id);
              await audit(row.notification_id, row.id, user.id, 'assignment_updated', { previousAssigneeId: row.assignee_id, assigneeId, opinionDue, actionsDue, reason });
              return json(assignmentView(await assignment(user, row.id)));
            }
            if (operation !== 'actions') return json(await updateAssignment(user, row, operation, body));
            areaOwner(user);
            requireState(row, ['actions', 'complement']);
            const description = str(body.description, 'description', 6000);
            const performedOn = day(body.performedOn, 'performedOn');
            if (performedOn > today(clock())) invalid('performedOn');
            const actionId = randomUUID();
            const createdAt = clock().toISOString();
            await run('INSERT INTO actions(id,assignment_id,description,performed_on,created_by,created_at) VALUES (?,?,?,?,?,?)',
              actionId, row.id, description, performedOn, user.id, createdAt);
            await audit(row.notification_id, row.id, user.id, 'action_registered', { actionId });
            return json({ id: actionId, description, performedOn, createdBy: user.id, createdAt }, 201);
          });
        }

        match = path.match(/^\/api\/v1\/actions\/([^/]+)\/evidence$/);
        if (match && method === 'POST') {
          areaOwner(user);
          const actionId = id(match[1]);
          const action = await get('SELECT assignment_id FROM actions WHERE id=?', actionId);
          if (!action) unavailable();
          requireState(await assignment(user, action.assignment_id), ['actions', 'complement']);
          const upload = decodeEvidence(await readJson(request, Math.ceil(evidenceLimit / 3) * 4 + 2048), Object.keys(evidenceTypes), evidenceLimit);
          return await atomic(async () => {
            const user = await actor(request);
            areaOwner(user);
            const row = await assignment(user, action.assignment_id, true);
            requireState(row, ['actions', 'complement']);
            const counts = await get(`SELECT count(*)::integer AS total, coalesce(sum(octet_length(e.content)),0)::integer AS bytes FROM evidence e
              JOIN actions a ON a.id=e.action_id WHERE a.assignment_id=?`, row.id);
            if (counts.total >= 30 || counts.bytes + upload.content.length > 30 * 1024 * 1024) conflict('Limite de evidências da tratativa atingido.');
            const evidenceId = randomUUID();
            const createdAt = clock().toISOString();
            await run('INSERT INTO evidence(id,action_id,name,mime,content,created_at) VALUES (?,?,?,?,?,?)', evidenceId, actionId, upload.name, upload.mime, upload.content, createdAt);
            await audit(row.notification_id, row.id, user.id, 'evidence_added', { actionId, evidenceId });
            return json({ id: evidenceId, name: upload.name, mime: upload.mime, size: upload.content.length, createdAt }, 201);
          });
        }

        match = path.match(/^\/api\/v1\/evidence\/([^/]+)$/);
        if (match && method === 'GET') {
          const evidenceId = id(match[1]);
          const locator = await get('SELECT a.assignment_id FROM evidence e JOIN actions a ON a.id=e.action_id WHERE e.id=?', evidenceId);
          if (!locator) unavailable();
          await assignment(user, locator.assignment_id);
          const row = await get('SELECT name,content FROM evidence WHERE id=?', evidenceId);
          const filename = row.name.toWellFormed().replace(/[\\/\r\n]/g, '_');
          const encoded = encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
          return new Response(row.content, { headers: {
            'cache-control': 'no-store', 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff',
            'content-disposition': "attachment; filename*=UTF-8''" + encoded
          } });
        }
        unavailable();
      };
      return await (method === 'GET' ? db.read(authenticated) : authenticated());
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      return json({ error: { code: 'internal', message: 'Falha ao processar a solicitação.' } }, 500);
    }
  };
}
