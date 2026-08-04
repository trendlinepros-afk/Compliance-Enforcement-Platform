# Enrollment & device identity

## 1. Tenant enrollment token

Each tenant has a single **enrollment token** (revocable / regenerable from the
tenant's Agents tab). It authorizes *enrollment* only — it is not a device
credential and cannot read data.

## 2. Install one-liner

The deploy panel produces a copy-paste PowerShell one-liner:

```powershell
powershell -ep bypass -c "iwr <PUBLIC_URL>/api/enroll/<token>/agent.msi -OutFile $env:TEMP\agent.msi; Start-Process msiexec -ArgumentList '/i',$env:TEMP\agent.msi,'/qn','SERVERURL=<PUBLIC_URL>','ENROLLTOKEN=<token>' -Wait"
```

- The MSI is downloaded **from the portal** (`/api/enroll/<token>/agent.msi`),
  which proxies the latest registered release. Agents and install scripts only
  ever reference the portal URL, never GitHub.
- `msiexec` is passed `SERVERURL` and `ENROLLTOKEN` as public properties. An MSI
  custom action runs `CepAgent.exe configure "<SERVERURL>" "<ENROLLTOKEN>"`
  which persists them to `ProgramData\CepAgent\config.json` before the service
  starts.

## 3. First start → device token exchange

On first start the service:

1. Reads `SERVERURL` / `ENROLLTOKEN` from config.
2. `POST /api/agent/enroll` with hostname, IPv4 list, OS name/version/build, and
   agent version.
3. The server validates the enrollment token, creates (or re-uses, on reinstall
   of the same hostname) a `computers` row, and returns a **per-device token**.
4. The agent stores that token **DPAPI-protected** (`LocalMachine` scope) at
   `ProgramData\CepAgent\device.dat`. All subsequent calls use
   `Authorization: Bearer <deviceToken>`.

Device tokens are per-computer and revocable server-side. The stored value is a
hash (`sha256`), so the database never holds the raw token.

## 4. Heartbeat & commands

Every 5 minutes the agent sends a heartbeat (hostname, IPs, OS, agent version,
enforcement state, current policy hash). The response carries:

- any **pending commands** (`APPLY_POLICY`, `REAUDIT`, `UPDATE_NOW`, `UNINSTALL`,
  `ROLLBACK`, `PAUSE_ENFORCEMENT`, `RESUME_ENFORCEMENT`),
- a **`policyChanged`** flag + the current `policyHash` — when it differs from
  what the agent reported, the agent fetches the new resolved policy from
  `GET /api/agent/policy`,
- the effective **enforcement pause** state (per-machine OR tenant kill switch).

Each command is acked with success/failure and error detail. Command status
moves `pending → delivered → acked/failed`.

## 5. Re-enrollment & revocation

- **Reinstall** on the same hostname re-uses the existing computer record, so
  snapshots, drift, and audit history stay attached.
- **Regenerating** the tenant token invalidates every prior install one-liner
  but does not affect already-enrolled devices (they hold device tokens).
- **Uninstall** revokes the device token and marks the computer
  `DECOMMISSIONED`; the token can never be used again.
