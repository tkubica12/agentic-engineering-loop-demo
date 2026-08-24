// The pinned gh-aw compiler version, derived from the repository rather than
// typed twice.
//
// Two committed artefacts record it: every `.lock.yml` carries the compiler that
// produced it in its `# gh-aw-metadata:` header, and `.github/aw/actions-lock.json`
// pins the gh-aw-actions toolchain. They must agree on exactly one version. That
// version is what `npm run aw:install` installs and what `npm run validate:aw`
// requires, so a presenter can never install "latest" by accident.

import { readdirSync } from 'node:fs';
import { readText, exists, repoPath } from './repo.mjs';

export function compilerVersionOfLock(lock) {
  const header = readText('.github', 'workflows', lock).split('\n')[0] ?? '';
  const m = header.match(/gh-aw-metadata:\s*(\{.*\})\s*$/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]).compiler_version ?? null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ versions: string[], expected: string|null, sources: string[] }}
 *   `expected` is non-null only when every source agrees on one version.
 */
export function pinnedCompiler() {
  const versions = new Set();
  const sources = [];
  const workflowDir = repoPath('.github', 'workflows');
  for (const lock of readdirSync(workflowDir).filter((f) => f.endsWith('.lock.yml')).sort()) {
    const version = compilerVersionOfLock(lock);
    if (version) {
      versions.add(version);
      sources.push(`.github/workflows/${lock}`);
    }
  }
  if (exists('.github', 'aw', 'actions-lock.json')) {
    try {
      const parsed = JSON.parse(readText('.github', 'aw', 'actions-lock.json'));
      for (const entry of Object.values(parsed.entries ?? {})) {
        if (/gh-aw/.test(entry.repo ?? '') && entry.version) {
          versions.add(entry.version);
          sources.push('.github/aw/actions-lock.json');
        }
      }
    } catch {
      versions.add('unparseable actions-lock.json');
    }
  }
  const list = [...versions];
  return { versions: list, expected: list.length === 1 ? list[0] : null, sources };
}

/** The version token gh prints for the extension, from either stream. */
export function versionTokenOf(result) {
  return (`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`.match(/v\d+\.\d+\.\d+/) || [])[0] ?? null;
}
