import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function repoPath(...parts) {
  return join(repoRoot, ...parts);
}

export function readJson(...parts) {
  return JSON.parse(readFileSync(repoPath(...parts), 'utf8'));
}

export function readText(...parts) {
  return readFileSync(repoPath(...parts), 'utf8').replace(/\r\n/g, '\n');
}

export function exists(...parts) {
  return existsSync(repoPath(...parts));
}

export function loadConfig() {
  return readJson('config', 'showcase.config.json');
}

/* The standalone export rewrites repo-relative document links into absolute
   GitHub URLs. The base is a single configurable block so a fork only edits
   config/showcase.config.json, never the build script. */
export function repositoryConfig() {
  const repo = loadConfig().repository;
  if (!repo || !repo.owner || !repo.name) {
    throw new Error(
      'config/showcase.config.json is missing a repository { owner, name, ref } block'
    );
  }
  return { ref: 'main', ...repo };
}

export function githubBlobUrl(path, repo = repositoryConfig()) {
  const clean = String(path).replace(/^\/+/, '');
  return `https://github.com/${repo.owner}/${repo.name}/blob/${repo.ref}/${clean}`;
}

export function loadProfile(id) {
  const config = loadConfig();
  const chosen = id ?? process.env.SHOWCASE_PROFILE ?? config.defaultProfile;
  const file = repoPath(config.profileDir, `${chosen}.json`);
  if (!existsSync(file)) {
    const error = new Error(`unknown profile "${chosen}". Available: ${listProfiles().join(', ')}`);
    error.userFacing = true;
    throw error;
  }
  return { ...JSON.parse(readFileSync(file, 'utf8')), _config: config };
}

/**
 * Resolve a profile for a command-line entry point. A bad SHOWCASE_PROFILE or
 * --profile is an operator mistake, not a defect, so it prints one actionable
 * line and exits 2 rather than a stack trace.
 */
export function requireProfile(id) {
  try {
    return loadProfile(id);
  } catch (error) {
    if (!error.userFacing) throw error;
    process.stderr.write(`FAIL  ${error.message}\n`);
    process.stderr.write('      Set SHOWCASE_PROFILE to one of those names, or pass --profile <name>.\n');
    process.exit(2);
  }
}

export function listProfiles() {
  const config = loadConfig();
  return readdirSync(repoPath(config.profileDir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadManifest() {
  return readJson('fixtures', 'prepared', 'manifest.json');
}

export function loadArtifact(scene) {
  const manifest = loadManifest();
  const entry = manifest.scenes.find((s) => s.id === scene);
  if (!entry) throw new Error(`unknown scene "${scene}"`);
  if (!entry.artifact) return null;
  return JSON.parse(readFileSync(repoPath(entry.artifact), 'utf8'));
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', '.playwright']);

export function walk(dir = repoRoot, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function relPath(full) {
  return relative(repoRoot, full).split(sep).join('/');
}

const COLOURS = { ok: '\u001b[32m', bad: '\u001b[31m', warn: '\u001b[33m', dim: '\u001b[2m', off: '\u001b[0m' };
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(kind, text) {
  return useColour ? `${COLOURS[kind]}${text}${COLOURS.off}` : text;
}

export const log = {
  ok: (m) => console.log(`${paint('ok', 'PASS')}  ${m}`),
  fail: (m) => console.log(`${paint('bad', 'FAIL')}  ${m}`),
  warn: (m) => console.log(`${paint('warn', 'WARN')}  ${m}`),
  info: (m) => console.log(`${paint('dim', 'INFO')}  ${m}`),
  head: (m) => console.log(`\n${m}\n${'-'.repeat(Math.max(8, m.length))}`)
};

export function createChecker() {
  const failures = [];
  return {
    check(condition, message) {
      if (condition) log.ok(message);
      else {
        log.fail(message);
        failures.push(message);
      }
      return condition;
    },
    note(message) {
      log.info(message);
    },
    warn(message) {
      log.warn(message);
    },
    get failures() {
      return failures;
    },
    finish(label) {
      if (failures.length === 0) {
        log.head(`${label}: all checks passed`);
        return 0;
      }
      log.head(`${label}: ${failures.length} failure(s)`);
      for (const f of failures) console.log(`  - ${f}`);
      return 1;
    }
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [], flags: new Set(), options: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.options[name] = next;
        i++;
      } else {
        args.flags.add(name);
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}
