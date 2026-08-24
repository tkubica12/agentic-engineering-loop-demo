# Acceptance mapping

Every acceptance criterion in [SPEC-001](SPEC-001-substitute-suggestion.md) maps
to exactly one automated test. `npm test` runs all of them; the `tests` workflow
runs the same command on every pull request.

| ID | Criterion | Test |
|---|---|---|
| AC-1 | An in-stock request is reserved and carries no suggestion | `app/test/service.test.js` — AC-1 |
| AC-2 | An out-of-stock request returns exactly one substitute | `app/test/service.test.js` — AC-2 |
| AC-3 | The substitute is the closest active in-stock member of the group | `app/test/service.test.js` — AC-3 |
| AC-4 | No internal classification field is ever serialised | `app/test/service.test.js` — AC-4 |
| AC-5 | A withdrawn SKU is never suggested | `app/test/service.test.js` — AC-5 |
| AC-6 | With no in-stock alternative the suggestion is `null` | `app/test/service.test.js` — AC-6 |
| AC-7 | The suggestion is stable across repeated identical requests | `app/test/service.test.js` — AC-7 |
| AC-8 | Held reservations reduce availability for later callers | `app/test/service.test.js` — AC-8 |
| AC-9 | Releasing a reservation restores availability | `app/test/service.test.js` — AC-9 |
| AC-10 | An inactive SKU is rejected rather than substituted | `app/test/service.test.js` — AC-10 |

## Transport-level checks

The HTTP surface is covered separately in `app/test/server.test.js`: status code
mapping, the exact public field set on a stock lookup, a malformed body, and an
unknown route.

## What is deliberately not covered

Load behaviour, persistence, and concurrency across processes. The service holds
reservations in memory by design; a durable store is a separate specification.
