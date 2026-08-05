/**
 * Per-tenant agent installer scripts. The server URL and the tenant's
 * enrollment token are baked into the file so a double-click (or an RMM push as
 * SYSTEM) installs the agent already enrolled — no arguments to remember. The
 * MSI itself is fetched through the portal at run time, so the script stays
 * tiny and always pulls the current release.
 */

// Combining diacritical marks (U+0300–U+036F); written as an escape so the
// source stays ASCII-only and can't be mangled by an editor or diff tool.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** File-name-safe slug for the download (e.g. Install-CEP-demo1.cmd). */
export const installerFileSlug = (t: { slug?: string | null; name: string }): string =>
  ((t.slug || t.name)
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '') // ö -> o, not o-
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)) || 'tenant';

/** Human-readable name safe to drop into a .cmd/.ps1 echo/comment line. */
export const installerDisplayName = (name: string): string =>
  name.replace(/[^\w .\-]+/g, ' ').trim().slice(0, 60) || 'this tenant';

/** A .cmd that self-elevates, downloads the MSI through the portal, and installs it enrolled. */
export function buildInstallerCmd(serverUrl: string, token: string, name: string): string {
  return [
    '@echo off',
    'setlocal enableextensions',
    `title CEP Agent - ${name}`,
    'REM ============================================================',
    ' REM  Compliance Enforcement Platform - agent installer',
    ` REM  Tenant: ${name}`,
    ' REM  The server URL and this tenant enrollment token are baked',
    ' REM  in below, so running this file installs the agent already',
    ' REM  enrolled to this tenant. Run as administrator (double-click',
    ' REM  and approve the prompt) or push it through your RMM as SYSTEM.',
    'REM ============================================================',
    '',
    `set "SERVERURL=${serverUrl}"`,
    `set "ENROLLTOKEN=${token}"`,
    '',
    'net session >nul 2>&1',
    'if %errorlevel% neq 0 (',
    '  echo Requesting administrator rights...',
    `  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"`,
    '  exit /b',
    ')',
    '',
    'set "MSI=%TEMP%\\cep-agent.msi"',
    'echo Downloading the CEP agent from %SERVERURL% ...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing -Uri '%SERVERURL%/api/enroll/%ENROLLTOKEN%/agent.msi' -OutFile '%MSI%' } catch { Write-Host $_; exit 1 }"`,
    'if not exist "%MSI%" (',
    '  echo.',
    '  echo ERROR: could not download the agent. Check the server URL / token and retry.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    `echo Installing and enrolling to ${name} ...`,
    'msiexec /i "%MSI%" /qn SERVERURL="%SERVERURL%" ENROLLTOKEN="%ENROLLTOKEN%"',
    'echo.',
    `echo Done. The machine will appear under ${name} in the portal shortly.`,
    'timeout /t 6 >nul',
    '',
  ].join('\r\n');
}

/** A .ps1 equivalent for shops that prefer PowerShell. */
export function buildInstallerPs1(serverUrl: string, token: string, name: string): string {
  return [
    `# Compliance Enforcement Platform - agent installer for tenant "${name}"`,
    '# The server URL and this tenant enrollment token are baked in below, so',
    '# running this installs the agent already enrolled to this tenant.',
    `$ServerUrl   = '${serverUrl}'`,
    `$EnrollToken = '${token}'`,
    '',
    '$ErrorActionPreference = "Stop"',
    '$id = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '$principal = New-Object Security.Principal.WindowsPrincipal($id)',
    'if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {',
    '  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""',
    '  return',
    '}',
    '',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    '$msi = Join-Path $env:TEMP "cep-agent.msi"',
    'Write-Host "Downloading the CEP agent from $ServerUrl ..."',
    'Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/api/enroll/$EnrollToken/agent.msi" -OutFile $msi',
    `Write-Host "Installing and enrolling to ${name} ..."`,
    '$p = Start-Process msiexec -ArgumentList "/i", "`"$msi`"", "/qn", "SERVERURL=$ServerUrl", "ENROLLTOKEN=$EnrollToken" -Wait -PassThru',
    'Write-Host ("msiexec exit code: {0}" -f $p.ExitCode)',
    `Write-Host "Done. The machine will appear under ${name} in the portal shortly."`,
    '',
  ].join('\r\n');
}
