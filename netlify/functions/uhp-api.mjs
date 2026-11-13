import { createApi } from '../../backend/api.mjs';
import { openStore } from '../../backend/store.mjs';

export const config = { path: '/api/v1/*' };

// The Netlify buffered request limit is 6 MB. Evidence is sent as JSON with Base64 overhead.
const evidenceLimit = 4 * 1024 * 1024;
let database;

function unavailable() {
  return Response.json({ error: { code: 'database_unavailable', message: 'Banco de homologação indisponível.' } }, {
    status: 503,
    headers: { 'cache-control': 'no-store' }
  });
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || !url.pathname.startsWith('/api/v1/')) {
    return new Response(null, { status: 404 });
  }
  try {
    database ??= openStore(process.env, { maxConnections: 2 });
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      const result = await database.get(`SELECT current_schema() AS schema,
        EXISTS (SELECT 1 FROM uhp_notifica.units) AS provisioned`);
      if (result.schema !== 'uhp_notifica') return unavailable();
      return Response.json({ status: 'ok', provisioned: result.provisioned }, {
        headers: { 'cache-control': 'no-store' }
      });
    }
    return await createApi(database, { origin: url.origin, evidenceLimit })(request, context.ip);
  } catch {
    return unavailable();
  }
}
