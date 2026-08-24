#!/usr/bin/env node
// Record how the build was attested, honestly.
//
// Reads the outcome of the attestation step from the environment. When the step
// did not succeed, the record says "simulated" and says why. Nothing downstream
// is allowed to present a simulated record as a verified attestation.

import { mkdirSync, writeFileSync } from 'node:fs';
import { repoPath, log } from './lib/repo.mjs';

const outcome = process.env.ATTEST_OUTCOME ?? 'skipped';
const url = process.env.ATTEST_URL ?? null;
const attested = outcome === 'success' && Boolean(url);

const record = {
  mode: attested ? 'attested' : 'simulated',
  reason: attested
    ? null
    : `The attestation step reported "${outcome}". Attestation needs an entitled repository and attestations: write. This record therefore describes the shape of a provenance statement and proves nothing about this artefact.`,
  subject: 'out/bundle/showcase-bundle.tar.gz',
  predicateType: 'https://slsa.dev/provenance/v1',
  attestationUrl: url,
  recordedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY ?? null,
  workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
  commit: process.env.GITHUB_SHA ?? null,
  verifyCommand: attested
    ? `gh attestation verify out/bundle/showcase-bundle.tar.gz --repo ${process.env.GITHUB_REPOSITORY ?? 'OWNER/REPO'}`
    : null
};

mkdirSync(repoPath('out', 'bundle'), { recursive: true });
writeFileSync(repoPath('out', 'bundle', 'provenance-record.json'), `${JSON.stringify(record, null, 2)}\n`);

if (attested) {
  log.ok(`provenance attested: ${url}`);
} else {
  log.warn(`provenance SIMULATED (attestation step: ${outcome})`);
  log.warn('Do not describe this as a verified attestation.');
}
