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
    // shell metacharacters must not survive into an echo/title/REM line
    expect(installerDisplayName('A & B <corp> | "x" %y%')).not.toMatch(/[&<>|"%^]/);
    expect(installerDisplayName('   ')).toBe('this tenant');
  });
});

describe('buildInstallerCmd', () => {
  const cmd = buildInstallerCmd(URL, TOKEN, 'Demo1');

  it('bakes the server url and enrollment token into the file', () => {
    expect(cmd).toContain(`set "SERVERURL=${URL}"`);
    expect(cmd).toContain(`set "ENROLLTOKEN=${TOKEN}"`);
  });

  it('installs with both properties so a double-click enrolls', () => {
    expect(cmd).toContain('msiexec /i "%MSI%" /qn SERVERURL="%SERVERURL%" ENROLLTOKEN="%ENROLLTOKEN%"');
  });

  it('self-elevates and downloads the MSI through the portal', () => {
    expect(cmd).toContain('net session >nul 2>&1');
    expect(cmd).toContain('Start-Process -Verb RunAs');
    expect(cmd).toContain('/api/enroll/%ENROLLTOKEN%/agent.msi');
  });

  it('uses Windows CRLF line endings', () => {
    expect(cmd).toContain('\r\n');
    expect(cmd.startsWith('@echo off')).toBe(true);
  });
});

describe('buildInstallerPs1', () => {
  const ps1 = buildInstallerPs1(URL, TOKEN, 'Demo1');

  it('bakes the server url and enrollment token in', () => {
    expect(ps1).toContain(`$ServerUrl   = '${URL}'`);
    expect(ps1).toContain(`$EnrollToken = '${TOKEN}'`);
  });

  it('self-elevates and installs with both msiexec properties', () => {
    expect(ps1).toContain('IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
    expect(ps1).toContain('"SERVERURL=$ServerUrl", "ENROLLTOKEN=$EnrollToken"');
    expect(ps1).toContain('$ServerUrl/api/enroll/$EnrollToken/agent.msi');
  });
});
