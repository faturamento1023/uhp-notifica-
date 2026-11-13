import { Buffer } from 'node:buffer';
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new HttpError(status, code, message);
}

export const invalid = field => fail(400, 'invalid_input', 'Campo inválido: ' + field);
export const unavailable = () => fail(404, 'not_found', 'Registro indisponível.');
export const forbidden = () => fail(403, 'forbidden', 'Perfil sem permissão para esta operação.');
export const conflict = message => fail(409, 'invalid_state', message);

export function str(value, field, max, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) invalid(field);
  return value.trim();
}

export function day(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field);
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(+parsed) || !parsed.toISOString().startsWith(value + 'T')) invalid(field);
  return value;
}

export function id(value, field = 'id') {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) invalid(field);
  return value;
}

export function oneOf(value, choices, field) {
  if (!choices.includes(value)) invalid(field);
  return value;
}

export async function readJson(request, limit = 65536) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    fail(415, 'content_type', 'Envie application/json.');
  }
  if (Number(request.headers.get('content-length')) > limit) fail(413, 'too_large', 'Conteúdo acima do limite.');
  if (!request.body) invalid('body');
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      void reader.cancel().catch(() => {});
      fail(413, 'too_large', 'Conteúdo acima do limite.');
    }
    chunks.push(value);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    invalid('body');
  }
  if (!body || Array.isArray(body) || typeof body !== 'object') invalid('body');
  return body;
}
