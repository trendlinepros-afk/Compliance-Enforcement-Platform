import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { errorMiddleware } from './lib/errors';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { tenantsRouter } from './routes/tenants';
import { groupsRouter } from './routes/groups';
import { computersRouter } from './routes/computers';
import { policiesRouter } from './routes/policies';
import { assignmentsRouter } from './routes/assignments';
import { catalogRouter } from './routes/catalog';
import { frameworksRouter } from './routes/frameworks';
import { releasesRouter } from './routes/releases';
import { agentRouter } from './routes/agent';
import { enrollRouter } from './routes/enroll';
import { dashboardRouter } from './routes/dashboard';
import { deploymentRouter } from './routes/deployment';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Railway terminates TLS at the edge; trust the first proxy hop so req.ip and
  // secure cookies behave.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '16mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Public + device-authenticated routers MUST be mounted before the routers
  // that apply a blanket requireUser to '/api', otherwise that middleware
  // rejects agent/enroll requests (which carry no session cookie) with 401.
  app.use('/api/auth', authRouter);
  app.use('/api', agentRouter);
  app.use('/api', enrollRouter);

  app.use('/api/users', usersRouter);
  app.use('/api/tenants', tenantsRouter);
  app.use('/api', groupsRouter);
  app.use('/api', computersRouter);
  app.use('/api', policiesRouter);
  app.use('/api', assignmentsRouter);
  app.use('/api', catalogRouter);
  app.use('/api', frameworksRouter);
  app.use('/api', releasesRouter);
  app.use('/api', deploymentRouter);
  app.use('/api', dashboardRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorMiddleware);

  // Serve the built client (single Docker service: Express serves client/dist + /api).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
