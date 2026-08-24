import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);

startServer({ port }).then((server) => {
  const addr = server.address();
  process.stdout.write(`stock-service listening on http://127.0.0.1:${addr.port}\n`);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
