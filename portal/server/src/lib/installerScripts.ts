/**
 * Per-tenant agent installer scripts. The server URL and the tenant's
 * enrollment token are baked into the file so a double-click (or an RMM push as
 * SYSTEM) installs the agent already enrolled — no arguments to remember. The
 * MSI itself is fetched through the portal at run time, so the script stays
 * tiny and always pulls the current release. Each installer shows a progress
 * bar, prints "Install complete", counts down, and closes its own window.
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
  name.replace(/[^\w .-]+/g, ' ').trim().slice(0, 60) || 'this tenant';

// Shared PowerShell body: download the MSI (BITS for a real progress bar, iwr
// fallback) then install it silently with a Write-Progress bar. Uses only
// single quotes + $env so it can be embedded inside a .cmd `-Command "..."`.
// $env:CEP_URL / $env:CEP_TOKEN are set by the caller.
const PS_INSTALL_BODY =
  "$ErrorActionPreference='Stop'; $u=$env:CEP_URL; $t=$env:CEP_TOKEN; " +
  "$m=Join-Path $env:TEMP 'cep-agent.msi'; $src=$u+'/api/enroll/'+$t+'/agent.msi'; " +
  "Write-Progress -Activity 'CEP Agent' -Status 'Downloading...' -PercentComplete 20; " +
  "try { Import-Module BitsTransfer -ErrorAction Stop; Start-BitsTransfer -Source $src -Destination $m -DisplayName 'Downloading CEP agent' } " +
  "catch { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $src -OutFile $m }; " +
  "Write-Progress -Activity 'CEP Agent' -Status 'Installing...' -PercentComplete 70; " +
  "Start-Process msiexec -ArgumentList '/i',$m,'/qn',('SERVERURL='+$u),('ENROLLTOKEN='+$t) -Wait; " +
  "Write-Progress -Activity 'CEP Agent' -Completed";

/** A .cmd that self-elevates, shows a progress bar, installs enrolled, then auto-closes. */
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
    `set "CEP_URL=${serverUrl}"`,
    `set "CEP_TOKEN=${token}"`,
    '',
    'net session >nul 2>&1',
    'if %errorlevel% neq 0 (',
    '  echo Requesting administrator rights...',
    `  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"`,
    '  exit /b',
    ')',
    '',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${PS_INSTALL_BODY}"`,
    'echo.',
    `echo Install complete. This machine will appear under ${name} in the portal shortly.`,
    'echo This window will close in 5 seconds...',
    'timeout /t 5 /nobreak >nul',
    'exit',
    '',
  ].join('\r\n');
}

/** A .ps1 equivalent for shops that prefer PowerShell. */
export function buildInstallerPs1(serverUrl: string, token: string, name: string): string {
  return [
    `# Compliance Enforcement Platform - agent installer for tenant "${name}"`,
    '# The server URL and this tenant enrollment token are baked in below, so',
    '# running this installs the agent already enrolled to this tenant.',
    `$env:CEP_URL   = '${serverUrl}'`,
    `$env:CEP_TOKEN = '${token}'`,
    '',
    '$ErrorActionPreference = "Stop"',
    '$id = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '$principal = New-Object Security.Principal.WindowsPrincipal($id)',
    'if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {',
    '  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""',
    '  return',
    '}',
    '',
    `${PS_INSTALL_BODY}`,
    "Write-Host ''",
    `Write-Host 'Install complete. This machine will appear under ${name} in the portal shortly.' -ForegroundColor Green`,
    "Write-Host 'This window will close in 5 seconds...' -ForegroundColor Yellow",
    'Start-Sleep -Seconds 5',
    'Stop-Process -Id $PID',
    '',
  ].join('\r\n');
}
