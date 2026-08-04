# Architecture

The Compliance Enforcement Platform (CEP) is a Senteon-style MSP compliance
product in two parts: a **multi-tenant web portal** and a **Windows agent**.

```
┌──────────────────────────────────────────────────────────────┐
│                        Railway (single service)               │
│                                                               │
│   ┌───────────────┐   serves    ┌──────────────────────────┐  │
│   │ React client  │◄────────────│  Express + Prisma server │  │
│   │ (client/dist) │   /api      │                          │  │
│   └───────────────┘             │  • auth (argon2 + JWT)   │  │
│                                 │  • tenants/computers     │  │
│                                 │  • policies + resolution │  │
│                                 │  • settings catalog      │  │
│                                 │  • agent API             │  │
│                                 │  • baseline importer     │  │
│                                 └───────────┬──────────────┘  │
│                                             │ Prisma          │
│                                 ┌───────────▼──────────────┐  │
│                                 │   PostgreSQL (plugin)     │  │
│                                 │   incl. bytea MSI + snaps │  │
│                                 └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                     ▲  HTTPS (TLS 1.2+), device token
                     │
     ┌───────────────┴───────────────────────────────────┐
     │              Windows Agent (.NET 8 service)         │
     │                                                     │
     │   heartbeat 5m ─ commands ─ audit 30m ─ enforce     │
     │   PReg / secedit / auditpol engines                 │
     │   snapshots + rollback + auto-update + uninstall    │
     └─────────────────────────────────────────────────────┘
```

## Portal server (`portal/server`)

Node 20 + Express + TypeScript + Prisma + PostgreSQL.

- **Auth** — username/password (argon2id), JWT in an httpOnly cookie. The admin
  user is seeded from `ADMIN_USER`/`ADMIN_PASSWORD` on first boot.
- **Effective policy resolution** (`services/effectivePolicy.ts`) — a pure,
  unit-tested function. Precedence is **computer > group > tenant**, merged per
  setting; overlapping group assignments break ties by an explicit priority
  integer. Produces a flat "effective policy document" (setting key, mechanism,
  desired value) plus a stable SHA-256 `policyHash` so the agent detects changes
  cheaply.
- **Parsers** (`parsers/`) — a byte-perfect PReg (Registry.pol) parser/writer,
  secedit INF parser/generator, auditpol CSV parser, and a PolicyAnalyzer
  `.PolicyRules` / LGPO-backup importer. All are shared conceptually with the
  agent's C# implementations and independently unit-tested.
- **Agent API** (`routes/agent.ts`) — enrollment, heartbeat + command delivery,
  audit/drift ingest, snapshot upload/download, update check, and an MSI proxy
  (`/api/agent/msi/:version`). Rate-limited per device.
- **Storage** — Railway's filesystem is ephemeral, so **nothing is written to
  disk**: uploaded MSIs and per-computer snapshots live in Postgres `bytea`.

## Portal client (`portal/client`)

React 18 + TypeScript + Vite + Tailwind, dark-mode operator UI. Every page is
wired to the real API via React Query. The setting explanation quality — *what
it does* / *what it can break* — is surfaced everywhere settings appear
(catalog, policy editor, setting picker, compliance detail).

## Windows agent (`agent/`)

.NET 8 self-contained `win-x64` Windows Service; no runtime install required.
Targets Windows Server 2016 / Windows 10 1607 and newer, forces TLS 1.2+, and
uses no OS API newer than Server 2016.

- **Identity** — the MSI supplies `SERVERURL` and `ENROLLTOKEN`. On first start
  the agent exchanges the tenant enrollment token for a per-device token stored
  DPAPI-protected under `ProgramData\CepAgent`.
- **Audit engine** (`Engines/ComplianceEngine.cs`) — reads real current state
  from three sources: `Registry.pol` (parsed with the custom PReg parser), the
  `secedit /export` INF, and `auditpol /get /r` CSV, plus the **live registry
  values** behind each administrative-template setting (to catch tattooed /
  out-of-band values). Runs every 30 minutes and on `REAUDIT`; queues results
  locally (JSONL) when offline and flushes on reconnect.
- **Enforcement engine** — after each audit, drift is remediated immediately.
  Registry settings are written to `Registry.pol` via the PReg writer with
  correct `gpt.ini` version math and CSE GUIDs; security areas via a generated
  INF + `secedit /configure`; audit policy via `auditpol /set`; finishing with
  `gpupdate /target:computer /force`. Every remediation logs a drift event.
- **Snapshots & rollback** — before the **first** enforcement on a machine, the
  agent captures a full snapshot (GroupPolicy + GroupPolicyUsers folders, a
  secedit export, an auditpol backup, and the live registry values for every
  touched setting), zips it, keeps a local copy, and uploads it. `ROLLBACK`
  restores the snapshot exactly and then **auto-pauses enforcement** on that
  machine so the drift loop cannot immediately re-apply the policy.
- **Auto-update** — daily at 12:00 America/New_York (DST-aware, ±10 min jitter)
  and on `UPDATE_NOW`: asks the portal for the latest release, compares
  versions, downloads through the portal, verifies SHA-256, then hands off to a
  detached updater helper that runs `msiexec /i /qn` (a service cannot replace
  itself).
- **Uninstall** — removes **every** artifact the agent created: service,
  `ProgramData` tree, scheduled task, and any policy content it authored.
  Leaving a populated `Registry.pol` baseline behind is the incumbent's critical
  bug and is explicitly prevented (`Engines/UninstallCleanup.cs`). Server-side,
  uninstall revokes the device token and marks the computer decommissioned.

See [enrollment-flow.md](enrollment-flow.md) and
[release-process.md](release-process.md) for the two key operational flows.
