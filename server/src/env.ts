import { config } from 'dotenv';
import { z } from 'zod';

// Load .env locally if present
config();

function normalizeOptionalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.replace(/\/+$/, '');
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

const optionalUrlSchema = z.preprocess(
  normalizeOptionalUrl,
  z.string().refine(isAbsoluteUrl, 'Must be a valid absolute URL').optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: z
    .preprocess((val) => {
      if (val === undefined || val === '' || val === 'false' || val === false || val === '0') {
        return false;
      }
      if (val === 'true' || val === true) {
        return true;
      }
      if (typeof val === 'string' && /^\d+$/.test(val) && Number(val) > 0) {
        return Number(val);
      }
      if (typeof val === 'number') {
        return val;
      }
      return false;
    }, z.union([z.boolean(), z.number()]))
    .default(false),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(10000),
  BODY_LIMIT_KB: z.coerce.number().default(100),
  WEB_ALLOWED_ORIGINS: z.preprocess(
    (val) => (typeof val === 'string' ? val.split(',').map((origin) => origin.trim()).filter(Boolean) : []),
    z
      .array(
        z.string().refine((origin) => {
          if (origin.includes('*')) return false;
          try {
            return new URL(origin).origin === origin;
          } catch {
            return false;
          }
        }, 'WEB_ALLOWED_ORIGINS must contain exact origins only'),
      )
      .default([]),
  ),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_DIRECT_URL: z.string().optional(),
  DATABASE_READ_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_PASSWORD: z.string().optional(),

  // Argon2
  ARGON2_MAX_CONCURRENCY: z.coerce.number().default(4),
  ARGON2_TIME_COST: z.coerce.number().default(3),
  ARGON2_MEMORY_COST: z.coerce.number().default(65536),

  // Auth Constants
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().default(30),
  SESSION_IDLE_TTL_DAYS: z.coerce.number().default(7),
  SESSION_CACHE_TTL_SECONDS: z.coerce.number().default(60),
  SESSION_CACHE_IDLE_SECONDS: z.coerce.number().default(60),
  SESSION_CACHE_MAX_SECONDS: z.coerce.number().default(300),
  SESSION_VERIFY_MAX_WAIT_MS: z.coerce.number().default(2000),
  CODE_TTL_SECONDS: z.coerce.number().default(300),
  CODE_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(60),
  MAX_CODE_ATTEMPTS: z.coerce.number().default(5),
  DAILY_CODE_SEND_CAP: z.coerce.number().default(5),
  DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  // Traffic Constants
  HOLD_TTL_SECONDS: z.coerce.number().default(600),
  MAX_SEATS_PER_HOLD: z.coerce.number().default(6),
  WAITING_ROOM_ACTIVE_LIMIT: z.coerce.number().default(100),
  WAITING_ROOM_ADMIT_PER_SEC: z.coerce.number().default(5),
  WAITING_ROOM_ADMIT_PER_SECOND: z.coerce.number().optional(),
  WAITING_ROOM_SLOT_SECONDS: z.coerce.number().default(90),
  SEAT_MAP_CACHE_SECONDS: z.coerce.number().default(2),
  READ_YOUR_WRITES_PIN_SECONDS: z.coerce.number().default(10),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
  SERVICE_FEE_BPS: z.coerce.number().default(500),
  CRON_SECRET: z.string().optional(),

  // On-Demand Showtimes Constants
  ON_DEMAND_DAYS: z.coerce.number().default(7),
  ON_DEMAND_MIN_LEAD_MINUTES: z.coerce.number().default(60),
  ON_DEMAND_SLOTS_PER_MOVIE_PER_DAY: z.coerce.number().default(2),
  ON_DEMAND_MAX_SHOWTIMES_PER_MOVIE: z.coerce.number().default(30),
  ON_DEMAND_MAX_NEW_MOVIES_PER_DAY: z.coerce.number().default(25),
  ON_DEMAND_MAX_ACTIVE_SHOWTIMES: z.coerce.number().default(1000),

  // Rate Limits
  RATE_LIMIT_HOLD_USER: z.coerce.number().default(10),
  RATE_LIMIT_HOLD_IP: z.coerce.number().default(120),
  RATE_LIMIT_CHECKOUT_USER: z.coerce.number().default(5),
  RATE_LIMIT_CHECKOUT_IP: z.coerce.number().default(20),
  RATE_LIMIT_SEARCH_USER: z.coerce.number().default(30),
  RATE_LIMIT_SEARCH_IP: z.coerce.number().default(30),
  RATE_LIMIT_AUTH_IP: z.coerce.number().default(30),
  RATE_LIMIT_ONDEMAND_USER: z.coerce.number().default(5),
  RATE_LIMIT_ONDEMAND_IP: z.coerce.number().default(20),
  ASSISTANT_RATE_USER_PER_MIN: z.coerce.number().int().positive().max(600).default(10),
  ASSISTANT_RATE_IP_PER_MIN: z.coerce.number().int().positive().max(600).default(30),

  // Search Constants
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().default(600),

  // Third Parties
  TMDB_API_TOKEN: z.string().optional(),
  TMDB_ACCESS_TOKEN: z.string().optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_HASH: z.string().optional(),
  PAYMENT_SIMULATOR: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  PUBLIC_API_URL: optionalUrlSchema,
  APP_RETURN_URL: optionalUrlSchema,

  // Email
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@avue.app'),
  MAIL_TEST_TO: z.string().optional(),

  // Observability
  ERROR_TRACKING_DSN: z.string().optional(),

  // Assistant (Ask A VUE, Gemini) - optional at boot; missing key/model => assistant route 503
  GEMINI_API_KEY: z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined),
    z.string().optional(),
  ),
  GEMINI_CHAT_MODEL: z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined),
    z.string().optional(),
  ),
  GEMINI_FALLBACK_MODEL: z.string().optional(),
  // Per-attempt deadline; values below 10000 ms are rejected by Gemini, so generate()
  // clamps to a 10000 ms floor. Blank values fall back to the default.
  GEMINI_ATTEMPT_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || (typeof val === 'string' && val.trim() === '') ? undefined : val),
    z.coerce.number().int().min(2000).max(15000).default(15000),
  ),
  GEMINI_EMBEDDING_MODEL: z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined),
    z.string().optional(),
  ),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(768),

  // Authorization (Task 5)
  ADMIN_EMAILS: z.string().optional().default(''),
}).superRefine((data, ctx) => {
  // In production, require FLUTTERWAVE_SECRET_HASH and FLUTTERWAVE_SECRET_KEY to be non-empty (Task 1)
  if (data.NODE_ENV === 'production') {
    if (!data.FLUTTERWAVE_SECRET_HASH || data.FLUTTERWAVE_SECRET_HASH.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FLUTTERWAVE_SECRET_HASH'],
        message: 'FLUTTERWAVE_SECRET_HASH must be non-empty in production',
      });
    }
    if (!data.FLUTTERWAVE_SECRET_KEY || data.FLUTTERWAVE_SECRET_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FLUTTERWAVE_SECRET_KEY'],
        message: 'FLUTTERWAVE_SECRET_KEY must be non-empty in production',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateSmtpEnv(config: {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  NODE_ENV: string;
}): { mode: 'relay' | 'local'; auth?: { user: string; pass: string } } {
  const user = config.SMTP_USER?.trim();
  const pass = config.SMTP_PASS?.trim();
  const hasUser = Boolean(user && user.length > 0);
  const hasPass = Boolean(pass && pass.length > 0);

  const host = config.SMTP_HOST.trim().toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  // Never Gmail SMTP (Rule 02 / Privacy)
  if (host.includes('gmail.com') || host.includes('googlemail.com')) {
    throw new Error(
      '[FATAL] Invalid SMTP configuration: Gmail SMTP is strictly forbidden (Rule 02 / Privacy).',
    );
  }

  // Real relay mode: both SMTP_USER and SMTP_PASS are set
  if (hasUser && hasPass) {
    if (isLocalHost && config.NODE_ENV === 'production') {
      throw new Error(
        '[FATAL] Invalid SMTP configuration: Localhost SMTP is forbidden in production. Configure a real remote relay.',
      );
    }
    return {
      mode: 'relay',
      auth: { user: user!, pass: pass! },
    };
  }

  // Invalid: only one of SMTP_USER or SMTP_PASS is set
  if (hasUser !== hasPass) {
    throw new Error(
      '[FATAL] Invalid SMTP configuration: Both SMTP_USER and SMTP_PASS must be set together, or both must be omitted.',
    );
  }

  // Invalid: neither is set, but NODE_ENV is production
  if (config.NODE_ENV === 'production') {
    throw new Error(
      '[FATAL] Invalid SMTP configuration: NODE_ENV is production but SMTP_USER and SMTP_PASS are missing.',
    );
  }

  // Invalid: neither is set, but SMTP_HOST is not localhost or 127.0.0.1
  if (!isLocalHost) {
    throw new Error(
      '[FATAL] Invalid SMTP configuration: Unauthenticated SMTP is only allowed when SMTP_HOST is localhost or 127.0.0.1. Set SMTP_USER and SMTP_PASS for remote SMTP_HOST.',
    );
  }

  // Local catcher mode: allowed ONLY when SMTP_HOST is localhost or 127.0.0.1 and NODE_ENV is not production
  return {
    mode: 'local',
  };
}

function validateEnv(sourceEnv: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(sourceEnv);

  if (!result.success) {
    // Extract unique missing or invalid environment key names ONLY
    const badKeys = Array.from(new Set(result.error.issues.map((issue) => issue.path.join('.'))));
    // Print KEY NAMES ONLY; NEVER print or log values (Rule 02)
    const message = `[FATAL] Environment configuration failure. Invalid or missing environment keys: ${badKeys.join(', ')}`;
    throw new Error(message);
  }

  // Refuse boot if PAYMENT_SIMULATOR is true in production (Rule 02)
  if (result.data.NODE_ENV === 'production' && result.data.PAYMENT_SIMULATOR) {
    throw new Error(
      '[FATAL] Production configuration violation: PAYMENT_SIMULATOR must be false in production.',
    );
  }

  // Validate SMTP transport configuration combinations (Task 1)
  validateSmtpEnv(result.data);

  return result.data;
}

export const env = validateEnv(process.env);
export function getTmdbToken(): string | undefined {
  return env.TMDB_API_TOKEN || env.TMDB_ACCESS_TOKEN;
}
export function getSearchCacheTtlSeconds(): number {
  return env.SEARCH_CACHE_TTL_SECONDS;
}
export function getAdminEmails(): string[] {
  const raw = env.ADMIN_EMAILS || process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}
export function isAdmin(email?: string): boolean {
  if (!email) return false;
  const admins = getAdminEmails();
  return admins.includes(email.trim().toLowerCase());
}
export { validateEnv };

