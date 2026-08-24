---
# Issue intake - classification, duplicate check, and feasibility.
#
# This workflow runs on the OpenCode behaviour definition vendored verbatim at
# .github/workflows/shared/opencode.md. That file is now a byte-for-byte copy of
# the upstream blob (test/workflow-security.test.js recomputes its git blob SHA),
# so the full vendoring, credential, and firewall disclosure for this lane lives
# here rather than as a trailing comment in the shared definition.
#
# Vendoring provenance: shared/opencode.md is a verbatim copy of the OpenCode
# engine definition published in the github/gh-aw repository.
#   - Source repo: github/gh-aw
#   - Source path: .github/workflows/shared/opencode.md
#   - Blob SHA:    d875e158b1500f7adc3e8c8616a5b849f2dd44d7
#   - Repo commit at copy time: 9b0a996d0d5993705ae3c37d02b3daffa050aac0
#   - Copied on:   2026-08-23
#
# Support status, verified 2026-08-23 against github/gh-aw main (c453ed80):
# ADR-50145, accepted 2026-08-04, removed opencode as a supported experimental
# engine; its changeset is marked major and states that workflows using
# `engine: opencode` will no longer compile or validate.
#   - ADR blob:       2b9a9f468691497687f9111dcb3282d64f4b5113
#   - Changeset blob: a18ad3749be79330e0e07fd5875fe516a381e717
# The definition still ships upstream under "Unsupported engine samples", which
# states those integrations are samples only, with
# no compatibility or maintenance commitment,
# and it carries engine.experimental: true.
#
# Untrusted input: an issue title and body are attacker-controlled untrusted
# input. A hostile issue cannot cause a write because the agent job holds
# read-only GitHub permissions, threat detection runs on its output, and safe
# outputs are applied by a separate job limited to the allowed label and comment
# set. This lane no longer triggers on opened/reopened; it is gated behind the
# unique aeloop:experimental-intake label (or manual dispatch), matching the
# deterministic label-gate pattern of the supported issue-intake.md lane, so
# seeding an issue never starts it. Keep it pointed at synthetic issues.
#
# Model-sandbox credentials (why this sample is not the live control path): the
# two supported Copilot lanes (issue-intake.md, repository-pulse.md) launch their
# model sandbox through the AWF wrapper (awf ... run) with an explicit
# --exclude-env list of five credentials, so no engine or MCP secret reaches the
# model process under any name:
#   ACTIONS_ID_TOKEN_REQUEST_TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL,
#   COPILOT_GITHUB_TOKEN, GITHUB_MCP_SERVER_TOKEN, MCP_GATEWAY_API_KEY.
# Their threat-detection sandbox excludes the three credentials present there:
#   ACTIONS_ID_TOKEN_REQUEST_TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL,
#   COPILOT_GITHUB_TOKEN.
# This experimental lane is different by construction: the OpenCode engine sets
# secret-strategy: universal-llm-consumer, so at compile time the generated lock
# exports OPENAI_API_KEY, set to the COPILOT_GITHUB_TOKEN secret, into the sandbox
# step so the OpenCode CLI and the AWF copilot proxy can authenticate.
# OPENAI_API_KEY is NOT on the --exclude-env list, so the Copilot token DOES reach
# the model here, only under a different name. The mapping appears on both sandbox
# invocations in issue-intake-opencode.lock.yml (the agent job and the
# threat-detection job); COPILOT_GITHUB_TOKEN stays excluded under its own name.
# This is a material difference from the supported lanes and a reason to treat
# this lane as prepared/experimental. It is asserted as a known,
# allowlisted exception in test/workflow-security.test.js; if it is ever silently
# removed from this disclosure, or ever appears in a supported Copilot lane, that
# test fails.
#
# Firewall status: this lock sets GH_AW_INFO_FIREWALL_ENABLED: "false", so the run
# summary's observability section prints "- **firewall enabled**: false" and skips
# the squid access-log check. That is not the whole story: the AWF firewall
# containers (gh-aw-firewall/agent, gh-aw-firewall/api-proxy, gh-aw-firewall/squid,
# pinned at 0.27.44 by digest) are still downloaded, awf-config.json still sets
# "isolation": true and "apiProxy": { "enabled": true } with an allowDomains egress
# allowlist, and GH_AW_INFO_FIREWALL_TYPE is still "squid". Both supported locks
# set GH_AW_INFO_FIREWALL_ENABLED: "true". State this on stage so the
# disabled-looking line is not mistaken for open egress.
#
# On gh-aw v0.86.2 this still compiles and passes `gh aw validate --strict`,
# because it imports the vendored behaviour definition rather than relying on a
# built-in engine identifier, and `gh aw compile` prints "Using experimental
# OpenCode support". It is used here to show that the repository contract does
# not depend on any one agent vendor. When it breaks, and the ADR says it will,
# run issue-intake.md instead: same brief, same safe outputs, supported engine.

on:
  issues:
    types: [labeled]
    names: ["aeloop:experimental-intake"]
  workflow_dispatch:

engine:
  id: opencode

# Routes model access through the GitHub Copilot provider, so this lane needs no
# separate Anthropic or OpenAI subscription.
model: copilot/claude-sonnet-4.5

imports:
  - shared/opencode.md
  - shared/intake-brief.md

permissions:
  contents: read
  issues: read

network: defaults

timeout-minutes: 12
max-turns: 14
max-ai-credits: 300

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

# Issue intake, experimental lane

Follow the imported intake brief exactly. Add nothing to it.

State in the first line of your comment which engine produced it, so a reader
can tell the experimental lane from the supported one.
