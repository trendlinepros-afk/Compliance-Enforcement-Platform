/**
 * Auto-sync agent releases from the project's GitHub Releases.
 *
 * The agent-release.yml workflow builds the MSI on Windows and publishes it as a
 * GitHub Release asset (plus a .sha256 sidecar). This service pulls those
 * releases into the AgentRelease table automatically, so an operator never has
 * to hand-register anything: once CI publishes a release, the portal serves it
 * (the MSI proxy streams the GitHub asset through the portal URL).
 *
 * The repo is public, so no token is required; a GITHUB_TOKEN env var is used if
 * present (private repos / higher rate limits).
 */

import { prisma } from '../db';

const GH_API = 'https://api.github.com';

/** owner/repo the releases come from. Overridable via env for forks. */
export function releaseRepo(): string {
  return process.env.GITHUB_RELEASE_REPO || 'trendlinepros-afk/Compliance-Enforcement-Platform';
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cep-portal',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export interface GhAsset {
  name: string;
  browser_download_url: string;
}
export interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GhAsset[];
}

export interface ReleasePlanItem {
  version: string;
  url: string;
  notes: string;
  shaAsset?: GhAsset;
  isLatest: boolean;
}

/**
 * Pure planning step (unit-tested): from a raw GitHub releases list, pick the
 * non-draft releases that ship an MSI, newest first, and flag the newest as
 * latest. No network, no DB.
 */
export function planReleaseSync(releases: GhRelease[]): ReleasePlanItem[] {
  const usable = releases
    .filter((r) => !r.draft && r.assets.some((a) => /\.msi$/i.test(a.name)))
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  const newestVersion = usable.length ? normVersion(usable[0].tag_name) : '';
  const plan: ReleasePlanItem[] = [];
  for (const rel of usable) {
    const version = normVersion(rel.tag_name);
    if (!version) continue;
    const msi = rel.assets.find((a) => /\.msi$/i.test(a.name))!;
    plan.push({
      version,
      url: msi.browser_download_url,
      notes: (rel.name || rel.body || '').slice(0, 4000),
      shaAsset: rel.assets.find((a) => /\.sha256$/i.test(a.name)),
      isLatest: version === newestVersion,
    });
  }
  return plan;
}

export interface SyncResult {
  ok: boolean;
  repo: string;
  created: number;
  latestVersion: string | null;
  message?: string;
}

const normVersion = (tag: string): string => tag.trim().replace(/^v/i, '');

/**
 * Fetch recent GitHub releases and upsert any that carry an MSI asset. The newest
 * MSI-bearing, non-draft release is marked latest.
 */
export async function syncReleasesFromGitHub(): Promise<SyncResult> {
  const repo = releaseRepo();
  let releases: GhRelease[];
  try {
    const res = await fetch(`${GH_API}/repos/${repo}/releases?per_page=20`, { headers: ghHeaders() });
    if (!res.ok) {
      return { ok: false, repo, created: 0, latestVersion: null, message: `GitHub API ${res.status}` };
    }
    releases = (await res.json()) as GhRelease[];
  } catch (err) {
    return { ok: false, repo, created: 0, latestVersion: null, message: (err as Error).message };
  }

  const plan = planReleaseSync(releases);
  if (plan.length === 0) {
    return { ok: true, repo, created: 0, latestVersion: null, message: 'no MSI releases published yet' };
  }

  let created = 0;
  for (const item of plan) {
    const existing = await prisma.agentRelease.findUnique({ where: { version: item.version } });
    if (existing) {
      // Keep the "latest" pointer in sync; leave uploaded/registered rows alone.
      if (item.isLatest && !existing.isLatest) {
        await prisma.$transaction([
          prisma.agentRelease.updateMany({ data: { isLatest: false } }),
          prisma.agentRelease.update({ where: { id: existing.id }, data: { isLatest: true } }),
        ]);
      }
      continue;
    }

    const sha256 = item.shaAsset ? await fetchSha(item.shaAsset) : '';
    await prisma.$transaction(async (tx) => {
      if (item.isLatest) await tx.agentRelease.updateMany({ data: { isLatest: false } });
      await tx.agentRelease.create({
        data: {
          version: item.version,
          source: 'GITHUB_URL',
          url: item.url,
          sha256,
          notes: item.notes,
          isLatest: item.isLatest,
        },
      });
    });
    created++;
  }

  return { ok: true, repo, created, latestVersion: plan.find((p) => p.isLatest)?.version ?? null };
}

/** Read the SHA-256 from the release's .sha256 sidecar asset (best effort). */
export function extractSha256(text: string): string {
  const m = /[0-9a-fA-F]{64}/.exec(text);
  return m ? m[0].toLowerCase() : '';
}

async function fetchSha(shaAsset: GhAsset): Promise<string> {
  try {
    const res = await fetch(shaAsset.browser_download_url, { headers: { 'User-Agent': 'cep-portal' }, redirect: 'follow' });
    if (!res.ok) return '';
    return extractSha256(await res.text());
  } catch {
    return '';
  }
}

// Lazy throttle so opening the Agent Releases page pulls fresh CI builds without
// hammering the GitHub API.
let lastSync = 0;
const THROTTLE_MS = 60_000;

export async function syncIfStale(): Promise<void> {
  const now = Date.now();
  if (now - lastSync < THROTTLE_MS) return;
  lastSync = now;
  try {
    const r = await syncReleasesFromGitHub();
    if (r.created > 0) console.log(`[release-sync] pulled ${r.created} release(s) from ${r.repo}, latest ${r.latestVersion}`);
  } catch (err) {
    console.warn('[release-sync] failed:', (err as Error).message);
  }
}

/** Reset the throttle so a manual/boot sync always runs. */
export function forceSyncSoon(): void {
  lastSync = 0;
}
