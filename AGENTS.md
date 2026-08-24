# Repository rules

These rules apply to every contributor, human or agent. They are enforced by tests
where enforcement is possible, and stated here where it is not.

## What this repository is

The source of truth for a public, customer-neutral, sixty-minute showcase. Every
file exists to advance one story: agents accelerate work, and GitHub is what turns
that work into engineering.

Nothing here is a product catalogue. If a change adds a capability to the story
without advancing it, remove the change.

## Product accuracy

1. **Date every product claim.** The verification date for this repository is
   2026-08-23. If you change a claim, change the date and say what you checked.
2. **Name the stage.** GA, public preview, private preview, experimental sample, and
   simulation are five different things. Use the right word every time the
   capability appears. "Preview" on its own is not a stage.
3. **Never claim a capability you have not verified.** If a source cannot be found,
   say it could not be found. An unverifiable claim marked as unverifiable is
   useful; an unverifiable claim stated confidently is a defect.
4. **Absence of evidence is a dated claim too.** "This does not exist" goes stale
   faster than "this exists", because the thing can land the next day. Before
   asserting that a record, page, or capability is absent, re-check it against
   the current upstream default branch and record the commit you checked. This
   rule exists because an earlier revision of this repository asserted that a
   decision record did not exist; it had landed hours before, and the assertion
   was wrong within a day.
5. **Never present a simulation as a live control.** A simulated attestation, a
   staged block, or a mocked check must be labelled in the artefact itself, not
   only in the prose beside it.
6. **Cite, do not paraphrase, a support status.** Quote the published wording and
   link it.

## Data

1. **Synthetic only.** No real product, supplier, pricing, patient, staff, or
   customer data enters this repository, in any file, including fixtures,
   examples, screenshots, and commit messages.
2. **The data files must declare themselves synthetic.** `app/data/catalog.json`
   and `app/data/inventory.json` carry a `$comment` saying so, and a test asserts it.
3. **No customer or organisation name.** Not in code, not in fixtures, not in
   commit messages, not in branch names. Neutrality is structural rather than a
   denylist: no profile may hold a concrete organisation, tenant, subscription or
   directory value, and attendee-facing documents may use only the proper nouns
   in `neutrality.allowedProperNouns`. An unrecognised name fails the build in
   `scripts/validate-docs.mjs`. A presenter's engagement-specific terms go in an
   untracked `.showcase.local.json`, documented by `.showcase.local.example.json`
   and never committed. The screen never reads its own declaration: both of those
   files are exempt from it, because a term list necessarily contains its terms.
4. **No tenant, subscription, or directory identifier.** Profiles use `null`
   placeholders; targets are supplied on the command line.

## Security

1. **Pin every third-party action to a full commit SHA**, with the version in a
   trailing comment. A tag is mutable; a SHA is not.
2. **Never use `pull_request_target`.** There is no exception in this repository.
3. **Set `persist-credentials: false` on every checkout.**
4. **Grant the narrowest permission that works.** Workflows start from
   `permissions: {}` and add what each job needs.
5. **No agent job holds a write permission.** Writes happen in a separate job with a declared, scoped safe output. Never write that an agent job "holds no secret": state the true property, which is read-only GitHub permissions plus explicit `--exclude-env` exclusion of engine and MCP credentials from the model sandbox. Where a sample engine breaks that property, disclose it.
6. **Cap every agent.** `timeout-minutes`, `max-turns`, and `max-ai-credits` are
   required in every agentic workflow.
7. **Commit both the Markdown source and the compiled `.lock.yml`.** Never
   hand-edit a lock file. CI recompiles and fails if they disagree.
8. **No secret in the repository, ever**, including in an example or a fixture.

## Code

1. **No runtime dependency.** The service uses only the Node standard library. A
   dependency change is a specification-level decision, not an implementation detail.
