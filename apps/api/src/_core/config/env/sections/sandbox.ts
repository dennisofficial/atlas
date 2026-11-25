import Joi from 'joi'

export interface ISandboxEnv {
  PLATFORM_VERCEL_TOKEN?: string
  PLATFORM_VERCEL_TEAM_ID?: string
  PLATFORM_VERCEL_PROJECT_ID?: string
  AGENT37_API_KEY?: string
  AGENT37_WEBHOOK_SECRET?: string
}

export const sandboxEnvSchema = {
  PLATFORM_VERCEL_TOKEN: Joi.string().optional(),
  PLATFORM_VERCEL_TEAM_ID: Joi.string().optional(),
  PLATFORM_VERCEL_PROJECT_ID: Joi.string().optional(),
  AGENT37_API_KEY: Joi.string().optional(),
  AGENT37_WEBHOOK_SECRET: Joi.string().optional(),
}
