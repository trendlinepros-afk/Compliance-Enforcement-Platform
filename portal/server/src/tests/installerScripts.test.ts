import { describe, expect, it } from 'vitest';
import {
  buildInstallerCmd,
  buildInstallerPs1,
  installerDisplayName,
  installerFileSlug,
} from '../lib/installerScripts';

const URL = 'https://cep.example.com';
const TOKEN = 'PWR1ZdP0DJkx8XLryqb9go44TQMriMWp';

describe('installerFileSlug', () => {
  it('prefers the slug and keeps it filename-safe', () => {
    expect(installerFileSlug({ slug: 'demo1', name: 'Demo 1' })).toBe('demo1');
    expect(installerFileSlug({ slug: 'Acme, Inc.', name: 'Acme' })).toBe('Acme-Inc.');
    expect(installerFileSlug({ slug: '', name: 'Björk & Co' })).toBe('Bjork-Co');
    expect(installerFileSlug({ slug: '///', name: '???' })).toBe('tenant');
  });
});

describe('installerDisplayName', () => {
  it('strips characters unsafe for a .cmd echo/comment line', () => {
    expect(installerDisplayName('Demo1')).toBe('Demo1');
    expect(installerDisplayName('A & B <corp> | "x" %y%')).not.toMatch(/[&<>|"%^]/);
    expect(installerDisplayName('   ')).toBe('this tenant');
  });
});

describe('buildInstallerCmd', () => {
  const cmd = buildInstallerCmd(URL, TOKEN, 'Demo1');

  it('bakes the server url and enrollment token into the file', () => {
    expect(cmd).toContain(`set "CEP_URL=${URL}"`);
    expect(cmd).toContain(`set "CEP_TOKEN=${TOKEN}"`);
  });

  it('installs with both msiexec properties so a double-click enrolls', () => {
    expect(cmd).toContain("Start-Process msiexec");
    expect(cmd).toContain("('SERVERURL='+$u)");
    expect(cmd).toContain("('ENROLLTOKEN='+$t)");
  });

  it('self-elevates and downloads the MSI through the portal', () => {
    expect(cmd).toContain('net session >nul 2>&1');
    expect(cmd).toContain('Start-Process -Verb RunAs');
    expect(cmd).toContain("'/api/enroll/'+$t+'/agent.msi'");
  });

  it('shows a progress bar, reports completion, and auto-closes', () => {
    expect(cmd).toContain('Write-Progress');
    expect(cmd).toContain('Install complete');
    expect(cmd).toContain('close in 5 seconds');
    expect(cmd).toContain('timeout /t 5');
    expect(cmd.trimEnd().endsWith('exit')).toBe(true);
  });

  it('uses Windows CRLF line endings', () => {
    expect(cmd).toContain('\r\n');
    expect(cmd.startsWith('@echo off')).toBe(true);
  });
});

describe('buildInstallerPs1', () => {
  const ps1 = buildInstallerPs1(URL, TOKEN, 'Demo1');

  it('bakes the server url and enrollment token in', () => {
    expect(ps1).toContain(`$env:CEP_URL   = '${URL}'`);
    expect(ps1).toContain(`$env:CEP_TOKEN = '${TOKEN}'`);
  });

  it('self-elevates and installs with both msiexec properties', () => {
    expect(ps1).toContain('IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
    expect(ps1).toContain("('SERVERURL='+$u)");
    expect(ps1).toContain("('ENROLLTOKEN='+$t)");
    expect(ps1).toContain("'/api/enroll/'+$t+'/agent.msi'");
  });

  it('shows completion and closes its own window', () => {
    expect(ps1).toContain('Write-Progress');
    expect(ps1).toContain('Install complete');
    expect(ps1).toContain('Stop-Process -Id $PID');
  });
});
