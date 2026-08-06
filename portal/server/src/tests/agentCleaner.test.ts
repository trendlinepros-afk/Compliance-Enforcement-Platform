import { describe, expect, it } from 'vitest';
import { buildAgentCleanerPs1 } from '../lib/agentCleaner';

describe('buildAgentCleanerPs1', () => {
  const ps = buildAgentCleanerPs1();

  it('self-elevates and needs no server url or token', () => {
    expect(ps).toContain('IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
    expect(ps).not.toContain('SERVERURL');
    expect(ps).not.toContain('ENROLLTOKEN');
  });

  it('targets every agent artifact by its real name', () => {
    expect(ps).toContain('$ServiceName = "CepAgent"');
    expect(ps).toContain('$TaskName    = "CepAgentUpdater"');
    expect(ps).toContain('Join-Path $env:ProgramFiles "CepAgent"');
    expect(ps).toContain('Join-Path $env:ProgramData "CepAgent"');
    expect(ps).toContain('HKLM:\\SYSTEM\\CurrentControlSet\\Services\\CepAgent');
  });

  it('reports found / removed / failed with the file path', () => {
    expect(ps).toContain('$found++');
    expect(ps).toContain('$removed++');
    expect(ps).toContain('$failed++');
    expect(ps).toContain('$f.FullName'); // per-file path in the report
    expect(ps).toMatch(/Found:/);
    expect(ps).toMatch(/Removed:/);
    expect(ps).toMatch(/Failed:/);
  });

  it('loops on -r and closes on -c', () => {
    expect(ps).toContain('Type -r to run the cleaner again, or -c to close');
    expect(ps).toContain('if ($ans -eq "-c") { break }');
    expect(ps).toContain('Stop-Process -Id $PID');
  });
});
