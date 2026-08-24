# ADR-0001 — Rank substitutes by a total order rather than by score

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-23 |
| Supersedes | none |

## Context

[SPEC-001](SPEC-001-substitute-suggestion.md) requires one substitute per
unavailable request, and requires the choice to be deterministic. Three
approaches were on the table.

## Options

**A. Weighted score.** Combine form match, strength distance, and pack distance
into one number and take the maximum. Flexible, but two candidates can tie, and
the tie is then broken by array order, which is the order the catalogue happens
to load in. That is not deterministic under a data edit.

**B. Total lexicographic order.** Compare on form, then strength distance, then
pack distance, then SKU identifier. The final key is unique, so the order is
total and no tie can survive.

**C. Commercial ranking.** Order by `marginTier`. Rejected outright: it makes a
commercial field decide a clinical-adjacent suggestion, and it would have to
travel to the client to be explainable.

## Decision

Option B.

## Consequences

- The suggestion is reproducible from the inputs alone, so AC-7 can assert
  equality across repeated runs instead of asserting "something plausible".
- Adding a ranking dimension means inserting a comparison before the SKU key,
  and updating AC-3. The test names the expected SKU, so a silent change in
  ranking fails the build.
- `marginTier` stays inside the service. Constraint 1 of SPEC-001 is then
  enforceable by a serialisation test (AC-4) rather than by review attention.
- A strength difference of 500 mg ranks above a form change. That is intentional
  for this demonstration data set and would need clinical review before it went
  anywhere near a real counter.

## Verification

`app/test/service.test.js` AC-3 and AC-7. Both run in `npm test` and in the
`tests` workflow.
