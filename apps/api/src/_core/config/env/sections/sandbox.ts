import Joi from 'joi'

export interface ISandboxEnv {
  VERCEL_TOKEN?: string
  VERCEL_TEAM_ID?: string
  VERCEL_PROJECT_ID?: string
  ATLAS_CLOUD_URL?: string
  SANDBOX_TTL_MINUTES: number
  SANDBOX_MAX_SESSION_MINUTES: number
}

export const sandboxEnvSchema = {
  VERCEL_TOKEN: Joi.string().optional(),
  VERCEL_TEAM_ID: Joi.string().optional(),
  VERCEL_PROJECT_ID: Joi.string().optional(),
  ATLAS_CLOUD_URL: Joi.string().uri().optional(),
  SANDBOX_TTL_MINUTES: Joi.number().integer().min(1).default(30),
  SANDBOX_MAX_SESSION_MINUTES: Joi.number().integer().min(1).default(240),
}
