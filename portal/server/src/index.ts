import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { runSeed } from './seed/run';

async function main(): Promise<void> {
  // Fail fast if required env is missing.
  void config.databaseUrl;
  void config.jwtSecret;

  console.log('[boot] running idempotent seed...');
  await runSeed(prisma);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[boot] portal listening on :${config.port} (${config.publicUrl})`);
  });
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
