import { buildServer } from './server.js';
import { env } from './env.js';

async function start() {
  const server = await buildServer();
  try {
    await server.listen({ port: env.PORT, host: env.HOST });
    process.stdout.write(`[A VUE Server] Listening on http://${env.HOST}:${env.PORT}\n`);
  } catch (err: any) {
    process.stderr.write(`[FATAL] Startup failure: ${err.message}\n`);
    process.exit(1);
  }
}

start();

