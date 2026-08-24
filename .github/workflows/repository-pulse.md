---
# Repository pulse — the opening live workflow.
#
# Reads committed synthetic telemetry, looks for one business signal worth an
# engineering response, and writes exactly one bounded issue. It does not touch
# code and it does not open a pull request.
#
# Security property (supported Copilot lane): the agent job runs with read-only
# GitHub permissions (contents: read, issues: read), and the compiled lock
# withholds engine and MCP credentials from the model sandbox by an explicit
# --exclude-env list (ACTIONS_ID_TOKEN_REQUEST_TOKEN,
# ACTIONS_ID_TOKEN_REQUEST_URL, COPILOT_GITHUB_TOKEN, GITHUB_MCP_SERVER_TOKEN,
# MCP_GATEWAY_API_KEY). No secret is mapped into the sandbox under any alias.
# The OpenCode sample (issue-intake-opencode.md) is the exception: it maps
# COPILOT_GITHUB_TOKEN into the sandbox as OPENAI_API_KEY.
#
# Input trust: pulse reads committed synthetic telemetry, not attacker-controlled
# issue text, so prompt injection is not the threat here; the read-only agent
# boundary and safe-output separation still bound what a run can write.

on:
  # An explicit cron rather than gh-aw's `schedule: daily`. The friendly form
  # scatters the run time by generating a random cron on every compile, which
  # means the lock file can never recompile to the committed bytes. Determinism
  # is worth more here than herd avoidance: lock freshness is a real check in
  # this repository, and it has to be able to pass.
  schedule:
    - cron: "20 2 * * *"
  workflow_dispatch:

engine: copilot

permissions:
  contents: read
  issues: read
  copilot-requests: write

network: defaults

timeout-minutes: 10
max-turns: 12
max-ai-credits: 300

tools:
  github:
    toolsets: [issues]

safe-outputs:
  report-failure-as-issue: false
  threat-detection: true
  create-issue:
    title-prefix: "[pulse] "
    labels: [showcase, pulse, needs-triage]
    max: 1
    deduplicate-by-title: 1
---

# Repository pulse

Find at most one business signal in the committed synthetic telemetry and turn
it into a single bounded change request.

## Data

`fixtures/telemetry/reservation-events.jsonl` holds one JSON object per line.
Each line has `ts`, `siteId`, `sku`, `quantity`, `outcome`, `substituteOffered`,
and `channel`. `outcome` is either `reserved` or `unavailable`.

This file is synthetic. It contains no real product, supplier, pricing, patient,
or customer data, and you must not treat it as if it did.

## What to look for

A signal is a `siteId` and `sku` pair whose share of `unavailable` outcomes is
both materially above the repository-wide rate and rising across the window. A
single bad day is noise. A trend across the window is a signal.

Rank candidates by the number of affected requests. Take the top one only.

## What to do

1. Compute the overall `unavailable` rate across all events.
2. Compute the per-`siteId`-per-`sku` `unavailable` rate for the first and the
   last third of the window.
3. Pick the one pair with the largest rising gap that also has at least 20
   affected requests. If nothing qualifies, write no issue and say so.
4. Check the open issues in this repository. If an open issue already describes
   the same pair, write no issue.
5. Otherwise create exactly one issue.

## Issue shape

The issue body must use these headings and nothing else:

- `## Signal` — the pair, the two rates, the number of affected requests, and
  the window. Numbers only; no adjectives.
- `## Why this is worth engineering time` — two sentences at most.
- `## Proposed outcome` — one sentence describing what would be true after a
  change. Do not propose an implementation.
- `## Open questions` — what you could not determine from the data alone.

Do not propose a solution, do not name a file, and do not write code. The next
stage decides whether this is worth doing at all.

## Constraints

- Exactly one issue, or none.
- Never include a customer name, an organisation name, or a tenant identifier.
- Never claim the data is real.
- If the telemetry file is missing or unreadable, report that and stop.
