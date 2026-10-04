import Joi from 'joi';

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  API_PREFIX: string;
  CORS_ORIGINS: string;
  SWAGGER_ENABLED: boolean;
  MONGODB_URI: string;
  MONGODB_DATABASE: string;
  AUTH0_ISSUER_URL: string;
  AUTH0_AUDIENCE: string;
  REDIS_URL: string;
  API_KEY_HASH_SECRET: string;
  MACHINE_AUTH_RATE_LIMIT_PER_MINUTE: number;
  MACHINE_AUTH_RATE_LIMIT_FAILURE_BEHAVIOR: 'allow' | 'deny';
  BUNDLE_SIGNING_PRIVATE_KEY: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_ANALYSIS_MODEL: string;
  ANTHROPIC_POLICY_MODEL: string;
  AI_MODEL_ALLOW_PRIVATE_BASE_URL: boolean;
  TELEMETRY_QUOTA_ENTRIES_PER_TENANT_HOUR: number;
  ANALYSIS_SANDBOX?: 'docker' | 'local-process';
  ANALYSIS_SANDBOX_IMAGE: string;
  ANALYSIS_SANDBOX_RUNTIME: 'runsc' | 'runc';
  ANALYSIS_SANDBOX_MEMORY_MB: number;
  ANALYSIS_SANDBOX_TIMEOUT_MS: number;
  ANALYSIS_MAX_WORK_ITEMS: number;
  ANALYSIS_ITEM_CONCURRENCY: number;
  ANALYSIS_MAX_TURNS_PER_ITEM: number;
  ANALYSIS_ITEM_TOKEN_BUDGET: number;
  AI_PRICE_TABLE?: string;
  ENVIRONMENT_SNAPSHOTS_RETAINED: number;
}

export const environmentSchema = Joi.object<Environment>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(5000),
  API_PREFIX: Joi.string().trim().default('api/v1'),
  CORS_ORIGINS: Joi.string().trim().default('http://localhost:3000'),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  MONGODB_DATABASE: Joi.string().trim().min(1).default('tessera-control-plane'),
  AUTH0_ISSUER_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .required(),
  AUTH0_AUDIENCE: Joi.string().trim().min(1).required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  API_KEY_HASH_SECRET: Joi.string().min(32).required(),
  MACHINE_AUTH_RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).required(),
  MACHINE_AUTH_RATE_LIMIT_FAILURE_BEHAVIOR: Joi.string()
    .valid('allow', 'deny')
    .required(),
  BUNDLE_SIGNING_PRIVATE_KEY: Joi.string()
    .trim()
    .pattern(/-----BEGIN PRIVATE KEY-----/)
    .required(),
  // 32 random bytes, base64. Without it integration credentials cannot be
  // stored or delivered; there is no plaintext fallback.
  CREDENTIAL_ENCRYPTION_KEY: Joi.string()
    .empty('')
    .base64()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === 32
        ? value
        : helpers.error('any.invalid'),
    ),
  GITHUB_APP_ID: Joi.string().empty('').pattern(/^\d+$/),
  GITHUB_APP_PRIVATE_KEY: Joi.string()
    .empty('')
    .pattern(/-----BEGIN [A-Z ]*PRIVATE KEY-----/),
  GITHUB_APP_CLIENT_ID: Joi.string().empty('').trim().min(1),
  GITHUB_APP_CLIENT_SECRET: Joi.string().empty('').min(1),
  ANTHROPIC_API_KEY: Joi.string().empty('').min(1),
  ANTHROPIC_ANALYSIS_MODEL: Joi.string().trim().default('claude-opus-5-5'),
  ANTHROPIC_POLICY_MODEL: Joi.string().trim().default('claude-opus-5-5'),
  // Lets organizations save a `local` AI model at a local, private or
  // plain-http address (ADR-0017). Only for self-hosted control planes.
  AI_MODEL_ALLOW_PRIVATE_BASE_URL: Joi.boolean().default(false),
  TELEMETRY_QUOTA_ENTRIES_PER_TENANT_HOUR: Joi.number()
    .integer()
    .min(1)
    .default(100_000),
  // Repository sandbox (ADR-0013). Without it analyses fail at source fetch.
  ANALYSIS_SANDBOX: Joi.string().empty('').valid('docker', 'local-process'),
  ANALYSIS_SANDBOX_IMAGE: Joi.string()
    .trim()
    .default('tessera-repo-host:latest'),
  ANALYSIS_SANDBOX_RUNTIME: Joi.string()
    .valid('runsc', 'runc')
    .default('runsc'),
  ANALYSIS_SANDBOX_MEMORY_MB: Joi.number()
    .integer()
    .min(256)
    .max(65_536)
    .default(2_048),
  ANALYSIS_SANDBOX_TIMEOUT_MS: Joi.number()
    .integer()
    .min(60_000)
    .max(24 * 60 * 60_000)
    .default(2 * 60 * 60_000),
  ANALYSIS_MAX_WORK_ITEMS: Joi.number()
    .integer()
    .min(1)
    .max(5_000)
    .default(400),
  ANALYSIS_ITEM_CONCURRENCY: Joi.number().integer().min(1).max(32).default(4),
  ANALYSIS_MAX_TURNS_PER_ITEM: Joi.number()
    .integer()
    .min(3)
    .max(100)
    .default(25),
  ANALYSIS_ITEM_TOKEN_BUDGET: Joi.number()
    .integer()
    .min(20_000)
    .max(2_000_000)
    .default(150_000),
  // JSON price overrides: {"model": {"input":4,"output":20,"cacheWrite":5,"cacheRead":0.2}} in USD per million tokens.
  AI_PRICE_TABLE: Joi.string().empty(''),
  ENVIRONMENT_SNAPSHOTS_RETAINED: Joi.number()
    .integer()
    .min(1)
    .max(1_000)
    .default(10),
})
  // The GitHub App is configured completely or not at all.
  .and(
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
  );

/**
 * Validates configuration without echoing values: they are often secrets and
 * Joi's default messages would print them to the logs.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const result = environmentSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
  });
  if (result.error) {
    const problems = result.error.details.map((detail) =>
      detail.path.length > 0
        ? `${detail.path.join('.')} (${detail.type})`
        : detail.message,
    );
    throw new Error(`Config validation error: ${problems.join('; ')}`);
  }
  return result.value;
}
