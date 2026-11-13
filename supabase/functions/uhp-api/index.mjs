import { createApi } from '../../../backend/api.mjs';
import { openStore } from '../../../backend/store.mjs';

const origins = new Set([
  'https://uhp-notifica.netlify.app',
  'https://deploy-preview-1--uhp-notifica.netlify.app'
]);
const prefix = /^\/(?:functions\/v1\/)?uhp-api(?=\/)/;
const database = openStore({ UHP_DATABASE_URL: Deno.env.get('SUPABASE_DB_URL') }, {
  maxConnections: 1, restrictedRole: true
});
const evidenceLimit = 4 * 1024 * 1024;
const handlers = new Map([...origins].map(origin => [origin, createApi(database, { origin, evidenceLimit })]));
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

Deno.serve(async request => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(prefix, '');
  if (!url.pathname.startsWith('/api/v1/')) return new Response(null, { status: 404 });
  try {
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      const result = await database.get(`SELECT current_user AS role,
        EXISTS (SELECT 1 FROM uhp_notifica.units) AS provisioned`);
      if (result.role !== 'uhp_notifica_app') throw new Error('Unexpected database role');
      return Response.json({ status: 'ok', provisioned: result.provisioned }, { headers: noStore });
    }
    const origin = request.headers.get('origin');
    const handler = handlers.get(origin) ?? handlers.values().next().value;
    if (request.method !== 'GET' && !handlers.has(origin)) {
      return Response.json({ error: { code: 'forbidden', message: 'Origem não autorizada.' } }, { status: 403, headers: noStore });
    }
    return await handler(new Request(url, request), 'edge');
  } catch (error) {
    console.error('Falha no adaptador UHP', error.code ?? error.name);
    return Response.json({ error: { code: 'database_unavailable', message: 'Banco de homologação indisponível.' } }, { status: 503, headers: noStore });
  }
});
