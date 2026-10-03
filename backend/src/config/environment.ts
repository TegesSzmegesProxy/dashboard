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
});
