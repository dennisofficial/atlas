import Joi from 'joi'

export interface IAuthEnv {
  SECRET_KEY: string
  BETTER_AUTH_URL: string
  TRUSTED_ORIGINS?: string
}

export const authEnvSchema = {
  SECRET_KEY: Joi.string().min(32).required(),
  BETTER_AUTH_URL: Joi.string().uri().default('http://localhost:3400'),
  TRUSTED_ORIGINS: Joi.string().optional(),
}
