#!/usr/bin/env node
// Serve the repository root over http so the documents behave exactly as they
// will on the day, including the documented cross-links that point above docs/
// such as ../README.md, ../AGENTS.md and ../ATTRIBUTION.md.
// Local only, no dependency, no directory listing.
//
//   npm run serve            http://127.0.0.1:8080/  (redirects to /docs/index.html)
//   npm run serve -- --port 9000

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, log, parseArgs } from './lib/repo.mjs';

const HOME = '/docs/index.html';

// Proper containment check for the traversal guard. The resolved target must be
// the root directory itself or live strictly inside it. A plain
// target.startsWith(base) is a bug: a sibling directory whose name merely begins
// with the root string (e.g. a "repo-evil" next to "repo") would pass. Comparing
// against base + path separator (or, equivalently, rejecting a path.relative that
// starts with "..") closes that hole.
export function isWithin(base, target) {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

// Build a request handler rooted at an absolute directory. Exported so tests
// can start it on an ephemeral port without shelling out.
export function createDocsServer(root = repoRoot) {
  const base = resolve(root);

  return createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requested = decodeURIComponent(url.pathname);

    // The root redirects to the documented entry point rather than listing.
    if (requested === '/') {
      res.writeHead(302, { location: HOME }).end();
      return;
    }

    // Browsers auto-request /favicon.ico; answer 204 (No Content) to suppress
    // the cosmetic 404 rather than serving a binary this repo does not ship.
    if (requested === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    const relative = requested.replace(/^\/+/, '');
    const target = resolve(join(base, normalize(relative)));

    // Containment check: reject anything that resolves outside the served root.
    if (!isWithin(base, target)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
      return;
    }

    // Only regular files are served; directories return 404 (no listing).
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }

    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(target).pipe(res);
  });
}

function main() {
  const args = parseArgs();
  const port = Number(args.options.port ?? process.env.PORT ?? 8080);
  const server = createDocsServer();

  // A busy port is the common local failure. Name the exact command to retry
  // on a different port rather than dumping a raw stack trace.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const next = port + 1;
      log.fail(`port ${port} is already in use.`);
      log.info(`Retry on another port, e.g.:  npm run serve -- --port ${next}   (or: node scripts/serve.mjs --port ${next})`);
      log.info(`Or set one via the environment:  PORT=${next} npm run serve`);
    } else {
      log.fail(`could not start the server: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    log.head('Serving repository root');
    log.ok(`http://127.0.0.1:${port}/  ->  ${HOME}`);
    log.info(`showcase         http://127.0.0.1:${port}/docs/showcase.html`);
    log.info(`presenter guide  http://127.0.0.1:${port}/docs/presenter.html`);
    log.info(`offline fallback http://127.0.0.1:${port}/docs/mission-control.html`);
    log.info(`README           http://127.0.0.1:${port}/README.md`);
    log.info('stop with Ctrl+C');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
