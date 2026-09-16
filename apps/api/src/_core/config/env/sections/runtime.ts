import Joi from 'joi'

export interface IRuntimeEnv {
  APP_TIER: 'local' | 'staging' | 'production'
  PORT: number
}

export const runtimeEnvSchema = {
  APP_TIER: Joi.string().valid('local', 'staging', 'production').default('local'),
  PORT: Joi.number().port().default(3400),
}
