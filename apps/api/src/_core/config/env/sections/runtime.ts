import Joi from 'joi'

export interface IRuntimeEnv {
  APP_TIER: 'local' | 'production'
  PORT: number
  RATE_LIMIT_PER_MINUTE: number
}

export const runtimeEnvSchema = {
  APP_TIER: Joi.string().valid('local', 'production').default('local'),
  PORT: Joi.number().port().default(3400),
  RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).default(100),
}
