import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';
import { INTERNAL_ITEM_FIELDS } from '../src/catalog.js';

// AC-1
test('AC-1 an in-stock request is reserved and no suggestion is produced', () => {
  const svc = createService();
  const result = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1002', quantity: 2 });
  assert.equal(result.outcome, 'reserved');
  assert.match(result.reservationId, /^RES-\d{5}$/);
  assert.equal(result.suggestion, undefined);
});

// AC-2
test('AC-2 an out-of-stock request returns exactly one substitute', () => {
  const svc = createService();
  const result = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 2 });
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.reason, 'insufficient_stock');
  assert.ok(result.suggestion, 'a suggestion is expected');
  assert.equal(typeof result.suggestion.sku, 'string');
  assert.notEqual(result.suggestion.sku, 'SKU-1001');
});

// AC-3
test('AC-3 the substitute is the closest active in-stock member of the group', () => {
  const svc = createService();
  const result = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 2 });
  // SKU-1002 shares form and strength, differs only by pack size.
  assert.equal(result.suggestion.sku, 'SKU-1002');
});

// AC-4
test('AC-4 no internal classification field is ever serialised', () => {
  const svc = createService();
  const results = [
    svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 2 }),
    svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1002', quantity: 1 }),
    svc.stockOf('SITE-NORTH', 'SKU-1001')
  ];
  const serialised = JSON.stringify(results);
  for (const field of INTERNAL_ITEM_FIELDS) {
    assert.ok(!serialised.includes(field), `internal field leaked: ${field}`);
  }
  assert.ok(!serialised.includes('internal'), 'internal container leaked');
  assert.ok(!serialised.includes('GRP-'), 'substitute group value leaked');
  assert.ok(!serialised.includes('SUP-'), 'supplier code leaked');
});

// AC-5
test('AC-5 a withdrawn SKU is never suggested', () => {
  const svc = createService();
  // SKU-1005 is withdrawn and has 30 units at SITE-NORTH.
  const result = svc.reserve({ siteId: 'SITE-SOUTH', sku: 'SKU-1003', quantity: 1 });
  assert.equal(result.outcome, 'unavailable');
  if (result.suggestion) assert.notEqual(result.suggestion.sku, 'SKU-1005');
});

// AC-6
test('AC-6 when the group has no in-stock alternative the suggestion is null', () => {
  const svc = createService();
  const result = svc.reserve({ siteId: 'SITE-SOUTH', sku: 'SKU-3001', quantity: 1 });
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.suggestion, null);
});

// AC-7
test('AC-7 the suggestion is stable across repeated identical requests', () => {
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const svc = createService();
    const result = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 2 });
    seen.add(result.suggestion.sku);
  }
  assert.equal(seen.size, 1);
});

// AC-8
test('AC-8 held reservations reduce availability for later callers', () => {
  const svc = createService();
  assert.equal(svc.available('SITE-NORTH', 'SKU-1002'), 12);
  const first = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1002', quantity: 12 });
  assert.equal(first.outcome, 'reserved');
  assert.equal(svc.available('SITE-NORTH', 'SKU-1002'), 0);
  const second = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1002', quantity: 1 });
  assert.equal(second.outcome, 'unavailable');
});

// AC-9
test('AC-9 releasing a reservation restores availability', () => {
  const svc = createService();
  const first = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1002', quantity: 12 });
  svc.release(first.reservationId);
  assert.equal(svc.available('SITE-NORTH', 'SKU-1002'), 12);
});

// AC-10
test('AC-10 an inactive SKU is rejected rather than substituted', () => {
  const svc = createService();
  const result = svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1005', quantity: 1 });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'sku_not_active');
});

test('invalid quantities are rejected', () => {
  const svc = createService();
  assert.throws(() => svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 0 }), /positive integer/);
  assert.throws(() => svc.reserve({ siteId: 'SITE-NORTH', sku: 'SKU-1001', quantity: 1.5 }), /positive integer/);
});

test('unknown sku and unknown site are rejected', () => {
  const svc = createService();
  assert.throws(() => svc.stockOf('SITE-NORTH', 'SKU-9999'), /unknown sku/);
  assert.throws(() => svc.stockOf('SITE-WEST', 'SKU-1001'), /unknown site/);
});
