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
