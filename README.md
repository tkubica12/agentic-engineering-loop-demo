# The Agentic Engineering Loop

Source of truth for a sixty-minute presenter-led showcase: **GitHub Beyond Coding — The Agentic Engineering Loop**.

A nine-stage engineering loop shown in eleven demo scenes; only one lifecycle stage is coding. The ninth stage returns to the first, which is why the loop closes.

Everything here is public, customer-neutral, and built on synthetic data.

## Start here

| If you are | Open |
|---|---|
| Reading the argument | [`docs/showcase.html`](docs/showcase.html) — press **Slides** to present the same page |
| Presenting it | [`docs/presenter.html`](docs/presenter.html) — run of show, talk track, fallback ladder |
| Presenting with no network | [`docs/mission-control.html`](docs/mission-control.html) — every scene offline, every simulation labelled |
| Sending it to someone | `docs/showcase.standalone.html` — build it with `npm run build:standalone` |
| Reviewing the engineering | [`docs/spec/`](docs/spec/) — specification, decision record, acceptance mapping |
| Changing anything | [`AGENTS.md`](AGENTS.md) — the rules that apply to humans and agents alike |

## Quick start

Node 22 or newer. There is nothing to install: the repository has no runtime dependency.

The agentic-workflow compiler is pinned. `npm run aw:install` installs `github/gh-aw` at the version the committed lock files record, currently `v0.86.2`, reading it from the repository rather than from a second copy of the number; it is idempotent and never installs the latest release. `npm run aw:compile` regenerates the lock files. `npm run validate:aw` asserts that this checkout is the git working-tree root, then fails if the installed `gh aw` drifts from the pinned version or if any lock file is stale.

```bash
npm run setup        # create output directories; installs nothing
npm run preflight    # is this machine ready to present?
npm test             # service tests and repository tests
npm run verify       # recompute the telemetry signal and check it against the prepared issue
npm run aw:install   # pin the agentic-workflow compiler to the version the locks record
npm run validate:aw  # gh aw validate --strict, plus lock-file provenance
npm run rehearse     # walk all eleven scenes offline
npm run serve        # http://127.0.0.1:8080/
```

`npm run verify` proves its claims group by group, and each group can be run on
its own. Two of them recompute the numbers the hour opens and closes on:

```bash
npm run verify -- --only signal     # the opening 23% to 78%, from the telemetry
npm run verify -- --only followup   # the closing 32 / 25 / 7, replayed
```

The follow-up group replays the thirty-two unmet requests through the service's
own `selectSubstitute`, so the closing payoff is derived rather than restated. It
is a **prepared replay**: the requests are the real ones from the telemetry, and
the shelf state afterwards is declared synthetic in
`fixtures/telemetry/post-change-stock.json`. No second production window was
observed, and nothing in the repository claims one was.

`npm run rehearse -- --fallback` walks the same hour entirely on prepared artefacts, resolving every fallback target, which is the check that the fallback path has no gaps.

## The seven questions this loop answers

1. Was the intent written down?
2. Is the proposal reviewable?
3. Does deterministic evidence exist?
4. Does policy allow it?
5. Who is accountable for the merge?
6. How does it reach production?
7. What does production say afterwards?

None of them is a model problem. All of them are platform problems.

## What is in here

```
app/          A small synthetic pharmacy stock and reservation service, with deterministic tests
docs/         The four documents, their local runtime, the diagrams, and the specification
fixtures/     Synthetic telemetry, and one prepared artefact per scene
.github/      Deterministic CI, plus three agentic workflows and their compiled lock files
scripts/      preflight, setup, verify, rehearse, reset, cleanup, seed-remote, validators
config/       Sandbox and enterprise profiles, plus the structural neutrality rules. No customer
              or tenant value is hard-coded; profile targets are supplied on the command line.
              The one repository value present is this public repository's own metadata, used to
              rewrite sibling links to absolute URLs in the standalone export.
test/         Repository tests: workflow security, content rules, sequence, portability
```

## The demonstration change

When a requested SKU is out of stock, the service suggests one compatible in-stock substitute without exposing internal classification fields. Ten acceptance criteria, each mapped to exactly one named test. See [SPEC-001](docs/spec/SPEC-001-substitute-suggestion.md).

## Agentic workflows

Three, all compiled with `gh aw compile` and committed as both Markdown source and `.lock.yml`:

- `repository-pulse.md` — Copilot engine, supported. Reads committed telemetry, creates at most one bounded issue.
- `issue-intake-opencode.md` — OpenCode. **Removed upstream as a first-class engine by ADR-50145 (accepted 2026-08-04), still shipped as an unsupported sample definition**, verified 2026-08-23. Model access routes through the Copilot provider, so the lane needs no separate model subscription.
- `issue-intake.md` — Copilot engine, supported. Imports the identical brief. The fallback lane, and the reason the removal costs nothing here.

Every agent job holds read-only GitHub permissions, caps its time, turns, and AI credits, and runs threat detection before any scoped safe-output job acts. The supported Copilot lanes also withhold the engine and MCP credentials from the model sandbox by explicit exclusion; the experimental OpenCode sample does not, which is why it is presented as prepared evidence.

## Honesty rules this repository enforces

- Product states carry the date they were verified: **2026-08-24**.
- Experimental, preview, and simulated states are labelled everywhere they appear.
- A simulated provenance record declares `mode: simulated` and is never described as an attestation.
- No customer or tenant identifier is committed. Neutrality is structural: no profile holds a concrete organisation, tenant, subscription or directory value, and attendee-facing documents may use only an allowlisted set of scenario and product proper nouns. Tests enforce both, and an unrecognised name fails the build. A presenter's engagement-specific terms live in an untracked `.showcase.local.json` (see `.showcase.local.example.json`) and are never committed. This public repository's own owner and name are present, because the standalone export needs them to rewrite sibling links.
- All data is synthetic. A test fails the build if the data files stop saying so.

## Licence and attribution

MIT. External evidence is cited rather than copied; see [ATTRIBUTION.md](ATTRIBUTION.md).
