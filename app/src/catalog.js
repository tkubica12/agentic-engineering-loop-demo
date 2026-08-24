import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

/**
 * Fields that may leave the service boundary. Anything under `internal`
 * is commercial or clinical classification and must never be serialised.
 */
export const PUBLIC_ITEM_FIELDS = Object.freeze([
  'sku',
  'name',
  'form',
  'strengthMg',
  'packSize'
]);

export const INTERNAL_ITEM_FIELDS = Object.freeze([
  'substituteGroup',
  'therapeuticClass',
  'marginTier',
  'supplierCode'
]);

function readJson(name) {
  return JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
}

export function loadCatalog() {
  const raw = readJson('catalog.json');
  const bySku = new Map();
  for (const item of raw.items) bySku.set(item.sku, Object.freeze(structuredClone(item)));
  return {
    get(sku) {
      return bySku.get(sku) ?? null;
    },
    list() {
      return [...bySku.values()];
    },
    groupMembers(groupId) {
      return [...bySku.values()].filter((i) => i.internal.substituteGroup === groupId);
    }
  };
}

export function loadInventory() {
  const raw = readJson('inventory.json');
  const bySite = new Map();
  for (const site of raw.sites) bySite.set(site.siteId, { ...site.stock });
  return bySite;
}

/**
 * Projects a catalogue item to the public shape. This is the only function
 * allowed to build an item payload for a response.
 */
export function toPublicItem(item) {
  const out = {};
  for (const field of PUBLIC_ITEM_FIELDS) out[field] = item[field];
  return out;
}
