const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
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
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
  port: parseInt(process.env.PORT ?? '8080', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Heartbeat interval the fleet is told to use; "online" = seen within 2.5x this.
  heartbeatSeconds: 300,
  onlineWindowSeconds: 750,
};
