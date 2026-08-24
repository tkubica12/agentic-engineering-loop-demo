// Replay the follow-up window.
//
// The hour closes on three numbers: 32 requests that could not be met, 25 that
// the change answered with an alternative, and 7 that it still could not. This
// module recomputes those numbers instead of restating them, so the payoff is a
// derived fact rather than a claim in a fixture.
//
// Two inputs, and both are read rather than assumed:
//
//   * the requests come from fixtures/telemetry/reservation-events.jsonl, the
//     same file the opening signal is computed from, filtered to the pair the
//     signal named and taken in timestamp order;
//   * the shelf state comes from fixtures/telemetry/post-change-stock.json,
//     which is declared synthetic and says so, because the telemetry predates
//     the change and carries no stock level.
//
// The selection itself is the service's own: selectSubstitute and loadCatalog
// are imported from app/src, so the ranking, the active-status filter and the
// quantity test are the shipped ones. Nothing here re-implements them, which is
// the whole point — a replay that reimplemented the logic would prove only that
// two copies of a rule agree.

import { readFileSync } from 'node:fs';
import { loadCatalog } from '../../app/src/catalog.js';
import { selectSubstitute } from '../../app/src/substitution.js';
import { repoPath, readJson } from './repo.mjs';

export function loadReplayInput() {
  return readJson('fixtures', 'telemetry', 'post-change-stock.json');
}

/** The unmet requests of the window, in the order they arrived. */
export function unmetRequests(input = loadReplayInput()) {
  const { siteId, requestedSku } = input.replayWindow;
  const raw = readFileSync(repoPath('fixtures', 'telemetry', 'reservation-events.jsonl'), 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((e) => e.siteId === siteId && e.sku === requestedSku && e.outcome === 'unavailable')
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * Replay the window. Each offered substitute is taken, so its units leave the
 * shelf and a later request in the same window cannot be answered with them.
 * That is what makes the residue meaningful: without it every request would be
 * answered from an infinite shelf and the number would prove nothing.
 */
export function replayFollowUp(input = loadReplayInput()) {
  const catalog = loadCatalog();
  const requested = catalog.get(input.replayWindow.requestedSku);
  if (!requested) {
    throw new Error(`the replay names ${input.replayWindow.requestedSku}, which is not in the catalogue`);
  }

  const stock = { ...input.openingStock };
  const availableFor = (sku) => stock[sku] ?? 0;

  const requests = unmetRequests(input);
  const substitutesBySku = {};
  const unresolvedAt = [];
  let answeredWithSubstitute = 0;
  let unitsDispensed = 0;

  requests.forEach((request, index) => {
    const substitute = selectSubstitute({
      requested,
      catalog,
      quantity: request.quantity,
      availableFor
    });
    if (!substitute) {
      unresolvedAt.push(index + 1);
      return;
    }
    stock[substitute.sku] -= request.quantity;
    substitutesBySku[substitute.sku] = (substitutesBySku[substitute.sku] ?? 0) + 1;
    unitsDispensed += request.quantity;
    answeredWithSubstitute += 1;
  });

  const closingStock = {};
  const orderedSubstitutes = {};
  for (const sku of Object.keys(substitutesBySku).sort()) {
    orderedSubstitutes[sku] = substitutesBySku[sku];
    closingStock[sku] = stock[sku];
  }

  return {
    requestsReplayed: requests.length,
    answeredWithSubstitute,
    unresolved: unresolvedAt.length,
    unresolvedAt,
    unitsDispensed,
    substitutesBySku: orderedSubstitutes,
    closingStock
  };
}
