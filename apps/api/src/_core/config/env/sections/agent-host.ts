import Joi from 'joi'

export interface IAgentHostEnv {
  AGENT_HOST_TOKEN?: string | undefined
}

export const agentHostEnvSchema = {
  AGENT_HOST_TOKEN: Joi.string().min(32).optional(),
}
