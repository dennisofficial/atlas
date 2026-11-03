import Joi from 'joi'

export interface IV2Env {
  V2_USER_IDS?: string | undefined
  V2_AGENT_HOST_TOKEN?: string | undefined
}

export const v2EnvSchema = {
  V2_USER_IDS: Joi.string().optional(),
  V2_AGENT_HOST_TOKEN: Joi.string().min(32).optional(),
}
