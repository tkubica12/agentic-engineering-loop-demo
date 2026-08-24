---
# Issue intake — supported fallback lane.
#
# Identical brief and identical safe outputs to issue-intake-opencode.md, on the
# supported Copilot engine. Run this when the experimental lane fails, or when
# an audience needs to see that the contract is engine-independent.
#
# Deterministic gate: the issues trigger is filtered with names: [intake-please]
# (gh-aw triggers reference, "Trigger Filtering"), which the compiler lowers to a
# job-level if: in the lock. The model is never spent to decide whether to run; a
# label other than intake-please never reaches the agent job. workflow_dispatch
# stays for manual runs. This replaces the old prose "stop unless the label is
# intake-please" instruction, which was not a gate.
#
# No self-retrigger: this lane uses the default GITHUB_TOKEN (no PAT, no App
# token), and its safe outputs only ever apply labels from the allowed set —
# never intake-please — so it cannot re-apply its own trigger label. Even if it
# did, GITHUB_TOKEN-authored label events do not recursively start workflows.
#
# Untrusted input: an issue title and body are attacker-controlled untrusted
# input. A hostile issue cannot cause a write because the agent job holds
# read-only GitHub permissions, threat detection runs on its output, safe outputs
# are applied by a separate job limited to the allowed label and comment set, and
# the deterministic gate bounds when the agent runs at all.
#
# Security property (supported Copilot lane): the compiled lock withholds engine
# and MCP credentials from the model sandbox by an explicit --exclude-env list
# (COPILOT_GITHUB_TOKEN among them) and maps no secret into the sandbox under any
# alias. Contrast issue-intake-opencode.md, which maps COPILOT_GITHUB_TOKEN into
# the sandbox as OPENAI_API_KEY.

on:
  issues:
    types: [labeled]
    names: [intake-please]
  workflow_dispatch:

engine: copilot

imports:
  - shared/intake-brief.md

permissions:
  contents: read
  issues: read

network: defaults

timeout-minutes: 12
max-turns: 14
max-ai-credits: 300

tools:
  github:
    toolsets: [issues]

safe-outputs:
  threat-detection: true
  add-labels:
    allowed:
      - needs-triage
      - ready-for-spec
      - needs-detail
      - duplicate
      - out-of-scope
      - size/small
      - size/medium
      - size/large
    max: 3
  add-comment:
    max: 1
---

# Issue intake, supported lane

Follow the imported intake brief exactly. Add nothing to it.

State in the first line of your comment which engine produced it, so a reader
can tell the supported lane from the experimental one.
