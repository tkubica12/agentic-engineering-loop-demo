#!/usr/bin/env node
// Explicit, portable test discovery.
//
// `node --test "glob/**/*.test.js"` relies on shell glob expansion (which
// PowerShell/cmd do not perform on quoted arguments) or on Node's own glob
// handling, which is not dependable across the Node 22 baseline this repo
// targets. Instead we enumerate the test directories ourselves and hand
// `node --test` an explicit list of file paths, which behaves identically on
// Windows, macOS and Linux.
//
// Usage:
//   node scripts/run-tests.mjs            # app + repo suites
//   node scripts/run-tests.mjs app        # app/test/*.test.js only
//   node scripts/run-tests.mjs repo       # test/*.test.js only

import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect(relDir) {
  const absDir = path.join(root, relDir);
  if (!existsSync(absDir)) return [];
  const found = [];
  const stack = [absDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

const scope = process.argv[2];
if (scope && scope !== 'app' && scope !== 'repo') {
  console.error(`run-tests: unknown scope "${scope}" (expected "app" or "repo")`);
  process.exit(1);
}

const dirs = [];
if (!scope || scope === 'app') dirs.push('app/test');
if (!scope || scope === 'repo') dirs.push('test');

const files = dirs.flatMap(collect);
if (files.length === 0) {
  console.error(`run-tests: no *.test.js files found for scope "${scope ?? 'all'}"`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
});

if (result.error) {
  console.error(`run-tests: failed to launch node --test: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
