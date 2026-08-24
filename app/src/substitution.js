/**
 * Deterministic substitute selection.
 *
 * Contract (see docs/spec/SPEC-001-substitute-suggestion.md):
 *   - a candidate shares the requested item's substitute group
 *   - a candidate is not the requested SKU
 *   - a candidate has status "active"
 *   - a candidate has enough free stock at the same site for the whole request
 *   - at most one candidate is returned
 *
 * Ranking is total and stable, so the same inputs always produce the same
 * suggestion. That property is what makes the acceptance tests meaningful.
 */
export function rankCandidates(requested, candidates) {
  return [...candidates].sort((a, b) => {
    const formA = a.form === requested.form ? 0 : 1;
    const formB = b.form === requested.form ? 0 : 1;
    if (formA !== formB) return formA - formB;

    const strengthA = Math.abs(a.strengthMg - requested.strengthMg);
    const strengthB = Math.abs(b.strengthMg - requested.strengthMg);
    if (strengthA !== strengthB) return strengthA - strengthB;

    const packA = Math.abs(a.packSize - requested.packSize);
    const packB = Math.abs(b.packSize - requested.packSize);
    if (packA !== packB) return packA - packB;

    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });
}

export function selectSubstitute({ requested, catalog, quantity, availableFor }) {
  const group = requested.internal.substituteGroup;
  const candidates = catalog
    .groupMembers(group)
    .filter((item) => item.sku !== requested.sku)
    .filter((item) => item.status === 'active')
    .filter((item) => availableFor(item.sku) >= quantity);

  if (candidates.length === 0) return null;
  return rankCandidates(requested, candidates)[0];
}
