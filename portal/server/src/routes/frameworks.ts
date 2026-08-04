import { Router } from 'express';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireUser } from '../lib/auth';

export const frameworksRouter = Router();
frameworksRouter.use(requireUser);

frameworksRouter.get(
  '/frameworks',
  ah(async (_req, res) => {
    const frameworks = await prisma.framework.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { controls: true } } },
    });
    res.json(frameworks);
  }),
);

frameworksRouter.get(
  '/frameworks/:key',
  ah(async (req, res) => {
    const framework = await prisma.framework.findUnique({
      where: { key: req.params.key },
      include: {
        controls: {
          orderBy: { controlId: 'asc' },
          include: {
            settingMaps: {
              select: {
                confidence: true,
                recommendedValue: true,
                setting: { select: { id: true, key: true, name: true, category: true, mechanism: true } },
              },
            },
          },
        },
      },
    });
    if (!framework) throw httpError(404, 'Framework not found');
    res.json(framework);
  }),
);
