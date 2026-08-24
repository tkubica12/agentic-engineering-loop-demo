// Windows-safe process invocation for `gh` and `git`.
//
// The bug this fixes: earlier code passed `shell: process.platform === 'win32'`
// to execFileSync('gh', ...). With a shell on Windows every argv element is
// re-parsed by cmd.exe, so a label description with spaces, a multiline issue
// body, or a cleanup comment with quotes is corrupted before gh ever sees it.
//
// The fix: resolve the executable directly (gh.exe / git.exe on win32) and pass
// argv with `shell` unset. Node's execFileSync/spawnSync then hand the argv to
// the process verbatim, with no shell in between.
//
// buildCommand() is pure and exported on its own so tests can prove the argv is
// preserved byte-for-byte without spawning anything.

import { execFileSync, spawnSync } from 'node:child_process';
import { extname } from 'node:path';

const isWin = process.platform === 'win32';

// On Windows, execFile needs the real executable name. `gh`/`git` on PATH are
// gh.exe/git.exe; naming them explicitly avoids relying on PATHEXT resolution
// and never routes through a shell.
export function resolveExecutable(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('resolveExecutable requires a non-empty command name');
  }
  if (!isWin) return name;
  return extname(name) ? name : `${name}.exe`;
}

// Pure: turn a logical command + argv into the concrete { file, args } that will
// be executed, and assert every argument is a string. No spawning, no shell.
export function buildCommand(name, argv = []) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }
  argv.forEach((arg, i) => {
    if (typeof arg !== 'string') {
      throw new TypeError(`argument ${i} for "${name}" must be a string, got ${typeof arg}`);
    }
  });
  return { file: resolveExecutable(name), args: [...argv] };
}

export function buildGhCommand(argv = []) {
  return buildCommand('gh', argv);
}

export function buildGitCommand(argv = []) {
  return buildCommand('git', argv);
}

const BASE_OPTS = {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
  // `shell` is intentionally left unset (false). Do not add it back.
};

// Run a command and return its stdout. Throws on non-zero exit, like execFileSync.
export function run(name, argv = [], opts = {}) {
  const { file, args } = buildCommand(name, argv);
  return execFileSync(file, args, { ...BASE_OPTS, ...opts });
}

export function runGh(argv = [], opts = {}) {
  return run('gh', argv, opts);
}

export function runGit(argv = [], opts = {}) {
  return run('git', argv, opts);
}

// Run a command without throwing; returns the full spawnSync result so callers
// can inspect status, error, stdout and stderr. Useful for capability probes
// where a non-zero exit or a missing executable is information, not a crash.
export function probe(name, argv = [], opts = {}) {
  const { file, args } = buildCommand(name, argv);
  return spawnSync(file, args, { ...BASE_OPTS, ...opts });
}

export function probeGh(argv = [], opts = {}) {
  return probe('gh', argv, opts);
}
