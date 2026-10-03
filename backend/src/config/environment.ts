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
  ANALYSIS_STORAGE_DIR: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_ANALYSIS_MODEL: string;
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
  ANALYSIS_STORAGE_DIR: Joi.string().trim().default('./var/analysis-storage'),
  GITHUB_APP_ID: Joi.string().empty('').pattern(/^\d+$/),
  GITHUB_APP_PRIVATE_KEY: Joi.string()
    .empty('')
    .pattern(/-----BEGIN [A-Z ]*PRIVATE KEY-----/),
  GITHUB_APP_CLIENT_ID: Joi.string().empty('').trim().min(1),
  GITHUB_APP_CLIENT_SECRET: Joi.string().empty('').min(1),
  ANTHROPIC_API_KEY: Joi.string().empty('').min(1),
  ANTHROPIC_ANALYSIS_MODEL: Joi.string().trim().default('claude-opus-5-5'),
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
