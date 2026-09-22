import Joi from 'joi'

export interface ILinearEnv {
  LINEAR_FACTORY_WEBHOOK_SECRET?: string
  LINEAR_CLIENT_ID?: string
  LINEAR_CLIENT_SECRET?: string
}

export const linearEnvSchema = {
  LINEAR_FACTORY_WEBHOOK_SECRET: Joi.string().optional(),
  LINEAR_CLIENT_ID: Joi.string().optional(),
  LINEAR_CLIENT_SECRET: Joi.string().optional(),
}
