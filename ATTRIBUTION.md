# Attribution

## Vendored runtime

`docs/assets/` contains the html-docs document runtime: `article.css`, `article.js`,
`tokens.css`, `validate.js` and `bundle.js`. It is vendored so every document in this
repository renders offline with no network request and no package install.

The runtime also ships a standalone deck renderer (`deck.css`, `deck.js`) and a sample
diagram (`sample-diagram.svg`). No document here is a deck — the showcase is an article
that can be presented — and nothing referenced the sample, so those three files are not vendored.
`validate.js` still detects the deck shape and would validate one if a future document
needed it; only the deck's own stylesheet and script are absent.

`docs/assets/package.json` exists only to scope that runtime as CommonJS, because
the repository root declares `"type": "module"`. The runtime files themselves are
unmodified.

## Repository-owned overrides

`docs/assets/slide-a11y.css` and `docs/assets/slide-a11y.js` are **not** vendored.
They are this repository's own, loaded after the runtime on every presentable
document, and they are the only sanctioned place to change presented behaviour or
type size without editing the runtime:

- `slide-a11y.js` moves keyboard focus to the current slide, announces the slide's
  title and position in a polite live region, and warns once per slide that the
  runtime had to shrink below a readable zoom.
- `slide-a11y.css` carries the live-region class, an accessibility fix for the
  non-text contrast of the presenting chrome, viewport-proportional slide type
  sizes, and the rules that render the first section divider as the cover. It
  defines no design token and uses no colour literal.

## Vendored engine definition

`.github/workflows/shared/opencode.md` is a verbatim copy of the OpenCode
behaviour definition published in the `github/gh-aw` repository.

- Source path: `.github/workflows/shared/opencode.md`
- Blob SHA: `d875e158b1500f7adc3e8c8616a5b849f2dd44d7`
- Repository commit at time of copy: `9b0a996d0d5993705ae3c37d02b3daffa050aac0`
- Copied on 2026-08-23
- Re-verified against `main` at `c453ed80d0fb167c90849624537bb29c8309debd` on
  2026-08-23; the upstream blob SHA is unchanged.

It is vendored **byte-for-byte**: no local commentary is appended. `test/workflow-security.test.js` computes the file's git blob SHA and asserts it equals `d875e158b1500f7adc3e8c8616a5b849f2dd44d7`, so "verbatim copy" is a checked fact rather than an intention. Do not edit it locally; update the pinned blob instead. All commentary about its status lives in `.github/workflows/issue-intake-opencode.md` and in the article.

It is pinned rather than imported live so the definition cannot change underneath
a rehearsed demonstration.

**Support status, verified 2026-08-23.** ADR-50145,
`docs/adr/50145-remove-opencode-engine-from-workflows.md`, blob
`2b9a9f468691497687f9111dcb3282d64f4b5113`, status Accepted, dated 2026-08-04,
removed `opencode` as a supported experimental engine from the gh-aw platform.
The accompanying changeset, `.changeset/major-remove-opencode-engine.md`, blob
`a18ad3749be79330e0e07fd5875fe516a381e717`, is marked `"gh-aw": major` and
states: "Workflows using `engine: opencode` or `engine.id: opencode` no longer
compile or validate."

The definition nonetheless still ships upstream under the engine reference
heading "Unsupported engine samples", which states that the OpenCode, Aider,
Crush, Cursor, DeepSeek Harness, Kiro, and Pydantic AI integrations in that
repository "are samples only. They are not officially supported by gh-aw and
have no compatibility or maintenance commitment." It carries
`engine.experimental: true`.

On gh-aw v0.86.2 a workflow importing this definition still compiles and passes
`gh aw validate --strict`. A major release can end that, which is why
`.github/workflows/issue-intake.md` exists as the supported lane.

## Cited GitHub documentation

- GitHub Agentic Workflows engine reference:
  <https://github.github.com/gh-aw/reference/engines/>
- Third-party coding agents on GitHub, public preview, currently Anthropic
  Claude and OpenAI Codex:
  <https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents>

Both read 2026-08-23. Neither is reproduced here beyond short quotations.

## Cited Microsoft documentation

The security chapter names Microsoft's agentic code scanner by its codename and
states its stage. The stage is quoted, not paraphrased: Microsoft Learn titles the
page **"Codename MDASH - Agentic code scanner initiative (private preview)"**.

- <https://learn.microsoft.com/en-us/security-exposure-management/mdash-initiative>
- <https://learn.microsoft.com/en-us/security-exposure-management/ai-code-security-overview>

Both read 2026-08-24, which is later than this repository's product validation date
of 2026-08-23 because this one claim was re-checked on its own. The overview page
describes the capability but does not carry the stage; the initiative page does, and
that is why the stage is cited from there. Nothing in this repository depends on the
capability, and no finding from it is shown or simulated.

## Cited external evidence

The production-feedback chapter cites, and does not copy, the public repository
[`tkubica12/azure-sre-agent`](https://github.com/tkubica12/azure-sre-agent).

- Licence: MIT
- Copyright: Copyright (c) 2026 Tomáš Kubica
- Read on 2026-08-23

MIT permits reuse with attribution. This repository nonetheless stores no copy of
that project's screenshots or transcripts: it references them by path and links to
the source. Nothing in that repository is modified or duplicated here.

Specific material referenced:

| Claim | Referenced path in the source repository |
|---|---|
| Connected telemetry and GitHub source | `docs/assets/screenshots/09-code-access.png`, `docs/assets/screenshots/10-connectors.png` |
| Root cause identifies the configuration difference | `docs/assets/screenshots/02-incident-root-cause.png` |
| Scoped rollback and recovery verification | `scenarios/bad-deployment/`, `README.md` |
| Rollback subagent tool list and instructions | `agent/config/subagents/rollback-advisor.yaml`, `agent/config/subagents/rollback-advisor.instructions.md` |

The stated limitation in that chapter — that GitHub issue or pull request write-back
is a designed next step rather than a demonstrated capability — is derived from the
subagent's configured tool list, which contains no GitHub connector.

## This repository

MIT, see [LICENSE](LICENSE). All catalogue, stock, and telemetry data is synthetic
and was generated for this demonstration. It describes no real product, supplier,
price, patient, organisation, or customer.
