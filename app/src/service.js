import { loadCatalog, loadInventory, toPublicItem } from './catalog.js';
import { selectSubstitute } from './substitution.js';

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export function createService({ seed = 1 } = {}) {
  const catalog = loadCatalog();
  const stock = loadInventory();
  const reservations = new Map();
  let counter = seed;

  function requireSite(siteId) {
    const site = stock.get(siteId);
    if (!site) throw new ValidationError('unknown site', { siteId });
    return site;
  }

  function reservedFor(siteId, sku) {
    let total = 0;
    for (const r of reservations.values()) {
      if (r.siteId === siteId && r.sku === sku && r.state === 'held') total += r.quantity;
    }
    return total;
  }

  function available(siteId, sku) {
    const site = requireSite(siteId);
    const onHand = site[sku] ?? 0;
    return Math.max(0, onHand - reservedFor(siteId, sku));
  }

  function stockOf(siteId, sku) {
    const item = catalog.get(sku);
    if (!item) throw new ValidationError('unknown sku', { sku });
    requireSite(siteId);
    return { ...toPublicItem(item), siteId, available: available(siteId, sku) };
  }

  function reserve({ siteId, sku, quantity }) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError('quantity must be a positive integer', { quantity });
    }
    const item = catalog.get(sku);
    if (!item) throw new ValidationError('unknown sku', { sku });
    requireSite(siteId);

    if (item.status !== 'active') {
      return {
        outcome: 'rejected',
        reason: 'sku_not_active',
        requested: { ...toPublicItem(item), siteId, available: 0 }
      };
    }

    if (available(siteId, sku) >= quantity) {
      const id = `RES-${String(counter++).padStart(5, '0')}`;
      reservations.set(id, { id, siteId, sku, quantity, state: 'held' });
      return {
        outcome: 'reserved',
        reservationId: id,
        item: { ...toPublicItem(item), siteId, available: available(siteId, sku) }
      };
    }

    const substitute = selectSubstitute({
      requested: item,
      catalog,
      quantity,
      availableFor: (candidateSku) => available(siteId, candidateSku)
    });

    return {
      outcome: 'unavailable',
      reason: 'insufficient_stock',
      requested: { ...toPublicItem(item), siteId, available: available(siteId, sku) },
      suggestion: substitute
        ? { ...toPublicItem(substitute), siteId, available: available(siteId, substitute.sku) }
        : null
    };
  }

  function release(reservationId) {
    const r = reservations.get(reservationId);
    if (!r) throw new ValidationError('unknown reservation', { reservationId });
    r.state = 'released';
    return { outcome: 'released', reservationId };
  }

  return { stockOf, reserve, release, available, catalog };
}
