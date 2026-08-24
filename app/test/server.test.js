import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';

let server;
let base;

before(async () => {
  server = await startServer({ port: 0 });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('health endpoint answers', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('stock lookup returns only public fields', async () => {
  const res = await fetch(`${base}/api/v1/stock/SKU-1001?siteId=SITE-NORTH`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), [
    'available',
    'form',
    'name',
    'packSize',
    'siteId',
    'sku',
    'strengthMg'
  ]);
});

test('an out-of-stock reservation answers 409 with one suggestion', async () => {
  const res = await fetch(`${base}/api/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 2 })
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.suggestion.sku, 'SKU-1002');
  assert.equal(Object.hasOwn(body.suggestion, 'internal'), false);
});

test('an in-stock reservation answers 201', async () => {
  const res = await fetch(`${base}/api/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: 'SITE-SOUTH', sku: 'SKU-2001', quantity: 1 })
  });
  assert.equal(res.status, 201);
});

test('releasing a held reservation answers 200 and restores availability', async () => {
  const reservation = await fetch(`${base}/api/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: 'SITE-NORTH', sku: 'SKU-4001', quantity: 15 })
  });
  const { reservationId } = await reservation.json();

  const release = await fetch(`${base}/api/v1/reservations/${reservationId}`, {
    method: 'DELETE'
  });
  assert.equal(release.status, 200);
  assert.deepEqual(await release.json(), { outcome: 'released', reservationId });
  assert.equal(release.headers.get('x-content-type-options'), 'nosniff');

  const laterReservation = await fetch(`${base}/api/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: 'SITE-NORTH', sku: 'SKU-4001', quantity: 15 })
  });
  assert.equal(laterReservation.status, 201);
});

test('releasing an unknown reservation answers 400', async () => {
  const res = await fetch(`${base}/api/v1/reservations/RES-99999`, {
    method: 'DELETE'
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {
    error: 'unknown reservation',
    details: { reservationId: 'RES-99999' }
  });
});

test('a malformed body answers 400 rather than crashing', async () => {
  const res = await fetch(`${base}/api/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  assert.equal(res.status, 400);
});

test('an unknown route answers 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('every JSON response forbids content-type sniffing', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('a hostile SKU is never reflected verbatim in the error body', async () => {
  const hostile = '<script>alert(1)</script>';
  const res = await fetch(`${base}/api/v1/stock/${encodeURIComponent(hostile)}`);
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(!text.includes('<script>'), 'the response reflected a script tag');
  assert.ok(!text.includes('<'), 'the response reflected an angle bracket');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('a hostile site identifier is not reflected either', async () => {
  const res = await fetch(`${base}/api/v1/stock/SKU-1001?siteId=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`);
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(!/[<>]/.test(text), 'the response reflected an angle bracket');
});