2. **The service boundary is `toPublicItem`.** It is the only function permitted to
   build a payload that leaves the service. Do not assemble a response object by
   spreading a catalogue item.
3. **Every acceptance criterion has exactly one named test**, and the mapping in
   `docs/spec/acceptance-mapping.md` is checked in both directions by
   `scripts/verify.mjs --only acceptance`.
4. **Determinism is a requirement, not a preference.** Ranking uses a total order
   so the same inputs always produce the same output.
5. **Comment only what needs clarification.** The code should not narrate itself.

## Documents

1. **Author HTML with the html-docs skill's components only.** Do not invent CSS
   classes and do not edit `docs/assets/article.css`, `docs/assets/article.js`,
   or any other vendored runtime file. Repository-owned overrides go in
   `docs/assets/slide-a11y.css` and `docs/assets/slide-a11y.js`, which load after
   the runtime and are listed as ours in `ATTRIBUTION.md`. They may set layout
   and type size for existing classes; they may not define a token or a colour.
   A per-document `<style>` block that overrides the runtime is not an
   alternative to that layer.
2. **Never change a design token in a page.** The palette is fixed.
3. **No emoji anywhere.** A test fails the build on one.
4. **Every document must be readable with JavaScript disabled** and must work
   offline with no network request.
5. **The standalone export is an output.** Edit `docs/showcase.html` and rebuild;
   never hand-edit `docs/showcase.standalone.html`.
6. **Validate before claiming done:** `node docs/assets/validate.js <file>` must
   exit zero for every document, and the standalone export must be validated in an
   empty folder.

## The showcase sequence

1. **`fixtures/prepared/manifest.json` is the only place the sequence is defined.**
   The rehearsal script, the offline fallback, the presenter guide, and the tests
   all read it. Change the order there and nowhere else.
2. **Two counts exist and must never be conflated.** There are **nine lifecycle
   stages** and **eleven demo scenes**. The exact sentence, used verbatim
   wherever the shape is described, is: "A nine-stage engineering loop shown in
   eleven demo scenes; only one lifecycle stage is coding." The return to the
   next signal is the arrow back to stage one, not a tenth stage. Both numbers
   live in `manifest.json` under `shape`, and a test fails the build on drift.
3. **Every scene needs an expected visible state, a stop condition, and at least
   one fallback.** The rehearsal fails without them.
4. **Fallbacks are structured, not prose.** Each is
   `{ kind, target, label }` where `kind` is `file`, `url`, `doc-scene`, or
   `narrate`. Preflight and `rehearse --fallback` resolve every target and fail
   on a missing one.
5. **Every live scene needs a durable prepared artefact.** No exceptions.
6. **The scenes must tile the whole hour with no gap.** A test asserts it.
7. **Slides mode must produce between ten and fifteen slides in
   `docs/showcase.html`.** That rule is about the presented deck and nothing
   else. `docs/mission-control.html` is a scene fallback surface: it is a
   readable article that can also be presented, its card count follows the
   eleven scenes, and no slide budget applies to it. `docs/presenter.html` and
   `docs/index.html` are read, not presented. Depth belongs in cards nested
   below the one presentation card per chapter, and in reveals. A test asserts
   the showcase's slide count.

## Remote operations

1. **No script has a default target repository.** `--repo OWNER/REPO` is required.
2. **Seeding is dry-run by default** and needs `--apply` to write.
3. **Destructive cleanup needs `--confirm`** and only ever touches items carrying
   the demo marker from `config/showcase.config.json`.

## Before you open a pull request

```bash
npm test && npm run verify && npm run aw:install && npm run validate:aw && npm run rehearse
node docs/assets/validate.js docs/showcase.html
```

`aw:install` comes before `validate:aw` because the validation requires the
installed `gh aw` to be exactly the version the committed locks were compiled
with. It is idempotent and never installs the latest release.

If any of those cannot run in your environment, say so explicitly in the pull
request. Do not describe a check you did not perform.
