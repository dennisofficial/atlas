import Joi from 'joi'

export interface ISandboxEnv {
  AGENT37_API_KEY?: string
  AGENT37_WEBHOOK_SECRET?: string
}

export const sandboxEnvSchema = {
  AGENT37_API_KEY: Joi.string().optional(),
  AGENT37_WEBHOOK_SECRET: Joi.string().optional(),
}
