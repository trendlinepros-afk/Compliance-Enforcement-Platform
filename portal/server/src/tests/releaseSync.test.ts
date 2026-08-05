import { describe, expect, it } from 'vitest';
import { extractSha256, planReleaseSync, type GhRelease } from '../services/releaseSync';

const rel = (over: Partial<GhRelease> & { tag: string; msi?: boolean; sha?: boolean; published?: string }): GhRelease => ({
  tag_name: over.tag,
  name: over.name ?? `Agent ${over.tag}`,
  body: over.body ?? '',
  draft: over.draft ?? false,
  prerelease: over.prerelease ?? false,
  published_at: over.published ?? '2026-01-01T00:00:00Z',
  assets: [
    ...(over.msi === false ? [] : [{ name: `cep-agent-${over.tag.replace(/^v/, '')}.msi`, browser_download_url: `https://gh/${over.tag}/agent.msi` }]),
    ...(over.sha ? [{ name: `cep-agent-${over.tag.replace(/^v/, '')}.msi.sha256`, browser_download_url: `https://gh/${over.tag}/agent.msi.sha256` }] : []),
  ],
});

describe('planReleaseSync', () => {
  it('picks MSI-bearing non-draft releases, newest flagged latest', () => {
    const plan = planReleaseSync([
      rel({ tag: 'v1.0.0', sha: true, published: '2026-01-01T00:00:00Z' }),
      rel({ tag: 'v1.2.0', sha: true, published: '2026-03-01T00:00:00Z' }),
      rel({ tag: 'v1.1.0', sha: true, published: '2026-02-01T00:00:00Z' }),
    ]);
    expect(plan.map((p) => p.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']); // newest first
    expect(plan.find((p) => p.isLatest)?.version).toBe('1.2.0');
    expect(plan.filter((p) => p.isLatest)).toHaveLength(1);
  });

  it('strips a leading v and exposes the MSI + sha asset urls', () => {
    const [p] = planReleaseSync([rel({ tag: 'v2.3.4', sha: true })]);
    expect(p.version).toBe('2.3.4');
    expect(p.url).toBe('https://gh/v2.3.4/agent.msi');
    expect(p.shaAsset?.browser_download_url).toBe('https://gh/v2.3.4/agent.msi.sha256');
    expect(p.isLatest).toBe(true);
  });

  it('ignores drafts and releases with no MSI asset', () => {
    const plan = planReleaseSync([
      rel({ tag: 'v3.0.0', draft: true, sha: true, published: '2026-05-01T00:00:00Z' }),
      rel({ tag: 'v2.0.0', msi: false, published: '2026-04-01T00:00:00Z' }),
      rel({ tag: 'v1.9.0', sha: true, published: '2026-03-01T00:00:00Z' }),
    ]);
    expect(plan.map((p) => p.version)).toEqual(['1.9.0']);
    expect(plan[0].isLatest).toBe(true);
  });

  it('handles a release with an MSI but no sha sidecar (sha fetched later)', () => {
    const [p] = planReleaseSync([rel({ tag: 'v1.0.0', sha: false })]);
    expect(p.shaAsset).toBeUndefined();
    expect(p.url).toContain('.msi');
  });

  it('returns empty when nothing qualifies', () => {
    expect(planReleaseSync([])).toEqual([]);
    expect(planReleaseSync([rel({ tag: 'v1.0.0', msi: false })])).toEqual([]);
  });
});

describe('extractSha256', () => {
  it('pulls the 64-hex digest out of a checksum file', () => {
    const line = 'a'.repeat(64) + '  cep-agent-1.0.0.msi';
    expect(extractSha256(line)).toBe('a'.repeat(64));
  });
  it('lowercases and ignores surrounding text', () => {
    expect(extractSha256('SHA256 = ' + 'B'.repeat(64))).toBe('b'.repeat(64));
  });
  it('returns empty when no digest present', () => {
    expect(extractSha256('no hash here')).toBe('');
  });
});
