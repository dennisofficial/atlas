import Joi from 'joi'

export interface ITriggerEnv {
  TRIGGER_SECRET_KEY?: string
}

export const triggerEnvSchema = {
  TRIGGER_SECRET_KEY: Joi.string().optional(),
}
