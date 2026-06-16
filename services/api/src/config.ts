import { z } from 'zod';

/**
 * Typed, validated runtime configuration.
 * Parsed once at boot from process.env. Fails fast on missing/invalid values.
 */

const csv = (val: string | undefined): string[] =>
  (val ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('production'),

  apiPort: z.coerce.number().int().positive().default(3000),

  // Public reachability — used to tell carriers (e.g. Twilio) where to send us.
  publicIp: z.string().optional(),
  domain: z.string().optional(),
  sipPort: z.coerce.number().int().positive().default(5060),

  databaseUrl: z.string().min(1, 'DATABASE_URL is required'),
  redisUrl: z.string().min(1, 'REDIS_URL is required'),

  jwt: z.object({
    accessSecret: z.string().min(16, 'JWT_SECRET too short'),
    refreshSecret: z.string().min(16, 'JWT_REFRESH_SECRET too short'),
    accessTtl: z.coerce.number().int().positive().default(900),
    refreshTtl: z.coerce.number().int().positive().default(2_592_000),
  }),

  corsOrigins: z.array(z.string()).default([]),

  encryptionKey: z.string().min(1, 'ENCRYPTION_KEY is required'),

  ari: z.object({
    url: z.string().default('http://asterisk:8088'),
    username: z.string().default('ariuser'),
    password: z.string().default(''),
    app: z.string().default('aipbx'),
    asteriskHost: z.string().default('asterisk'),
    enabled: z.boolean().default(true),
  }),

  aiEngineUrl: z.string().default('http://ai-engine:8080'),
  internalApiKey: z.string().optional(),

  // Data retention: rows (and their S3 objects) older than this are purged by a
  // daily sweep. Per-tenant override via tenants.settings.retention_days.
  retention: z.object({
    enabled: z.boolean().default(true),
    days: z.coerce.number().int().min(1).max(3650).default(90),
    intervalHours: z.coerce.number().int().min(1).max(168).default(24),
  }),

  s3: z.object({
    endpoint: z.string().optional(),
    region: z.string().default('us-east-1'),
    bucket: z.string().default('aipbx-recordings'),
    accessKey: z.string().optional(),
    secretKey: z.string().optional(),
    forcePathStyle: z.boolean().default(false),
  }),

  smtp: z.object({
    host: z.string().optional(),
    port: z.coerce.number().int().positive().default(587),
    user: z.string().optional(),
    password: z.string().optional(),
    from: z.string().default('pbx@example.com'),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = ConfigSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    apiPort: env.API_PORT,
    publicIp: env.PUBLIC_IP,
    domain: env.DOMAIN,
    sipPort: env.ASTERISK_SIP_PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwt: {
      accessSecret: env.JWT_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
    },
    corsOrigins: csv(env.CORS_ORIGINS),
    encryptionKey: env.ENCRYPTION_KEY,
    ari: {
      url: env.ARI_URL,
      username: env.ARI_USERNAME,
      password: env.ARI_PASSWORD,
      app: env.ARI_APP,
      asteriskHost: env.ASTERISK_HOST,
      enabled: env.ARI_ENABLED !== 'false',
    },
    aiEngineUrl: env.AI_ENGINE_URL,
    internalApiKey: env.INTERNAL_API_KEY,
    retention: {
      enabled: env.RETENTION_ENABLED !== 'false',
      days: env.RETENTION_DAYS,
      intervalHours: env.RETENTION_INTERVAL_HOURS,
    },
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
    },
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** For tests: reset the memoized config. */
export function resetConfigCache(): void {
  cached = null;
}
