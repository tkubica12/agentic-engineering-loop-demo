#!/usr/bin/env node
// Build the shareable bundle that the release workflow attests.
// Uses only what the platform ships: no archiver dependency.

import { mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { repoPath, walk, relPath, log } from './lib/repo.mjs';

const outDir = repoPath('out', 'bundle');
mkdirSync(outDir, { recursive: true });

const included = walk(repoPath('docs'))
  .map(relPath)
  .filter((p) => !p.endsWith('.standalone.html'))
  .sort();

log.head('Bundle');
log.info(`including ${included.length} file(s) from docs/`);

// A minimal, deterministic USTAR writer. Enough to produce a tar a standard
// tool can read, without pulling in a dependency for a demonstration.
function tarHeader(name, size, mtime) {
  const buf = Buffer.alloc(512);
  buf.write(name.slice(0, 100), 0, 100, 'utf8');
  buf.write('0000644\0', 100, 8, 'utf8');
  buf.write('0000000\0', 108, 8, 'utf8');
  buf.write('0000000\0', 116, 8, 'utf8');
  buf.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  buf.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136, 12, 'utf8');
  buf.write('        ', 148, 8, 'utf8');
  buf.write('0', 156, 1, 'utf8');
  buf.write('ustar', 257, 5, 'utf8');
  buf.writeUInt8(0, 262);
  buf.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return buf;
}

const chunks = [];
const mtime = 0; // fixed, so the same inputs produce the same archive
for (const rel of included) {
  const data = readFileSync(repoPath(rel));
  chunks.push(tarHeader(rel, data.length, mtime));
  chunks.push(data);
  const pad = (512 - (data.length % 512)) % 512;
  if (pad) chunks.push(Buffer.alloc(pad));
}
chunks.push(Buffer.alloc(1024));

const tar = Buffer.concat(chunks);
const target = repoPath('out', 'bundle', 'showcase-bundle.tar.gz');

await new Promise((resolvePromise, reject) => {
  const gzip = createGzip({ level: 9 });
  const sink = createWriteStream(target);
  sink.on('finish', resolvePromise);
  sink.on('error', reject);
  gzip.on('error', reject);
  gzip.pipe(sink);
  gzip.end(tar);
});

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repoPath() }).trim();
} catch {
  /* not a git checkout */
}

writeFileSync(
  repoPath('out', 'bundle', 'bundle-manifest.json'),
  `${JSON.stringify({ builtFromCommit: commit, files: included, bytes: tar.length }, null, 2)}\n`
);

log.ok(`wrote ${relPath(target)} (${tar.length} bytes uncompressed)`);
log.info('the release workflow attests this file, or records that it could not');
