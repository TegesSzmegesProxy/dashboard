import Joi from 'joi';

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  API_PREFIX: string;
  CORS_ORIGINS: string;
  SWAGGER_ENABLED: boolean;
}

export const environmentSchema = Joi.object<Environment>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(5000),
  API_PREFIX: Joi.string().trim().default('api/v1'),
  CORS_ORIGINS: Joi.string().trim().default('http://localhost:3000'),
  SWAGGER_ENABLED: Joi.boolean().default(true),
});
