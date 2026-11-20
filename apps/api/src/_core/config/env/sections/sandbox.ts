import Joi from 'joi'

export interface ISandboxEnv {
  VERCEL_TOKEN?: string
  VERCEL_TEAM_ID?: string
  VERCEL_PROJECT_ID?: string
  ATLAS_CLOUD_URL?: string
  SANDBOX_TTL_MINUTES: number
  SANDBOX_MAX_SESSION_MINUTES: number
  SANDBOX_MAX_ACTIVE_PER_USER: number
  SANDBOX_IMAGE: string
  PLATFORM_VERCEL_TOKEN?: string
  PLATFORM_VERCEL_TEAM_ID?: string
  PLATFORM_VERCEL_PROJECT_ID?: string
  AGENT37_API_KEY?: string
  AGENT37_WEBHOOK_SECRET?: string
  ATLAS_TELEMETRY_PEPPER?: string
}

export const sandboxEnvSchema = {
  VERCEL_TOKEN: Joi.string().optional(),
  VERCEL_TEAM_ID: Joi.string().optional(),
  VERCEL_PROJECT_ID: Joi.string().optional(),
  ATLAS_CLOUD_URL: Joi.string().uri().optional(),
  SANDBOX_TTL_MINUTES: Joi.number().integer().min(1).default(30),
  SANDBOX_MAX_SESSION_MINUTES: Joi.number().integer().min(1).default(240),
  SANDBOX_MAX_ACTIVE_PER_USER: Joi.number().integer().min(1).default(3),
  SANDBOX_IMAGE: Joi.string().default('atlas-sandbox:latest'),
  PLATFORM_VERCEL_TOKEN: Joi.string().optional(),
  PLATFORM_VERCEL_TEAM_ID: Joi.string().optional(),
  PLATFORM_VERCEL_PROJECT_ID: Joi.string().optional(),
  AGENT37_API_KEY: Joi.string().optional(),
  AGENT37_WEBHOOK_SECRET: Joi.string().optional(),
  ATLAS_TELEMETRY_PEPPER: Joi.string().optional(),
}
