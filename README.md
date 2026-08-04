# Compliance Enforcement Platform (CEP)

A production-ready MSP compliance platform — a Senteon replacement. It
continuously **audits and enforces** CIS-aligned Windows GPO hardening across
your customers' fleets, remediates drift automatically, and cleans up after
itself completely on uninstall (the incumbent product does not — that is why
this exists).

Two components in one monorepo:

- **Portal** (`portal/`) — a multi-tenant web app deployed to Railway as a
  single Docker service: a React client served by an Express + Prisma +
  PostgreSQL API.
- **Agent** (`agent/`) — a .NET 8 self-contained Windows Service, packaged as an
  MSI via a WiX v4 project (`installer/`), built and released by GitHub Actions.

```
/portal
  /client            React 18 + TypeScript + Vite + Tailwind
  /server            Node 20 + Express + TypeScript + Prisma + PostgreSQL
/agent               C# .NET 8 Windows Service (self-contained win-x64)
  /src/CepAgent          the service
  /src/CepAgent.Updater  detached install/uninstall helper
  /tests/CepAgent.Tests  xUnit tests
/installer           WiX v4 MSI project
/.github/workflows   portal-ci.yml, agent-release.yml
/docs                architecture, enrollment flow, release process
```

See **[docs/architecture.md](docs/architecture.md)** for the full design.

---

## Local development

### Prerequisites

- Node 20+
- PostgreSQL 14+ (any local instance, or Docker)
- .NET 8 SDK (only to build/test the agent)

### 1. Server

```bash
cd portal/server
cp .env.example .env          # then edit DATABASE_URL, JWT_SECRET, ADMIN_*
npm install
npm run prisma:generate
npx prisma migrate deploy      # create the schema
npm run seed                   # idempotent: catalog, frameworks, global policies, admin
npm run dev                    # http://localhost:8080
```

The seed is safe to re-run; it creates ~330 CIS-aligned catalog settings, the
compliance frameworks (CIS, CMMC 2.0 L1/L2, NIST 800-171, NIST 800-53, HIPAA,
SOC 2), their control mappings, and the seeded global policies. The admin user
is created from `ADMIN_USER` / `ADMIN_PASSWORD` on first run.

### 2. Client

```bash
cd portal/client
npm install
npm run dev                    # http://localhost:5173, proxies /api to :8080
```

### 3. Tests

```bash
cd portal/server && npm test   # parsers, resolution, importer (with a live PG)
```

Set `TEST_DATABASE_URL` to a migrated+seeded database to include the
database-backed importer test; without it that test is skipped.

### 4. Agent (optional, requires .NET 8 SDK)

```bash
dotnet test agent/tests/CepAgent.Tests/CepAgent.Tests.csproj
```

The agent only *runs* on Windows, but its parser/engine unit tests run on any
platform.

---

## Railway deployment (step by step)

The portal deploys as a **single Docker service**; the multi-stage
`portal/Dockerfile` builds the client, builds the server, and runs Express
serving `client/dist` plus `/api`.

1. **Create a project** on Railway and add the **PostgreSQL** plugin. Railway
   sets `DATABASE_URL` automatically for services in the project.
2. **Add a service from this repo.** `railway.json` points the builder at
   `portal/Dockerfile`, sets the start command
   (`prisma migrate deploy && node dist/index.js`), and a `/api/health`
   healthcheck.
3. **Set environment variables** on the service:
   - `JWT_SECRET` — a long random string.
   - `ADMIN_USER` / `ADMIN_PASSWORD` — the first admin account (seeded on boot).
   - `PUBLIC_URL` — your service's public domain, e.g.
     `https://cep-production.up.railway.app`. Used to build the agent install
     one-liner and MSI URLs.
   - `DATABASE_URL` — provided by the Postgres plugin (reference it).
4. **Deploy.** On boot the container runs `prisma migrate deploy`, then the
   server runs the idempotent seed and starts listening. The healthcheck flips
   green at `/api/health`.
5. **Sign in** at your `PUBLIC_URL` with the admin credentials.

> Railway's filesystem is ephemeral. The platform never writes uploads to disk:
> agent MSIs and per-computer snapshots are stored in Postgres `bytea`.

---

## Agent build & release flow

Tag `v*` → GitHub Actions builds the self-contained MSI, computes its SHA-256,
attaches it to a GitHub Release, and prints the version/URL/SHA-256 to register
in the portal. See **[docs/release-process.md](docs/release-process.md)**.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Then **Agent Releases → Register URL** in the portal (or upload the MSI
directly), and mark it latest.

---

## Enrollment flow

The tenant Agents tab gives you a copy-paste PowerShell one-liner that downloads
the MSI from the portal and installs it enrolled to that tenant. On first start
the agent trades the tenant enrollment token for a per-device token (stored
DPAPI-protected). Full detail in **[docs/enrollment-flow.md](docs/enrollment-flow.md)**.

```powershell
powershell -ep bypass -c "iwr <PUBLIC_URL>/api/enroll/<token>/agent.msi -OutFile $env:TEMP\agent.msi; Start-Process msiexec -ArgumentList '/i',$env:TEMP\agent.msi,'/qn','SERVERURL=<PUBLIC_URL>','ENROLLTOKEN=<token>' -Wait"
```

---

## Rollback & uninstall semantics

These are the product's non-negotiable correctness guarantees.

### Snapshots

Before the **first enforcement ever** performed on a machine, the agent captures
a full snapshot — the `GroupPolicy` and `GroupPolicyUsers` folders, a
`secedit /export` INF, an `auditpol /backup` CSV, and the **live registry
values** for every setting the policy touches. It is zipped, kept locally under
`ProgramData\CepAgent\snapshots`, and uploaded to the portal. If the snapshot
fails, enforcement is skipped that cycle (rollback must always be possible).

### Rollback

`ROLLBACK` restores the snapshot **exactly** — replaces the GroupPolicy folders,
`secedit /configure` from the saved INF, `auditpol /restore` from the saved CSV,
re-writes the live registry values, and runs `gpupdate /force`. It then
**automatically pauses enforcement** on that machine, because otherwise the
continuous drift loop would immediately re-apply the policy and defeat the
rollback.

### Uninstall

`UNINSTALL` takes a mode:

- **revert** — restore the snapshot first, then remove the agent.
- **leave** — keep the currently-applied hardening, but still remove the agent.

In **both** modes the uninstall removes **every artifact the agent created**:
the Windows service, the `ProgramData\CepAgent` tree (device token, config,
state, queues, snapshots), the scheduled task, and — critically — any policy
content it authored in `Registry.pol`. If removing the authored values leaves
`Registry.pol` empty, the file is deleted so **no baseline is left behind**.
Leaving a populated `Registry.pol` baseline after uninstall is the incumbent
product's critical bug and the single thing this product must never do.

Server-side, uninstall revokes the device token and marks the computer
`DECOMMISSIONED`.

---

## Quality bar

- Unit tests for the PReg parser/writer (byte-perfect round-trip), gpt.ini
  version math, secedit INF generation/parsing, auditpol CSV parsing, the
  effective-policy resolution function (all precedence/merge cases), and the
  PolicyRules/LGPO importer.
- Idempotent seed (safe to re-run on every deploy).
- Rate-limited agent endpoints; device tokens scoped per computer and revoked on
  uninstall.
- TLS 1.2+ forced on the agent; no OS API newer than Server 2016.
- Dense, fast, dark-mode operator UI — no marketing chrome.
