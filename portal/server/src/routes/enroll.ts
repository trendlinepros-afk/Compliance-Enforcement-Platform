import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { config } from '../config';
import { ah, httpError } from '../lib/errors';
import { msiFetchHeaders } from '../lib/tokens';
import {
  buildInstallerCmd,
  buildInstallerPs1,
  installerDisplayName,
  installerFileSlug,
} from '../lib/installerScripts';

/**
 * Public enrollment convenience endpoints used by the deploy panel:
 *   GET /api/enroll/:token/agent.msi     -> latest MSI (raw; for RMM/GPO/Intune)
 *   GET /api/enroll/:token/install.cmd   -> one-click installer, token baked in
 *   GET /api/enroll/:token/install.ps1   -> same, PowerShell flavour
 * The enrollment token in the path is the tenant's shared secret; the installer
 * scripts bake SERVERURL + ENROLLTOKEN into the file so running them installs
 * the agent already enrolled to that tenant — no arguments to remember.
 */
export const enrollRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Per-tenant installer scripts (token baked into the file) ---------------
enrollRouter.get(
  '/enroll/:token/install.:ext(cmd|ps1)',
  limiter,
  ah(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { enrollToken: req.params.token } });
    if (!tenant) throw httpError(404, 'Unknown enrollment token');

    const name = installerDisplayName(tenant.name);
    const isPs1 = req.params.ext === 'ps1';
    const script = isPs1
      ? buildInstallerPs1(config.publicUrl, tenant.enrollToken, name)
      : buildInstallerCmd(config.publicUrl, tenant.enrollToken, name);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Install-CEP-${installerFileSlug(tenant)}.${req.params.ext}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  }),
);

enrollRouter.get(
  '/enroll/:token/agent.msi',
  limiter,
  ah(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { enrollToken: req.params.token } });
    if (!tenant) throw httpError(404, 'Unknown enrollment token');
    const release = await prisma.agentRelease.findFirst({ where: { isLatest: true } });
    if (!release) throw httpError(404, 'No agent release has been registered yet');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="cep-agent-${release.version}.msi"`);
    res.setHeader('X-Msi-Sha256', release.sha256);

    if (release.source === 'UPLOADED' && release.msiBlob) {
      res.send(Buffer.from(release.msiBlob));
      return;
    }
    if (release.source === 'GITHUB_URL' && release.url) {
      const upstream = await fetch(release.url, { redirect: 'follow', headers: msiFetchHeaders() });
      if (!upstream.ok || !upstream.body) throw httpError(502, `Upstream download failed (${upstream.status})`);
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
      return;
    }
    throw httpError(500, 'Release has no content');
  }),
);
