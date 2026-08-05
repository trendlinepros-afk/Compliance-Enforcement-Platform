const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
};

/**
 * Normalize a public base URL: trim, drop trailing slashes, and guarantee a
 * scheme. A schemeless value (e.g. PUBLIC_URL set to `foo.up.railway.app`)
 * would otherwise flow into the install one-liner and, worse, into the agent's
 * `SERVERURL` — where `new Uri()` throws on a missing scheme and the agent can
 * never call home. Default to https for anything that isn't an explicit
 * http(s) URL; a bare `localhost[:port]` stays http for local dev.
 */
export const normalizePublicUrl = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const scheme = /^localhost(:\d+)?$/i.test(trimmed) ? 'http' : 'https';
  return `${scheme}://${trimmed}`;
};

export const config = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get jwtSecret() {
    return required('JWT_SECRET');
  },
  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  publicUrl: normalizePublicUrl(process.env.PUBLIC_URL ?? 'http://localhost:8080'),
  port: parseInt(process.env.PORT ?? '8080', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Heartbeat interval the fleet is told to use; "online" = seen within 2.5x this.
  heartbeatSeconds: 300,
  onlineWindowSeconds: 750,
};
