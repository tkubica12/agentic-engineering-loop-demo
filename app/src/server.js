import { createServer } from 'node:http';
import { createService, ValidationError } from './service.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Without this a browser may sniff a JSON error body that echoes user input
  // and render it as HTML. See the CodeQL js/reflected-xss alert that found it.
  'x-content-type-options': 'nosniff'
};

/**
 * Error details name the value the caller supplied, which makes them useful and
 * makes them a reflection point. Echo only a bounded, alphanumeric form of it.
 */
function safeEcho(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
}

function safeDetails(details) {
  const out = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    out[key] = typeof value === 'number' || typeof value === 'boolean' ? value : safeEcho(value);
  }
  return out;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req, limitBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new ValidationError('request body too large', { limitBytes });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('request body is not valid JSON');
  }
}

export function createApp(service = createService()) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return send(res, 200, { status: 'ok' });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/v1/stock/')) {
        const sku = safeEcho(decodeURIComponent(url.pathname.slice('/api/v1/stock/'.length)));
        const siteId = safeEcho(url.searchParams.get('siteId') ?? 'SITE-NORTH');
        return send(res, 200, service.stockOf(siteId, sku));
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/reservations') {
        const body = await readBody(req);
        const result = service.reserve({
          siteId: safeEcho(body.siteId ?? 'SITE-NORTH'),
          sku: safeEcho(body.sku),
          quantity: body.quantity
        });
        if (result.outcome === 'reserved') return send(res, 201, result);
        if (result.outcome === 'unavailable') return send(res, 409, result);
        return send(res, 422, result);
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/v1/reservations/')) {
        const reservationId = safeEcho(
          decodeURIComponent(url.pathname.slice('/api/v1/reservations/'.length))
        );
        return send(res, 200, service.release(reservationId));
      }

      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      if (err instanceof ValidationError) {
        return send(res, 400, { error: err.message, details: safeDetails(err.details) });
      }
      return send(res, 500, { error: 'internal_error' });
    }
  };
}

export function startServer({ port = 0, service } = {}) {
  const server = createServer(createApp(service));
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
