import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';

/**
 * Public enrollment convenience endpoints used by the deploy one-liner:
 *   GET /api/enroll/:token/agent.msi  -> latest MSI (enrollment token acts as auth)
 * The PowerShell one-liner downloads from here and passes SERVERURL/ENROLLTOKEN
 * to msiexec, so nothing but the portal URL ever appears on the endpoint.
 */
export const enrollRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

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
      const upstream = await fetch(release.url, { redirect: 'follow' });
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
