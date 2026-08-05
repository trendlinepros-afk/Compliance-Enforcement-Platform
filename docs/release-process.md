# Agent build & release process

## Automated (GitHub Actions)

`.github/workflows/agent-release.yml` runs on any `v*` tag (or manual dispatch):

1. `windows-latest` runner with the .NET 8 SDK.
2. `dotnet test` — runs the agent unit tests (PReg round-trip, gpt.ini math,
   secedit INF, auditpol CSV, version/schedule, value comparison).
3. `dotnet publish -c Release -r win-x64 --self-contained` for both
   `CepAgent` and `CepAgent.Updater` into `agent/publish`.
4. WiX v4 (`wix build`) packages `installer/Package.wxs` + `installer/Files.wxs`
   into `installer/out/cep-agent-<version>.msi`.
5. Computes the SHA-256 and writes `<msi>.sha256`.
6. Attaches the MSI + checksum to a **GitHub Release** for the tag.
7. Prints the **version, asset URL, and SHA-256** in the job summary — copy
   these into the portal's Agent Releases page.

### Cutting a release

Either push a tag:

```bash
git tag v1.2.0
git push origin v1.2.0
```

…or run the **Agent Release** workflow manually (Actions tab → Run workflow, or
`gh workflow run agent-release.yml -f version=1.2.0`). A manual run creates the
`v<version>` tag and Release itself, so you don't need tag-push access.

**The portal auto-registers the release — no manual step.** On boot, hourly,
whenever the Agent Releases page is opened, and via the "Sync from GitHub"
button, the portal pulls the newest MSI-bearing GitHub Release into its
`agent_releases` table (source `GITHUB_URL`, marked latest) and reads the
SHA-256 from the `.sha256` sidecar asset. From that point:

- the install one-liner and `/api/enroll/<token>/agent.msi` serve the new MSI
  (the portal proxies the public GitHub asset through its own URL),
- the bulk-update flow and each agent's daily 12:00 ET check offer the update,
- agents download it **through the portal**, verify the SHA-256 against the
  manifest, and self-update via the detached updater helper.

The sync targets this repo by default; override with `GITHUB_RELEASE_REPO`
(`owner/repo`). A public repo needs no token; set `GITHUB_TOKEN` for a private
repo or to raise the GitHub API rate limit.

Alternatively, **register a URL or upload the MSI directly** in the portal
(stored in Postgres `bytea`) — useful for air-gapped or private distributions.

## Local build

Requires the .NET 8 SDK and (for the MSI) the WiX v4 CLI on Windows.

```bash
# from repo root
dotnet test agent/tests/CepAgent.Tests/CepAgent.Tests.csproj -c Release

dotnet publish agent/src/CepAgent/CepAgent.csproj \
  -c Release -r win-x64 --self-contained -p:Version=1.2.0 -o agent/publish
dotnet publish agent/src/CepAgent.Updater/CepAgent.Updater.csproj \
  -c Release -r win-x64 --self-contained -p:Version=1.2.0 -o agent/publish

# Windows only (WiX v4):
dotnet tool install --global wix --version 4.0.5
wix extension add -g WixToolset.Util.wixext/4.0.5
wix build installer/Package.wxs installer/Files.wxs \
  -ext WixToolset.Util.wixext \
  -d "PublishDir=$(Resolve-Path agent/publish)" \
  -o installer/out/cep-agent-1.2.0.msi
```

## Versioning

The MSI `Version` comes from the assembly file version, driven by the
`-p:Version=<x.y.z>` publish flag (from the tag). The agent reports this version
in every heartbeat; the portal flags agents whose version differs from the
release marked latest.

The MSI `UpgradeCode` is fixed (`7E9F2A54-3C1B-4E8D-9A0F-2B6C1D4E5F60`) so
`MajorUpgrade` cleanly replaces older versions in place — the updater helper
also targets this UpgradeCode for `msiexec /x` on uninstall.
