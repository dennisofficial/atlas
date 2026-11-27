import Joi from 'joi'

export interface IAiEnv {
  AI_GATEWAY_API_KEY?: string
}

export const aiEnvSchema = {
  AI_GATEWAY_API_KEY: Joi.string().optional(),
}
