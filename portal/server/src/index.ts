import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { runSeed } from './seed/run';
import { forceSyncSoon, syncReleasesFromGitHub } from './services/releaseSync';

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

  // Auto-register the latest CI-published agent MSI from GitHub Releases, then
  // re-check hourly, so operators never have to hand-register a release.
  forceSyncSoon();
  syncReleasesFromGitHub()
    .then((r) => r.ok && console.log(`[boot] release sync: ${r.created} new, latest ${r.latestVersion ?? 'none'} (${r.repo})`))
    .catch((err) => console.warn('[boot] release sync failed:', err.message));
  setInterval(() => {
    forceSyncSoon();
    syncReleasesFromGitHub().catch(() => {});
  }, 60 * 60 * 1000).unref();
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
