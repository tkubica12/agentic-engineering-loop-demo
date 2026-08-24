# SPEC-001 — Substitute suggestion for an unavailable SKU

| Field | Value |
|---|---|
| Status | Accepted |
| Owner | Platform engineering |
| Applies to | `app/src/service.js`, `app/src/substitution.js` |
| Related | [ADR-0001](ADR-0001-substitute-selection.md), [acceptance mapping](acceptance-mapping.md) |
| Data | Synthetic only. No real product, price, supplier, or patient data. |

## Outcome

A counter assistant who requests a pack that is not on the shelf gets one
concrete alternative in the same response, instead of a bare failure that sends
them back to a separate lookup.

## Constraints

1. The response never exposes an internal classification field. `substituteGroup`,
   `therapeuticClass`, `marginTier`, and `supplierCode` stay inside the service.
2. At most one substitute is offered. A ranked list turns a counter decision into
   a comparison exercise.
3. Selection is deterministic. The same request against the same state always
   produces the same suggestion.
4. A substitute must be immediately reservable at the same site for the whole
   requested quantity.
5. A SKU whose status is not `active` is never suggested and never reserved.
6. No new runtime dependency is introduced.

## Behaviour contract

`POST /api/v1/reservations` with `{ siteId, sku, quantity }`:

| Condition | Status | Body |
|---|---|---|
| Enough free stock | `201` | `outcome: "reserved"`, `reservationId` |
| Not enough free stock, a substitute exists | `409` | `outcome: "unavailable"`, `suggestion` object |
| Not enough free stock, no substitute exists | `409` | `outcome: "unavailable"`, `suggestion: null` |
| SKU is not active | `422` | `outcome: "rejected"`, `reason: "sku_not_active"` |
| Unknown SKU, unknown site, bad quantity | `400` | `error` and `details` |

The `suggestion` object carries exactly `sku`, `name`, `form`, `strengthMg`,
`packSize`, `siteId`, `available`.

## Ranking rule

Among active members of the requested item's substitute group, excluding the
requested SKU, that have at least `quantity` free at the same site:

1. same dosage form first;
2. then smallest absolute strength difference;
3. then smallest absolute pack-size difference;
4. then lowest SKU identifier.

The fourth key makes the order total, which is what makes rule 3 of the
constraints testable rather than aspirational.

## Out of scope

Clinical interchangeability advice, prescriber approval flows, pricing,
cross-site transfers, and reservation expiry. Each of those is a separate
outcome with its own acceptance criteria.

## Acceptance criteria

AC-1 through AC-10 are listed in [acceptance-mapping.md](acceptance-mapping.md)
with the test that proves each one.
