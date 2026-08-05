import crypto from 'crypto';

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Device tokens are stored hashed; comparison is by hash of presented token. */
export function hashDeviceToken(token: string): string {
  return sha256Hex(`cep-device:${token}`);
}

/**
 * Headers for fetching a release MSI from an upstream (GitHub) asset URL.
 * GitHub rejects requests without a User-Agent; a GITHUB_TOKEN is attached when
 * present (needed only for private repos / higher rate limits).
 */
export function msiFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'cep-portal' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
